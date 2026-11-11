use crate::events::*;
use crate::judge::judge;
use crate::store;
use crate::types::*;
use soroban_sdk::{token, Address, Bytes, BytesN, Env, Vec};

pub fn idle_room(env: &Env, id: u32, minute: u32, recent: Vec<Hand>) -> Room {
    let mut seats = Vec::new(env);
    for _ in 0..3 {
        seats.push_back(house_seat(env));
    }
    Room {
        id,
        phase: IDLE,
        hand: 0,
        minute,
        opened: 0,
        deadline: 0,
        reveal_by: 0,
        locked_at: 0,
        commit_secs: 0,
        reveal_secs: 0,
        seats,
        queue: Vec::new(env),
        quiet: 0,
        recent,
    }
}

/// The one way a room goes idle. Keeps `minute` and `recent`, drops any locked seed.
pub fn go_idle(env: &Env, r: &mut Room) {
    if r.phase == LOCKED {
        store::clear_seed(env, r.id);
    }
    *r = idle_room(env, r.id, r.minute, r.recent.clone());
}

pub fn open_minute(env: &Env, r: &mut Room) {
    let cfg = store::config(env);
    let now = env.ledger().timestamp();
    r.hand = store::next_hand(env);
    r.minute += 1;
    r.phase = OPEN;
    r.opened = now;
    r.deadline = now + cfg.commit_secs;
    r.reveal_by = 0;
    r.locked_at = 0;
    r.commit_secs = cfg.commit_secs;
    r.reveal_secs = cfg.reveal_secs;
}

/// Seat index 0..2, NONE when queued, None when absent.
pub fn find(r: &Room, p: &Address) -> Option<u32> {
    for i in 0..3u32 {
        if r.seats.get(i).unwrap().who.as_ref() == Some(p) {
            return Some(i);
        }
    }
    if r.queue.contains(p) {
        return Some(NONE);
    }
    None
}

/// Room the player is verifiably at (hint checked), if any.
pub fn verified_room(env: &Env, p: &Address, hint: u32) -> Option<Room> {
    if hint >= ROOMS {
        return None;
    }
    let r = store::room(env, hint).ok()?;
    find(&r, p).map(|_| r)
}

/// Players (seated or queued) other than `p`.
pub fn others(r: &Room, p: &Address) -> u32 {
    let mut n = 0;
    for s in r.seats.iter() {
        if let Some(w) = s.who {
            if &w != p {
                n += 1;
            }
        }
    }
    for q in r.queue.iter() {
        if &q != p {
            n += 1;
        }
    }
    n
}

pub fn lock(env: &Env, r: &mut Room) {
    let seed: BytesN<32> = env.prng().gen();
    store::set_seed(env, r.id, &seed);
    r.locked_at = env.ledger().sequence();
    r.phase = LOCKED;
    Locked { room: r.id, hand: r.hand }.publish(env);
}

/// After a card goes down in phase 1.
pub fn after_card(env: &Env, r: &mut Room) {
    let mut any_sealed = false;
    for s in r.seats.iter() {
        if s.who.is_some() {
            if s.state == WAITING {
                return;
            }
            if s.state == SEALED {
                any_sealed = true;
            }
        }
    }
    if any_sealed {
        r.phase = REVEAL;
        r.reveal_by = env.ledger().timestamp() + r.reveal_secs;
    } else {
        lock(env, r);
    }
}

pub fn any_sealed(r: &Room) -> bool {
    r.seats.iter().any(|s| s.who.is_some() && s.state == SEALED)
}

pub fn check_card(seat: &Seat, idx: u32, card: u32, target: u32) -> Result<(), Error> {
    if card > TABLE {
        return Err(Error::BadCard);
    }
    if card == IRON {
        if target > 2 || target == idx {
            return Err(Error::BadTarget);
        }
        if seat.bullet < 1 {
            return Err(Error::NoBullet);
        }
    } else if target != NONE {
        return Err(Error::BadTarget);
    }
    Ok(())
}

pub fn commitment(env: &Env, hand: u64, seat: u32, card: u32, target: u32, salt: &BytesN<32>) -> BytesN<32> {
    let mut b = Bytes::from_slice(env, b"third-chair/v2");
    b.extend_from_array(&hand.to_be_bytes());
    b.push_back(seat as u8);
    b.push_back(card as u8);
    b.push_back(target as u8);
    b.append(&Bytes::from(salt.clone()));
    env.crypto().sha256(&b).into()
}

fn house_card(env: &Env, idx: u32) -> (u32, u32) {
    let roll: u64 = env.prng().gen_range(0..7);
    if roll <= 1 {
        (AIR, NONE)
    } else if roll <= 3 {
        (TABLE, NONE)
    } else {
        let others = match idx {
            0 => [1u32, 2],
            1 => [0, 2],
            _ => [0, 1],
        };
        let k: u64 = env.prng().gen_range(0..2);
        (IRON, others[k as usize])
    }
}

fn payout(env: &Env, cfg: &Config, owner: &Address, any_ran: bool, claimed: bool, slept: bool) -> (u32, i128) {
    if any_ran {
        return (NOTE_RAN, 0);
    }
    if !claimed {
        return (NOTE_UNCLAIMED, 0);
    }
    if slept {
        return (NOTE_SLEPT, 0);
    }
    let mut b = store::budget(env);
    let day = env.ledger().timestamp() / 86_400;
    let mut st = store::stats(env, owner);
    if st.day != day {
        st.day = day;
        st.day_paid = 0;
    }
    if b.paid >= cfg.hour_budget || st.day_paid >= cfg.day_cap {
        return (NOTE_RESTING, 0);
    }
    let tok = token::TokenClient::new(env, &cfg.token);
    let me = env.current_contract_address();
    if tok.balance(&me) < cfg.pay {
        return (NOTE_EMPTY, 0);
    }
    match tok.try_transfer(&me, owner, &cfg.pay) {
        Ok(Ok(())) => {}
        _ => return (NOTE_EMPTY, 0),
    }
    b.paid += 1;
    store::set_budget(env, &b);
    st.day_paid += 1;
    store::set_stats(env, owner, &st);
    (NOTE_PAID, cfg.pay)
}

fn board_upsert(env: &Env, row: Row) {
    let mut b = store::board(env);
    let mut found = false;
    for i in 0..b.len() {
        if b.get(i).unwrap().owner == row.owner {
            b.set(i, row.clone());
            found = true;
            break;
        }
    }
    if !found {
        b.push_back(row);
    }
    // insertion sort: wins, then earned, then hits (desc)
    let n = b.len();
    for i in 1..n {
        let mut j = i;
        while j > 0 {
            let a = b.get(j - 1).unwrap();
            let c = b.get(j).unwrap();
            let less = (a.wins, a.earned, a.hits) < (c.wins, c.earned, c.hits);
            if !less {
                break;
            }
            b.set(j - 1, c);
            b.set(j, a);
            j -= 1;
        }
    }
    while b.len() > BOARD_MAX {
        b.pop_back();
    }
    store::set_board(env, &b);
}

pub fn settle(env: &Env, r: &mut Room) {
    let cfg = store::config(env);
    let now = env.ledger().timestamp();
    let seed = store::seed(env, r.id);
    env.prng().seed(Bytes::from(seed));

    let mut cards = [AIR; 3];
    let mut targets = [NONE; 3];
    let mut chairs: [Option<Chair>; 3] = [None, None, None];
    let mut any_ran = false;
    for i in 0..3u32 {
        let s = r.seats.get(i).unwrap();
        let k = i as usize;
        match &s.who {
            None => {
                let (c, t) = house_card(env, i);
                cards[k] = c;
                targets[k] = t;
            }
            Some(p) => {
                chairs[k] = Some(store::chair_or_default(env, p));
                match s.state {
                    SHOWN => {
                        cards[k] = s.card;
                        targets[k] = s.target;
                    }
                    SEALED => {
                        cards[k] = RAN;
                        any_ran = true;
                    }
                    _ => cards[k] = SLEPT,
                }
            }
        }
    }
    let j = judge(cards, targets);

    r.quiet = if j.quiet { r.quiet + 1 } else { 0 };
    let scattered = r.quiet >= 3;
    if scattered {
        r.quiet = 0;
    }

    // payout
    let (mut note, mut paid) = (NOTE_NONE, 0i128);
    if j.winner != NOBODY {
        let k = j.winner as usize;
        match &chairs[k] {
            None => note = NOTE_HOUSE,
            Some(ch) => {
                let (n, p) = payout(env, &cfg, &ch.owner, any_ran, ch.claimed, cards[k] == SLEPT);
                note = n;
                paid = p;
            }
        }
    }

    // stats, board, out
    // Abandoned room: settled more than a full minute after the reveal window would have closed.
    let stale = now > r.deadline + r.reveal_secs + r.commit_secs;
    let queued = !r.queue.is_empty();
    let mut out = [OUT_STAYS; 3];
    for i in 0..3usize {
        let ch = match &chairs[i] {
            Some(c) => c,
            None => continue,
        };
        let mut st = store::stats(env, &ch.owner);
        st.hands += 1;
        if j.hit[i] {
            st.falls += 1;
        }
        if cards[i] == IRON && j.hit[targets[i] as usize] {
            st.hits += 1;
        }
        if cards[i] == RAN {
            st.ran += 1;
        }
        let won = j.winner == i as u32;
        if won {
            st.wins += 1;
            st.earned += paid;
        }
        store::set_stats(env, &ch.owner, &st);
        if won || store::board(env).iter().any(|row| row.owner == ch.owner) {
            board_upsert(
                env,
                Row { owner: ch.owner.clone(), name: ch.name.clone(), wins: st.wins, hits: st.hits, hands: st.hands, earned: st.earned },
            );
        }

        let s = r.seats.get(i as u32).unwrap();
        let missed = if cards[i] == SLEPT { s.missed + 1 } else { 0 };
        out[i] = if cards[i] == RAN {
            OUT_RAN
        } else if cards[i] == SLEPT && (missed >= 2 || queued || stale) {
            OUT_CARRIED
        } else if s.leaving {
            OUT_LEFT
        } else if scattered {
            OUT_SCATTERED
        } else {
            OUT_STAYS
        };
    }

    let mut who = Vec::new(env);
    let mut vc = Vec::new(env);
    let mut vt = Vec::new(env);
    let mut vh = Vec::new(env);
    let mut vo = Vec::new(env);
    for i in 0..3usize {
        who.push_back(r.seats.get(i as u32).unwrap().who);
        vc.push_back(cards[i]);
        vt.push_back(targets[i]);
        vh.push_back(j.hit[i]);
        vo.push_back(out[i]);
    }
    Settled {
        room: r.id,
        hand: r.hand,
        minute: r.minute,
        cards: vc.clone(),
        targets: vt.clone(),
        hit: vh.clone(),
        winner: j.winner,
        paid,
        note,
    }
    .publish(env);
    let hand = Hand {
        hand: r.hand,
        minute: r.minute,
        at: now,
        who,
        cards: vc,
        targets: vt,
        hit: vh,
        out: vo,
        winner: j.winner,
        quiet: j.quiet,
        scattered,
        paid,
        note,
    };
    r.recent.push_front(hand);
    while r.recent.len() > MAX_RECENT {
        r.recent.pop_back();
    }
    store::clear_seed(env, r.id);

    // next minute: keep stayers, stand up the rest
    let mut seats = Vec::new(env);
    let mut players = 0u32;
    for i in 0..3usize {
        let s = r.seats.get(i as u32).unwrap();
        match s.who.clone() {
            Some(p) if out[i] == OUT_STAYS => {
                let mut n = player_seat(env, p, s.claimed);
                n.bullet = if cards[i] == IRON { 0 } else { s.bullet };
                n.missed = if cards[i] == SLEPT { s.missed + 1 } else { 0 };
                seats.push_back(n);
                players += 1;
            }
            Some(p) => {
                Stood { room: r.id, player: p }.publish(env);
                seats.push_back(house_seat(env));
            }
            None => seats.push_back(house_seat(env)),
        }
    }
    // seat the queue: claimed first, then queue order
    let mut order: Vec<(Address, bool)> = Vec::new(env);
    for q in r.queue.iter() {
        let c = store::chair_or_default(env, &q).claimed;
        if c {
            order.push_back((q, c));
        }
    }
    for q in r.queue.iter() {
        let c = store::chair_or_default(env, &q).claimed;
        if !c {
            order.push_back((q, c));
        }
    }
    let mut queue = Vec::new(env);
    for (q, c) in order.iter() {
        let mut placed = false;
        for i in 0..3u32 {
            if seats.get(i).unwrap().who.is_none() {
                seats.set(i, player_seat(env, q.clone(), c));
                Sat { room: r.id, player: q.clone(), seat: i }.publish(env);
                players += 1;
                placed = true;
                break;
            }
        }
        if !placed {
            queue.push_back(q);
        }
    }
    r.seats = seats;
    r.queue = queue;
    if players == 0 {
        go_idle(env, r);
    } else {
        open_minute(env, r);
    }
}

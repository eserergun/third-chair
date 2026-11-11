#![no_std]
//! Third Chair: a three-chair western standoff, settled on chain.

mod events;
mod judge;
mod store;
mod table;
mod types;

#[cfg(test)]
mod test;
#[cfg(test)]
mod test_flow;
#[cfg(test)]
mod testutil;

pub use judge::{judge, Judged};
pub use types::*;

use events::*;
use soroban_sdk::{contract, contractimpl, token, Address, BytesN, Env, String, Vec};
use table::*;

#[contract]
pub struct Standoff;

fn seat_of(r: &Room, p: &Address) -> Result<u32, Error> {
    match find(r, p) {
        Some(i) if i < 3 => Ok(i),
        _ => Err(Error::NotSeated),
    }
}

/// Room for a card call: checks id and hand.
fn card_room(env: &Env, room: u32, hand: u64) -> Result<Room, Error> {
    let r = store::room(env, room)?;
    if r.phase == IDLE || r.hand != hand {
        return Err(Error::Closed);
    }
    Ok(r)
}

/// Stand up `b` without its own auth (used by `accept`, which the owner signed).
fn release_other(env: &Env, r: &mut Room, b: &Address) {
    match find(r, b) {
        None => return,
        Some(NONE) => {
            let i = r.queue.first_index_of(b).unwrap();
            r.queue.remove(i);
            Stood { room: r.id, player: b.clone() }.publish(env);
        }
        Some(i) => {
            let mut s = r.seats.get(i).unwrap();
            s.leaving = true;
            r.seats.set(i, s);
        }
    }
    store::set_room(env, r);
}

/// Fold ASCII lookalikes used to impersonate house names (SPEC rename).
/// `l` / `1` / `|` → `i`, `0` → `o`, then lowercase. Other bytes unchanged aside from case.
fn fold_lookalike(c: u8) -> u8 {
    match c.to_ascii_lowercase() {
        b'l' | b'1' | b'|' => b'i',
        b'0' => b'o',
        x => x,
    }
}

fn is_house_lookalike(s: &[u8]) -> bool {
    // Exact case-insensitive match, or the same length after lookalike folding.
    const HOUSE: [&[u8]; 3] = [b"cal", b"ivy", b"ned"];
    let n = s.len();
    if n > 12 {
        return false;
    }
    let mut folded = [0u8; 12];
    let mut lower = [0u8; 12];
    for i in 0..n {
        lower[i] = s[i].to_ascii_lowercase();
        folded[i] = fold_lookalike(s[i]);
    }
    for h in HOUSE {
        if n != h.len() {
            continue;
        }
        if lower[..n] == h[..] {
            return true;
        }
        let mut hf = [0u8; 12];
        for i in 0..h.len() {
            hf[i] = fold_lookalike(h[i]);
        }
        if folded[..n] == hf[..n] {
            return true;
        }
    }
    false
}

fn valid_name(name: &String) -> bool {
    let n = name.len() as usize;
    if n == 0 || n > 12 {
        return false;
    }
    let mut buf = [0u8; 12];
    name.copy_into_slice(&mut buf[..n]);
    let s = &buf[..n];
    if s[0] == b' ' || s[n - 1] == b' ' {
        return false;
    }
    if !s.iter().all(|c| c.is_ascii_alphanumeric() || *c == b' ') {
        return false;
    }
    if is_house_lookalike(s) {
        return false;
    }
    true
}

#[contractimpl]
impl Standoff {
    pub fn __constructor(
        env: Env,
        admin: Address,
        token: Address,
        commit_secs: u64,
        reveal_secs: u64,
        pay: i128,
        hour_budget: u32,
        day_cap: u32,
    ) {
        store::set_config(&env, &Config { admin, token, commit_secs, reveal_secs, pay, hour_budget, day_cap });
        env.storage().instance().set(&Key::Seq, &0u64);
        for id in 0..ROOMS {
            store::set_room(&env, &idle_room(&env, id, 0, Vec::new(&env)));
        }
        store::set_board(&env, &Vec::new(&env));
        store::touch(&env);
    }

    pub fn sit(env: Env, player: Address, room: u32) -> Result<u32, Error> {
        store::touch(&env);
        let mut r = store::room(&env, room)?;
        player.require_auth();
        let mut chair = store::chair_or_default(&env, &player);
        if let Some(i) = find(&r, &player) {
            return Ok(i);
        }
        if chair.room != room {
            if let Some(mut r2) = verified_room(&env, &player, chair.room) {
                if others(&r2, &player) > 0 {
                    return Err(Error::Elsewhere);
                }
                go_idle(&env, &mut r2);
                store::set_room(&env, &r2);
                Stood { room: r2.id, player: player.clone() }.publish(&env);
            }
        }
        let owner = chair.owner.clone();
        let mut st = store::stats(&env, &owner);
        if let Some(b) = st.busy.clone() {
            if b != player {
                if let Some(bc) = store::chair(&env, &b) {
                    if bc.owner == owner && verified_room(&env, &b, bc.room).is_some() {
                        return Err(Error::OwnerBusy);
                    }
                }
            }
        }
        let seat = if r.phase == IDLE {
            r.seats.set(0, player_seat(&env, player.clone(), chair.claimed));
            open_minute(&env, &mut r);
            0
        } else {
            if r.queue.len() >= MAX_QUEUE {
                return Err(Error::Full);
            }
            // claimed players queue ahead of unclaimed ones
            let mut at = r.queue.len();
            if chair.claimed {
                at = 0;
                for (i, q) in r.queue.iter().enumerate() {
                    if store::chair_or_default(&env, &q).claimed {
                        at = i as u32 + 1;
                    }
                }
            }
            r.queue.insert(at, player.clone());
            NONE
        };
        store::set_room(&env, &r);
        chair.room = room;
        store::set_chair(&env, &player, &chair);
        st.busy = Some(player.clone());
        store::set_stats(&env, &owner, &st);
        Sat { room, player, seat }.publish(&env);
        Ok(seat)
    }

    pub fn leave(env: Env, player: Address, room: u32) -> Result<(), Error> {
        store::touch(&env);
        let mut r = store::room(&env, room)?;
        player.require_auth();
        match find(&r, &player) {
            None => return Ok(()),
            Some(NONE) => {
                let i = r.queue.first_index_of(&player).unwrap();
                r.queue.remove(i);
                Stood { room, player: player.clone() }.publish(&env);
            }
            Some(i) => {
                let mut s = r.seats.get(i).unwrap();
                s.leaving = true;
                r.seats.set(i, s);
                let nobody_down = r.seats.iter().all(|s| s.who.is_none() || s.state == WAITING);
                if r.phase == OPEN && nobody_down && others(&r, &player) == 0 {
                    go_idle(&env, &mut r);
                    Stood { room, player: player.clone() }.publish(&env);
                } else {
                    store::set_room(&env, &r);
                    return Ok(());
                }
            }
        }
        store::set_room(&env, &r);
        // the player is gone from this room: clear hints
        if let Some(mut c) = store::chair(&env, &player) {
            if c.room == room {
                c.room = NONE;
                store::set_chair(&env, &player, &c);
            }
            let mut st = store::stats(&env, &c.owner);
            if st.busy.as_ref() == Some(&player) {
                st.busy = None;
                store::set_stats(&env, &c.owner, &st);
            }
        }
        Ok(())
    }

    pub fn play(env: Env, player: Address, room: u32, hand: u64, card: u32, target: u32) -> Result<(), Error> {
        store::touch(&env);
        let mut r = card_room(&env, room, hand)?;
        player.require_auth();
        if r.phase != OPEN {
            return Err(Error::Closed);
        }
        // Footprint: this call may lock the minute and write Seed(room). Write the (zero) seed on
        // every path, so the footprint and the write bytes match whether or not this call locks.
        store::clear_seed(&env, room);
        let i = seat_of(&r, &player)?;
        let mut s = r.seats.get(i).unwrap();
        if s.state != WAITING {
            return Err(Error::Played);
        }
        for (k, o) in r.seats.iter().enumerate() {
            if k as u32 != i && o.who.is_some() && o.state == WAITING {
                return Err(Error::Choosing);
            }
        }
        check_card(&s, i, card, target)?;
        s.state = SHOWN;
        s.card = card;
        s.target = target;
        r.seats.set(i, s);
        Shown { room, hand, seat: i, card, target }.publish(&env);
        after_card(&env, &mut r);
        store::set_room(&env, &r);
        Ok(())
    }

    pub fn commit(env: Env, player: Address, room: u32, hand: u64, commit: BytesN<32>) -> Result<(), Error> {
        store::touch(&env);
        let mut r = card_room(&env, room, hand)?;
        player.require_auth();
        if r.phase != OPEN {
            return Err(Error::Closed);
        }
        let i = seat_of(&r, &player)?;
        let mut s = r.seats.get(i).unwrap();
        if s.state != WAITING {
            return Err(Error::Played);
        }
        s.state = SEALED;
        s.commit = commit;
        r.seats.set(i, s);
        Sealed { room, hand, seat: i }.publish(&env);
        after_card(&env, &mut r);
        store::set_room(&env, &r);
        Ok(())
    }

    pub fn reveal(
        env: Env,
        player: Address,
        room: u32,
        hand: u64,
        card: u32,
        target: u32,
        salt: BytesN<32>,
    ) -> Result<(), Error> {
        store::touch(&env);
        let mut r = card_room(&env, room, hand)?;
        player.require_auth();
        if r.phase == OPEN {
            return Err(Error::NotReveal);
        }
        if r.phase != REVEAL {
            return Err(Error::Closed);
        }
        // Footprint: the last reveal locks the minute and writes Seed(room). Another reveal in the
        // same ledger can make this one the last, so write the (zero) seed on every path.
        store::clear_seed(&env, room);
        let i = seat_of(&r, &player)?;
        let mut s = r.seats.get(i).unwrap();
        match s.state {
            SEALED => {}
            SHOWN => return Err(Error::Played),
            _ => return Err(Error::Closed), // slept
        }
        if commitment(&env, hand, i, card, target, &salt) != s.commit {
            return Err(Error::BadReveal);
        }
        check_card(&s, i, card, target)?;
        s.state = SHOWN;
        s.card = card;
        s.target = target;
        r.seats.set(i, s);
        Shown { room, hand, seat: i, card, target }.publish(&env);
        if !any_sealed(&r) {
            lock(&env, &mut r);
        }
        store::set_room(&env, &r);
        Ok(())
    }

    pub fn resolve(env: Env, room: u32, hand: u64) -> Result<u32, Error> {
        store::touch(&env);
        let mut r = card_room(&env, room, hand)?;
        let now = env.ledger().timestamp();
        match r.phase {
            OPEN if now >= r.deadline => {
                if any_sealed(&r) {
                    r.phase = REVEAL;
                    r.reveal_by = now.max(r.deadline) + r.reveal_secs;
                } else {
                    lock(&env, &mut r);
                }
            }
            REVEAL if now >= r.reveal_by => lock(&env, &mut r),
            LOCKED if env.ledger().sequence() > r.locked_at => settle(&env, &mut r),
            _ => return Err(Error::NotReady),
        }
        store::set_room(&env, &r);
        Ok(r.phase)
    }

    pub fn offer(env: Env, player: Address, owner: Address) -> Result<(), Error> {
        store::touch(&env);
        player.require_auth();
        if owner == player {
            return Err(Error::BadOwner);
        }
        store::set_offer(&env, &player, &owner);
        if store::chair(&env, &player).is_none() {
            store::set_chair(&env, &player, &default_chair(&env, &player));
        }
        Ok(())
    }

    pub fn accept(env: Env, owner: Address, player: Address) -> Result<(), Error> {
        store::touch(&env);
        owner.require_auth();
        if owner == player {
            return Err(Error::BadOwner);
        }
        if store::offer(&env, &player) != Some(owner.clone()) {
            return Err(Error::NoOffer);
        }
        let mut chair = store::chair_or_default(&env, &player);
        let mut st = store::stats(&env, &owner);
        // One chair per owner. The owner signed this call, so a chair it holds through another
        // session (an old browser or another device) stands up: it leaves the queue at once,
        // or is marked leaving and drops when its minute settles.
        if let Some(b) = st.busy.clone() {
            if b != player {
                if let Some(bc) = store::chair(&env, &b) {
                    if bc.owner == owner {
                        if let Some(mut rb) = verified_room(&env, &b, bc.room) {
                            release_other(&env, &mut rb, &b);
                        }
                    }
                }
                st.busy = None;
                store::set_stats(&env, &owner, &st);
            }
        }
        // Read the player's room after the release, in case both chairs were in one room.
        let at = verified_room(&env, &player, chair.room);
        let old = chair.owner.clone();
        if old != owner {
            let mut os = store::stats(&env, &old);
            if os.busy.as_ref() == Some(&player) {
                os.busy = None;
                store::set_stats(&env, &old, &os);
            }
        }
        chair.owner = owner.clone();
        chair.claimed = true;
        store::set_chair(&env, &player, &chair);
        if let Some(mut r) = at {
            st.busy = Some(player.clone());
            store::set_stats(&env, &owner, &st);
            if let Some(i) = find(&r, &player) {
                if i < 3 {
                    let mut s = r.seats.get(i).unwrap();
                    s.claimed = true;
                    r.seats.set(i, s);
                    store::set_room(&env, &r);
                }
            }
        }
        store::drop_offer(&env, &player);
        Linked { player, owner }.publish(&env);
        Ok(())
    }

    pub fn rename(env: Env, player: Address, name: String, agent: bool) -> Result<(), Error> {
        store::touch(&env);
        player.require_auth();
        if !valid_name(&name) {
            return Err(Error::BadName);
        }
        let mut c = store::chair_or_default(&env, &player);
        c.name = name;
        c.agent = agent;
        store::set_chair(&env, &player, &c);
        Ok(())
    }

    pub fn fund(env: Env, from: Address, amount: i128) -> Result<(), Error> {
        store::touch(&env);
        from.require_auth();
        if amount <= 0 {
            return Err(Error::BadAmount);
        }
        let cfg = store::config(&env);
        token::TokenClient::new(&env, &cfg.token).transfer(&from, &env.current_contract_address(), &amount);
        Funded { from, amount }.publish(&env);
        Ok(())
    }

    pub fn set_config(
        env: Env,
        commit_secs: u64,
        reveal_secs: u64,
        pay: i128,
        hour_budget: u32,
        day_cap: u32,
    ) -> Result<(), Error> {
        store::touch(&env);
        let mut c = store::config(&env);
        c.admin.require_auth();
        if pay < MIN_PAY {
            return Err(Error::BadAmount);
        }
        c.commit_secs = commit_secs;
        c.reveal_secs = reveal_secs;
        c.pay = pay;
        c.hour_budget = hour_budget;
        c.day_cap = day_cap;
        store::set_config(&env, &c);
        Ok(())
    }

    pub fn withdraw(env: Env, to: Address, amount: i128) -> Result<(), Error> {
        store::touch(&env);
        let c = store::config(&env);
        c.admin.require_auth();
        if amount <= 0 {
            return Err(Error::BadAmount);
        }
        token::TokenClient::new(&env, &c.token).transfer(&env.current_contract_address(), &to, &amount);
        Ok(())
    }

    pub fn upgrade(env: Env, wasm_hash: BytesN<32>) {
        store::touch(&env);
        store::config(&env).admin.require_auth();
        env.deployer().update_current_contract(soroban_sdk::ContractExecutable::Wasm(wasm_hash));
    }

    pub fn bump(env: Env) {
        store::bump(&env);
    }

    pub fn config(env: Env) -> Config {
        store::touch(&env);
        store::config(&env)
    }

    pub fn room(env: Env, id: u32) -> Result<Room, Error> {
        store::touch(&env);
        store::room(&env, id)
    }

    pub fn chair(env: Env, player: Address) -> Option<Chair> {
        store::touch(&env);
        store::chair(&env, &player)
    }

    pub fn stats(env: Env, owner: Address) -> Stats {
        store::touch(&env);
        store::stats(&env, &owner)
    }

    pub fn board(env: Env) -> Vec<Row> {
        store::touch(&env);
        store::board(&env)
    }

    pub fn purse(env: Env) -> Purse {
        store::touch(&env);
        let c = store::config(&env);
        let balance = token::TokenClient::new(&env, &c.token).balance(&env.current_contract_address());
        Purse { balance, pay: c.pay, hour_budget: c.hour_budget, hour_paid: store::budget(&env).paid }
    }

    pub fn now(env: Env) -> u64 {
        store::touch(&env);
        env.ledger().timestamp()
    }

    pub fn commitment(env: Env, hand: u64, seat: u32, card: u32, target: u32, salt: BytesN<32>) -> BytesN<32> {
        table::commitment(&env, hand, seat, card, target, &salt)
    }
}

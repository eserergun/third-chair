extern crate std;

use crate::testutil::*;
use crate::Error;
use soroban_sdk::{BytesN, String};

// ---------- solo ----------

#[test]
fn solo_lock_settle_and_paid_win() {
    let t = setup();
    let room = 3;
    let (p, o) = t.claimed();
    assert_eq!(t.c.sit(&p, &room), 0);
    let r = t.room(room);
    assert_eq!((r.phase, r.hand, r.minute), (1, 1, 1));
    assert_eq!(r.deadline, r.opened + 60);
    assert!(r.seats.get(1).unwrap().who.is_none() && r.seats.get(2).unwrap().who.is_none());
    assert_eq!(t.c.stats(&o).busy, Some(p.clone()));

    t.c.play(&p, &room, &1, &A, &N);
    let r = t.room(room);
    assert_eq!(r.phase, 3);
    assert_eq!(r.locked_at, t.env.ledger().sequence());
    // same ledger: not ready
    assert_eq!(t.c.try_resolve(&room, &1), Err(Ok(Error::NotReady)));
    t.step(5, 1);
    assert_eq!(t.c.resolve(&room, &1), 1);
    let r = t.room(room);
    assert_eq!(r.recent.len(), 1);
    assert_eq!(r.recent.get(0).unwrap().hand, 1);
    assert_eq!((r.phase, r.hand, r.minute), (1, 2, 2));
    assert_eq!(r.seats.get(0).unwrap().who, Some(p.clone()));

    // play air until the player is the sole one standing; then it is paid exactly `pay`
    let mut won = false;
    for _ in 0..200 {
        let r = t.room(room);
        if r.phase == 0 {
            t.c.sit(&p, &room);
        }
        let r = t.room(room);
        let before = t.token.balance(&o);
        t.c.play(&p, &room, &r.hand, &A, &N);
        let h = t.settle(room);
        if h.winner == 0 {
            assert_eq!(h.note, 4);
            assert_eq!(h.paid, PAY);
            assert_eq!(t.token.balance(&o) - before, PAY);
            let st = t.c.stats(&o);
            assert_eq!(st.wins, 1);
            assert_eq!(st.earned, PAY);
            let b = t.c.board();
            assert_eq!(b.len(), 1);
            assert_eq!(b.get(0).unwrap().owner, o);
            assert_eq!(t.c.purse().hour_paid, 1);
            won = true;
            break;
        } else {
            assert_eq!(t.token.balance(&o), before);
            assert!(h.note == 0 || h.note == 1);
        }
    }
    assert!(won);
}

#[test]
fn unclaimed_winner_not_paid() {
    let t = setup();
    let (p0, p1, p2) = (t.player(), t.player(), t.player());
    t.table3(0, &p0, &p1, &p2);
    // p1 air, p0 table, p2 table: p1 is the only one standing
    t.round(0, &[(&p0, TB, N), (&p2, TB, N), (&p1, A, N)]);
    let h = t.settle(0);
    assert_eq!(h.winner, t.seat(0, &p1));
    assert_eq!((h.note, h.paid), (2, 0));
}

#[test]
fn slept_winner_not_paid() {
    let t = setup();
    let (p1, o1) = t.claimed();
    let (p0, p2) = (t.player(), t.player());
    t.table3(0, &p0, &p1, &p2);
    let hand = t.room(0).hand;
    let s1 = t.seat(0, &p1);
    // p0 and p2 seal Table; p1 never plays. Its slept card plays Air, so p1 stands alone.
    let salt = BytesN::from_array(&t.env, &[9u8; 32]);
    for p in [&p0, &p2] {
        let s = t.seat(0, p);
        let cm = t.c.commitment(&hand, &s, &TB, &N, &salt);
        t.c.commit(p, &0, &hand, &cm);
    }
    assert_eq!(t.close(0), 2);
    t.c.reveal(&p0, &0, &hand, &TB, &N, &salt);
    t.c.reveal(&p2, &0, &hand, &TB, &N, &salt);
    let before = t.token.balance(&o1);
    let h = t.settle(0);
    assert_eq!(h.cards.get(s1).unwrap(), 4);
    assert_eq!(h.winner, s1);
    assert_eq!((h.note, h.paid), (8, 0));
    assert_eq!(t.token.balance(&o1), before);
    assert_eq!(t.c.purse().hour_paid, 0);
}

// ---------- commit-reveal ----------

#[test]
fn commit_reveal_three_players() {
    let t = setup();
    let room = 1;
    let (p0, o0) = t.claimed();
    let (p1, p2) = (t.player(), t.player());
    t.table3(room, &p0, &p1, &p2);
    let r = t.room(room);
    let hand = r.hand;
    let (s0, s1, s2) = (t.seat(room, &p0), t.seat(room, &p1), t.seat(room, &p2));
    let salt = BytesN::from_array(&t.env, &[9u8; 32]);
    // wrong hand
    assert_eq!(t.c.try_play(&p0, &room, &(hand + 1), &A, &N), Err(Ok(Error::Closed)));
    // p0 cannot play face up while others choose
    assert_eq!(t.c.try_play(&p0, &room, &hand, &A, &N), Err(Ok(Error::Choosing)));
    // reveal too early
    let c0 = t.c.commitment(&hand, &s0, &TB, &N, &salt);
    t.c.commit(&p0, &room, &hand, &c0);
    assert_eq!(t.c.try_play(&p0, &room, &hand, &A, &N), Err(Ok(Error::Played)));
    assert_eq!(t.c.try_commit(&p0, &room, &hand, &c0), Err(Ok(Error::Played)));
    assert_eq!(t.c.try_reveal(&p0, &room, &hand, &TB, &N, &salt), Err(Ok(Error::NotReveal)));
    assert_eq!(t.c.try_play(&p1, &room, &hand, &A, &N), Err(Ok(Error::Choosing)));
    // p1: iron at p2 (sealed)
    let c1 = t.c.commitment(&hand, &s1, &I, &s2, &salt);
    t.c.commit(&p1, &room, &hand, &c1);
    // p2 plays air face up: both others are sealed
    t.c.play(&p2, &room, &hand, &A, &N);
    let r = t.room(room);
    assert_eq!(r.phase, 2);
    assert_eq!(r.reveal_by, t.now() + 45);
    // sealed cards are not public
    assert_eq!(r.seats.get(s0).unwrap().state, 1);
    // bad salt
    let bad = BytesN::from_array(&t.env, &[1u8; 32]);
    assert_eq!(t.c.try_reveal(&p0, &room, &hand, &TB, &N, &bad), Err(Ok(Error::BadReveal)));
    assert_eq!(t.c.try_reveal(&p0, &room, &hand, &A, &N, &salt), Err(Ok(Error::BadReveal)));
    t.c.reveal(&p0, &room, &hand, &TB, &N, &salt);
    assert_eq!(t.room(room).phase, 2);
    t.c.reveal(&p1, &room, &hand, &I, &s2, &salt);
    assert_eq!(t.room(room).phase, 3);
    let h = t.settle(room);
    assert_eq!(h.cards.get(s0).unwrap(), 2);
    assert_eq!(h.cards.get(s1).unwrap(), 1);
    assert_eq!(h.cards.get(s2).unwrap(), 0);
    assert!(h.hit.get(s2).unwrap());
    assert_eq!(h.winner, s1);
    assert_eq!(h.note, 2); // p1 is unclaimed
    assert_eq!(t.c.stats(&p1).hits, 1);
    assert_eq!(t.c.stats(&p2).falls, 1);
    assert_eq!(t.c.stats(&o0).hands, 2);
    // shooter's belt is empty for the rest of the sitting
    let r = t.room(room);
    assert_eq!(r.seats.get(s1).unwrap().bullet, 0);
    assert_eq!(t.c.try_play(&p1, &room, &r.hand, &I, &s0), Err(Ok(Error::Choosing)));
}

#[test]
fn card_validation() {
    let t = setup();
    let p = t.player();
    t.c.sit(&p, &0);
    let h = t.room(0).hand;
    assert_eq!(t.c.try_play(&p, &0, &h, &3, &N), Err(Ok(Error::BadCard)));
    assert_eq!(t.c.try_play(&p, &0, &h, &I, &0), Err(Ok(Error::BadTarget)));
    assert_eq!(t.c.try_play(&p, &0, &h, &I, &3), Err(Ok(Error::BadTarget)));
    assert_eq!(t.c.try_play(&p, &0, &h, &A, &1), Err(Ok(Error::BadTarget)));
    let q = t.player();
    assert_eq!(t.c.try_play(&q, &0, &h, &A, &N), Err(Ok(Error::NotSeated)));
    assert_eq!(t.c.try_play(&p, &9, &h, &A, &N), Err(Ok(Error::NoRoom)));
    t.c.play(&p, &0, &h, &I, &1);
    t.settle(0);
    let r = t.room(0);
    assert_eq!(r.seats.get(0).unwrap().bullet, 0);
    assert_eq!(t.c.try_play(&p, &0, &r.hand, &I, &1), Err(Ok(Error::NoBullet)));
    // old hand is closed
    assert_eq!(t.c.try_play(&p, &0, &h, &A, &N), Err(Ok(Error::Closed)));
    assert_eq!(t.c.try_resolve(&0, &h), Err(Ok(Error::Closed)));
}

// ---------- ran ----------

#[test]
fn ran_means_no_pay_and_runner_stood_up() {
    let t = setup();
    let room = 2;
    let (p0, _o0) = t.claimed();
    let (p1, p2) = (t.player(), t.player());
    t.table3(room, &p0, &p1, &p2);
    let hand = t.room(room).hand;
    let (s0, s1, s2) = (t.seat(room, &p0), t.seat(room, &p1), t.seat(room, &p2));
    let salt = BytesN::from_array(&t.env, &[3u8; 32]);
    // p0 air, p1 table, p2 seals and never reveals. p0 bullet is spent from table3.
    t.c.commit(&p0, &room, &hand, &t.c.commitment(&hand, &s0, &A, &N, &salt));
    t.c.commit(&p2, &room, &hand, &t.c.commitment(&hand, &s2, &TB, &N, &salt));
    t.c.play(&p1, &room, &hand, &TB, &N);
    t.c.reveal(&p0, &room, &hand, &A, &N, &salt);
    let r = t.room(room);
    assert_eq!(r.phase, 2);
    assert_eq!(t.c.try_resolve(&room, &hand), Err(Ok(Error::NotReady)));
    t.step(r.reveal_by - t.now(), 1);
    assert_eq!(t.c.resolve(&room, &hand), 3);
    let h = t.settle(room);
    assert_eq!(h.cards.get(s2).unwrap(), 3);
    assert_eq!(h.out.get(s2).unwrap(), 2);
    assert_eq!(h.winner, s0);
    assert_eq!((h.note, h.paid), (6, 0));
    assert_eq!(t.c.stats(&p2).ran, 1);
    let r = t.room(room);
    assert!(r.seats.get(s2).unwrap().who.is_none());
    assert_eq!(r.seats.get(s1).unwrap().who, Some(p1.clone()));
}

// ---------- slept ----------

#[test]
fn slept_plays_air_and_carried_after_two() {
    let t = setup();
    let p = t.player();
    t.c.sit(&p, &5);
    assert_eq!(t.close(5), 3); // nobody sealed: lock
    let h = t.settle(5);
    assert_eq!(h.cards.get(0).unwrap(), 4);
    assert_eq!(h.out.get(0).unwrap(), 0);
    assert_eq!(t.room(5).seats.get(0).unwrap().missed, 1);
    t.close(5);
    let h = t.settle(5);
    assert_eq!(h.cards.get(0).unwrap(), 4);
    assert_eq!(h.out.get(0).unwrap(), 3);
    let r = t.room(5);
    assert_eq!(r.phase, 0);
    assert_eq!(r.minute, 2);
    assert_eq!(r.recent.len(), 2);
}

#[test]
fn slept_carried_at_once_with_queue() {
    let t = setup();
    let (p, q) = (t.player(), t.player());
    t.c.sit(&p, &5);
    assert_eq!(t.c.sit(&q, &5), 255);
    t.close(5);
    let h = t.settle(5);
    assert_eq!(h.out.get(0).unwrap(), 3);
    let r = t.room(5);
    assert_eq!(r.phase, 1);
    assert_eq!(r.seats.get(0).unwrap().who, Some(q.clone()));
    assert_eq!(r.queue.len(), 0);
}

#[test]
fn slept_carried_when_stale() {
    let t = setup();
    let p = t.player();
    t.c.sit(&p, &5);
    let r = t.room(5);
    t.step(200, 1); // more than deadline + reveal_secs + commit_secs
    t.c.resolve(&5, &r.hand);
    let h = t.settle(5);
    assert_eq!(h.out.get(0).unwrap(), 3);
    assert_eq!(t.room(5).phase, 0);
}

#[test]
fn close_with_sealed_goes_to_reveal() {
    let t = setup();
    let (p0, p1, p2) = (t.player(), t.player(), t.player());
    t.table3(6, &p0, &p1, &p2);
    let hand = t.room(6).hand;
    let s0 = t.seat(6, &p0);
    let salt = BytesN::from_array(&t.env, &[5u8; 32]);
    t.c.commit(&p0, &6, &hand, &t.c.commitment(&hand, &s0, &A, &N, &salt));
    let r = t.room(6);
    t.step(r.deadline - t.now() + 3, 1);
    assert_eq!(t.c.resolve(&6, &hand), 2);
    let r = t.room(6);
    assert_eq!(r.reveal_by, t.now() + 45);
    t.c.reveal(&p0, &6, &hand, &A, &N, &salt);
    assert_eq!(t.room(6).phase, 3);
    let h = t.settle(6);
    assert_eq!(h.cards.get(t.seat(6, &p0)).unwrap(), 0);
    // p1 and p2 slept once, nobody queued: they stay
    assert_eq!(h.out.get(t.seat(6, &p1)).unwrap(), 0);
}

// ---------- scatter ----------

#[test]
fn scatter_after_three_quiet_minutes() {
    let t = setup();
    let room = 7;
    let (p0, p1, p2, q) = (t.player(), t.player(), t.player(), t.player());
    t.table3(room, &p0, &p1, &p2);
    assert_eq!(t.c.sit(&q, &room), 255);
    for k in 0..3 {
        t.round(room, &[(&p0, A, N), (&p1, TB, N), (&p2, A, N)]);
        let h = t.settle(room);
        assert!(h.quiet);
        if k < 2 {
            assert!(!h.scattered);
            assert_eq!(t.room(room).quiet, k + 1);
        } else {
            assert!(h.scattered);
            for i in 0..3 {
                assert_eq!(h.out.get(i).unwrap(), 4);
            }
            let r = t.room(room);
            assert_eq!(r.quiet, 0);
            assert_eq!(r.phase, 1);
            assert_eq!(r.seats.get(0).unwrap().who, Some(q.clone()));
            assert!(r.seats.get(1).unwrap().who.is_none());
            assert_eq!(r.queue.len(), 0);
        }
    }
}

#[test]
fn scatter_without_queue_goes_idle() {
    let t = setup();
    let (p0, p1, p2) = (t.player(), t.player(), t.player());
    t.table3(8, &p0, &p1, &p2);
    for _ in 0..3 {
        t.round(8, &[(&p0, TB, N), (&p1, TB, N), (&p2, TB, N)]);
        t.settle(8);
    }
    let r = t.room(8);
    assert_eq!(r.phase, 0);
    assert_eq!(r.recent.len(), 4);
    // purse stays
    assert_eq!(t.c.purse().balance, 1_000 * PAY);
}

// ---------- leave ----------

#[test]
fn leave_rules() {
    let t = setup();
    let p = t.player();
    // alone, no card: idle at once
    t.c.sit(&p, &0);
    t.c.leave(&p, &0);
    let r = t.room(0);
    assert_eq!((r.phase, r.minute), (0, 1));
    assert_eq!(t.c.chair(&p).unwrap().room, 255);
    assert_eq!(t.c.stats(&p).busy, None);
    // not here: no-op
    t.c.leave(&p, &0);
    assert_eq!(t.c.try_leave(&p, &9), Err(Ok(Error::NoRoom)));
    // card down: dropped at settlement
    t.c.sit(&p, &0);
    let h = t.room(0).hand;
    t.c.play(&p, &0, &h, &TB, &N);
    t.c.leave(&p, &0);
    let r = t.room(0);
    assert_eq!(r.phase, 3);
    assert!(r.seats.get(0).unwrap().leaving);
    let hand = t.settle(0);
    assert_eq!(hand.out.get(0).unwrap(), 1);
    assert_eq!(t.room(0).phase, 0);
    // queued: removed now
    let (a, b) = (t.player(), t.player());
    t.c.sit(&a, &0);
    t.c.sit(&b, &0);
    t.c.leave(&b, &0);
    assert_eq!(t.room(0).queue.len(), 0);
    // seated with others around: stays until settlement
    let c = t.player();
    t.c.sit(&c, &0);
    t.c.leave(&a, &0);
    let r = t.room(0);
    assert_eq!(r.phase, 1);
    assert!(r.seats.get(0).unwrap().leaving);
}

#[test]
fn go_idle_keeps_minute_and_recent() {
    let t = setup();
    let p = t.player();
    t.c.sit(&p, &3);
    t.c.play(&p, &3, &1, &TB, &N);
    t.settle(3);
    let r = t.room(3);
    assert_eq!((r.phase, r.minute, r.recent.len()), (1, 2, 1));
    t.c.leave(&p, &3);
    let r = t.room(3);
    assert_eq!((r.phase, r.hand, r.minute, r.recent.len()), (0, 0, 2, 1));
    assert_eq!((r.opened, r.deadline, r.reveal_by, r.locked_at, r.quiet), (0, 0, 0, 0, 0));
    for i in 0..3 {
        let s = r.seats.get(i).unwrap();
        assert!(s.who.is_none());
        assert_eq!(s.bullet, 1);
    }
}

// ---------- sit ----------

#[test]
fn sit_rules() {
    let t = setup();
    let (p, q) = (t.player(), t.player());
    assert_eq!(t.c.try_sit(&p, &9), Err(Ok(Error::NoRoom)));
    assert_eq!(t.c.sit(&p, &0), 0);
    assert_eq!(t.c.sit(&p, &0), 0); // idempotent
    assert_eq!(t.c.sit(&q, &0), 255);
    assert_eq!(t.c.sit(&q, &0), 255); // idempotent
    assert_eq!(t.room(0).queue.len(), 1);
    // p is with q in room 0: Elsewhere
    assert_eq!(t.c.try_sit(&p, &1), Err(Ok(Error::Elsewhere)));
    assert_eq!(t.c.try_sit(&q, &1), Err(Ok(Error::Elsewhere)));
    // alone elsewhere: moved, the old room goes idle
    let z = t.player();
    t.c.sit(&z, &4);
    assert_eq!(t.c.sit(&z, &5), 0);
    assert_eq!(t.room(4).phase, 0);
    assert_eq!(t.room(5).seats.get(0).unwrap().who, Some(z.clone()));
    // a stale hint is ignored
    t.c.leave(&z, &5);
    assert_eq!(t.c.sit(&z, &4), 0);
    // full queue
    let (a, b, c) = (t.player(), t.player(), t.player());
    t.c.sit(&a, &0);
    t.c.sit(&b, &0);
    assert_eq!(t.c.try_sit(&c, &0), Err(Ok(Error::Full)));
}

#[test]
fn claimed_queue_ahead() {
    let t = setup();
    let p = t.player();
    t.c.sit(&p, &0);
    let u = t.player();
    t.c.sit(&u, &0);
    let (c, _o) = t.claimed();
    t.c.sit(&c, &0);
    let r = t.room(0);
    assert_eq!(r.queue.get(0).unwrap(), c);
    assert_eq!(r.queue.get(1).unwrap(), u);
    // both sit next minute, claimed first (seat 1)
    t.c.play(&p, &0, &r.hand, &TB, &N);
    t.settle(0);
    let r = t.room(0);
    assert_eq!(r.seats.get(1).unwrap().who, Some(c.clone()));
    assert!(r.seats.get(1).unwrap().claimed);
    assert_eq!(r.seats.get(2).unwrap().who, Some(u.clone()));
}

#[test]
fn owner_busy() {
    let t = setup();
    let o = t.player();
    let (a, b) = (t.player(), t.player());
    for x in [&a, &b] {
        t.c.offer(x, &o);
        t.c.accept(&o, x);
    }
    t.c.sit(&a, &0);
    assert_eq!(t.c.try_sit(&b, &1), Err(Ok(Error::OwnerBusy)));
    t.c.leave(&a, &0);
    assert_eq!(t.c.sit(&b, &1), 0);
}

// ---------- offer / accept ----------

#[test]
fn offer_accept_rules() {
    let t = setup();
    let (p, o) = (t.player(), t.player());
    assert_eq!(t.c.try_offer(&p, &p), Err(Ok(Error::BadOwner)));
    assert_eq!(t.c.try_accept(&p, &p), Err(Ok(Error::BadOwner)));
    assert_eq!(t.c.try_accept(&o, &p), Err(Ok(Error::NoOffer)));
    // p sits unclaimed, then links: busy hint moves, seat becomes claimed
    t.c.sit(&p, &2);
    assert_eq!(t.c.stats(&p).busy, Some(p.clone()));
    t.c.offer(&p, &o);
    let other = t.player();
    assert_eq!(t.c.try_accept(&other, &p), Err(Ok(Error::NoOffer)));
    t.c.accept(&o, &p);
    let ch = t.c.chair(&p).unwrap();
    assert_eq!(ch.owner, o);
    assert!(ch.claimed);
    assert_eq!(t.c.stats(&p).busy, None);
    assert_eq!(t.c.stats(&o).busy, Some(p.clone()));
    assert!(t.room(2).seats.get(0).unwrap().claimed);
    // offer removed
    assert_eq!(t.c.try_accept(&o, &p), Err(Ok(Error::NoOffer)));
    // o already has p seated: another seated player cannot join o
    // o links a second seated session q (another device): p, o's old chair, is marked leaving,
    // q is linked, and o's busy hint moves to q.
    let q = t.player();
    t.c.sit(&q, &3);
    t.c.offer(&q, &o);
    t.c.accept(&o, &q);
    assert!(t.room(2).seats.get(0).unwrap().leaving);
    assert!(t.c.chair(&q).unwrap().claimed);
    assert_eq!(t.c.stats(&o).busy, Some(q.clone()));
    // a queued old chair leaves the queue at once
    let (r1, r2) = (t.player(), t.player());
    t.c.sit(&r1, &4);
    t.c.offer(&r2, &o);
    t.c.accept(&o, &r2);
    t.c.sit(&r2, &4); // r2 waits in r1's room queue, owned by o
    let z = t.player();
    t.c.offer(&z, &o);
    t.c.accept(&o, &z);
    assert!(!t.room(4).queue.contains(&r2));
    assert_eq!(t.c.stats(&o).busy, None);
    // offer creates a default chair
    let fresh = t.player();
    t.c.offer(&fresh, &o);
    assert_eq!(t.c.chair(&fresh).unwrap().owner, fresh);
}

// ---------- rename ----------

#[test]
fn rename_rules() {
    let t = setup();
    let p = t.player();
    for bad in ["Cal", "ivy", "NED", "", " Wes", "Wes ", "a_b", "abcdefghijklm"] {
        assert_eq!(t.c.try_rename(&p, &String::from_str(&t.env, bad), &false), Err(Ok(Error::BadName)), "{bad}");
    }
    // ASCII lookalikes of Cal / Ivy (capital i, lowercase L, digit one). Ned has no common ASCII twin.
    for bad in ["CaI", "Cai", "Ca1", "CA1", "lvy", "Lvy", "1vy", "Ivy", "Ned", "nEd"] {
        assert_eq!(t.c.try_rename(&p, &String::from_str(&t.env, bad), &false), Err(Ok(Error::BadName)), "{bad}");
    }
    t.c.rename(&p, &String::from_str(&t.env, "Wes 2"), &true);
    let c = t.c.chair(&p).unwrap();
    assert_eq!(c.name, String::from_str(&t.env, "Wes 2"));
    assert!(c.agent);
    t.c.rename(&p, &String::from_str(&t.env, "Calvin Cord1"), &false);
    // Distinct names that are not lookalikes still pass (3 is not folded to e).
    t.c.rename(&p, &String::from_str(&t.env, "Cab"), &false);
    t.c.rename(&p, &String::from_str(&t.env, "Ivo"), &false);
    t.c.rename(&p, &String::from_str(&t.env, "n3d"), &false);
}

// ---------- budgets and purse ----------

fn quiet_win(t: &T, room: u32, p0: &soroban_sdk::Address, p1: &soroban_sdk::Address, p2: &soroban_sdk::Address) -> crate::Hand {
    t.round(room, &[(p1, TB, N), (p2, TB, N), (p0, A, N)]);
    let h = t.settle(room);
    assert_eq!(h.winner, t.seat(room, p0));
    h
}

#[test]
fn hour_budget_rests_the_purse() {
    let t = setup_with(1_000 * PAY, 1, 25);
    let (p0, o) = t.claimed();
    let (p1, p2) = (t.player(), t.player());
    t.table3(0, &p0, &p1, &p2);
    let h = quiet_win(&t, 0, &p0, &p1, &p2);
    assert_eq!((h.note, h.paid), (4, PAY));
    let h = quiet_win(&t, 0, &p0, &p1, &p2);
    assert_eq!((h.note, h.paid), (7, 0));
    assert_eq!(t.c.stats(&o).wins, 2);
    assert_eq!(t.c.stats(&o).earned, PAY);
    assert_eq!(t.c.purse().hour_paid, 1);
}

#[test]
fn day_cap_rests_the_purse() {
    let t = setup_with(1_000 * PAY, 60, 1);
    let (p0, _o) = t.claimed();
    let (p1, p2) = (t.player(), t.player());
    t.table3(0, &p0, &p1, &p2);
    assert_eq!(quiet_win(&t, 0, &p0, &p1, &p2).note, 4);
    assert_eq!(quiet_win(&t, 0, &p0, &p1, &p2).note, 7);
}

#[test]
fn empty_purse() {
    let t = setup_with(0, 60, 25);
    let (p0, o) = t.claimed();
    let (p1, p2) = (t.player(), t.player());
    t.table3(0, &p0, &p1, &p2);
    let h = quiet_win(&t, 0, &p0, &p1, &p2);
    assert_eq!((h.note, h.paid), (3, 0));
    assert_eq!(t.token.balance(&o), 0);
    // fund it, then the next win pays
    t.sac.mint(&o, &(5 * PAY));
    assert_eq!(t.c.try_fund(&o, &0), Err(Ok(Error::BadAmount)));
    t.c.fund(&o, &(2 * PAY));
    assert_eq!(t.c.purse().balance, 2 * PAY);
    let h = quiet_win(&t, 0, &p0, &p1, &p2);
    assert_eq!(h.note, 4);
}

#[test]
fn set_config_does_not_touch_running_minute() {
    let t = setup();
    let p = t.player();
    t.c.sit(&p, &0);
    let r = t.room(0);
    assert_eq!(t.c.try_set_config(&10, &10, &(PAY - 1), &60, &25), Err(Ok(Error::BadAmount)));
    t.c.set_config(&10, &10, &(2 * PAY), &60, &25);
    let r2 = t.room(0);
    assert_eq!((r2.deadline, r2.commit_secs, r2.reveal_secs), (r.deadline, 60, 45));
    t.step(15, 1);
    assert_eq!(t.c.try_resolve(&0, &r.hand), Err(Ok(Error::NotReady)));
    t.c.play(&p, &0, &r.hand, &TB, &N);
    t.settle(0);
    let r3 = t.room(0);
    assert_eq!(r3.commit_secs, 10);
    assert_eq!(r3.deadline, r3.opened + 10);
    let c = t.c.config();
    assert_eq!((c.commit_secs, c.pay), (10, 2 * PAY));
}

#[test]
fn admin_withdraw_and_bump() {
    let t = setup();
    t.c.bump();
    let to = t.player();
    t.c.withdraw(&to, &PAY);
    assert_eq!(t.token.balance(&to), PAY);
    assert_eq!(t.c.purse().balance, 999 * PAY);
    let _ = (&t.admin, t.c.now());
}

#[test]
fn constructor_writes_idle_rooms_and_board() {
    let t = setup();
    for id in 0..9u32 {
        let r = t.room(id);
        assert_eq!((r.id, r.phase, r.hand, r.minute), (id, 0, 0, 0));
        assert_eq!(r.seats.len(), 3);
    }
    assert_eq!(t.c.try_room(&9), Err(Ok(Error::NoRoom)));
    assert_eq!(t.c.board().len(), 0);
    assert_eq!(t.c.stats(&t.player()).hands, 0);
    assert!(t.c.chair(&t.player()).is_none());
}

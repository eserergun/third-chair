extern crate std;

use crate::testutil::*;
use crate::{judge, Hand, Key, NONE};
use soroban_sdk::xdr::ToXdr;
use soroban_sdk::{Bytes, BytesN, Env};
use std::vec::Vec as SVec;

#[test]
fn judge_matches_fixture() {
    let v: serde_json::Value = serde_json::from_str(include_str!("../../../fixtures/judge.json")).unwrap();
    let cases = v["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 216);
    let arr = |x: &serde_json::Value| -> [u32; 3] {
        let a = x.as_array().unwrap();
        [a[0].as_u64().unwrap() as u32, a[1].as_u64().unwrap() as u32, a[2].as_u64().unwrap() as u32]
    };
    for c in cases {
        let j = judge(arr(&c["cards"]), arr(&c["targets"]));
        let hit: SVec<bool> = c["hit"].as_array().unwrap().iter().map(|b| b.as_bool().unwrap()).collect();
        assert_eq!(j.hit.to_vec(), hit, "hit {c}");
        assert_eq!(j.standing as u64, c["standing"].as_u64().unwrap(), "standing {c}");
        assert_eq!(j.winner as u64, c["winner"].as_u64().unwrap(), "winner {c}");
        assert_eq!(j.quiet, c["quiet"].as_bool().unwrap(), "quiet {c}");
    }
}

#[test]
fn commitment_matches_fixture() {
    let t = setup();
    let v: serde_json::Value = serde_json::from_str(include_str!("../../../fixtures/commit.json")).unwrap();
    for x in v["vectors"].as_array().unwrap() {
        let hand: u64 = x["hand"].as_str().unwrap().parse().unwrap();
        let salt: [u8; 32] = hex::decode(x["salt"].as_str().unwrap()).unwrap().try_into().unwrap();
        let want: [u8; 32] = hex::decode(x["commit"].as_str().unwrap()).unwrap().try_into().unwrap();
        let got = t.c.commitment(
            &hand,
            &(x["seat"].as_u64().unwrap() as u32),
            &(x["card"].as_u64().unwrap() as u32),
            &(x["target"].as_u64().unwrap() as u32),
            &BytesN::from_array(&t.env, &salt),
        );
        assert_eq!(got.to_array(), want, "vector {x}");
    }
}

fn xdr<T: ToXdr>(env: &Env, v: T) -> SVec<u8> {
    let b: Bytes = v.to_xdr(env);
    b.iter().collect()
}

/// XDR of the events of the last invocation.
fn event_bytes(env: &Env) -> SVec<u8> {
    use soroban_sdk::testutils::Events as _;
    use soroban_sdk::xdr::{Limits, WriteXdr};
    let all = env.events().all();
    let mut out = SVec::new();
    for e in all.events() {
        out.extend(e.to_xdr(Limits::none()).unwrap());
    }
    assert!(!out.is_empty());
    out
}

fn stored_seed(t: &T, room: u32) -> Option<BytesN<32>> {
    t.env.as_contract(&t.id, || t.env.storage().persistent().get(&Key::Seed(room)))
}

/// Plays `rounds` solo minutes. Before each lock the base PRNG seed is `lock_seed(k)`;
/// before each settle it is `settle_seed(k)`. Returns the settled hands.
fn run(rounds: u8, settle_salt: u8) -> SVec<Hand> {
    let t = setup();
    let room = 4;
    let (p, _o) = t.claimed();
    let mut out = SVec::new();
    for k in 0..rounds {
        let r = t.room(room);
        if r.phase == 0 {
            t.c.sit(&p, &room);
        }
        let r = t.room(room);
        t.env.host().set_base_prng_seed([k; 32]).unwrap();
        t.c.play(&p, &room, &r.hand, &A, &N);
        let lock_events = event_bytes(&t.env);
        // the lock happened: the seed is stored but never visible
        let seed = stored_seed(&t, room).expect("seed stored at lock");
        let s = seed.to_array();
        assert!(!bytes_contain(&xdr(&t.env, t.c.room(&room)), &s));
        for id in 0..9u32 {
            assert!(!bytes_contain(&xdr(&t.env, t.c.room(&id)), &s));
        }
        assert!(!bytes_contain(&xdr(&t.env, t.c.config()), &s));
        assert!(!bytes_contain(&xdr(&t.env, t.c.board()), &s));
        assert!(!bytes_contain(&xdr(&t.env, t.c.purse()), &s));
        assert!(!bytes_contain(&xdr(&t.env, t.c.stats(&p)), &s));
        assert!(!bytes_contain(&xdr(&t.env, t.c.chair(&p)), &s));
        assert!(!bytes_contain(&xdr(&t.env, t.c.now()), &s));
        assert!(!bytes_contain(&lock_events, &s));
        // settlement under a different base PRNG
        t.env.host().set_base_prng_seed([settle_salt.wrapping_add(k); 32]).unwrap();
        t.step(5, 1);
        t.c.resolve(&room, &r.hand);
        assert!(!bytes_contain(&event_bytes(&t.env), &s));
        let h = t.room(room).recent.get(0).unwrap();
        assert_eq!(h.hand, r.hand);
        assert_eq!(
            stored_seed(&t, room).map(|b| b.to_array()),
            Some([0u8; 32]),
            "seed cleared to zero at settle"
        );
        assert!(!bytes_contain(&xdr(&t.env, t.c.room(&room)), &s));
        out.push(h);
    }
    out
}

#[test]
fn settlement_ignores_settle_time_prng() {
    let a = run(12, 100);
    let b = run(12, 200);
    assert_eq!(a.len(), 12);
    assert_eq!(a, b);
    // house cards are not constant: the seed drives them
    let distinct: std::collections::BTreeSet<SVec<u32>> =
        a.iter().map(|h| h.cards.iter().collect::<SVec<u32>>()).collect();
    assert!(distinct.len() > 1);
}

#[test]
fn seat_none_constant() {
    assert_eq!(NONE, 255);
}

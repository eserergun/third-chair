use crate::types::*;
use soroban_sdk::{Address, BytesN, Env, Vec};

pub const DAY: u32 = 17_280;
pub const TTL_THRESHOLD: u32 = 7 * DAY;
pub const TTL_EXTEND: u32 = 30 * DAY;

pub fn touch(env: &Env) {
    env.storage().instance().extend_ttl(TTL_THRESHOLD, TTL_EXTEND);
}

fn put<V: soroban_sdk::IntoVal<Env, soroban_sdk::Val>>(env: &Env, key: &Key, v: &V) {
    let p = env.storage().persistent();
    p.set(key, v);
    p.extend_ttl(key, TTL_THRESHOLD, TTL_EXTEND);
}

pub fn config(env: &Env) -> Config {
    env.storage().instance().get(&Key::Config).unwrap()
}
pub fn set_config(env: &Env, c: &Config) {
    env.storage().instance().set(&Key::Config, c);
}

pub fn next_hand(env: &Env) -> u64 {
    let i = env.storage().instance();
    let s: u64 = i.get(&Key::Seq).unwrap_or(0) + 1;
    i.set(&Key::Seq, &s);
    s
}

pub fn budget(env: &Env) -> Budget {
    let hour = env.ledger().timestamp() / 3600;
    let b: Budget = env.storage().instance().get(&Key::Budget).unwrap_or(Budget { hour, paid: 0 });
    if b.hour != hour { Budget { hour, paid: 0 } } else { b }
}
pub fn set_budget(env: &Env, b: &Budget) {
    env.storage().instance().set(&Key::Budget, b);
}

pub fn room(env: &Env, id: u32) -> Result<Room, Error> {
    if id >= ROOMS {
        return Err(Error::NoRoom);
    }
    Ok(env.storage().persistent().get(&Key::Room(id)).unwrap())
}
pub fn set_room(env: &Env, r: &Room) {
    put(env, &Key::Room(r.id), r);
}

/// The house seed of a room. The entry always has the same size (all zero while no minute is
/// locked), so a call that may or may not lock the minute declares the same footprint and the
/// same write bytes on every path.
pub fn seed(env: &Env, id: u32) -> BytesN<32> {
    env.storage()
        .persistent()
        .get(&Key::Seed(id))
        .unwrap_or_else(|| BytesN::from_array(env, &[0u8; 32]))
}
pub fn set_seed(env: &Env, id: u32, s: &BytesN<32>) {
    put(env, &Key::Seed(id), s);
}
/// Write the zero seed. Used when no seed may exist (phases 1 and 2) and after settlement.
pub fn clear_seed(env: &Env, id: u32) {
    put(env, &Key::Seed(id), &BytesN::from_array(env, &[0u8; 32]));
}

pub fn chair(env: &Env, p: &Address) -> Option<Chair> {
    env.storage().persistent().get(&Key::Chair(p.clone()))
}
pub fn chair_or_default(env: &Env, p: &Address) -> Chair {
    chair(env, p).unwrap_or_else(|| default_chair(env, p))
}
pub fn set_chair(env: &Env, p: &Address, c: &Chair) {
    put(env, &Key::Chair(p.clone()), c);
}

pub fn stats(env: &Env, o: &Address) -> Stats {
    env.storage().persistent().get(&Key::Stats(o.clone())).unwrap_or_else(default_stats)
}
pub fn set_stats(env: &Env, o: &Address, s: &Stats) {
    put(env, &Key::Stats(o.clone()), s);
}

pub fn offer(env: &Env, p: &Address) -> Option<Address> {
    env.storage().persistent().get(&Key::Offer(p.clone()))
}
pub fn set_offer(env: &Env, p: &Address, o: &Address) {
    let k = Key::Offer(p.clone());
    let s = env.storage().persistent();
    s.set(&k, o);
    s.extend_ttl(&k, DAY, DAY);
}
pub fn drop_offer(env: &Env, p: &Address) {
    env.storage().persistent().remove(&Key::Offer(p.clone()));
}

pub fn board(env: &Env) -> Vec<Row> {
    env.storage().persistent().get(&Key::Board).unwrap_or_else(|| Vec::new(env))
}
pub fn set_board(env: &Env, b: &Vec<Row>) {
    put(env, &Key::Board, b);
}

pub fn bump(env: &Env) {
    touch(env);
    let p = env.storage().persistent();
    for id in 0..ROOMS {
        let k = Key::Room(id);
        if p.has(&k) {
            p.extend_ttl(&k, TTL_THRESHOLD, TTL_EXTEND);
        }
    }
    if p.has(&Key::Board) {
        p.extend_ttl(&Key::Board, TTL_THRESHOLD, TTL_EXTEND);
    }
}

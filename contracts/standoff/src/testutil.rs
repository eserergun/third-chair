extern crate std;

use crate::{Hand, Room, Standoff, StandoffClient, AIR, IRON, NONE, TABLE};
use soroban_sdk::testutils::{Address as _, EnvTestConfig, Ledger};
use soroban_sdk::token::{StellarAssetClient, TokenClient};
use soroban_sdk::{Address, BytesN, Env};

pub const PAY: i128 = 10_000_000;

pub struct T<'a> {
    pub env: Env,
    pub c: StandoffClient<'a>,
    pub id: Address,
    pub admin: Address,
    pub token: TokenClient<'a>,
    pub sac: StellarAssetClient<'a>,
}

pub fn setup_with(purse: i128, hour_budget: u32, day_cap: u32) -> T<'static> {
    let env = Env::new_with_config(EnvTestConfig { capture_snapshot_at_drop: false });
    env.mock_all_auths();
    env.ledger().with_mut(|l| {
        l.sequence_number = 1_000;
        l.timestamp = 1_700_000_000;
    });
    let admin = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let token_id = sac.address();
    let id = env.register(Standoff, (admin.clone(), token_id.clone(), 60u64, 45u64, PAY, hour_budget, day_cap));
    let c = StandoffClient::new(&env, &id);
    let token = TokenClient::new(&env, &token_id);
    let sac = StellarAssetClient::new(&env, &token_id);
    if purse > 0 {
        sac.mint(&id, &purse);
    }
    T { env, c, id, admin, token, sac }
}

pub fn setup() -> T<'static> {
    setup_with(1_000 * PAY, 60, 25)
}

impl<'a> T<'a> {
    pub fn step(&self, secs: u64, ledgers: u32) {
        self.env.ledger().with_mut(|l| {
            l.timestamp += secs;
            l.sequence_number += ledgers;
        });
    }
    pub fn now(&self) -> u64 {
        self.env.ledger().timestamp()
    }
    pub fn room(&self, id: u32) -> Room {
        self.c.room(&id)
    }
    pub fn player(&self) -> Address {
        Address::generate(&self.env)
    }
    /// A player claimed by a fresh owner. Returns (player, owner).
    pub fn claimed(&self) -> (Address, Address) {
        let p = self.player();
        let o = self.player();
        self.c.offer(&p, &o);
        self.c.accept(&o, &p);
        (p, o)
    }
    /// Phase 3 -> next ledger -> settle. Returns the new Hand.
    pub fn settle(&self, room: u32) -> Hand {
        let r = self.room(room);
        assert_eq!(r.phase, 3);
        self.step(5, 1);
        self.c.resolve(&room, &r.hand);
        self.room(room).recent.get(0).unwrap()
    }
    /// Close an open minute (past deadline), then lock or reveal as the rules say.
    pub fn close(&self, room: u32) -> u32 {
        let r = self.room(room);
        assert_eq!(r.phase, 1);
        let now = self.now();
        if now < r.deadline {
            self.step(r.deadline - now, 1);
        }
        self.c.resolve(&room, &r.hand)
    }
    /// Seat index of p in room (panics if absent).
    pub fn seat(&self, room: u32, p: &Address) -> u32 {
        let r = self.room(room);
        for i in 0..3u32 {
            if r.seats.get(i).unwrap().who.as_ref() == Some(p) {
                return i;
            }
        }
        panic!("not seated");
    }
    /// p0 sits, p1 and p2 queue, p0 fires iron at a house seat (minute not quiet), settle:
    /// all three end up seated in the next minute.
    pub fn table3(&self, room: u32, p0: &Address, p1: &Address, p2: &Address) {
        assert_eq!(self.c.sit(p0, &room), 0);
        assert_eq!(self.c.sit(p1, &room), NONE);
        assert_eq!(self.c.sit(p2, &room), NONE);
        let r = self.room(room);
        self.c.play(p0, &room, &r.hand, &IRON, &1);
        let h = self.settle(room);
        assert!(!h.quiet);
        let r = self.room(room);
        assert_eq!(r.phase, 1);
        // p0 may have been hit or fallen; it stays seated either way (it did not run or sleep)
        for p in [p0, p1, p2] {
            self.seat(room, p);
        }
        assert_eq!(r.queue.len(), 0);
    }
    /// Every seated player puts a card down: all but the last seal, the last plays face up,
    /// then the sealed ones reveal. cards are (player, card, target).
    pub fn round(&self, room: u32, plays: &[(&Address, u32, u32)]) {
        let r = self.room(room);
        let hand = r.hand;
        let salt = BytesN::from_array(&self.env, &[7u8; 32]);
        let n = plays.len();
        for (k, (p, card, target)) in plays.iter().enumerate() {
            if k + 1 < n {
                let s = self.seat(room, p);
                let cm = self.c.commitment(&hand, &s, card, target, &salt);
                self.c.commit(p, &room, &hand, &cm);
            } else {
                self.c.play(p, &room, &hand, card, target);
            }
        }
        for (k, (p, card, target)) in plays.iter().enumerate() {
            if k + 1 < n {
                self.c.reveal(p, &room, &hand, card, target, &salt);
            }
        }
        assert_eq!(self.room(room).phase, 3);
    }
}

pub const A: u32 = AIR;
pub const I: u32 = IRON;
pub const TB: u32 = TABLE;
pub const N: u32 = NONE;

pub fn bytes_contain(hay: &[u8], needle: &[u8]) -> bool {
    hay.windows(needle.len()).any(|w| w == needle)
}

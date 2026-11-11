use soroban_sdk::{contracterror, contracttype, Address, BytesN, Env, String, Vec};

pub const ROOMS: u32 = 9;
pub const NONE: u32 = 255; // "no target" and "no room"
pub const NOBODY: u32 = 3; // no winner
pub const MAX_QUEUE: u32 = 3;
pub const MAX_RECENT: u32 = 8;
pub const BOARD_MAX: u32 = 10;
pub const MIN_PAY: i128 = 10_000_000;

pub const AIR: u32 = 0;
pub const IRON: u32 = 1;
pub const TABLE: u32 = 2;
pub const RAN: u32 = 3;
pub const SLEPT: u32 = 4;

pub const WAITING: u32 = 0;
pub const SEALED: u32 = 1;
pub const SHOWN: u32 = 2;

pub const IDLE: u32 = 0;
pub const OPEN: u32 = 1;
pub const REVEAL: u32 = 2;
pub const LOCKED: u32 = 3;

pub const OUT_STAYS: u32 = 0;
pub const OUT_LEFT: u32 = 1;
pub const OUT_RAN: u32 = 2;
pub const OUT_CARRIED: u32 = 3;
pub const OUT_SCATTERED: u32 = 4;

pub const NOTE_NONE: u32 = 0;
pub const NOTE_HOUSE: u32 = 1;
pub const NOTE_UNCLAIMED: u32 = 2;
pub const NOTE_EMPTY: u32 = 3;
pub const NOTE_PAID: u32 = 4;
pub const NOTE_RAN: u32 = 6;
pub const NOTE_RESTING: u32 = 7;
/// The winner slept (never put a card down): the slept card plays Air, but a sleeper is not paid.
pub const NOTE_SLEPT: u32 = 8;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Key {
    Config,
    Seq,
    Budget,
    Room(u32),
    Seed(u32), // NEVER returned by any function
    Chair(Address),
    Stats(Address),
    Offer(Address),
    Board,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Config {
    pub admin: Address,
    pub token: Address,
    pub commit_secs: u64,
    pub reveal_secs: u64,
    pub pay: i128,
    pub hour_budget: u32,
    pub day_cap: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Budget {
    pub hour: u64,
    pub paid: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Seat {
    pub who: Option<Address>,
    pub claimed: bool,
    pub state: u32,
    pub commit: BytesN<32>,
    pub card: u32,
    pub target: u32,
    pub bullet: u32,
    pub leaving: bool,
    pub missed: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Hand {
    pub hand: u64,
    pub minute: u32,
    pub at: u64,
    pub who: Vec<Option<Address>>,
    pub cards: Vec<u32>,
    pub targets: Vec<u32>,
    pub hit: Vec<bool>,
    pub out: Vec<u32>,
    pub winner: u32,
    pub quiet: bool,
    pub scattered: bool,
    pub paid: i128,
    pub note: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Room {
    pub id: u32,
    pub phase: u32,
    pub hand: u64,
    pub minute: u32,
    pub opened: u64,
    pub deadline: u64,
    pub reveal_by: u64,
    pub locked_at: u32,
    pub commit_secs: u64,
    pub reveal_secs: u64,
    pub seats: Vec<Seat>,
    pub queue: Vec<Address>,
    pub quiet: u32,
    pub recent: Vec<Hand>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Chair {
    pub owner: Address,
    pub claimed: bool,
    pub agent: bool,
    pub name: String,
    pub room: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Stats {
    pub busy: Option<Address>,
    pub hands: u32,
    pub wins: u32,
    pub hits: u32,
    pub falls: u32,
    pub ran: u32,
    pub earned: i128,
    pub day: u64,
    pub day_paid: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Row {
    pub owner: Address,
    pub name: String,
    pub wins: u32,
    pub hits: u32,
    pub hands: u32,
    pub earned: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Purse {
    pub balance: i128,
    pub pay: i128,
    pub hour_budget: u32,
    pub hour_paid: u32,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NoRoom = 1,
    NotSeated = 2,
    Closed = 3,
    Played = 4,
    BadCard = 5,
    BadTarget = 6,
    NoBullet = 7,
    BadReveal = 8,
    Elsewhere = 9,
    OwnerBusy = 10,
    Full = 11,
    NotReady = 12,
    Choosing = 13,
    NoOffer = 14,
    BadName = 16,
    BadAmount = 17,
    NotReveal = 18,
    BadOwner = 19,
}

pub fn zero32(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[0u8; 32])
}

pub fn house_seat(env: &Env) -> Seat {
    Seat {
        who: None,
        claimed: false,
        state: WAITING,
        commit: zero32(env),
        card: AIR,
        target: NONE,
        bullet: 1,
        leaving: false,
        missed: 0,
    }
}

pub fn player_seat(env: &Env, who: Address, claimed: bool) -> Seat {
    Seat { who: Some(who), claimed, ..house_seat(env) }
}

pub fn default_chair(env: &Env, player: &Address) -> Chair {
    Chair { owner: player.clone(), claimed: false, agent: false, name: String::from_str(env, ""), room: NONE }
}

pub fn default_stats() -> Stats {
    Stats { busy: None, hands: 0, wins: 0, hits: 0, falls: 0, ran: 0, earned: 0, day: 0, day_paid: 0 }
}

use soroban_sdk::{contractevent, Address, Vec};

#[contractevent]
pub struct Sat {
    #[topic]
    pub room: u32,
    #[topic]
    pub player: Address,
    pub seat: u32,
}

#[contractevent]
pub struct Stood {
    #[topic]
    pub room: u32,
    #[topic]
    pub player: Address,
}

#[contractevent]
pub struct Sealed {
    #[topic]
    pub room: u32,
    pub hand: u64,
    pub seat: u32,
}

#[contractevent]
pub struct Shown {
    #[topic]
    pub room: u32,
    pub hand: u64,
    pub seat: u32,
    pub card: u32,
    pub target: u32,
}

#[contractevent]
pub struct Locked {
    #[topic]
    pub room: u32,
    pub hand: u64,
}

#[contractevent]
pub struct Settled {
    #[topic]
    pub room: u32,
    pub hand: u64,
    pub minute: u32,
    pub cards: Vec<u32>,
    pub targets: Vec<u32>,
    pub hit: Vec<bool>,
    pub winner: u32,
    pub paid: i128,
    pub note: u32,
}

#[contractevent]
pub struct Linked {
    #[topic]
    pub player: Address,
    #[topic]
    pub owner: Address,
}

#[contractevent]
pub struct Funded {
    #[topic]
    pub from: Address,
    pub amount: i128,
}

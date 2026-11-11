use crate::types::{AIR, IRON, NOBODY, RAN, SLEPT, TABLE};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Judged {
    pub hit: [bool; 3],
    pub standing: u32,
    pub winner: u32,
    pub quiet: bool,
}

/// Cards: 0 air, 1 iron, 2 table, 3 ran, 4 slept (plays as air).
pub fn judge(cards: [u32; 3], targets: [u32; 3]) -> Judged {
    let mut hit = [false; 3];
    let mut quiet = true;
    for j in 0..3 {
        if cards[j] == IRON {
            quiet = false;
            let t = targets[j] as usize;
            if t < 3 && t != j && cards[t] != TABLE {
                hit[t] = true;
            }
        }
    }
    let mut standing = 0u32;
    let mut last = NOBODY;
    for i in 0..3 {
        let c = cards[i];
        if (c == AIR || c == IRON || c == SLEPT) && !hit[i] {
            standing += 1;
            last = i as u32;
        }
    }
    let mut winner = NOBODY;
    if standing == 1 {
        let i = last as usize;
        if cards[i] != IRON {
            winner = last;
        } else {
            let t = targets[i] as usize;
            if t < 3 {
                let tc = cards[t];
                if tc == AIR || tc == RAN || tc == SLEPT {
                    winner = last;
                }
            }
        }
    }
    Judged { hit, standing, winner, quiet }
}

# Third Chair: on-chain edition (repo `third-chair`)

This file is the build spec. Code that disagrees with it is wrong, unless this file is updated first.

Every string a person or an agent can read is English: the site, the gazette, contract docs, `skill.md`, errors, and notices.

## 1. What it is

A watchable 1890 western standoff. Three chairs. One minute. Three cards played face down and opened together. Nine rooms along the Glass River, each its own table. The purse is testnet XLM held by a Soroban contract. Talk is not the purse. There is no entry fee.

A person or an agent sits one chair. The house sits the empty chairs (Cal, Ivy, Ned) so a single player can play.

This edition is fully on-chain:

- No backend server. The website is a static Vite + React build on GitHub Pages: `https://eserergun.github.io/third-chair/`.
- All game state, card commitments, results, payouts, and stats live in one Soroban contract on Stellar testnet.
- The browser talks to Stellar RPC directly. Each player acts with a browser **session key** (a Stellar account funded by Friendbot). The session key signs every card, so no wallet popup opens during play.
- An owner wallet (Freighter, xBull, Albedo, Lobstr, Hana, Rabet, and others through Stellar Wallets Kit, or an imported testnet secret) signs **once** to link the session. The purse pays the owner.
- Agents are first-class: they play by calling the same contract with the Stellar CLI or any SDK. `skill.md` is the whole interface.

Why this replaces the original design: the original `third-chair` repo needs an always-on Express process that holds a relayer secret and the hidden cards. GitHub Pages cannot run it, and its house cards came from a public formula, so a player could compute them before choosing. Here, hidden cards use commit-reveal, and house cards come from the network PRNG at the moment the minute settles.

## 2. Locked rules (kept from the original PLAN)

Cards: Air, Iron, Table. Codes `0`, `1`, `2`. API names `air`, `iron`, `table`.

- **Air.** In the open. No bullet. Takes the purse only as the sole chair standing and unhit.
- **Iron.** One bullet at one other chair. Takes the purse only if that target played Air (or ran, see below), the shooter was not hit, and nobody else is standing.
- **Table.** Cannot be hit. Cannot take the purse. Is not standing.

A hit is Iron fired at a chair whose card is not Table. Standing means Air or Iron, and not hit. The purse pays only when exactly one chair is standing and unhit, and (if that chair played Iron) its target played Air. All Air, all Table, two standing, or a circle of shots: nobody is paid.

- Self-iron is rejected. Iron at a seat outside `0..2` is rejected. Iron with an empty belt is rejected.
- A sitter has one bullet per sitting. Firing spends it for the rest of that sitting. Standing up and sitting again re-arms (bullet back to 1). House chairs are refilled every minute with one bullet.
- Missing the minute is Air.
- Three quiet minutes in a row (no Iron from anyone, house included) scatter the room: every player and the queue are stood up and the room goes idle. The purse stays.
- House cowboys are Cal, Ivy, Ned in seat order 0, 1, 2. They are labeled house. They are not pretending to be players.
- House card distribution (unchanged from the original): `roll = uniform 0..6`; `roll <= 1` air; `roll <= 3` table; else iron at one of the two other seats chosen uniformly. House seats may shoot each other. The only change: the roll comes from the Soroban PRNG during settlement, not from a public formula of the hand id.
- The purse pays **1 testnet XLM** (`10_000_000` stroops) to a claimed winner when the contract can pay it.

On-chain additions (new in this edition, needed because there is no server):

- **Ran.** A player who sealed a card and never revealed it before the cards locked "ran". Ran is not standing, cannot win, and can be hit (bullets at a ran chair hit). For the Iron payout condition, ran counts as open air. The runner is stood up when the minute closes. **If any player ran, the purse does not move that minute** (withholding a reveal can never hand the purse to a chosen seat).
- **Slept.** A player who put no card down at all plays Air (missing the minute is Air), but a slept winner is not paid (note 8). A sleeper is carried out after two slept minutes in a row, or at once when someone waits in the queue, or when the minute went stale (settled more than one full minute after the end of its reveal window: `now > deadline + reveal_secs + commit_secs`).
- **Scatter** stands up the seated players only. Queued players then sit in a fresh minute.
- **Purse budget.** The purse pays at most `hour_budget` wins per hour across all rooms, and at most `day_cap` wins per owner per day. Over budget the winner is recorded and not paid ("The purse is resting.").
- Card codes in a settled hand record: `0` air, `1` iron, `2` table, `3` ran, `4` slept (plays as air).

`fixtures/judge.json` is the truth table for all 216 seat combinations (each seat: air, table, iron at either other seat, ran, slept). Both the contract and the TypeScript rules must pass it.

## 3. Rooms

| id | slug | name | x | y |
|---|---|---|---|---|
| 0 | billen | Billen | 0.368 | 0.256 |
| 1 | cheyen | Cheyen | 0.552 | 0.260 |
| 2 | amarilla | Amarilla | 0.818 | 0.303 |
| 3 | denvar | Denvar | 0.373 | 0.497 |
| 4 | abelen | Abelen | 0.608 | 0.547 |
| 5 | laramy | Laramy | 0.862 | 0.484 |
| 6 | prescot | Prescot | 0.185 | 0.725 |
| 7 | duranga | Duranga | 0.602 | 0.814 |
| 8 | tucsan | Tucsan | 0.825 | 0.788 |

`x`, `y` are anchors as fractions of `public/survey.jpg` (1280x720, 16:9). Denvar is the default room; `live` is an alias for Denvar in URLs. The contract knows only ids `0..8`. Unknown room: "That room is not on the survey."

## 4. The minute (state machine)

Ledger time (`env.ledger().timestamp()`, seconds) is the only clock. Testnet closes a ledger every 5 seconds.

Config (constructor args, admin can change): `commit_secs` (live 60: "the minute"), `reveal_secs` (live 45), `pay` (live `10_000_000`), `hour_budget` (live 60 paid wins per hour), `day_cap` (live 25 paid wins per owner per day). A room copies `commit_secs` and `reveal_secs` when a minute opens, so `set_config` never shifts a running minute.

Room phases: `0` idle (no players, house only), `1` open (cards go down), `2` reveal (sealed cards turn over), `3` locked (all cards fixed and public, the house seed is drawn, settlement waits for the next ledger).

Seat states: `0` waiting (no card yet), `1` sealed (commitment stored), `2` shown (card public).

### 4.1 Why settlement takes two ledgers

House cards come from `env.prng()`. A caller who can see the outcome inside the same transaction can wrap the call in their own contract and abort on a loss, then retry until they win. So the random seed is drawn in one transaction and used in a later ledger:

- **Lock**: when every card is fixed and public, the contract draws `seed = env.prng().gen::<BytesN<32>>()` and stores it under the hidden key `Seed(room)` with `locked_at = env.ledger().sequence()`. No function returns the seed or anything derived from it. Other contracts cannot read our storage, so a wrapper learns nothing inside the lock transaction.
- `Seed(room)` always exists with the same size (all zero while the room is not locked). `play` and `reveal` write it on every path (zero, or the new seed when they lock), and settlement writes zero back. So a card that becomes the lock because another player's card landed first in the same ledger still matches its simulated footprint and write bytes.
- **Settle** (`resolve`, only when `env.ledger().sequence() > locked_at`): `env.prng().seed(seed)`, then draw the house cards. The result is fully determined by stored data, so aborting and retrying changes nothing, and simulation gives the exact real result.

### 4.2 Flow

1. **Sit.** The first player in an idle room takes seat 0 and a minute opens at once: `hand = ++seq`, `opened = now`, `deadline = now + commit_secs`. The house holds seats 1 and 2. If a minute is running, the newcomer joins the queue (claimed players queue ahead of unclaimed ones) and sits when the minute closes. Queue max 3.
2. **Cards (phase 1).** A card call names the hand (`hand` must equal `room.hand`, else `Closed`) and needs caller state 0 (else `Played`). Cards are accepted while the phase is 1, even a little after `deadline`, until someone closes the minute. Nobody can see a sealed card, so a late card gains nothing.
   - `commit(player, room, hand, commit)`: seal.
   - `play(player, room, hand, card, target)`: face up. Allowed only when every *other* player at the table is sealed or shown (always true for a lone player), else `Choosing`.
   - After either call, if every player is sealed or shown: if anyone is sealed, phase 2 with `reveal_by = now + reveal_secs`; if everyone is shown, **lock** (phase 3).
3. **Reveal (phase 2).** `reveal(player, room, hand, card, target, salt)` from a sealed player. Accepted while the phase is 2 (also after `reveal_by`, until the lock). When the last sealed player reveals, **lock**.
4. **`resolve(room, hand)`**, anyone, advances one step:
   - phase 1 and `now >= deadline`: close the minute. Waiting players are now slept. If anyone is sealed, phase 2 with `reveal_by = max(now, deadline) + reveal_secs`; else lock.
   - phase 2 and `now >= reveal_by`: sealed players are now ran. Lock.
   - phase 3 and `sequence > locked_at`: **settle**.
   - otherwise `NotReady`.
   Returns the phase after the call (`u32`). It never returns cards or a winner.
5. **Settle**: reseed from `Seed(room)` and draw each house seat; build every seat's card (shown, ran, slept, house); judge; quiet streak and scatter; payout (4.3); stats and board; push the Hand into `room.recent`; remove `Seed(room)`; then open the next minute in the same call: drop leavers, runners, sleepers by the rules in section 2, everyone seated on scatter; seat the queue into house seats (claimed first, then by queue order, bullet 1); refill house seats; reset seat states. No players left: idle.

### 4.3 Payout (inside settlement)

Winner is house: note 1. No winner: note 0. A player won:
- anyone ran this minute: note 6 (the purse does not move);
- the winner is unclaimed (snapshot of `Chair.claimed` at settlement): note 2;
- the winner slept (put no card down; the slept card plays Air): note 8. A sleeper is never paid, so an idle chair cannot farm the purse;
- the hourly budget is spent or the owner reached `day_cap` today: note 7 (resting);
- the contract's native balance is below `pay`, or `try_transfer` fails: note 3 (empty);
- else transfer `pay` to the owner with `try_transfer`: note 4. Settlement never panics on a payout.

### 4.4 Narration (client side, from the Hand record)

Main line from the winner logic:
- Winner is a player: note 4 "{name} takes the purse. {amount} testnet XLM." (amount from `paid`); note 2 "{name} takes the chair, but sits unclaimed. The purse will not pay them."; note 3 "{name} takes the chair. The purse had nothing to send."; note 6 "{name} takes the chair. Somebody ran, so the purse does not move."; note 7 "{name} takes the chair. The purse is resting."; note 8 "{name} takes the chair asleep. The purse does not pay a sleeper."
- Winner is house: "{name} takes the minute. The house keeps the purse."
- No winner: quiet: "A quiet minute. Dust, and no iron. The purse stays." Fired and one standing: "One chair is standing, but the iron did not find open air. The purse stays." Nobody standing: "Nobody is standing. The purse stays." Else: "More than one chair is standing. The purse stays."

Extra lines, in seat order, from `out` and the cards: scattered: "Three quiet minutes. The table scatters." (once); ran and hit: "{name} ran, and the iron found them."; ran: "{name} ran. The chair is empty."; slept: "{name} slept through the minute. That plays as Air."; carried out: "{name} was carried out."; left: "{name} stood up."

## 5. Contract (`contracts/standoff`, soroban-sdk `29.0.1`, crate `standoff`)

Build target `wasm32v1-none` with `stellar contract build`. `#![no_std]`. Tests use soroban-sdk `testutils`.

### 5.1 Types

```rust
pub const ROOMS: u32 = 9;
pub const NONE: u32 = 255;      // "no target" and "no room"
pub const NOBODY: u32 = 3;      // no winner

#[contracttype] pub enum Key {
    Config,             // instance: Config
    Seq,                // instance: u64, last hand id issued (global across rooms)
    Budget,             // instance: Budget (hourly pay budget)
    Room(u32),          // persistent: Room (all nine written in the constructor)
    Seed(u32),          // persistent: BytesN<32>, the locked house seed. NEVER returned by any function.
    Chair(Address),     // persistent: Chair, keyed by player (session) address
    Stats(Address),     // persistent: Stats, keyed by owner address
    Offer(Address),     // persistent: Address (player -> proposed owner), removed on accept
    Board,              // persistent: Vec<Row>, top 10 (written empty in the constructor)
}

#[contracttype] pub struct Config {
    pub admin: Address, pub token: Address,
    pub commit_secs: u64, pub reveal_secs: u64, pub pay: i128,
    pub hour_budget: u32, pub day_cap: u32,
}

#[contracttype] pub struct Budget { pub hour: u64, pub paid: u32 }   // hour = timestamp / 3600

#[contracttype] pub struct Seat {
    pub who: Option<Address>,  // None = house
    pub claimed: bool,         // copy of Chair.claimed when seated (for queue priority and display)
    pub state: u32,            // 0 waiting, 1 sealed, 2 shown
    pub commit: BytesN<32>,    // all zero when none
    pub card: u32,             // valid when state == 2
    pub target: u32,           // 0..2 for iron, 255 otherwise
    pub bullet: u32,           // 0 or 1
    pub leaving: bool,
    pub missed: u32,           // consecutive slept minutes
}

#[contracttype] pub struct Hand {     // a settled minute, kept in Room.recent
    pub hand: u64, pub minute: u32, pub at: u64,
    pub who: Vec<Option<Address>>,    // 3 entries, None = house
    pub cards: Vec<u32>,              // 0 air, 1 iron, 2 table, 3 ran, 4 slept
    pub targets: Vec<u32>,            // 255 unless iron
    pub hit: Vec<bool>,
    pub out: Vec<u32>,                // 0 stays, 1 left, 2 ran, 3 carried out, 4 scattered
    pub winner: u32,                  // 0..2 or 3
    pub quiet: bool, pub scattered: bool,
    pub paid: i128,
    pub note: u32,                    // 0 no winner, 1 house, 2 unclaimed, 3 empty, 4 paid, 6 ran, 7 resting
}

#[contracttype] pub struct Room {
    pub id: u32,
    pub phase: u32,           // 0 idle, 1 open, 2 reveal, 3 locked
    pub hand: u64,            // 0 when idle
    pub minute: u32,          // minutes dealt in this room (kept across idle)
    pub opened: u64, pub deadline: u64,
    pub reveal_by: u64,       // 0 until phase 2
    pub locked_at: u32,       // ledger sequence of the lock, 0 until phase 3
    pub commit_secs: u64, pub reveal_secs: u64,   // copied from Config when the minute opens
    pub seats: Vec<Seat>,     // always 3
    pub queue: Vec<Address>,  // max 3
    pub quiet: u32,
    pub recent: Vec<Hand>,    // newest first, max 8 (kept across idle)
}

#[contracttype] pub struct Chair {
    pub owner: Address,       // payout owner; the player itself until linked
    pub claimed: bool,        // true once an owner (not the player itself) accepted this player
    pub agent: bool,
    pub name: String,         // "" means the client derives a name from the address
    pub room: u32,            // hint: room the player sat or queued in; 255 none. May be stale.
}

#[contracttype] pub struct Stats {
    pub busy: Option<Address>, // hint: the owner's player now seated or queued. May be stale.
    pub hands: u32, pub wins: u32, pub hits: u32, pub falls: u32, pub ran: u32,
    pub earned: i128,
    pub day: u64, pub day_paid: u32,  // day = timestamp / 86400
}

#[contracttype] pub struct Row { pub owner: Address, pub name: String, pub wins: u32, pub hits: u32, pub hands: u32, pub earned: i128 }
#[contracttype] pub struct Purse { pub balance: i128, pub pay: i128, pub hour_budget: u32, pub hour_paid: u32 }
```

Idle room: phase 0, hand 0, opened 0, deadline 0, reveal_by 0, locked_at 0, three house seats (`who: None`, bullet 1), empty queue, quiet 0. `minute` and `recent` are kept when a room goes idle. One helper `go_idle(room)` does this everywhere.

### 5.2 Functions

Player address = the session account. Every player action calls `player.require_auth()` (satisfied by the transaction source signature, no extra signing).

| fn | auth | effect |
|---|---|---|
| `__constructor(admin, token, commit_secs, reveal_secs, pay, hour_budget, day_cap)` | | store Config, `Seq = 0`, write nine idle rooms and an empty board |
| `sit(player, room) -> u32` | player | seat index, or 255 when queued. Idempotent if already seated/queued in this room. See 5.3. |
| `leave(player, room)` | player | queued: removed now. Seated: `leaving = true`, dropped when the minute settles; if the room's phase is 1 and nobody has a card down and the player is the only player, the room goes idle at once. Not here: no-op. |
| `play(player, room, hand, card, target)` | player | face up, see 4.2 |
| `commit(player, room, hand, commit: BytesN<32>)` | player | seal, see 4.2 |
| `reveal(player, room, hand, card, target, salt: BytesN<32>)` | player | show, see 4.2 |
| `resolve(room, hand) -> u32` | none | advance one step (close, lock, settle), returns the new phase |
| `offer(player, owner)` | player | `owner != player` else `BadOwner`. Store `Offer(player) = owner`, TTL one day. Creates the default Chair if missing. |
| `accept(owner, player)` | owner | requires `Offer(player) == owner` (else `NoOffer`) and `owner != player`. One chair per owner: if the player is verifiably at a room and `Stats(owner).busy` is another player verifiably at a room, fail `OwnerBusy`. Sets `Chair(player).owner = owner`, `claimed = true`; moves the busy hint (clear the old owner's `busy` if it pointed at this player, set the new owner's `busy` if the player is at a room); removes the offer. Updates `claimed` in the player's seat if seated. |
| `rename(player, name: String, agent: bool)` | player | 1..12 chars of `A-Z a-z 0-9` and space, no leading/trailing space, not "Cal", "Ivy", "Ned" (any case) and not ASCII lookalikes of those names (`l`/`1`/`|` fold to `i`, `0` folds to `o`; e.g. `CaI`, `lvy`, `1vy`). Creates the default Chair if missing. |
| `fund(from, amount)` | from | native transfer into the contract, `amount > 0` |
| `set_config(commit_secs, reveal_secs, pay, hour_budget, day_cap)` | admin | `pay >= 10_000_000` |
| `withdraw(to, amount)` | admin | |
| `upgrade(wasm_hash)` | admin | |
| `bump()` | none | extend TTL of the instance and of every room and board key that exists (`has()` first) |
| `config() -> Config`, `room(id) -> Room`, `chair(player) -> Option<Chair>`, `stats(owner) -> Stats`, `board() -> Vec<Row>`, `purse() -> Purse`, `now() -> u64` | none | views (never expose `Seed`) |
| `commitment(hand: u64, seat: u32, card: u32, target: u32, salt: BytesN<32>) -> BytesN<32>` | none | helper for agents |

Commit preimage (exact bytes, 57 total): ASCII `third-chair/v2` (14) + `hand` u64 big-endian (8) + `seat` u8 + `card` u8 + `target` u8 + `salt` (32). `commit = sha256(preimage)`. Vectors in `fixtures/commit.json`. Clients must use 32 fresh bytes from a CSPRNG per commit.

Card validation (play and reveal): `card <= 2`; iron needs `bullet >= 1` and `target <= 2` and `target != seat`; air and table need `target == 255`. A reveal whose hash does not match fails `BadReveal`.

### 5.3 `sit` rules

1. Unknown room id: `NoRoom`.
2. Load or default `Chair(player)` (owner = player, claimed false, agent false, name "", room 255).
3. Verify the room hint: the player is "at" room R only if R's seats or queue contain the player. Stale hints are ignored.
4. Already at this room: return the current seat or 255.
5. At another room R2: if R2 holds any other player (seated or queued), fail `Elsewhere`. Otherwise remove the player from R2 and `go_idle(R2)` (its running minute is dropped with no result).
6. One chair per owner: if `Stats(owner).busy` is another player B with `Chair(B).owner == owner` who is verifiably at some room, fail `OwnerBusy`.
7. Idle room: seat 0, open a minute. Running minute: queue; fail `Full` when the queue holds 3.
8. Write `Chair.room = room`, `Stats(owner).busy = Some(player)`. Emit `sat`.

### 5.4 Settlement details

- House seat card: `roll = prng.gen_range::<u64>(0..7)` after `prng.seed(seed)`, seats in order 0, 1, 2; `0..=1` air, `2..=3` table, else iron at `others[prng.gen_range::<u64>(0..2)]` where `others` lists the two other seat indexes in increasing order.
- Judge exactly as `fixtures/judge.json`.
- `quiet = no iron`. `room.quiet = quiet ? room.quiet + 1 : 0`. `scattered = room.quiet >= 3` (then `room.quiet = 0`).
- Stats for each seated owner: `hands += 1`, `falls += 1` if hit, `hits += 1` for a shooter whose target was hit, `ran += 1` if ran, `wins += 1` for the winner, `earned += paid`.
- Board: top 10 by wins, then earned, then hits; the row name is the winner's `Chair.name`.
- `out` per seat: 2 ran, 3 carried out (slept with missed >= 2 after this minute, or slept while the queue is non-empty, or `now > deadline + reveal_secs + commit_secs`), 1 left, 4 scattered, else 0. Human bullet becomes 0 after firing iron.
- Emit `settled` with room, hand, minute, cards, targets, hit, winner, paid, note.

### 5.5 Footprint discipline

- Settlement is deterministic given storage (the seed is stored), so simulation equals execution. Clients still pad simulated CPU instructions by 25%.
- The lock draws a fresh seed, but the lock writes the same entries (Room and Seed) whatever the seed is.
- No transaction may read `Seed(room)` except settlement.

### 5.6 Errors (`#[contracterror]`, stable codes)

| code | name | client message |
|---|---|---|
| 1 | NoRoom | That room is not on the survey. |
| 2 | NotSeated | You are not in this minute. |
| 3 | Closed | The minute is closed. |
| 4 | Played | Your card is already down. |
| 5 | BadCard | The card is not on the table. |
| 6 | BadTarget | Iron needs another chair. |
| 7 | NoBullet | The belt is empty. |
| 8 | BadReveal | That is not the card you put down. |
| 9 | Elsewhere | You already have a chair in {Name}. Stand up there first. |
| 10 | OwnerBusy | Your wallet already has a chair, maybe in another browser. Stand up there, or link the wallet here again. |
| 11 | Full | The table is full. |
| 12 | NotReady | The minute is not ready to settle. |
| 13 | Choosing | Another chair is still choosing. Your card goes face down. |
| 14 | NoOffer | That chair has not offered itself to you. |
| 16 | BadName | Names are letters, numbers, and spaces. Twelve at most. The house names are taken. |
| 17 | BadAmount | That amount does not work. |
| 18 | NotReveal | The cards are not turning over yet. |
| 19 | BadOwner | A chair cannot claim itself. |

### 5.7 Events (`#[contractevent]`)

`sat {room, player, seat}`, `stood {room, player}`, `sealed {room, hand, seat}`, `shown {room, hand, seat, card, target}`, `locked {room, hand}`, `settled {room, hand, minute, cards, targets, hit, winner, paid, note}`, `linked {player, owner}`, `funded {from, amount}`. Put `room` and addresses in topics.

### 5.8 TTL

Instance: extend on every call (threshold 7 days, extend to 30 days, 17,280 ledgers per day). Persistent entries: extend on write to the same values. `Offer`: one day. `bump()` extends what exists.

## 6. Client (browser)

Stack: Vite 8, React 19, TypeScript 7, `@stellar/stellar-sdk` 17.4.0, `@creit.tech/stellar-wallets-kit` 2.8.0 (v2 static API), `@fontsource/silkscreen`, Vitest 5, Playwright 1.65. Base path `/third-chair/`; every public URL is built from `import.meta.env.BASE_URL`. Hash routes: `#/` map, `#/room/<slug>`, `#/gazette`, `#/claim?agent=G...`, `#/practice`.

Config comes from `deployments/testnet.json` (imported at build time): `rpcUrl`, `networkPassphrase`, `friendbotUrl`, `contractId`, `nativeSac`, `explorer`. A build can target another contract only through the `VITE_DEPLOYMENT` env var (a path to another deployment JSON) at build time, never through a URL parameter. Optional `VITE_RPC_URL` (or `STANDOFF_RPC_URL` for Node scripts) overrides `rpcUrl` for a dedicated RPC provider without changing the rest of the deployment. `public/skill.md` is generated at build time from `skill.template.md` and the deployment file.

The UI depends only on `src/shared/game-client.ts` (the `GameClient` interface), `src/game/*`, `src/art/*`, `src/audio/*`. Two implementations: `ChainClient` (`src/chain/client.ts`) and `PracticeClient` (`src/game/practice.ts`).

### 6.1 Identity

Local storage key prefix: `standoff.v2.<contractId>.` Every storage access is wrapped in try/catch.

- **Session key**: an ed25519 Stellar keypair made in the browser, stored in local storage, funded by Friendbot with `fetch(friendbotUrl + "?addr=")`. A 200, or a 400 whose body says the account is already funded, is success; then confirm the account exists. On 429 or 5xx retry after 2, 4, 8 s, then offer the practice table. The key is made and funded as soon as a room slip or a room page opens, before "Walk in", so Friendbot (often 15 to 30 s) runs while the visitor looks around. The key stays hidden until a door is chosen. Progress lines: "Friendbot is saddling your horse." and "Pulling up a chair."
- **Doors** (on first sit): the guest door seats the player at once with the session key. The wallet and secret doors link first and sit after `accept` lands ("Linked. Your next win pays."): a link takes up to a minute, and a chair taken before it would sleep through the minute. If the sit fails after a link, the doors stay open with a "Sit down" button.
  1. *Walk in as a guest*: session key only. Unclaimed, the purse does not pay.
  2. *Connect a Stellar wallet*: two clicks. Click 1 "Connect a wallet" calls `StellarWalletsKit.authModal()` inside the gesture. Then in the background: fund the owner with Friendbot if the account is missing, send `offer(session, owner)` from the session, build and simulate `accept(owner, session)` with the owner as source and timebounds of 300 s. Click 2 "Sign the link (one signature)": the handler's first await is `StellarWalletsKit.signTransaction(xdr, { networkPassphrase, address: owner })`, with a 120 s timeout and an "Open the wallet again" button. Init the kit with `StellarWalletsKit.init({ modules: defaultModules(), network: Networks.TESTNET })` (`Networks` from `@creit.tech/stellar-wallets-kit/types`; Freighter is now called Varial and is in the default modules, so is MetaMask through its Stellar snap). Before sending, parse the signed XDR with the testnet passphrase and verify one signature against the owner key; otherwise "Your wallet is not on testnet. Switch it to Testnet and try again." or "Your wallet signed with a different account." The kit is loaded with a dynamic import on the first click.
  3. *Use a testnet secret key*: a pasted `S...` key acts as the owner wallet (same flow, signed locally). Warn: testnet only. Never stored unless the user asks.
- Wallet drawer: session address (copy), owner address, claimed status, balances, stats, rename, export session secret (behind a confirm), forget this browser.

### 6.2 Transactions

One module sends every contract call:

1. Sequence: cache the session account sequence and increment it locally under a Web Lock (`navigator.locks`, name `standoff-tx-<address>`); reload it only on `txBadSeq`.
2. Build with `Contract.call`, simulate. Simulation error: decode `Error(Contract, #n)` to the table in 5.6.
3. Check the simulated auth: for session transactions every auth entry must be source-account credentials, the root invocation must be our contract and the expected function, with no sub-invocations, except `fund` (one native transfer). Otherwise refuse to sign.
4. Assemble, pad instructions by 25% and the resource fee, set timebounds, sign, send.
5. `TRY_AGAIN_LATER`: back off and resend. `txBadSeq`: reload and rebuild. Poll `getTransaction` up to 45 s.
6. Return `{hash, returnValue, events}` from the applied transaction. Failed: decode the contract error.

Errors that come from a lost race in automation (`NotReady`, `Closed`, `Played` on a duplicate, `NotReveal`) never show an error toast.

### 6.3 Reads and time

- Rooms are read with `getLedgerEntries` on the persistent keys `Room(id)` (one call for all nine on the map; the room plus the player's `Chair` in a saloon). Decode with `scValToNative`; u64 and i128 come back as BigInt, BytesN as Uint8Array. Convert to the string/number fields of the GameClient types.
- Views `config`, `purse`, `board`, `stats`, `chair` use simulation with a throwaway source account.
- Clock: poll `getHealth` every 5 s and use `latestLedgerCloseTime` (read it through a widened type) and `latestLedger`. Keep `offset = max(latestLedgerCloseTime - localReceiveTime)` over recent samples, re-anchor every 30 s, and never let the displayed watch step back. Never call `getLatestLedger` in the browser (about 250 KB per call).
- Poll the current room every 2 s (aligned after each new ledger when possible), all rooms every 8 s on the map. Drop responses older than the newest applied one. Hidden tabs slow to 10 s, except while this player is sealed.
- Names: house seats are Cal, Ivy, Ned. A player with `Chair.name` uses it; otherwise decode the G-address to its 32 raw bytes and take `NAMES[raw[0] % NAMES.length]` with `NAMES = [Wes, Ada, Kit, Bo, Mae, Sol, Rhett, June, Hank, Pearl, Cora, Silas, Ezra, Nell, Jesse, Opal, Amos, Ruby, Clem, Etta, Gus, Lula, Abe, Tess]`. Two seats with one name get " II" on the later seat.

### 6.4 Automation (the client is the croupier)

- Card pick: from a fresh read, if every other player at the table is sealed or shown, call `play`; otherwise `commit`. If `play` fails with `Choosing`, fall back to `commit`.
- Before sending `commit`, store the pending card inside the Web Lock under `standoff.v2.<cid>.sealed.<hand>.<commitHex>` as `{hand: decimal string, seat, card, target, salt: hex}`. At reveal time pick the record whose hash equals the on-chain `seat.commit`. Delete records of older hands. Broadcast "card sent" on a `BroadcastChannel` so other tabs disable their cards. After a commit on a phone, show "Keep this tab open until the cards turn over."
- Phase 2 and this player sealed: send `reveal` at once; retry on failure, on `visibilitychange` and `pageshow`, until the lock.
- `resolve` when a step is due: phase 1 after `deadline + 8 s`; phase 2 after all reveals or after `reveal_by + 5 s`; phase 3 one ledger after `locked_at`. Seated and queued players send it with a stagger of `seat * 6 s` (queued: 18 s) plus up to 2 s random; spectators with a funded key help after 20 s.
- Cards stay enabled until the minute closes. A card that lands after the close shows "Your card missed the minute. You played Air." as an outcome, not an error.
- Every user transaction shows a toast with its status and a stellar.expert link.

### 6.5 Practice table and house rehearsal

A fully local engine (`src/game/engine.ts`) implements the same room state machine, judge, and narration in TypeScript with a seeded PRNG (house distribution as in section 2). Uses:
- the Practice table (`#/practice`), labeled "Practice table. Nothing here touches the chain.";
- **house rehearsal** in idle rooms: the engine plays a house-only minute seeded by `sha256(contractId | roomId | floor(ledgerTime / 60))`, so every viewer sees the same rehearsal, labeled "The house is rehearsing. Nothing here touches the chain." It stops when a real minute opens;
- deterministic UI tests and differential tests against the contract.

A settled hand is animated only if its `at` is within 15 s of ledger time when first seen; older hands show as a result line and can be replayed.

## 7. Screens and art

Palette (four inks): Soot `#140c08` (line, type, shadows), Paper `#e7d7b1` (sky, page, faces), Rust `#b8432f` (shots, the watch, wounds), Felt `#2f4a3c` (table, money, the quiet seat). Type is Silkscreen. No serif, no grotesque, no Inter, no purple gradient.

### 7.1 Map

Full window painting `survey.jpg` with `object-fit: contain` inside a 16:9 frame (centered on short wide screens, top-aligned at `max-width: 800px`). Nine town chips sit on the hamlets: paper chips, soot border, rust pin, name in Silkscreen, translated so the chip sits above the hamlet. Each chip shows live status: players at the table and a rust dot while a minute runs. Clicking opens the room slip: "Three chairs. You take one. The house sits the other two until somebody else walks in." Buttons: Walk in (sit), Watch the minute (spectate). Slim dock: "Nine rooms along the Glass River. Walk into any one. The house sits the other two chairs." Links: Map, Dust Gazette, skill.md, Claim an agent, Practice. Top right: identity chip.

### 7.2 Saloon

Canvas internal `384x216`, `image-rendering: pixelated`, `object-fit: contain`, `object-position: center top`. One `requestAnimationFrame`. Hat and coat lag the body by `floor(frame / 6)`. Lamps flicker on `frame % 18`. Cards press at `scale(0.96)`. Names sit under the chairs. "TALK IS NOT THE PURSE" stays on the comic. The purse is a small satchel on the table; on a player win it slides to that chair. Coats by seat: rust, felt, soot.

Dock (overlays the bottom on wide screens, in flow under a `56.25vw` stage at `max-width: 640px`; roster lines stack as `display: block` at `max-width: 800px`): the watch (counts down from ledger time), the room name, three cards (Air, Iron, Table, keys 1, 2, 3), Iron opens a target picker for the two other seats, roster (name, House/Player/Agent, bullets, state: thinking, face down, shown, you), the narration line (`aria-live`), status of your card, links.

### 7.3 The reveal and death (required)

When the client sees a new settled hand for the room, it plays the reveal:

- Beat 1 (0 to about 700 ms): everyone who played Iron draws, barrel out. Muzzle flash and smoke if anyone fired. Cards flip over the chairs.
- Beat 2 (about 700 ms to at least 2.8 s, hold about 3.4 s total): apply the result.
  - **Hit**: on the floor. Legs out, torso down, hat off the head (it flew), eyes are a cross. An obvious wound with a paper outline so it reads on rust, felt, and soot coats, and a rust pool on the floor. No bobbing. Never stands back up during the reveal. Two chairs that shot each other are both on the floor.
  - **Table**: a duck. The body drops behind the table edge. The hat brim stays visible. No head, no wound, no fall.
  - **Air, or Iron that was not hit**: standing.
  - **Ran**: the chair is empty with the card face down on it, unless the runner was hit (then on the floor).
- Reduced motion: no tweens, no flash, but the body is on the floor.
- The house letter never covers the wound.
- After the reveal the table shows the next minute with fresh, standing cowboys. A corpse never carries into the next minute.
- Replays: any hand in `room.recent` can be replayed from the gazette or the saloon.

### 7.4 Sound

WebAudio only (synthesized, no files): gunshot, ricochet into the table, body fall, card slap, last-ten-seconds tick, coin jingle on a paid win. Off by default until the first user gesture. Toggle in the dock, remembered.

### 7.5 Dust Gazette

Overlay newspaper. Lead: "Testnet edition. Nine rooms are open. Walk into any one. The shop, the horse, and the depot are still news." Sections: the rules, recent hands across all rooms (minute, room, names, cards, result line, replay, transaction link when known), the leaderboard (`board()`), the purse (contract balance, pay per win, contract link), and the news items: Blend vault (later), the shop (horse, vest, second bullet: not for sale), the horse (a second room, later), the depot (LayerZero, later), the nail (rules hash, later), the agents (bring your own clock).

### 7.6 Navbar, stakes, and How it works

- A top navbar on every route: Third Chair (to the map), Map, How it works, Gazette, Practice, and the identity chip.
- `#/how` explains the stakes first (free entry, 1 XLM to the sole survivor, guests not paid, budgets, ran rule), then the cards, worked examples of who takes the purse, the house odds and fairness, the flow of a minute, bullets/sleepers/runners, the doors, on-chain transparency, agents, and questions. Copy lives in `src/ui/how-content.ts`.
- The saloon shows a stakes panel: the purse (pay, treasury, paid wins left this hour), you (entry free, your result if you win or why a guest is not paid, wins, earned, wallet balance), and each seated player (linked or unpaid, wins, earned, owner wallet balance). A paid win shows a receipt with the settlement transaction link. A plate on the comic shows CARDS SEALED, SETTLING - LEDGER n, and SETTLED.
- The map painting covers the stage between the navbar and the dock, cropped so every hamlet chip stays visible; leftover space is filled with a blurred copy of the painting, never flat black.

### 7.7 Claim page

`#/claim?agent=G...` shows the agent's name and whether it offered itself to you. "Accept with your wallet" signs `accept(owner, agent)` (one popup). If the agent has not offered: show the exact `offer` command from `skill.md`.

## 8. Agents (`public/skill.md`)

`https://eserergun.github.io/third-chair/skill.md` is the whole interface. It must be complete without this repo: contract id, network, the Stellar CLI commands for every step (key, Friendbot, rename, sit, read the room, play or commit/reveal, resolve until settled, offer to a human, leave), how to compute the commitment (the `commitment` view, or local sha256 with the exact preimage), how to read the clock (`now`), how to decide when to act, and error codes. It must say: talk is not a move, speech does not move the purse, there is no entry fee, unclaimed agents are not paid.

`scripts/agent.ts` is a reference bot that plays N minutes in a room with a chosen strategy, using the same client library as the website.

## 9. Operations

- `scripts/deploy.ts`: builds the wasm, deploys with constructor args, funds the purse from Friendbot accounts, writes `deployments/testnet.json`. Admin key comes from `STANDOFF_ADMIN_SECRET` or a local `stellar keys` identity. Never commit secrets.
- GitHub Actions: `ci.yml` (cargo test, wasm build, typecheck, vitest, Playwright practice suite), `pages.yml` (build and deploy to Pages on push to `main`), `keeper.yml` (every 30 minutes: settle abandoned minutes with `resolve`, `bump`, top up the purse, redeploy after a testnet reset and commit the new deployment file).
- Two deployments: `live` (commit 60 s, reveal 45 s) for the website, `test` (commit 20 s, reveal 20 s) for automated suites.

## 10. Done when

- Nine chips sit on the nine hamlets. Each opens its slip. Names are sharp HTML, not bitmap.
- Watch the minute shows Cal, Ivy, and Ned, house, one bullet each, the room name.
- Sitting in an idle room opens a minute at once with the player in seat 0 and two house cowboys. A second player waits for the next minute.
- Solo play: the card locks the minute and the next ledger settles it (about 10 s); the reveal animation follows at once.
- Iron on an open chair puts that cowboy on the floor for the reveal. Table ducks and is not hit. The next minute stands a fresh table.
- All air pays nobody. A sole standing unhit claimed player is paid 1 testnet XLM at settlement, visible on stellar.expert. A circle of shots pays nobody. Guests and unclaimed agents are not paid, and the line says so.
- Three humans at one table play with commit-reveal; nobody sees another card before reveal; reveal and settlement happen automatically.
- A missed card is Air. A sealed card never shown is "ran".
- A wallet links with one signature. After that no card opens a wallet.
- An agent plays from `skill.md` alone with the Stellar CLI, offers itself to a human, is accepted on the claim page, and is then paid.
- The comic and the contract agree on every hand.
- Narrow width keeps the chips and cards clickable. Reduced motion still shows a body on the floor.
- Contract tests, TypeScript tests, and Playwright suites pass. The live site works on GitHub Pages against the live testnet contract.

## 11. Repo layout

```
contracts/standoff/       Soroban contract + tests
fixtures/                 judge.json, commit.json (shared truth)
deployments/testnet.json  live deployment (public data only)
public/                   survey.jpg, skill.md, favicon
src/game/                 rules.ts, rooms.ts, names.ts, narrate.ts, engine.ts (pure, no DOM)
src/chain/                config, rpc, codec, tx pipeline, session, wallet, client
src/shared/               game-client.ts (the interface between UI and chain/practice)
src/ui/                   React components, styles
src/art/                  canvas drawing, sprites, pixel font
src/audio/                WebAudio sound effects
scripts/                  deploy.ts, agent.ts, keeper.ts
e2e/                      Playwright specs
.github/workflows/        ci.yml, pages.yml, keeper.yml
```

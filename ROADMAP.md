# Third Chair: status and roadmap

Status date: 2026-11-09. P0 is done except the items that need a person or a device (section 5.1). Two rounds of live agent play verified the build; see `docs/p0-acceptance.md`.

- Live site: https://eserergun.github.io/third-chair/ (GitHub Pages, private repo `eserergun/third-chair`)
- Test site: https://eserergun.github.io/third-chair/test/
- Live contract (testnet): `CC3PPBRDTZ6LFAM3XNABLSNAWTHQOSMFFW66TGD6SMHG5PH37BBNOV2Y` (60 s minute, 45 s reveal, 1 XLM per paid win, 60 paid wins per hour, 25 per wallet per day)
- Test contract (testnet): `CC2UPOKB4ACKNYUG7JUCR5HZ6HY6VGVCXHQNSCKHUOILHO4P2PHWFLUQ` (20 s minute, 20 s reveal)
- On-chain wasm (both): `8f7c473c625ab8a0f9d4b69bc8e5ddb5effbef16be1f5d5f66a02cd0645aa440`. It rebuilds to the same hash from any checkout (rustc 1.95.0, Stellar CLI 30.0.1).
- Admin: `GC2SWUC254XOXW6PG4A7ZBRIMSQAS2OS73BSN76HG5OWYP6TJAJG43C3`. The secret is in the local `stellar keys` store (`standoff-admin`) and in the repo secret `STANDOFF_ADMIN_SECRET`. See `docs/ops/admin-secret.md`.
- Retired contracts: `deployments/ARCHIVE.md`.
- Plans this document tracks: the original `third-chair` PLAN.md and this repo's SPEC.md.

## 1. Summary

The game works end to end on Stellar testnet. There is no server: one Soroban contract holds the rooms, the cards, the results, and the purse, and the site is static. Players sit as guests or link a Stellar wallet with one signature. Agents play with the Stellar CLI from `skill.md`. On 2026-11-09, thirteen agents played the live site and contracts in two rounds (guests in five engines, five real wallets, agents, three-player tables), and independent verifiers recomputed every hand from the chain.

The edition is ready for a public testnet launch. A mainnet launch needs product, legal, and security decisions first (section 5.3).

The bigger aim: Third Chair is meant to become neutral ground where humans and AI agents interact, with each other and among themselves, under rules that live on chain and that no operator can bend. The standoff is its first room. Its primitives (a contract as referee, sealed moves, fair chance, settlement with payment, agents owned by people, a plain-text interface) carry over to tournaments, human-versus-agent ladders, sealed-bid auctions, trust games and agent service markets. Decks: `docs/decks/`.

## 2. Status against the plans

### 2.1 Original PLAN.md "Done when"

| PLAN.md item | Status | Notes |
|---|---|---|
| Nine buttons on the nine hamlets, each opens its slip, names are sharp HTML | Done | HTML chips over the painting. The painting fills the screen and keeps every chip in view. |
| Watch the minute shows Cal, Ivy, Ned, house, one bullet, room name | Done | Idle rooms run a client-side house rehearsal, labeled as not on chain. |
| Sitting alone clears the demo and restarts the minute with the player and two house cowboys | Done | The first sitter takes seat 0 and a minute opens at once. |
| Iron on an open chair puts that cowboy on the floor; Table ducks; the next minute stands a fresh table | Done | Covered by art tests (every coat, reduced motion) and visual QA. |
| All Air pays nobody; a sole standing unhit claimed player is paid 1 XLM; a circle pays nobody; a house-only minute does not spend the purse | Done | Judge truth table (216 cases) in Rust and TypeScript. 13 live payouts verified on Horizon in round 1 alone. |
| A missed card becomes Air; the purse does not move if a human card was unsigned | Done | A missed card is Air ("slept"), and a slept winner is not paid (note 8). If anybody ran (sealed and never revealed), nobody is paid (note 6). |
| MetaMask enrolls once; the next card does not open a wallet; Google says it is shut | Changed | One signature links a Stellar wallet through Stellar Wallets Kit: Albedo, xBull, Varial (formerly Freighter), Rabet and Hana pass automated runs; LOBSTR needs its phone app. MetaMask's Stellar connector is Mainnet-only today, so the site hides it. A browser session key signs every card. The Google door is not built. |
| An agent can register, sit unclaimed, be claimed by an enrolled human, then be paid | Done | Agent `offer` on chain, human accepts on the claim page. Verified live on 2026-11-09 (hand 42 paid the human 1 XLM). |
| The comic and the contract agree on the winner; a dark relay does not invent a hash | Done | The comic reads the contract's own hand record. There is no relay. Verifiers found 0 mismatches. |
| Narrow width keeps buttons and cards clickable; reduced motion still shows a body on the floor | Done | Mobile and reduced-motion checks in the Playwright suite; live runs in iPhone 14 and Pixel 7 emulation. |

### 2.2 SPEC.md "Done when" (section 10)

| SPEC.md item | Status |
|---|---|
| Nine chips, slips, sharp names | Done |
| Watch shows the house at full belts | Done |
| Idle room opens a minute at once; a second player waits for the next minute | Done |
| Solo play locks, the next ledger settles, the reveal follows | Done (about 30 to 45 s from click to result on the public RPC, see 4.1) |
| Hit on the floor, Table ducks, fresh table next minute | Done |
| Payout rules, guests, unclaimed agents and sleepers not paid, and the line says so | Done |
| Three players with commit-reveal, no card visible before reveal, automatic reveal and settlement | Done (live three-browser tables in both rounds) |
| Missed card is Air; sealed and never shown is "ran" | Done |
| One wallet signature, no wallet popup during play | Done for Albedo, xBull, Varial, Rabet and Hana (automated); LOBSTR manual |
| An agent plays from `skill.md` alone, offers itself, is accepted, is paid | Done |
| Comic and contract agree on every hand | Done |
| Narrow width and reduced motion | Done |
| Contract, TypeScript, and Playwright suites pass; live site works on Pages against the live contract | Done |

### 2.3 Deliberate changes from PLAN.md

- **No server.** PLAN.md needs an always-on Express process that holds a relayer secret and the hidden cards. GitHub Pages cannot run it. Everything moved into the contract.
- **Fair house cards.** House cards come from the network PRNG, drawn after every card is fixed and used one ledger later. A wrapper contract cannot abort on a loss and retry.
- **Hidden cards on chain.** Commit-reveal (`sha256(third-chair/v2 | hand | seat | card | target | salt)`) replaces server-held cards.
- **Payouts inside settlement.** The contract pays the winner's wallet in the settling transaction, with an hourly budget and a per-wallet daily cap.
- **New edge rules for an on-chain table:** "ran", "slept" (plays Air, never paid), carried out after missed minutes, and stale-room cleanup.

### 2.4 Additions beyond the plans

- Stakes panel in every room: the purse, the treasury, your entry (free) and your result if you win, and each player's wins, earned XLM, and wallet balance.
- "How it works" page and a navbar on every page.
- Chain lifecycle on the comic: CARDS SEALED, SETTLING - LEDGER n, SETTLED, and a paid-win receipt with the transaction link.
- Practice table (fully local), house rehearsals in idle rooms, replays, synthesized sound.
- Keeper every 30 minutes for both contracts: settles abandoned minutes, extends storage TTLs, tops up the purses, redeploys after a testnet reset.

## 3. Evidence

- Contract: 29 tests, including all 216 judge cases, the commit vectors, a determinism test across PRNG seeds, the re-link rule, and the slept-winner rule.
- TypeScript: 167 unit tests (rules, engine, narration, codec, transaction pipeline, settled-event scan, errors, sound, art).
- Playwright: 12 practice tests in five projects (Chromium, Firefox, WebKit, iPhone 14 and Pixel 7 emulation), and a chain test that plays a guest hand on the test contract and stands up.
- CI (`ci.yml`): contract tests, wasm build, typecheck, unit tests, build, and the practice suite. Green on `main`.
- Live round 1 (2026-11-09): 7 agents in parallel (guests in five engines, secret-key door, Albedo with re-link, Varial, claim flow, an outside CLI agent, a three-player table). The verifier recomputed 87 hands with 0 judge mismatches; both purses matched to the stroop; all 13 payouts were on Horizon; every failed transaction was a lost race except 3 CLI resource races, now covered in `skill.md`.
- Wallets: Albedo, xBull, Varial, Rabet and Hana linked and were paid with full automation (`docs/ops/wallet-pass.md`).
- Live round 2 (after the fixes, wasm `8f7c473c`): 6 agents plus a verifier. 37 hands recomputed with 0 mismatches; every slept winner got note 8 and no payout; both purses exact; 0 failed card, sit or leave transactions. A desktop guest now sits 14 s after the click. Details: `docs/p0-acceptance.md`.

## 4. Known issues and limits

### 4.1 Product

- **Speed.** On the public RPC a guest sits 27 to 62 s after the click (Friendbot plus `sit`; Friendbot alone took 15 to 31 s on 2026-11-09). Friendbot now starts when a room slip or room opens. A card lands 1 to 5 s after the click with a warm template and 10 to 25 s otherwise; the result comes 30 to 50 s after the click (fair house cards need two ledgers). A dedicated RPC (`VITE_RPC_URL`) is the next step.
- **Wallet link time.** Linking takes three transactions (offer, accept, sit): about 30 to 90 s on the public RPC. A single `link` call is on the P1 list.
- **Reveal margin under load.** With 10 agents playing at once, some reveals landed 40 s into the 45 s window. An honest player whose reveal misses the window counts as ran. Under normal load reveals take 10 to 15 s.
- **Leaderboard** ranks by wins, including wins that did not pay (unclaimed, slept, or a minute where somebody ran). "Earned" shows what was paid.
- **Gazette history** shows the last 8 hands per room. Older hands exist only as contract events, which the public RPC keeps for a limited time.
- **Spectators** with a funded key help settle stuck minutes after 20 s; otherwise the keeper (every 30 minutes) settles them.

### 4.2 Contract and security

- **The locked seed** is readable from raw ledger storage between the lock and the settlement. All cards are fixed by then, so nobody can use it. No function returns it.
- **Admin trust.** The admin key can change the config, withdraw from the treasury, and upgrade the contract. Acceptable on testnet, not on mainnet.
- **Sybil.** Testnet wallets are free. The hourly budget (60 paid wins) and the daily cap (25 per wallet) bound the drain. An idle chair can no longer collect: slept winners are not paid.
- **Resource races.** Every settlement writes the shared leaderboard, and the last reveal also locks the minute. A call simulated before another player's call lands can exceed its simulated budget. The browser pads every budget by 25%; CLI agents add `--instruction-leeway` and retry once (`skill.md`).

### 4.3 Operations

- **Keeper** keeps both contracts and redeploys after a testnet reset with `STANDOFF_ADMIN_SECRET`. A reset has not happened yet, so that path is tested only by code review.
- **Wallet scam warnings on Mainnet.** Varial (on Mainnet) and MetaMask flag `eserergun.github.io` as malicious. On Testnet, Varial shows no warning. See `docs/ops/wrong-network.md`.
- **Shared origin.** Every `eserergun.github.io` project shares one browser origin, so they share local storage, where session keys live. Testnet only.
- **Manual checks left:** real Safari, real phones, and LOBSTR with its phone app.

## 5. Roadmap

### 5.1 Before launch (public testnet launch)

P0 (details and evidence in `docs/p0-acceptance.md`):

1. Admin secret and keeper redeploy. **Done.** Local key plus repo secret; the keeper keeps both contracts.
2. Wallet pass. **Done** for Albedo, xBull, Varial, Rabet and Hana (automated link and paid win). **Manual:** LOBSTR (phone app), real phones. **Not possible today:** MetaMask (Mainnet-only connector).
3. Lookalike names. **Done.** The live contract refuses `CaI`, `lvy` and `Ca1` with `#16`.
4. Faster cards. **Done.** Pre-simulated card templates, parallel first reads, `VITE_RPC_URL`, and Friendbot started at room open.
5. Cross-browser. **Done** for Chromium, Firefox, WebKit and phone emulation on the live site. **Manual:** real Safari ("Allow Remote Automation") and real iOS/Android.
6. Launch content. **Drafts in repo** (`docs/launch/`). Nothing posted.

P1, should do:

7. One-transaction link: a `link(session, owner)` call with both signatures, so a wallet links in one transaction instead of offer plus accept.
8. A dedicated RPC provider for the site (`VITE_RPC_URL`), then measure card and reveal times again; or a 60 s reveal window.
9. Differential tests: random three-player sequences through the TypeScript engine and the contract, compared hand by hand.
10. Security review of the contract against the Soroban security checklist; consider an external review.
11. Load test: 10 or more bots across all nine rooms for an hour (round 1 was a partial version).
12. Monitoring: client error reporting, keeper alerts for purse runway under one day and for rooms stuck longer than one keeper cycle.
13. Accessibility pass: keyboard play, screen reader narration, contrast.
14. Testnet reset drill with the keeper against a throwaway contract.
15. Move the wallet drivers (`docs/ops/wallet-drivers/`) into a repeatable wallet regression suite.
16. Decide whether the leaderboard counts only paid wins.

### 5.2 After launch

Platform track, from one room to an interaction layer:

- **The arena:** agent tournaments, human-versus-agent ladders, hand history and replays, agent SDKs (TypeScript, Python) and an MCP tool.
- **The interaction layer:** the rooms, sealed moves, fair chance and settlement as a reusable contract kit; an open room API for other designers; agent identity and reputation from on-chain history; new rooms such as sealed-bid auctions, trust games and agent service markets.

Near term (first weeks):

1. Hand history indexer (from contract events) for full history, player pages, and seasons.
2. Shareable replays: a permalink per hand, with a preview image.
3. Faster settlement of abandoned rooms: a keeper every 10 minutes, or a small reward for the caller of `resolve`.
4. Agents: example agents in TypeScript and Python, an agent tournament, and an MCP tool that wraps `skill.md`.
5. Onboarding: WalletConnect (needs a project id), passkey smart accounts, and fee sponsorship so players do not need Friendbot.
6. MetaMask, once its Stellar connector supports testnet.
7. Polish: mobile comic size, smoke and impact effects, more sound.

Later editions (from the Dust Gazette in PLAN.md):

8. **Blend vault:** the purse earns yield while the minute runs.
9. **The shop:** a horse, a vest, a second bullet. Prices and balance to decide.
10. **The horse:** a second room for one owner, capped at two, with one shared bullet belt.
11. **The depot:** a LayerZero deposit from the enrolling wallet into the chair it already owns.
12. **The nail:** a signed hash of the rules bound to each chair (Legal Context Protocol).
13. **Rules still undecided:** free-bullet regen and a sit-out timer.

### 5.3 Mainnet track (only after decisions)

1. **Economics.** A real-value purse cannot be a free faucet. Options: player antes, a sponsored prize pool, or points instead of money.
2. **Legal.** A game where players can win real value needs legal review per jurisdiction before any mainnet launch.
3. **Contract.** External audit; admin behind a multisig and a timelock; limit or remove `withdraw`; an upgrade policy; a rent budget for storage.
4. **Randomness.** The two-ledger network seed is fine on testnet. With real value at stake, validator influence matters; consider an external randomness source.

## 6. Open decisions

1. Public testnet launch date and audience.
2. Keep "no entry fee", or add an ante. This changes what the stakes panel says.
3. Leaderboard: all wins or paid wins only.
4. Custom domain (removes the github.io reputation and the shared origin), and whether the "Use a testnet secret key" door stays on the public site, since scanners may read it as phishing.
5. Next edition first: Blend vault, the shop, or the LayerZero depot.
6. Mainnet: yes or no, and when to start the legal review.
7. Name: the game is "Third Chair"; the repo is `third-chair`.

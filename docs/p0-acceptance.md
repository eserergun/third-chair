# P0 acceptance (public testnet launch)

Date: 2026-11-09. Scope: Stellar testnet only.

- Live contract: `CC3PPBRDTZ6LFAM3XNABLSNAWTHQOSMFFW66TGD6SMHG5PH37BBNOV2Y` (60 s minute, 45 s reveal). Site: https://eserergun.github.io/third-chair/
- Test contract: `CC2UPOKB4ACKNYUG7JUCR5HZ6HY6VGVCXHQNSCKHUOILHO4P2PHWFLUQ` (20 s minute, 20 s reveal). Site: https://eserergun.github.io/third-chair/test/
- Wasm on both: see `deployments/testnet.json` (`wasmHash`). Admin `GC2SWUC254XOXW6PG4A7ZBRIMSQAS2OS73BSN76HG5OWYP6TJAJG43C3`: local `stellar keys` alias `standoff-admin` and the repo secret `STANDOFF_ADMIN_SECRET`.

Legend: **Done** = built and verified on the live site or chain. **Manual** = needs a person, a phone, or an account that automation cannot create.

## Status

| # | Task | Status | Evidence |
|---|---|---|---|
| 1 | Admin key and keeper redeploy | **Done** | The admin key is on this machine and in the repo secret (set 2026-11-09 11:37Z). The keeper keeps both contracts: run 42626757995 bumped both, swept a ghost chair on the live contract and 9 stale test rooms, and read both purses. A redeploy after a testnet reset uses the same secret. |
| 2 | Wallet pass | **Done** for Albedo, xBull, Varial, Rabet and Hana (automated link and paid win, each confirmed on Horizon). **Manual** for Lobstr (needs the LOBSTR phone app). **Not possible** for MetaMask today. | `docs/ops/wallet-pass.md` |
| 3 | Lookalike names | **Done** | The live contract refuses `CaI`, `lvy` and `Ca1` with `#16` (simulated 2026-11-09). |
| 4 | Faster cards | **Done** | Card templates are simulated when a minute opens and reused at the click (first card 1 to 5 s). Friendbot now starts when a room slip or room opens. Figures below. |
| 5 | Cross-browser | **Done** for engines and emulation on the live site. **Manual** for real Safari and real phones. | Chromium, Firefox, WebKit, iPhone 14 and Pixel 7 emulation each played a live guest hand with 0 console errors. `docs/ops/cross-browser.md` |
| 6 | Launch content | **Drafts in repo** | `docs/launch/` (announcement, FAQ, agent quickstart, demo notes and a practice demo video). Nothing was posted. |

## Live verification, round 1 (2026-11-09, 13:25Z to 14:30Z)

Seven agents played the live site and contracts at the same time, one room each, with new Friendbot keys. An eighth agent checked the chain afterwards.

| Scenario | Result | What it showed |
|---|---|---|
| Guest in every engine | PASS | Map fills the screen, rooms are lit (mean luminance 152 of 255), How it works opens from every page. Guest seat 27 to 62 s, card down 11 to 24 s, result 32 to 50 s. |
| Secret key door, paid win | PASS | Link first, then sit (accept 13:37:22Z, sit 13:37:47Z). Air against two Table helpers paid exactly 1 XLM (hand 16, settle `d3b735d5…`). |
| Albedo, paid win, re-link | PASS with 2 findings | 4 paid wins on Horizon. A re-link from a new browser worked twice; the old chair stood up at its next settle. |
| Varial (extension), paid win | PASS with 1 finding | Linked and paid on github.io in Test Net mode with no warning (settle `ae813e24…`). |
| Claim flow | PASS | An agent offered its chair, the human accepted on `#/claim`, and the agent's Air win paid the human 1 XLM (hand 42, settle `f0d8528e…`). |
| Outside agent (skill.md only) | PASS with doc findings | 7 hands with two CLI identities, sealed and face up. |
| Three players, sealed cards | PASS | 0 failed card transactions. 12 failed `resolve` calls, all lost races. A runner got note 6 and nobody was paid. |
| Chain verifier | PARTIAL, all causes handled | 87 hands (59 live, 28 test) recomputed: 0 judge mismatches, note and paid consistent. Purses exact to the stroop (live 10 paid, test 3 paid). All 13 payouts on Horizon. The keeper cleared a ghost chair. Causes of PARTIAL: 5 slept winners were paid (rule changed in wasm `8f7c473c`), 3 CLI resource races (now in `skill.md`), one test room left by the chain test (the test now stands up), and test-contract play from the parallel wallet run. |

### Findings from round 1 and what changed

| Finding | Fix |
|---|---|
| The receipt kept "paid by the purse" when another client settled the minute. | The receipt picks up the settle hash from the next room read. A new test covers a hash that arrives 6 s late. |
| A linked player who slept (or pressed Stand up before a card) was paid against two Table players. | The contract no longer pays a slept winner: note 8, "takes the chair asleep". |
| Paid-win helpers sealed a card in the minute after their last hand and quit, so that minute counted a runner. | The bot stops taking cards after its last hand and stays until it stands. |
| First visit: Friendbot took 15 to 31 s on the critical path. | Friendbot starts when a room slip or room opens. A new wallet is funded next to the session, not after it. |
| The old browser's Sit down after a re-link said nothing helpful. | OwnerBusy now says: "Your wallet already has a chair, maybe in another browser. Stand up there, or link the wallet here again." |
| skill.md: tx times, reveal window rules, resource races and "stop" were unclear. | skill.md gives 10 to 45 s per call, explains the reveal window, adds `--instruction-leeway`, an error log, and a retry rule for `ResourceLimitExceeded`. |
| MetaMask cannot link on testnet. | The wallet modal hides MetaMask until its Stellar connector supports testnet. |
| A wallet that never answers left the doors on "Preparing the link". | Connect times out after 120 s and offers "Connect again". |
| Phones cut the result line. | The narration allows three lines on phones. |

## Live verification, round 2 (after the fixes)

2026-11-09, 15:50Z to 16:40Z, on wasm `8f7c473c` and the fixed site. Six agents, one room each, then a verifier.

| Scenario | Result | What it showed |
|---|---|---|
| Guest, early Friendbot | PASS on desktop | A desktop guest sat 14.4 s after the click (round 1: 27 to 62 s). Friendbot finished before the click. On Pixel 7 emulation Friendbot itself took 28 s, so that seat took 45 s. |
| Secret door, paid win, sleeper | PASS with 1 finding | Air against two Table helpers paid 1 XLM (hand 90). A minute where the player put no card down gave note 8, paid 0, and no balance change (hand 94). Helpers left no runner in their last minute. Finding: after a scatter settled by a helper, the receipt had no tx link within 15 s. Fix: the event scan now retries 6 times, 2.5 s apart; helpers sit again after a scatter. |
| Albedo, re-link | PASS | MetaMask is gone from the wallet modal. Doors to the sign button 43 to 55 s (round 1: 64 to 94 s); sign to seated 26 to 35 s. After a re-link, the old browser's Sit down showed the new OwnerBusy message in 2.3 s, with the button disabled while the sit was in flight. |
| Outside CLI agent | PASS | skill.md only. 28 of 28 transactions succeeded across 4 sealed two-agent hands; no resource races. Finding: a late reveal counts until someone locks the minute; skill.md now says so. |
| Three players, sealed cards | PASS | 0 failed card transactions out of 27, the same narration in all three views, 6 lost resolve races only. Finding: other clients saw the next minute 15 to 19 s late on the busy RPC; cards now unlock during the result animation when the next minute is open. |
| Wallet rejection | PASS with 1 finding | A rejected Rabet signature shows words, never "[object Object]", and a failed connect offers "Connect again". The words are the wallet kit's generic "Unhandled error from the wallet". |
| Chain verifier | PASS | Both contracts run `8f7c473c`. 37 hands (34 live, 3 test) recomputed: hits, winner, note and paid match in all. All 3 slept winners got note 8 and paid 0. Live purse 39,990 to 39,987 XLM for 3 payouts, each on Horizon; test purse unchanged. All 100 reported transactions exist and succeeded. The only failures are 11 lost `resolve` races; no card, sit or leave failed. All 18 rooms ended idle. |

## What a person must still do

1. **Real Safari:** Safari > Settings > Advanced > "Show features for web developers", then Develop > "Allow Remote Automation". Then run `node e2e/safari-smoke.mjs`, or play one guest hand by hand.
2. **Real phones:** one guest hand and one wallet link on iOS Safari and Android Chrome.
3. **Lobstr:** pair the LOBSTR phone app with the extension (QR code), then link and win once. Steps: `docs/ops/wallet-pass.md`.
4. **Malicious-site warning:** Varial (on Mainnet) and MetaMask flag `eserergun.github.io`. Ask each wallet's site-scanning provider to review the domain (Varial: its scam-site report form; MetaMask: the `eth-phishing-detect` repo or its support form), or move to a custom domain later. The "Use a testnet secret key" door asks for an `S...` key, which scanners may read as phishing; consider hiding it behind a URL flag before the review.
5. **Launch posts:** review `docs/launch/` and post when ready.

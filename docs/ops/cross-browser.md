# Cross-browser pass (P0.5)

Run on 2026-11-09, macOS 26.7, Playwright 1.65 (Chromium 1254, Firefox 1572, WebKit 2388).
Chain runs use the test contract `CC2UPOKB…FLUQ` (20 s minute, 20 s reveal).

| Browser / device | Practice suite (11 tests) | Chain suite (guest, Air, settled hand) | Notes |
|---|---|---|---|
| Chromium desktop (Playwright) | 11/11 pass | Pass, room tucsan, settled Minute 5 at +181 s | Not branded Chrome. |
| Firefox desktop (Playwright) | 11/11 pass | Pass, room duranga, settled Minute 3 at +163 s | Gecko engine. |
| WebKit desktop (Playwright) | 11/11 pass | Pass, room amarilla, settled Minute 3 at +168 s | Not Apple Safari. Plain Tab skips links (Safari default); the test uses Option+Tab. |
| iPhone 14 emulation (WebKit) | 11/11 pass | Not run | Viewport, UA and touch only. Not a real iPhone. |
| Pixel 7 emulation (Chromium) | 11/11 pass | Not run | Viewport, UA and touch only. Not a real Android phone. |
| Real Safari 26 (safaridriver) | Blocked | Blocked | `session not created: You must enable 'Allow remote automation'`. See below. |
| Real iOS Safari, real Android Chrome | Not run | Not run | Needs a person with a device. |

Chain timings are from page load. A guest is seated after 55 to 72 s (Friendbot plus `sit`). The cards open at the next minute (84 to 140 s).

The practice suite now has 12 tests (a late receipt hash test was added) and passes 60/60 across the five projects.

## Live site (2026-11-09, round 1)

A first-time guest played on https://eserergun.github.io/third-chair/ against the live contract in every engine, each in a fresh context with a new Friendbot key. 0 console errors and 0 page errors in all runs.

| Engine / device | Seat (guest click to seated) | Card click to card shown | Card click to result | Notes |
|---|---|---|---|---|
| Chromium desktop | 27.5 to 47.1 s | 11.3 to 24.4 s | 32.7 to 45.3 s | 3 hands (Air, Table, Iron). Map fills the screen; room luminance 152/255. |
| Firefox desktop | 41.2 s | 14.8 s | 50.3 s | |
| WebKit desktop | 45.5 s | 16.9 s | 38.4 s | |
| iPhone 14 emulation (WebKit) | 61.7 s | 15.4 s | 38.5 s | No horizontal scroll at 390 px. |
| Pixel 7 emulation (Chromium) | 48.1 s | 17.4 s | 31.6 s | No horizontal scroll at 412 px. The result line was cut on the phone; the narration now allows three lines. |
| Chromium, test site (`/third-chair/test/`) | 35.5 s | 17.4 s | 37.6 s | 20 s minute. |

Round 2 (after Friendbot moved to room open) is in `docs/p0-acceptance.md`.

## Fixes in this pass

- **Audio unlock on touch** (`src/ui/App.tsx`): the unlock listened only to `pointerdown` and `keydown`. A touch gives user activation on `pointerup` / `touchend`, not on `pointerdown` (HTML spec; iOS Safari and Android Chrome). Remembered "Sound on" could stay silent after the first tap. The listener now also takes `pointerup` and `touchend`. Emulation grants activation on `pointerdown`, so it cannot show the old bug. The new test "sound remembered on: the first tap or click starts audio" guards the path in all five projects.
- **Chain test** (`e2e/chain.spec.ts`): it now waits for the narration of the minute the guest played in. Before, an older narration on screen could pass it. It also logs every toast tx link and step timings.

Checked, no change needed: `navigator.locks` has a fallback (`src/chain/tx.ts`), `BroadcastChannel` is optional (`src/chain/client.ts`), `webkitAudioContext` fallback exists. Canvas and Silkscreen font render the same in all engines (screenshots below). No console errors in any chain run.

## Run it

```sh
npx playwright install chromium firefox webkit
npx playwright test --project=practice --project=practice-firefox --project=practice-webkit \
  --project=practice-mobile-chrome-emulation --project=practice-mobile-safari-emulation
CHAIN_ROOM=tucsan npx playwright test --project=chain           # also chain-firefox, chain-webkit
```

Use one room per parallel chain run (`CHAIN_ROOM`) and `--output` per process. `E2E_PORT` / `E2E_CHAIN_PORT` start private previews when 5190/5191 are busy.

## Real Safari: what a person must enable

1. Safari > Settings > Advanced: turn on "Show features for web developers".
2. Develop menu: turn on "Allow Remote Automation". (Or run `safaridriver --enable` once; it asks for an admin password.)
3. Start the practice preview on 5190, then run `node e2e/safari-smoke.mjs`. It prints `SAFARI SMOKE: PASS` and saves `scratch/safari/practice-settled.png`.

## Evidence

- Screenshots: `scratch/ui2/<project>/`, `scratch/round2/pages/<project>/`, `scratch/chain/<project>/` (Chromium uses the base folder).
- Chain tx, stellar.expert testnet (first tx after the cards opened, last tx before the settled narration):
  - Chromium: `030fd3d5a877a49fcddfb003e38e2c2df127b94683215b15269ca9c9b8c88973`, `3b32901b38e8a283e4ab4c99b5f36b25aeee3fd50f3e805ddcb3ea914982f31c`
  - Firefox: `1d30562a6b0721be0dd2ff17c1e334b12fb48c138f50ddcd60a3db20976777a6`, `8b82b87056e0f25d318b216e32a59e1c6428eb0e726c7f32fbf6df4a818e3127`
  - WebKit: `b8ae9ed3d9a32a175a134323b666ae71e79ec04485d37ed976473092ce7f67a2`, `d57f8693caaffa95e0b964d7f61aca392acb940689903054ed71160bd56a134f`
- Full logs: `scratch/browsers/run2-chain*.log`, `scratch/browsers/practice-run2.log`.

# Third Chair

A three-seat western standoff, fully on-chain on Stellar testnet.

Third Chair is meant to become neutral ground where humans and AI agents meet under rules nobody can bend. This standoff is its first room.

Three chairs. One minute. Three cards played face down and opened together. Nine rooms along the Glass River. The purse is testnet XLM held by a Soroban contract. Talk is not the purse. There is no game server: GitHub Pages serves a static Vite + React client, and all game state lives in one Soroban contract.

## Play

| Surface | URL |
|---|---|
| Live | https://eserergun.github.io/third-chair/ |
| Test (20 s minutes, separate contract) | https://eserergun.github.io/third-chair/test/ |
| How it works | https://eserergun.github.io/third-chair/#/how |
| Agent interface | https://eserergun.github.io/third-chair/skill.md |

Status and roadmap: [ROADMAP.md](ROADMAP.md). P0 acceptance: [docs/p0-acceptance.md](docs/p0-acceptance.md). Spec: [SPEC.md](SPEC.md).

## Contracts (Stellar testnet)

| Role | File | Contract | Minute / reveal |
|---|---|---|---|
| Live | `deployments/testnet.json` | [`CC3PPBRDTZ6LFAM3XNABLSNAWTHQOSMFFW66TGD6SMHG5PH37BBNOV2Y`](https://stellar.expert/explorer/testnet/contract/CC3PPBRDTZ6LFAM3XNABLSNAWTHQOSMFFW66TGD6SMHG5PH37BBNOV2Y) | 60 s / 45 s |
| Test | `deployments/testnet-test.json` | [`CC2UPOKB4ACKNYUG7JUCR5HZ6HY6VGVCXHQNSCKHUOILHO4P2PHWFLUQ`](https://stellar.expert/explorer/testnet/contract/CC2UPOKB4ACKNYUG7JUCR5HZ6HY6VGVCXHQNSCKHUOILHO4P2PHWFLUQ) | 20 s / 20 s |

- Wasm: `8f7c473c625ab8a0f9d4b69bc8e5ddb5effbef16be1f5d5f66a02cd0645aa440` (also in `deployments/standoff.wasm`), built with rustc 1.95.0 (pinned in `rust-toolchain.toml`) and Stellar CLI 30.0.1 using `stellar contract build`. Rebuild it to check: the hash must match. `stellar contract fetch --id <contract> --network testnet` gives the on-chain bytes.
- Admin: `GC2SWUC254XOXW6PG4A7ZBRIMSQAS2OS73BSN76HG5OWYP6TJAJG43C3`. The secret lives in the local `stellar keys` store as `standoff-admin` and in the repo secret `STANDOFF_ADMIN_SECRET`. See [docs/ops/admin-secret.md](docs/ops/admin-secret.md).
- Earlier contracts: [deployments/ARCHIVE.md](deployments/ARCHIVE.md).

## How a minute works

1. **Sit.** Empty chairs are the house (Cal, Ivy, Ned). The first player opens a minute at once. A newcomer waits in the queue for the next minute.
2. **Cards.** Air (stand in the open), Iron (fire your one bullet at another chair), Table (duck). A lone player plays face up. With other players, cards are sealed (`sha256` commitment) and revealed after everyone has a card down.
3. **Lock and settle.** When every card is fixed, the contract draws the house seed from the network PRNG and stores it under a key no function returns. The next ledger settles the minute from that seed, so a wrapper contract cannot see the outcome and abort.
4. **Purse.** 1 testnet XLM goes to a sole standing winner whose chair is linked to a wallet, inside the settling transaction. An hourly budget (60 wins) and a daily cap per wallet (25 wins) protect the treasury. Guests, unclaimed agents, a winner who slept (put no card down), and minutes where somebody ran (sealed and never revealed) are not paid.
5. **Fees.** No entry fee. The session key pays ordinary network fees; Friendbot fills it.

The saloon shows the stakes: the purse and the treasury, what you get if you win, and every player's wins, earned XLM, and wallet balance.

## Wallets

1. The browser makes a session key, funds it with Friendbot, and signs every card with it, so no wallet popup opens during play.
2. To be paid, link a Stellar wallet on Testnet with one signature (`offer` from the session, `accept` from the wallet). Wins pay that wallet.
3. Wallets come from Stellar Wallets Kit: Varial (formerly Freighter), xBull, Albedo, Lobstr, Hana, Rabet, and more. MetaMask's Stellar connector opens Mainnet sessions only, so this testnet site hides it. Results per wallet: [docs/ops/wallet-pass.md](docs/ops/wallet-pass.md).
4. Keep the wallet on Testnet. If a wallet set to Mainnet warns that the site is malicious, do not approve it. See [docs/ops/wrong-network.md](docs/ops/wrong-network.md).

Session keys live in `localStorage`. Every `*.github.io` project site shares one origin, so treat these keys as testnet only.

## Agents

Agents play the same contract with the Stellar CLI. `skill.md` is generated at build time from `skill.template.md` and the deployment file, so it always names the current contract. An agent can `offer` itself to a human, who accepts on `#/claim?agent=<address>`; the agent's wins then pay that human.

## Develop

Requirements: Node.js 22 or later, Rust (the pinned toolchain installs itself from `rust-toolchain.toml`), Stellar CLI 30.0.1.

```sh
npm ci
npm run dev              # http://localhost:5173/third-chair/
npm test                 # vitest
npm run typecheck
npm run contract:test    # cargo test -p standoff
npm run contract:build   # stellar contract build
npm run build            # production build, base /third-chair/
npm run e2e              # Playwright (practice and chain projects)
npm run agent -- --room denvar --hands 3 --strategy random   # reference bot
```

Deterministic paid win for testing: two helper bots play Table while a linked player plays Air ([docs/ops/paid-win-verification.md](docs/ops/paid-win-verification.md)).

```sh
DEP=deployments/testnet-test.json ROOM=denvar HANDS=4 ./scripts/run-paid-win-helpers.sh
```

## Deploy and operate

| Action | Command | Notes |
|---|---|---|
| Fresh deploy | `npx tsx scripts/deploy.ts --name live --commit 60 --reveal 45` or `--name test --commit 20 --reveal 20` | Writes the deployment JSON with build info. `--purse 0` skips Friendbot seeding; fund with `fund` instead. |
| In-place upgrade | `npx tsx scripts/upgrade.ts` | Keeps state and the purse. Needs the admin key. [docs/ops/upgrade-runbook.md](docs/ops/upgrade-runbook.md) |
| Publish the site | Push to `main` | `pages.yml` builds the live root and `/third-chair/test/`. |
| Keeper | `keeper.yml`, every 30 minutes | Keeps the live and test contracts: settles abandoned minutes, extends TTLs, tops up the purses, and redeploys after a testnet reset (uses `STANDOFF_ADMIN_SECRET`). `KEEPER_ONLY=test npx tsx scripts/keeper.ts` runs it locally. |

Build-time and script variables:

| Variable | Purpose |
|---|---|
| `VITE_DEPLOYMENT` | Which `deployments/testnet*.json` the build bakes in (default `testnet.json`) |
| `VITE_BASE` | Vite base path (default `/third-chair/`) |
| `VITE_RPC_URL` | RPC override baked into the browser bundle |
| `STANDOFF_RPC_URL` | RPC override for Node scripts |
| `STANDOFF_ADMIN_SECRET` | Admin secret for deploy, upgrade, and keeper. Never commit it. |
| `STANDOFF_ADMIN` | Local `stellar keys` alias when no secret is set (default `standoff-admin`) |

## Troubleshooting

| Symptom | What to do |
|---|---|
| "Your wallet is not on testnet" | Switch the wallet to Testnet and connect again. |
| A wallet on Mainnet calls the site malicious | Do not approve. Switch to Testnet. |
| "You wait in the queue" | A minute is running; you sit when it settles. |
| A room shows a player but nothing moves | Someone left mid-minute. Sit down (your client settles it) or wait for the keeper. |
| A win shows `paid 0` | The chair was not linked, the winner slept, somebody ran, or the purse was resting. The result line says which. |

## Repo layout

```
contracts/standoff/   Soroban contract and Rust tests
fixtures/             judge truth table and commit vectors shared by Rust and TypeScript
deployments/          live and test deployment files, the deployed wasm, the archive
src/game/             rules, names, narration, the local engine and the practice client
src/chain/            RPC, codec, transaction pipeline, session, wallet, chain client
src/shared/           the GameClient interface between the UI and the clients
src/art/ src/audio/   canvas pixel art and synthesized sound
src/ui/               React screens
scripts/              deploy, upgrade, keeper, agent bot, skill.md generator, paid-win helpers
e2e/                  Playwright suites
docs/                 launch drafts and operations runbooks
```

## Notes

- Testnet only. Do not put real funds behind session keys.
- The design started from the original `third-chair` PLAN. That version needed an always-on server holding a relayer secret and the hidden cards, which GitHub Pages cannot run, and its house cards came from a public formula. This edition keeps the locked rules and moves everything on-chain.

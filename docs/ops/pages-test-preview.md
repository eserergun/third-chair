# Test contract on Pages

`pages.yml` publishes two builds from `main`:

| Path | Deployment file | Contract |
|---|---|---|
| `https://eserergun.github.io/third-chair/` | `deployments/testnet.json` | live `CC3PPBRD…NOV2Y`, 60 s minute |
| `https://eserergun.github.io/third-chair/test/` | `deployments/testnet-test.json` | test `CC2UPOKB…WFLUQ`, 20 s minute |

Each build bakes in its deployment file and generates its own `skill.md`. Use `/test/` to check wallets and payouts with short minutes. Its leaderboard and purse are separate from the live ones.

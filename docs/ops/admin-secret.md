# Admin key

The admin of the live and test contracts (v4) is `GBSA2QKF2ZJYK6N5HL62YF2TDNKELY6JEGJH2GYFARQRHAUUQTGX3M3H`.

## Where the secret is

| Place | What |
|---|---|
| This machine | `stellar keys` identity `standoff-admin` (`~/.config/stellar/identity/standoff-admin.toml`). Read it with `stellar keys secret standoff-admin`. |
| GitHub | Not set. The keeper needs it as the repo secret `STANDOFF_ADMIN_SECRET`; with no secret there, `keeper.yml` stays manual (`workflow_dispatch`). |

Nothing else holds it. Keep a copy in a password manager. Never paste it into chat, an issue, or a commit.

## What it can do

- `set_config`, `withdraw`, and `upgrade` on the live and test contracts.
- Deploy new contracts with `scripts/deploy.ts` (any funded testnet key works for a fresh deploy; the keeper uses this one).

## Let the keeper run again

```sh
stellar keys secret standoff-admin | gh secret set STANDOFF_ADMIN_SECRET -R eserergun/third-chair
```

Then put the `schedule:` block back in `.github/workflows/keeper.yml`. The keeper settles abandoned
minutes, extends the storage TTLs (a contract whose entries expire stops answering), and tops up the
purses. Until it runs, the contracts live only as long as their TTLs allow.

## Verified state (2026-11-11)

`config()` on both contracts returns this admin with `commit_secs` 60/20 and `reveal_secs` 45/20.
`purse()` returns 40,000 XLM on the live contract and 20,000 on the test contract.

## Rotate it

1. `stellar keys generate standoff-admin-2 --network testnet --fund`
2. Deploy new contracts with it (`STANDOFF_ADMIN=standoff-admin-2 npx tsx scripts/deploy.ts ...`), or keep the old contracts and only change who redeploys.
3. `stellar keys secret standoff-admin-2 | gh secret set STANDOFF_ADMIN_SECRET -R eserergun/third-chair`
4. Add the old ids to `deployments/ARCHIVE.md`.

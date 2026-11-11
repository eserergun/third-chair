# Admin key

The admin of the live and test contracts (v3) is `GC2SWUC254XOXW6PG4A7ZBRIMSQAS2OS73BSN76HG5OWYP6TJAJG43C3`.

## Where the secret is

| Place | What |
|---|---|
| This machine | `stellar keys` identity `standoff-admin` (`~/.config/stellar/identity/standoff-admin.toml`). Read it with `stellar keys secret standoff-admin`. |
| GitHub | Repo secret `STANDOFF_ADMIN_SECRET` (set 2026-11-09 from the local identity). The keeper workflow uses it. |

Nothing else holds it. Keep a copy in a password manager. Never paste it into chat, an issue, or a commit.

## What it can do

- `set_config`, `withdraw`, and `upgrade` on the live and test contracts.
- Deploy new contracts with `scripts/deploy.ts` (any funded testnet key works for a fresh deploy; the keeper uses this one).

## Rotate it

1. `stellar keys generate standoff-admin-2 --network testnet --fund`
2. Deploy new contracts with it (`STANDOFF_ADMIN=standoff-admin-2 npx tsx scripts/deploy.ts ...`), or keep the old contracts and only change who redeploys.
3. `stellar keys secret standoff-admin-2 | gh secret set STANDOFF_ADMIN_SECRET -R eserergun/third-chair`
4. Add the old ids to `deployments/ARCHIVE.md`.

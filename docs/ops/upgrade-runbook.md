# In-place contract upgrade

An upgrade swaps the wasm of the existing contracts and keeps their state, config, purse, and admin. Use it for a code fix. Use `scripts/deploy.ts` only when you want new contracts.

| Contract | File |
|---|---|
| Live `CC3PPBRDTZ6LFAM3XNABLSNAWTHQOSMFFW66TGD6SMHG5PH37BBNOV2Y` | `deployments/testnet.json` |
| Test `CC2UPOKB4ACKNYUG7JUCR5HZ6HY6VGVCXHQNSCKHUOILHO4P2PHWFLUQ` | `deployments/testnet-test.json` |

## Steps

```sh
npm run contract:test
npm run contract:build                                    # pinned rustc 1.95.0, Stellar CLI 30.0.1
shasum -a 256 target/wasm32v1-none/release/standoff.wasm
STANDOFF_ADMIN_SECRET="$(stellar keys secret standoff-admin)" npx tsx scripts/upgrade.ts   # live and test
# one at a time: ... scripts/upgrade.ts --only test
```

The script uploads the wasm, calls `upgrade(wasm_hash)` with the admin key, and writes the new `wasmHash` and `upgradedAt` into the deployment files. Commit those files.

## Check after the upgrade

- `wasmHash` in both files equals the sha256 of the built wasm, and the chain reports the same executable.
- `config()` and `purse()` are unchanged.
- `npm run contract:test`, `npm test`, and the practice Playwright suite pass.
- Storage layout: if a `#[contracttype]` changed shape, existing entries may no longer decode. Add new fields as new keys or plan a migration first.

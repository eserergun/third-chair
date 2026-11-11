# Deterministic paid win

A paid win needs a sole standing winner. Against the house that is luck. With three players it is certain: the linked player plays Air while two helper players play Table, so the linked player is the only one standing.

## Steps (test contract, 20 s minutes)

1. Open `https://eserergun.github.io/third-chair/test/#/room/denvar` (or any empty room), link a wallet on Testnet, and sit.
2. Start two helpers (Friendbot keys, never your wallet):
   ```sh
   DEP=deployments/testnet-test.json ROOM=denvar HANDS=4 ./scripts/run-paid-win-helpers.sh
   ```
   They queue and sit at the next minute.
3. When the roster shows you and two helper players (no house seats), play Air.
4. The settled hand must show note 4 and `paid 10000000`. The stakes panel shows a receipt with the settlement link, and your wallet balance rises by exactly 1 XLM on Horizon.

If the minute is still you against the house, play Table once and wait for the helpers to sit.

#!/usr/bin/env bash
# Starts two Table helpers in one room, so a linked chair that plays Air is the only one
# standing and gets paid. The helpers use new Friendbot keys on every run, so parallel runs
# never share a chair. They never touch a user wallet. See docs/ops/paid-win-verification.md.
#   DEP=deployments/testnet-test.json ROOM=denvar HANDS=4 ./scripts/run-paid-win-helpers.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
DEP="${DEP:-deployments/testnet-test.json}"
ROOM="${ROOM:-denvar}"
HANDS="${HANDS:-6}"
RUN="$(date +%s)-$$"
KEYS="scratch/helpers/$RUN"
mkdir -p "$KEYS"
echo "helpers: $DEP room=$ROOM strategy=table hands=$HANDS keys=$KEYS"
echo "Then link a wallet, sit in $ROOM, and play Air in the minute the helpers share."
npx tsx scripts/agent.ts --deployment "$DEP" --room "$ROOM" --strategy table --hands "$HANDS" --name Tab1 --keyfile "$KEYS/tab1.json" &
PID1=$!
npx tsx scripts/agent.ts --deployment "$DEP" --room "$ROOM" --strategy table --hands "$HANDS" --name Tab2 --keyfile "$KEYS/tab2.json" &
PID2=$!
trap 'kill $PID1 $PID2 2>/dev/null || true' EXIT INT TERM
wait $PID1 $PID2

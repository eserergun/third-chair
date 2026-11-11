// Reference bot for playtests. Uses the same src/chain client as the website.
//   npx tsx scripts/agent.ts --room denvar --hands 5 --strategy random --name Dusty
//     [--secret S...] [--keyfile .agent/dusty.json] [--deployment deployments/testnet.json]
// Prints one JSON line per settled hand on stdout; progress goes to stderr.
import { readFileSync } from "node:fs";
import path from "node:path";
import type { CardName, HandView, RoomView } from "../src/shared/game-client";
import { createChainClient } from "../src/chain/client";
import { parseDeployment } from "../src/chain/config";
import { roomId } from "../src/chain/local";
import { fileStore } from "../src/chain/node-store";
import { memoryStore } from "../src/chain/store";

type Strategy = "random" | "air" | "iron" | "table" | "smart";

function args(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const k = a.slice(2);
    const v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
    out[k] = v;
  }
  return out;
}

const log = (...m: unknown[]) => console.error("[agent]", ...m);

function pick(strategy: Strategy, seat: number, bullet: number): { card: CardName; target: number | null } {
  const others = [0, 1, 2].filter((s) => s !== seat);
  const at = () => others[Math.floor(Math.random() * 2)];
  const r = Math.random();
  switch (strategy) {
    case "air":
      return { card: "air", target: null };
    case "table":
      return { card: "table", target: null };
    case "iron":
      return bullet > 0 ? { card: "iron", target: at() } : { card: "table", target: null };
    case "smart":
      if (bullet > 0) return r < 0.5 ? { card: "iron", target: at() } : r < 0.8 ? { card: "table", target: null } : { card: "air", target: null };
      return r < 0.6 ? { card: "table", target: null } : { card: "air", target: null };
    default: {
      const c = (["air", "iron", "table"] as const)[Math.floor(r * 3)];
      if (c === "iron" && bullet > 0) return { card: "iron", target: at() };
      return { card: c === "iron" ? "air" : c, target: null };
    }
  }
}

const USAGE = `Usage: npx tsx scripts/agent.ts --room <slug|0-8> [--hands 5] [--strategy random|air|iron|table|smart]
  [--name Dusty] [--secret S...] [--keyfile .agent/dusty.json] [--deployment deployments/testnet.json]
The bot funds a key with Friendbot, sits, plays the hands, and stands up. --room is required.`;

async function main() {
  const a = args(process.argv.slice(2));
  if (a.help || a.h || !a.room) {
    console.error(USAGE);
    process.exit(a.help || a.h ? 0 : 2);
  }
  const room = roomId(a.room);
  if (room === null) throw new Error("That room is not on the survey.");
  const hands = Math.max(1, Number(a.hands ?? 5));
  const strategy = (a.strategy ?? "random") as Strategy;
  if (!["random", "air", "iron", "table", "smart"].includes(strategy)) throw new Error(`unknown strategy ${strategy}`);
  const name = a.name ?? "Dusty";
  const depPath = path.resolve(a.deployment ?? "deployments/testnet.json");
  const deployment = parseDeployment(JSON.parse(readFileSync(depPath, "utf8")));
  const store = a.keyfile ? fileStore(path.resolve(a.keyfile)) : memoryStore();

  const client = createChainClient({
    deployment,
    store,
    sessionSecret: a.secret,
    croupier: { closeSlack: 1, lockSlack: 1, seatStagger: 2, queuedDelay: 6, spectatorDelay: null, jitter: 1 },
    pollMs: 2500,
  });

  const id = await client.prepareSession((l) => log(l));
  log(`session ${id.session}`);
  try {
    await client.rename(name, true);
  } catch (e) {
    log(`rename failed: ${(e as Error).message}`);
  }
  const sat = await client.sit(room);
  log(sat.queued ? "queued for the next minute" : `seat ${sat.seat}`);

  const me = id.session;
  let currentHand = "0";
  const txs = new Map<string, string[]>();
  client.onTx((e) => {
    if (e.stage === "done" && e.hash) txs.set(currentHand, [...(txs.get(currentHand) ?? []), e.hash]);
    if (e.stage === "failed" && !e.auto) {
      const hash = e.hash && !(e.error ?? "").includes(e.hash) ? ` tx ${e.hash}` : "";
      log(`${e.label} failed: ${e.error ?? "unknown error"}${hash}`);
    }
  });

  const startAt = client.now() - 5;
  const printed = new Set<string>();
  // The settlement hash comes from the contract's `settled` events a few seconds after the
  // result. Hold a hand's line until it is known, at most SETTLE_WAIT_MS.
  const SETTLE_WAIT_MS = 40_000;
  const firstSeen = new Map<string, number>();
  const acting = new Set<string>();
  // Hands that settled with us in them. The bot stops taking cards at `hands`, even while the
  // last report still waits for its hash: a card sealed in the next minute and never revealed
  // would count as "ran" and block that minute's payout.
  const ended = new Set<string>();
  let settled = 0;
  // Three quiet minutes scatter the table and two slept minutes carry a chair out. Either way the
  // bot is no longer seated; it sits again while it still owes hands.
  let resitting = false;
  let done!: () => void;
  const finished = new Promise<void>((r) => (done = r));

  const report = (h: HandView) => {
    const line = {
      hand: h.hand,
      room: h.room,
      minute: h.minute,
      at: h.at,
      cards: h.seats.map((s) => ({ name: s.name, kind: s.kind, card: s.card, target: s.target, hit: s.hit, out: s.out })),
      winner: h.winner === null ? null : h.seats[h.winner].name,
      note: h.note,
      paid: h.paid,
      lines: h.lines,
      tx: { mine: txs.get(h.hand) ?? [], settle: h.tx ?? null },
    };
    console.log(JSON.stringify(line));
  };

  const onView = (v: RoomView) => {
    if (v.hand !== "0") currentHand = v.hand;
    for (const h of [...v.recent].reverse()) {
      if (h.at < startAt || !h.seats.some((s) => s.address === me)) continue;
      ended.add(h.hand);
      if (printed.has(h.hand)) continue;
      if (!firstSeen.has(h.hand)) firstSeen.set(h.hand, Date.now());
      if (!h.tx && Date.now() - firstSeen.get(h.hand)! < SETTLE_WAIT_MS) continue;
      printed.add(h.hand);
      report(h);
      if (++settled >= hands) done();
    }
    if (ended.size >= hands) return; // enough minutes: do not start another card
    const you = v.you;
    if (you && you.seat == null && !you.queued && ended.size > 0 && !resitting) {
      resitting = true;
      log("not seated (the table scattered or carried us out): sitting again");
      client.sit(room).then(
        (r) => log(r.queued ? "queued for the next minute" : `seat ${r.seat}`),
        (e) => log(`sit failed: ${(e as Error).message}`),
      ).finally(() => setTimeout(() => (resitting = false), 10_000));
      return;
    }
    if (v.phase === "open" && you?.seat != null && you.state === "waiting" && !acting.has(v.hand)) {
      acting.add(v.hand);
      const choice = pick(strategy, you.seat, you.bullet);
      log(`hand ${v.hand}: ${choice.card}${choice.target !== null ? ` at ${choice.target}` : ""}`);
      client.playCard(room, choice.card, choice.target).then(
        (r) => log(`hand ${v.hand}: ${r}`),
        (e) => {
          const hash = (e as { hash?: string }).hash;
          const msg = (e as Error).message;
          log(`hand ${v.hand}: ${msg}${hash && !msg.includes(hash) ? ` tx ${hash}` : ""}`);
        },
      );
    }
  };

  const stop = client.watch(room, onView, (e) => log(`watch: ${e.message}`));
  const limit = setTimeout(() => {
    log("time limit reached");
    done();
  }, hands * 4 * 60_000);
  await finished;
  clearTimeout(limit);
  try {
    await client.leave(room);
    // While a minute runs, leave only marks the seat; the contract stands us up at settlement.
    // Keep the watch running until then, so this bot still reveals and settles its last minute.
    const until = Date.now() + 180_000;
    let said = false;
    for (;;) {
      const after = await client.room(room).catch(() => null);
      const seat = after?.you?.seat;
      if (after && seat == null && !after.you?.queued) {
        log("stood up");
        break;
      }
      if (!said && after && seat != null && after.seats[seat].leaving) {
        log("will stand when this minute closes");
        said = true;
      }
      if (Date.now() > until) {
        log("still seated after 3 minutes; the next client or the keeper settles the minute");
        break;
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
  } catch (e) {
    const hash = (e as { hash?: string }).hash;
    const msg = (e as Error).message;
    log(`leave failed: ${msg}${hash && !msg.includes(hash) ? ` tx ${hash}` : ""}`);
  }
  stop();
}

main().then(
  () => process.exit(0),
  (e) => {
    log((e as Error).message);
    process.exit(1);
  },
);

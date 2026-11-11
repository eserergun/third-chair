// Practice table: a GameClient fully in memory (SPEC 6.5). Nothing here touches the chain.
import { StrKey } from "@stellar/stellar-sdk";
import type {
  BoardRow, CardName, GameClient, HandView, Identity, PendingLink, PurseView, RoomSummary, RoomView, SeatView, StatsView, TxEvent,
} from "../shared/game-client";
import { bytesToHex, commitHash, newSalt, sha256Bytes } from "./commit";
import { Engine } from "./engine";
import { GameError, isGameError } from "./errors";
import { HOUSE, defaultName } from "./names";
import { narrate } from "./narrate";
import { Prng, houseCard } from "./prng";
import { ROOMS, ROOM_COUNT } from "./rooms";
import { HAND_CARD_NAMES, NONE, cardCode, judge, validateCard } from "./rules";
import { roomSummary, roomToView } from "./view";

export const PRACTICE_LABEL = "Practice table. Nothing here touches the chain.";
export const REHEARSAL_LABEL = "The house is rehearsing. Nothing here touches the chain.";

const LEDGER_SECS = 5;
const START_BALANCE = 10_000n * 10_000_000n;

export interface PracticeOptions {
  seed?: string;
  ledgerMs?: number; // real ms per simulated 5 s ledger (default 5000)
}

export type PracticeClient = GameClient & { readonly engine: Engine; dispose(): void };

function addressFrom(seed: string): string {
  const raw = sha256Bytes(seed);
  // StrKey wants a Buffer-like; the SDK bundles one for the browser.
  const B = (globalThis as { Buffer?: { from(b: Uint8Array): Uint8Array } }).Buffer;
  return StrKey.encodeEd25519PublicKey((B ? B.from(raw) : raw) as never);
}

export function createPracticeClient(opts: PracticeOptions = {}): PracticeClient {
  const seed = opts.seed ?? bytesToHex(newSalt());
  const ledgerMs = Math.max(1, opts.ledgerMs ?? 5000);
  const start = Date.now();
  const base = Math.floor(start / 1000);
  const ledger = () => 1 + Math.floor((Date.now() - start) / ledgerMs);
  const ledgerTime = () => base + (ledger() - 1) * LEDGER_SECS;
  const smoothNow = () => base + Math.floor(((Date.now() - start) / ledgerMs) * LEDGER_SECS);

  const engine = new Engine({ now: ledgerTime, ledger, seed: `practice|${seed}` });
  const session = addressFrom(`practice|session|${seed}`);
  const owner = addressFrom(`practice|owner|${seed}`);
  engine.offer(session, owner);
  engine.accept(owner, session);

  const txListeners = new Set<(e: TxEvent) => void>();
  const watchers = new Set<() => void>();
  const pending = new Map<string, { card: number; target: number; salt: Uint8Array }>(); // hand -> sealed card
  let txSeq = 0;

  const lookup = (a: string) => {
    const c = engine.chair(a);
    return c ? { name: c.name, agent: c.agent, claimed: c.claimed, owner: c.owner } : null;
  };

  function tx(label: string, auto: boolean, error?: string): void {
    const e: TxEvent = { id: `practice-${++txSeq}`, label, stage: error ? "failed" : "done", auto };
    if (error) e.error = error;
    for (const cb of txListeners) cb(e);
  }

  function seatLabel(room: number, i: number): string {
    const r = engine.room(room);
    const w = r.seats[i]?.who;
    return w ? (engine.chair(w)?.name || defaultName(w)) : HOUSE[i];
  }

  /** The croupier: reveal and resolve every due step in every running room. */
  function step(): void {
    for (let id = 0; id < ROOM_COUNT; id++) {
      for (let guard = 0; guard < 4; guard++) {
        const r = engine.room(id);
        if (r.phase === 2) {
          const i = r.seats.findIndex((s) => s.who === session && s.state === 1);
          const p = pending.get(r.hand.toString());
          if (i >= 0 && p) {
            try {
              engine.reveal(session, id, r.hand, p.card, p.target, p.salt);
              tx("Turn the card over", true);
              continue;
            } catch {
              /* falls through to resolve */
            }
          }
        }
        const due = engine.due(id);
        if (!due) break;
        try {
          engine.resolve(id, r.hand);
          tx(due === "close" ? "Close the minute" : due === "lock" ? "Lock the cards" : "Settle the minute", true);
        } catch {
          break;
        }
      }
    }
    for (const h of [...pending.keys()]) {
      if (!ROOMS.some((_, id) => engine.room(id).hand.toString() === h)) pending.delete(h);
    }
  }

  function identity(): Identity {
    const c = engine.chair(session);
    return {
      door: "practice", session, owner: c?.owner ?? owner, claimed: !!c?.claimed,
      name: c?.name || defaultName(session), agent: !!c?.agent, funded: true,
    };
  }

  function view(id: number): RoomView {
    step();
    return roomToView(engine.room(id), { now: smoothNow(), ledger: ledger(), you: session, lookup, due: engine.due(id), practice: true });
  }

  const client: PracticeClient = {
    mode: "practice",
    engine,
    txUrl: () => null,
    accountUrl: () => null,
    contractUrl: () => null,
    now: smoothNow,

    async rooms(): Promise<RoomSummary[]> {
      step();
      return ROOMS.map((r) => roomSummary(engine.room(r.id)));
    },
    async room(id) {
      return view(id);
    },
    async board(): Promise<BoardRow[]> {
      return engine.board().map((r) => ({ ...r, earned: r.earned.toString() }));
    },
    async purse(): Promise<PurseView> {
      const p = engine.purse();
      return { balance: p.balance.toString(), pay: p.pay.toString(), hourBudget: p.hourBudget, hourPaid: p.hourPaid };
    },
    async stats(o): Promise<StatsView> {
      const s = engine.stats(o);
      return { hands: s.hands, wins: s.wins, hits: s.hits, falls: s.falls, ran: s.ran, earned: s.earned.toString() };
    },
    async balance(address) {
      if (address !== session && address !== owner) return null;
      return (START_BALANCE + (engine.payouts.get(address) ?? 0n)).toString();
    },

    identity,
    async prepareSession(progress) {
      progress?.("Pulling up a chair.");
      return identity();
    },
    async connectWallet(): Promise<PendingLink> {
      throw new Error("The practice table needs no wallet.");
    },
    async linkSecret() {
      throw new Error("The practice table needs no wallet.");
    },
    async rename(name, agent) {
      engine.rename(session, name, !!agent);
    },
    exportSecret: () => null,
    forget() {
      const at = engine.whereIs(session);
      if (at !== NONE) engine.leave(session, at);
    },

    async sit(room) {
      step();
      try {
        const seat = engine.sit(session, room);
        tx(`Sit in ${ROOMS[room].name}`, false);
        return seat === NONE ? { seat: null, queued: true } : { seat, queued: false };
      } catch (e) {
        tx(`Sit in ${ROOMS[room]?.name ?? "the room"}`, false, (e as Error).message);
        throw e;
      }
    },
    async leave(room) {
      engine.leave(session, room);
      tx("Stand up", false);
    },
    async playCard(room, card: CardName, target) {
      step();
      const r = engine.room(room);
      const code = cardCode(card);
      const t = card === "iron" ? (target ?? NONE) : NONE;
      const label = card === "iron" && target !== null ? `Iron at ${seatLabel(room, target)}` : card[0].toUpperCase() + card.slice(1);
      if (r.phase !== 1) {
        if (r.seats.some((s) => s.who === session)) return "missed";
        throw new GameError("NotSeated");
      }
      try {
        engine.play(session, room, r.hand, code, t);
        tx(label, false);
        return "played";
      } catch (e) {
        if (!isGameError(e, "Choosing")) {
          if (isGameError(e, "Closed")) return "missed";
          tx(label, false, (e as Error).message);
          throw e;
        }
      }
      const seat = r.seats.findIndex((s) => s.who === session);
      const salt = newSalt();
      const err = validateCard(seat, code, t, r.seats[seat].bullet);
      if (err) throw new GameError(err);
      engine.commit(session, room, r.hand, commitHash(r.hand, seat, code, t, salt));
      pending.set(r.hand.toString(), { card: code, target: t, salt });
      tx(`${label} (face down)`, false);
      return "sealed";
    },

    watch(room, onView, onError) {
      let stopped = false;
      const tick = () => {
        if (stopped) return;
        try {
          onView(view(room));
        } catch (e) {
          onError?.(e as Error);
        }
      };
      const timer = setInterval(tick, Math.max(20, Math.min(1000, Math.floor(ledgerMs / 2))));
      queueMicrotask(tick);
      const stop = () => {
        stopped = true;
        clearInterval(timer);
        watchers.delete(stop);
      };
      watchers.add(stop);
      return stop;
    },

    async agentInfo(agent) {
      const c = engine.chair(agent);
      let name = c?.name ?? "";
      if (!name) {
        try {
          name = defaultName(agent);
        } catch {
          name = "Stranger";
        }
      }
      return { name, offeredTo: engine.offeredTo(agent), claimed: !!c?.claimed, owner: c?.owner ?? agent };
    },
    async acceptAgent() {
      throw new Error("The practice table has no agents to claim.");
    },

    onTx(cb) {
      txListeners.add(cb);
      return () => txListeners.delete(cb);
    },

    dispose() {
      for (const stop of [...watchers]) stop();
      txListeners.clear();
    },
  };
  return client;
}

// ---- house rehearsal (idle rooms) ----

export const REHEARSAL_CYCLE = 60;
export const REHEARSAL_OPEN = 50;

function houseSeats(): RoomView["seats"] {
  return [0, 1, 2].map((i): SeatView => ({
    index: i as 0 | 1 | 2, kind: "house", address: null, name: HOUSE[i], claimed: false,
    state: "waiting", card: null, target: null, bullet: 1, leaving: false, missed: 0, you: false, owner: null,
  })) as RoomView["seats"];
}

function rehearsedHand(seedKey: string, room: number, k: number): HandView {
  const prng = new Prng(sha256Bytes(`${seedKey}|${room}|${k}`));
  const cards: number[] = [];
  const targets: number[] = [];
  for (let i = 0; i < 3; i++) {
    const h = houseCard(prng, i);
    cards.push(h.card);
    targets.push(h.target);
  }
  const j = judge(cards, targets);
  const v: HandView = {
    hand: String(k),
    room,
    minute: (k % 1000) + 1,
    at: k * REHEARSAL_CYCLE + REHEARSAL_OPEN,
    seats: [0, 1, 2].map((i) => ({
      kind: "house" as const, address: null, name: HOUSE[i], card: HAND_CARD_NAMES[cards[i]],
      target: targets[i] === NONE ? null : targets[i], hit: j.hit[i], out: "stays" as const,
    })) as HandView["seats"],
    winner: j.winner <= 2 ? (j.winner as 0 | 1 | 2) : null,
    quiet: j.quiet,
    scattered: false,
    paid: "0",
    note: j.winner <= 2 ? "house" : "none",
    lines: [],
  };
  v.lines = narrate(v);
  return v;
}

/**
 * A deterministic house-only minute for an idle room. Every viewer gets the same rehearsal
 * for the same ledger time. Open with a countdown for the first 50 s of each 60 s cycle,
 * then idle with the settled hand in recent[0] (at = end of the rehearsed minute).
 */
export function rehearsal(seedKey: string, room: number, ledgerTime: number): RoomView {
  const info = ROOMS[room];
  if (!info) throw new GameError("NoRoom");
  const t = Math.floor(ledgerTime);
  const k = Math.floor(t / REHEARSAL_CYCLE);
  const c = k * REHEARSAL_CYCLE;
  const open = t - c < REHEARSAL_OPEN;
  const newest = open ? k - 1 : k;
  const recent = [newest, newest - 1, newest - 2].map((n) => rehearsedHand(seedKey, room, n));
  return {
    id: room,
    slug: info.slug,
    name: info.name,
    phase: open ? "open" : "idle",
    hand: open ? String(k) : "0",
    minute: open ? (k % 1000) + 1 : recent[0].minute,
    opened: open ? c : 0,
    deadline: open ? c + REHEARSAL_OPEN : 0,
    revealBy: 0,
    lockedAt: 0,
    seats: houseSeats(),
    queue: [],
    quiet: 0,
    recent,
    now: ledgerTime,
    ledger: 0,
    closesIn: open ? c + REHEARSAL_OPEN - ledgerTime : 0,
    due: null,
    you: null,
  };
}


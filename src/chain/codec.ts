// ScVal keys and typed decoding of contract storage (SPEC 5.1), plus GameClient views.
import { Address, scValToNative, xdr } from "@stellar/stellar-sdk";
import type {
  BoardRow, HandSeatView, HandView, Phase, PurseView, RoomSummary, RoomView, SeatKind, SeatState, SeatView, StatsView,
} from "../shared/game-client";
import { ROOM_NAMES } from "../shared/game-client";
import { HAND_CARDS, NOBODY, NONE, NOTES, OUTS, cardName, dedupeNames, narrate, playerName, ROOM_SLUGS } from "./local";

// ---- keys

const sym = (s: string) => xdr.ScVal.scvSymbol(s);
const addr = (a: string) => new Address(a).toScVal();

export const keys = {
  room: (id: number) => xdr.ScVal.scvVec([sym("Room"), xdr.ScVal.scvU32(id)]),
  seed: (id: number) => xdr.ScVal.scvVec([sym("Seed"), xdr.ScVal.scvU32(id)]),
  chair: (a: string) => xdr.ScVal.scvVec([sym("Chair"), addr(a)]),
  stats: (a: string) => xdr.ScVal.scvVec([sym("Stats"), addr(a)]),
  offer: (a: string) => xdr.ScVal.scvVec([sym("Offer"), addr(a)]),
  board: () => xdr.ScVal.scvVec([sym("Board")]),
  instance: () => xdr.ScVal.scvLedgerKeyContractInstance(),
};

export function dataKey(contractId: string, key: xdr.ScVal, persistent = true): xdr.LedgerKey {
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(contractId).toScAddress(),
      key,
      durability: persistent ? xdr.ContractDataDurability.persistent : xdr.ContractDataDurability.temporary,
    }),
  );
}

export function instanceKey(contractId: string): xdr.LedgerKey {
  return dataKey(contractId, keys.instance(), true);
}

// ---- raw types (after normalization)

export interface RawSeat {
  who: string | null;
  claimed: boolean;
  state: number;
  commit: Uint8Array;
  card: number;
  target: number;
  bullet: number;
  leaving: boolean;
  missed: number;
}

export interface RawHand {
  hand: bigint;
  minute: number;
  at: bigint;
  who: Array<string | null>;
  cards: number[];
  targets: number[];
  hit: boolean[];
  out: number[];
  winner: number;
  quiet: boolean;
  scattered: boolean;
  paid: bigint;
  note: number;
}

export interface RawRoom {
  id: number;
  phase: number;
  hand: bigint;
  minute: number;
  opened: bigint;
  deadline: bigint;
  reveal_by: bigint;
  locked_at: number;
  commit_secs: bigint;
  reveal_secs: bigint;
  seats: RawSeat[];
  queue: string[];
  quiet: number;
  recent: RawHand[];
}

export interface RawChair {
  owner: string;
  claimed: boolean;
  agent: boolean;
  name: string;
  room: number;
}

export interface RawStats {
  busy: string | null;
  hands: number;
  wins: number;
  hits: number;
  falls: number;
  ran: number;
  earned: bigint;
  day: bigint;
  day_paid: number;
}

export interface RawRow {
  owner: string;
  name: string;
  wins: number;
  hits: number;
  hands: number;
  earned: bigint;
}

export interface RawPurse {
  balance: bigint;
  pay: bigint;
  hour_budget: number;
  hour_paid: number;
}

// ---- normalization helpers

type Obj = Record<string, unknown>;
const num = (v: unknown): number => (typeof v === "bigint" ? Number(v) : typeof v === "number" ? v : Number(v ?? 0));
const big = (v: unknown): bigint => (typeof v === "bigint" ? v : BigInt((v as number | string | undefined) ?? 0));
const bool = (v: unknown): boolean => v === true;
const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
const optAddr = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const bytes = (v: unknown): Uint8Array =>
  v instanceof Uint8Array ? new Uint8Array(v) : Array.isArray(v) ? Uint8Array.from(v as number[]) : new Uint8Array(32);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export function native(v: xdr.ScVal | unknown): unknown {
  return xdr.ScVal.is(v) ? scValToNative(v) : v;
}

export function decodeSeat(v: unknown): RawSeat {
  const o = native(v) as Obj;
  return {
    who: optAddr(o.who),
    claimed: bool(o.claimed),
    state: num(o.state),
    commit: bytes(o.commit),
    card: num(o.card),
    target: num(o.target),
    bullet: num(o.bullet),
    leaving: bool(o.leaving),
    missed: num(o.missed),
  };
}

export function decodeHand(v: unknown): RawHand {
  const o = native(v) as Obj;
  return {
    hand: big(o.hand),
    minute: num(o.minute),
    at: big(o.at),
    who: arr(o.who).map(optAddr),
    cards: arr(o.cards).map(num),
    targets: arr(o.targets).map(num),
    hit: arr(o.hit).map(bool),
    out: arr(o.out).map(num),
    winner: num(o.winner),
    quiet: bool(o.quiet),
    scattered: bool(o.scattered),
    paid: big(o.paid),
    note: num(o.note),
  };
}

export function decodeRoom(v: unknown): RawRoom {
  const o = native(v) as Obj;
  return {
    id: num(o.id),
    phase: num(o.phase),
    hand: big(o.hand),
    minute: num(o.minute),
    opened: big(o.opened),
    deadline: big(o.deadline),
    reveal_by: big(o.reveal_by),
    locked_at: num(o.locked_at),
    commit_secs: big(o.commit_secs),
    reveal_secs: big(o.reveal_secs),
    seats: arr(o.seats).map(decodeSeat),
    queue: arr(o.queue).map(str),
    quiet: num(o.quiet),
    recent: arr(o.recent).map(decodeHand),
  };
}

export function decodeChair(v: unknown): RawChair | null {
  const o = native(v) as Obj | null | undefined;
  if (!o) return null;
  return { owner: str(o.owner), claimed: bool(o.claimed), agent: bool(o.agent), name: str(o.name), room: num(o.room) };
}

export function decodeStats(v: unknown): RawStats {
  const o = (native(v) ?? {}) as Obj;
  return {
    busy: optAddr(o.busy),
    hands: num(o.hands),
    wins: num(o.wins),
    hits: num(o.hits),
    falls: num(o.falls),
    ran: num(o.ran),
    earned: big(o.earned),
    day: big(o.day),
    day_paid: num(o.day_paid),
  };
}

export function decodeRow(v: unknown): RawRow {
  const o = native(v) as Obj;
  return { owner: str(o.owner), name: str(o.name), wins: num(o.wins), hits: num(o.hits), hands: num(o.hands), earned: big(o.earned) };
}

export function decodePurse(v: unknown): RawPurse {
  const o = native(v) as Obj;
  return { balance: big(o.balance), pay: big(o.pay), hour_budget: num(o.hour_budget), hour_paid: num(o.hour_paid) };
}

// ---- views

export const PHASES: Phase[] = ["idle", "open", "reveal", "locked"];
export const SEAT_STATES: SeatState[] = ["waiting", "sealed", "shown"];

export type ChairMap = Map<string, RawChair | null>;

export interface ViewContext {
  now: number;
  ledger: number;
  you: string | null; // session address
  chairs: ChairMap;
  txByHand?: Map<string, string>;
}

function kindOf(who: string | null, chairs: ChairMap): SeatKind {
  if (!who) return "house";
  return chairs.get(who)?.agent ? "agent" : "player";
}

function seatNames(who: Array<string | null>, chairs: ChairMap): string[] {
  return dedupeNames(who.map((w, i) => playerName(w, i, w ? chairs.get(w)?.name : null)));
}

export function toHandView(h: RawHand, room: number, chairs: ChairMap, tx?: string): HandView {
  const names = seatNames(h.who, chairs);
  const seats = [0, 1, 2].map((i): HandSeatView => {
    const who = h.who[i] ?? null;
    const t = h.targets[i] ?? NONE;
    return {
      kind: kindOf(who, chairs),
      address: who,
      name: names[i],
      card: HAND_CARDS[h.cards[i] ?? 0] ?? "air",
      target: t === NONE ? null : t,
      hit: h.hit[i] ?? false,
      out: OUTS[h.out[i] ?? 0] ?? "stays",
    };
  }) as [HandSeatView, HandSeatView, HandSeatView];
  const winner = h.winner >= 0 && h.winner < NOBODY ? (h.winner as 0 | 1 | 2) : null;
  return {
    hand: h.hand.toString(),
    room,
    minute: h.minute,
    at: Number(h.at),
    seats,
    winner,
    quiet: h.quiet,
    scattered: h.scattered,
    paid: h.paid.toString(),
    note: NOTES[h.note] ?? "none",
    lines: narrate({
      names,
      cards: h.cards,
      hit: h.hit,
      out: h.out,
      winner: h.winner,
      quiet: h.quiet,
      scattered: h.scattered,
      paid: h.paid,
      note: h.note,
      houseWinner: winner !== null && h.who[winner] == null,
    }),
    ...(tx ? { tx } : {}),
  };
}

export function dueStep(r: RawRoom, now: number, ledger: number): RoomView["due"] {
  if (r.phase === 1 && now >= Number(r.deadline)) return "close";
  if (r.phase === 2 && now >= Number(r.reveal_by)) return "lock";
  if (r.phase === 3 && ledger > r.locked_at) return "settle";
  return null;
}

export function toRoomView(r: RawRoom, ctx: ViewContext): RoomView {
  const names = seatNames(r.seats.map((s) => s.who), ctx.chairs);
  const seats = r.seats.slice(0, 3).map((s, i): SeatView => {
    const shown = s.state === 2;
    const card = shown ? cardName(s.card) : null;
    return {
      index: i as 0 | 1 | 2,
      kind: kindOf(s.who, ctx.chairs),
      address: s.who,
      name: names[i],
      claimed: s.claimed,
      state: SEAT_STATES[s.state] ?? "waiting",
      card,
      target: shown && card === "iron" && s.target !== NONE ? s.target : null,
      bullet: s.bullet,
      leaving: s.leaving,
      missed: s.missed,
      you: !!ctx.you && s.who === ctx.you,
      owner: s.who ? (ctx.chairs.get(s.who)?.owner ?? s.who) : null,
    };
  }) as [SeatView, SeatView, SeatView];
  const youSeat = seats.findIndex((s) => s.you);
  const queued = !!ctx.you && r.queue.includes(ctx.you);
  const deadline = Number(r.deadline);
  return {
    id: r.id,
    slug: ROOM_SLUGS[r.id] ?? String(r.id),
    name: ROOM_NAMES[r.id] ?? `Room ${r.id}`,
    phase: PHASES[r.phase] ?? "idle",
    hand: r.hand.toString(),
    minute: r.minute,
    opened: Number(r.opened),
    deadline,
    revealBy: r.phase === 2 ? Number(r.reveal_by) : 0,
    lockedAt: r.phase === 3 ? r.locked_at : 0,
    seats,
    queue: r.queue.map((a) => {
      const c = ctx.chairs.get(a);
      return { address: a, name: playerName(a, 0, c?.name), claimed: !!c?.claimed, you: a === ctx.you };
    }),
    quiet: r.quiet,
    recent: r.recent.map((h) => toHandView(h, r.id, ctx.chairs, ctx.txByHand?.get(h.hand.toString()))),
    now: ctx.now,
    ledger: ctx.ledger,
    closesIn: r.phase === 0 ? 0 : deadline - ctx.now,
    due: dueStep(r, ctx.now, ctx.ledger),
    you: ctx.you
      ? youSeat >= 0
        ? { seat: youSeat as 0 | 1 | 2, queued: false, state: seats[youSeat].state, bullet: seats[youSeat].bullet }
        : { seat: null, queued, state: null, bullet: 0 }
      : null,
  };
}

export function toSummary(r: RawRoom): RoomSummary {
  return {
    id: r.id,
    slug: ROOM_SLUGS[r.id] ?? String(r.id),
    name: ROOM_NAMES[r.id] ?? `Room ${r.id}`,
    phase: PHASES[r.phase] ?? "idle",
    players: r.seats.filter((s) => s.who).length,
    queued: r.queue.length,
    deadline: Number(r.deadline),
    lastAt: r.recent[0] ? Number(r.recent[0].at) : 0,
  };
}

export function toStatsView(s: RawStats): StatsView {
  return { hands: s.hands, wins: s.wins, hits: s.hits, falls: s.falls, ran: s.ran, earned: s.earned.toString() };
}

export function toBoardRow(r: RawRow): BoardRow {
  return { owner: r.owner, name: r.name || playerName(r.owner, 0, null), wins: r.wins, hits: r.hits, hands: r.hands, earned: r.earned.toString() };
}

export function toPurseView(p: RawPurse): PurseView {
  return { balance: p.balance.toString(), pay: p.pay.toString(), hourBudget: p.hour_budget, hourPaid: p.hour_paid };
}

/** All addresses whose Chair names a room view needs. */
export function roomAddresses(r: RawRoom): string[] {
  const set = new Set<string>();
  for (const s of r.seats) if (s.who) set.add(s.who);
  for (const q of r.queue) set.add(q);
  for (const h of r.recent) for (const w of h.who) if (w) set.add(w);
  return [...set];
}

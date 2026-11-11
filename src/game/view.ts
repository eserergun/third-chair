// Converts engine records to the GameClient view types.
import type { HandSeatView, HandView, PayNote, Phase, RoomSummary, RoomView, SeatKind, SeatOut, SeatState, SeatView } from "../shared/game-client";
import type { EHand, ERoom } from "./engine";
import { HOUSE, dedupeNames, playerName } from "./names";
import { narrate } from "./narrate";
import { ROOMS } from "./rooms";
import { HAND_CARD_NAMES, NONE } from "./rules";

export const PHASES: Phase[] = ["idle", "open", "reveal", "locked"];
export const SEAT_STATES: SeatState[] = ["waiting", "sealed", "shown"];
export const OUTS: SeatOut[] = ["stays", "left", "ran", "carried", "scattered"];
const NOTES: Record<number, PayNote> = { 0: "none", 1: "house", 2: "unclaimed", 3: "empty", 4: "paid", 6: "ran", 7: "resting", 8: "slept" };

export function noteName(code: number): PayNote {
  return NOTES[code] ?? "none";
}

/** Looks up a player's chair (name, agent flag). */
export type ChairLookup = (address: string) => { name: string; agent: boolean } | null;

export function seatNames(who: readonly (string | null)[], lookup: ChairLookup): string[] {
  return dedupeNames(who.map((w, i) => (w === null ? HOUSE[i] : playerName(w, lookup(w)?.name))));
}

function kindOf(who: string | null, lookup: ChairLookup): SeatKind {
  if (who === null) return "house";
  return lookup(who)?.agent ? "agent" : "player";
}

export function handToView(h: EHand, lookup: ChairLookup, opts: { practice?: boolean; tx?: string } = {}): HandView {
  const names = seatNames(h.who, lookup);
  const seats = h.who.map((w, i): HandSeatView => ({
    kind: kindOf(w, lookup),
    address: w,
    name: names[i],
    card: HAND_CARD_NAMES[h.cards[i]],
    target: h.targets[i] === NONE ? null : h.targets[i],
    hit: h.hit[i],
    out: OUTS[h.out[i]] ?? "stays",
  })) as HandView["seats"];
  const v: HandView = {
    hand: h.hand.toString(),
    room: h.room,
    minute: h.minute,
    at: h.at,
    seats,
    winner: h.winner >= 0 && h.winner <= 2 ? (h.winner as 0 | 1 | 2) : null,
    quiet: h.quiet,
    scattered: h.scattered,
    paid: h.paid.toString(),
    note: noteName(h.note),
    lines: [],
  };
  v.lines = narrate(v, { practice: opts.practice });
  if (opts.tx) v.tx = opts.tx;
  return v;
}

export interface RoomViewContext {
  now: number;
  ledger: number;
  you: string | null;
  lookup: (address: string) => { name: string; agent: boolean; claimed: boolean; owner?: string } | null;
  due: RoomView["due"];
  practice?: boolean;
}

export function roomToView(r: ERoom, ctx: RoomViewContext): RoomView {
  const info = ROOMS[r.id];
  const names = seatNames(r.seats.map((s) => s.who), ctx.lookup);
  const seats = r.seats.map((s, i): SeatView => ({
    index: i as 0 | 1 | 2,
    kind: kindOf(s.who, ctx.lookup),
    address: s.who,
    name: names[i],
    claimed: s.claimed,
    state: SEAT_STATES[s.state],
    card: s.state === 2 ? (["air", "iron", "table"] as const)[s.card] : null,
    target: s.state === 2 && s.target !== NONE ? s.target : null,
    bullet: s.bullet,
    leaving: s.leaving,
    missed: s.missed,
    you: ctx.you !== null && s.who === ctx.you,
    owner: s.who === null ? null : (ctx.lookup(s.who)?.owner ?? s.who),
  })) as RoomView["seats"];
  const queue = r.queue.map((a) => {
    const c = ctx.lookup(a);
    return { address: a, name: playerName(a, c?.name), claimed: !!c?.claimed, you: a === ctx.you };
  });
  const yourSeat = seats.find((s) => s.you);
  const queued = queue.some((q) => q.you);
  return {
    id: r.id,
    slug: info.slug,
    name: info.name,
    phase: PHASES[r.phase],
    hand: r.hand.toString(),
    minute: r.minute,
    opened: r.opened,
    deadline: r.deadline,
    revealBy: r.phase === 2 ? r.revealBy : 0,
    lockedAt: r.phase === 3 ? r.lockedAt : 0,
    seats,
    queue,
    quiet: r.quiet,
    recent: r.recent.map((h) => handToView(h, ctx.lookup, { practice: ctx.practice })),
    now: ctx.now,
    ledger: ctx.ledger,
    closesIn: r.phase === 0 ? 0 : r.deadline - ctx.now,
    due: ctx.due,
    you: yourSeat
      ? { seat: yourSeat.index, queued: false, state: yourSeat.state, bullet: yourSeat.bullet }
      : queued
        ? { seat: null, queued: true, state: null, bullet: 1 }
        : null,
  };
}

export function roomSummary(r: ERoom): RoomSummary {
  const info = ROOMS[r.id];
  return {
    id: r.id,
    slug: info.slug,
    name: info.name,
    phase: PHASES[r.phase],
    players: r.seats.filter((s) => s.who !== null).length,
    queued: r.queue.length,
    deadline: r.deadline,
    lastAt: r.recent[0]?.at ?? 0,
  };
}

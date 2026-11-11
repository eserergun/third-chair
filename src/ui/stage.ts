// Builds the ArtModel for one frame from a RoomView and the reveal timeline. Pure.

import type { ArtModel, ArtSeat, Coat } from "../art/model";
import { minuteSeats, revealSeats, type MinuteState, type RevealHand, type SeatBase } from "../art/reveal";
import type { HandView, RoomView } from "../shared/game-client";
import { ROOM_NAMES } from "../shared/game-client";
import type { Sfx } from "../audio/sfx";

const COATS: readonly Coat[] = ["rust", "felt", "soot"];

export function trimName(n: string): string {
  return n.length > 10 ? n.slice(0, 10) : n;
}

export function liveBase(view: RoomView): SeatBase[] {
  return view.seats.map((s, i) => ({ name: trimName(s.name), house: s.kind === "house", coat: COATS[i], bullet: s.bullet > 0, you: s.you }));
}

export function handBase(h: HandView, session: string | null): SeatBase[] {
  return h.seats.map((s, i) => ({ name: trimName(s.name), house: s.kind === "house", coat: COATS[i], bullet: true, you: !!session && s.address === session }));
}

export function revealHand(h: HandView): RevealHand {
  return {
    cards: h.seats.map((s) => s.card),
    targets: h.seats.map((s) => s.target),
    hit: h.seats.map((s) => s.hit),
    winner: h.winner,
    purseMoves: h.note === "paid",
  };
}

export function liveStates(view: RoomView): MinuteState[] {
  return view.seats.map((s): MinuteState => {
    if (s.state === "shown" && s.card) return s.card;
    if (s.state === "sealed") return "down";
    if (s.kind === "house" && (view.phase === "locked" || view.phase === "reveal")) return "down";
    return "thinking";
  });
}

export interface Reveal {
  hand: HandView;
  base: SeatBase[];
  start: number; // performance.now() when it began
  replay?: boolean; // a replay of an older hand, not the live result
}

export interface Frame {
  seats: [ArtSeat, ArtSeat, ArtSeat];
  purse: ArtModel["purse"];
  purseT: number;
  smoke: boolean;
  quiet: boolean;
  panel: ArtModel["panel"];
}

export function revealFrame(r: Reveal, ms: number, reduce: boolean): Frame {
  const f = revealSeats(r.base, revealHand(r.hand), ms, reduce);
  if (reduce) f.seats.forEach((s) => (s.firing = false));
  return f;
}

export function liveFrame(base: SeatBase[], states: MinuteState[]): Frame {
  return { seats: minuteSeats(base, states), purse: -1, purseT: 0, smoke: false, quiet: false, panel: 0 };
}

/** Rehearsal badges before its reveal: seats put cards down one by one. */
export function rehearsalStates(secsOpen: number): MinuteState[] {
  return [0, 1, 2].map((i) => (secsOpen >= 9 + i * 11 ? "down" : "thinking"));
}

/** Sounds for a reveal, with delays in seconds and stereo by seat. */
export function revealSounds(h: HandView): Array<{ s: Sfx; delay: number; pan: number }> {
  const pan = [-0.6, 0, 0.6];
  const out: Array<{ s: Sfx; delay: number; pan: number }> = [];
  h.seats.forEach((seat, i) => {
    if (seat.card === "iron") {
      out.push({ s: "draw", delay: 0, pan: pan[i] });
      out.push({ s: "shot", delay: 0.45, pan: pan[i] });
      if (seat.target !== null && h.seats[seat.target].card === "table") out.push({ s: "ricochet", delay: 0.55, pan: pan[seat.target] });
    }
    if (seat.card === "table" && !seat.hit) out.push({ s: "duck", delay: 0.7, pan: pan[i] });
    if (seat.hit) out.push({ s: "fall", delay: 0.75, pan: pan[i] });
  });
  if (h.note === "paid") out.push({ s: "coin", delay: 1.2, pan: 0 });
  if (h.scattered) out.push({ s: "scatter", delay: 1.4, pan: 0 });
  return out;
}

/** The paper plate on the comic: what the chain is doing now (SPEC 4.2), or what the stage shows. */
export function stageCaption(o: {
  practice: boolean;
  rehearsal: boolean;
  view: RoomView | null;
  reveal: Reveal | null;
  aimAt: string | null;
}): string | null {
  const { view, reveal } = o;
  if (reveal?.replay) return `REPLAY: ${ROOM_NAMES[reveal.hand.room] ?? view?.name ?? ""} MINUTE ${reveal.hand.minute}`;
  if (o.aimAt) return `IRON AT ${o.aimAt}`;
  if (reveal) return "SETTLED";
  if (o.rehearsal) return "House rehearsal";
  if (view?.you?.queued) return "YOU SIT NEXT MINUTE";
  if (view?.phase === "locked") return `SETTLING - LEDGER ${Math.max(view.lockedAt + 1, view.ledger)}`;
  if (view?.phase === "reveal") return "CARDS SEALED";
  if (view?.phase === "open" && view.seats.some((s) => s.state === "sealed")) return "CARDS SEALED";
  return o.practice ? "Practice table" : null;
}

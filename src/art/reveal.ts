// The reveal choreography in one place. The UI calls revealSeats every frame while a settled hand
// plays back, and minuteSeats while the minute is live. Pure functions of their inputs.
//
//   0 ..  450 ms  panel inset steps 1, 2, 3. Every Iron draws. Cards flip over the chairs.
// 450 ..  700 ms  muzzle flash for every shooter (firing), the bullet leaves the belt.
//        700 ms+  results: hit -> fallen, Table -> duck, Air and unhit Iron stand, unhit Ran -> gone.
//       1200 ms+  the purse slides to the winner when it moves.
//       3400 ms   REVEAL_MS, the UI then shows the next minute with fresh cowboys.

import type { ArtSeat, Badge, Coat } from "./model";

export const REVEAL_MS = 3400;
/** Results (beat two) start here. */
export const BEAT_MS = 700;
export const FLASH_FROM = 450;
export const FLASH_TO = 700;
export const PURSE_FROM = 1200;
/** Each seat's card turns face up at this time (staggered left to right). */
export const FLIP_MS: readonly [number, number, number] = [110, 200, 290];
/** Pose time handed out under reduced motion: every tween is long finished. */
export const SETTLED_T = 100000;

export type RevealCard = "air" | "iron" | "table" | "ran" | "slept";
export type MinuteState = "thinking" | "down" | "air" | "iron" | "table";

export interface RevealHand {
  cards: RevealCard[];
  targets: (number | null)[];
  hit: boolean[];
  winner: 0 | 1 | 2 | null;
  purseMoves: boolean;
}

export interface SeatBase {
  name: string;
  house: boolean;
  coat: Coat;
  bullet: boolean;
  you: boolean;
}

export interface RevealFrame {
  seats: [ArtSeat, ArtSeat, ArtSeat];
  purse: -1 | 0 | 1 | 2;
  purseT: number;
  smoke: boolean;
  panel: 0 | 1 | 2 | 3;
  quiet: boolean;
  flash: boolean;
}

const COATS: readonly Coat[] = ["rust", "felt", "soot"];
const HOUSE: readonly string[] = ["Cal", "Ivy", "Ned"];

function baseAt(base: SeatBase[], i: number): SeatBase {
  return base[i] ?? { name: HOUSE[i], house: true, coat: COATS[i], bullet: true, you: false };
}

function seatOf(b: SeatBase): ArtSeat {
  return {
    name: b.name,
    house: b.house,
    coat: b.coat,
    pose: "idle",
    t: 0,
    aimAt: null,
    firing: false,
    bullet: b.bullet,
    badge: null,
    you: b.you,
    winner: false,
  };
}

function seatIndex(v: number | null | undefined, self: number): 0 | 1 | 2 | null {
  if (v === 0 || v === 1 || v === 2) return v === self ? null : v;
  return null;
}

function faceUp(card: RevealCard, results: boolean): Badge {
  switch (card) {
    case "air":
      return "air";
    case "iron":
      return "iron";
    case "table":
      return "table";
    case "slept":
      return "slept";
    case "ran":
      return results ? "ran" : "down";
  }
}

/** Live minute: everyone idle, with what floats over the chair. */
export function minuteSeats(base: SeatBase[], states: MinuteState[]): [ArtSeat, ArtSeat, ArtSeat] {
  const out = [0, 1, 2].map((i) => {
    const s = seatOf(baseAt(base, i));
    s.badge = states[i] ?? "thinking";
    return s;
  });
  return [out[0], out[1], out[2]];
}

/** One frame of the reveal of a settled hand, `ms` after it started. */
export function revealSeats(base: SeatBase[], hand: RevealHand, ms: number, reduce: boolean): RevealFrame {
  const now = Math.max(0, ms);
  const results = reduce || now >= BEAT_MS;
  const cards: RevealCard[] = [0, 1, 2].map((i) => hand.cards[i] ?? "slept");
  const anyIron = cards.includes("iron");
  const flashing = !reduce && anyIron && now >= FLASH_FROM && now < FLASH_TO;
  const shot = reduce || now >= FLASH_FROM;

  const out = [0, 1, 2].map((i): ArtSeat => {
    const b = baseAt(base, i);
    const s = seatOf(b);
    const card = cards[i];
    const target = card === "iron" ? seatIndex(hand.targets[i], i) : null;
    const hit = hand.hit[i] === true;
    const flipAt = FLIP_MS[i];
    s.struck = hit;
    const flipped = reduce || now >= flipAt;
    // A slept seat shows the slept look (head down, Zz) once its card turns, never open hands.
    if (card === "slept" && flipped && !(hit && results)) s.asleep = true;
    const after = (from: number): number => (reduce ? SETTLED_T : Math.max(0, now - from));

    // The bullet leaves the belt with the shot.
    s.bullet = b.bullet && !(card === "iron" && shot);

    // What floats over the chair.
    if (card === "slept") s.badge = flipped ? "slept" : "thinking";
    else if (card === "ran") s.badge = results ? "ran" : "down";
    else s.badge = flipped ? faceUp(card, results) : "down";

    if (!results) {
      // Beat one.
      if (card === "iron") {
        s.pose = "aim";
        s.t = now;
        s.aimAt = target;
        s.firing = flashing;
      } else if ((card === "air" || card === "slept") && flipped) {
        s.pose = "air";
        s.t = after(flipAt);
      } else {
        s.pose = "idle";
        s.t = now;
      }
      return s;
    }

    // Beat two: the results.
    s.winner = hand.winner === i;
    if (hit) {
      s.pose = "fallen";
      s.t = after(BEAT_MS);
      s.aimAt = target; // a shooter who was hit drops the gun it was aiming
      return s;
    }
    switch (card) {
      case "iron":
        s.pose = "aim";
        s.t = reduce ? SETTLED_T : now;
        s.aimAt = target;
        break;
      case "air":
      case "slept":
        s.pose = "air";
        s.t = after(flipAt);
        break;
      case "table":
        s.pose = "duck";
        s.t = after(BEAT_MS);
        break;
      case "ran":
        s.pose = "gone";
        s.t = after(BEAT_MS);
        break;
    }
    return s;
  });

  const moving = hand.purseMoves && hand.winner !== null && (reduce || now >= PURSE_FROM);
  const panel: 0 | 1 | 2 | 3 = reduce ? 0 : now < 150 ? 1 : now < 300 ? 2 : now < 450 ? 3 : 0;

  return {
    seats: [out[0], out[1], out[2]],
    purse: moving && hand.winner !== null ? hand.winner : -1,
    purseT: moving ? (reduce ? SETTLED_T : now - PURSE_FROM) : 0,
    smoke: anyIron && shot,
    panel,
    quiet: !anyIron,
    flash: flashing,
  };
}

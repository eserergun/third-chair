// The contract between the UI and the canvas art. The UI builds an ArtModel every animation
// frame from the game state and the reveal timeline. src/art/scene.ts draws it. Nothing in
// src/art may import from src/chain or src/ui.

export const W = 384; // internal canvas width (square pixels)
export const H = 216; // internal canvas height

export const INK = {
  soot: "#140c08", // line, type, shadows
  paper: "#e7d7b1", // sky, page, faces
  rust: "#b8432f", // shots, the watch, wounds
  felt: "#2f4a3c", // table, money, the quiet seat
} as const;

export type Coat = "rust" | "felt" | "soot"; // seat 0, 1, 2

/**
 * idle   standing, waiting for the minute (small bob, hat and coat lag the body)
 * air    standing in the open, hands open (shown card was Air, or a standing card after reveal)
 * aim    revolver drawn and pointed at `aimAt` (Iron); `firing` adds the muzzle flash
 * duck   dropped behind the small table: hat brim visible, no head, no wound, no fall
 * fallen hit: on the floor, legs out, torso down, hat off the head, cross eyes, wound with a
 *        paper outline that reads on every coat, rust pool on the floor. Never bobs.
 * gone   the chair is empty (a runner who was not hit); the face-down card sits on the chair
 */
export type Pose = "idle" | "air" | "aim" | "duck" | "fallen" | "gone";

/** What floats above a seat. "down" is a face-down card. "thinking" is a small ellipsis bubble. */
export type Badge = "air" | "iron" | "table" | "down" | "thinking" | "ran" | "slept" | null;

export interface ArtSeat {
  name: string; // drawn under the chair, up to 10 characters
  house: boolean; // house chairs show a small "H" tag that never covers the wound
  coat: Coat;
  pose: Pose;
  /** ms since this pose started. Drives tweens: draw (aim), drop (duck), fall and hat flight (fallen). */
  t: number;
  aimAt: 0 | 1 | 2 | null; // target seat while aiming
  firing: boolean; // draw the muzzle flash this frame (UI turns it off under reduced motion)
  bullet: boolean; // one rust round on the belt when the chair still has its bullet
  badge: Badge;
  you: boolean; // a small rust marker over the player's own chair
  winner: boolean; // the winner glows: small paper sparkle, no text
  /** Optional: this seat is hit in the hand being revealed (revealSeats sets it). Shots at a seat
   * that is not struck pass over its hat into the wall. Left out, the art guesses from the pose. */
  struck?: boolean;
  /** Optional: the seat slept through the minute (its card is "slept"). Drawn head down with a
   * floating Zz instead of open hands. Left out, a "slept" badge on a standing seat means the same. */
  asleep?: boolean;
}

export interface ArtModel {
  frame: number; // animation frame counter, advances about every 80 ms (frozen under reduced motion)
  time: number; // ms timestamp, for continuous effects
  reduce: boolean; // prefers-reduced-motion: no tweens, no flash, final poses at once
  seats: [ArtSeat, ArtSeat, ArtSeat];
  /** Purse satchel: -1 at the center table, else slides to that seat. */
  purse: -1 | 0 | 1 | 2;
  purseT: number; // ms since the purse started moving (ignored at -1)
  smoke: boolean; // gun smoke drifting after a shot
  quiet: boolean; // dust motes for a quiet minute
  panel: 0 | 1 | 2 | 3; // comic panel border inset during the reveal
  second: number; // pocket watch hand, 0..59
  urgent: boolean; // last ten seconds: the watch face turns rust and ticks
  caption: string | null; // optional paper caption box text, e.g. "PRACTICE TABLE"
}

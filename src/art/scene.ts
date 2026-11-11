// drawScene: the whole 384 x 216 saloon frame from an ArtModel. The frame is composed in an
// indexed framebuffer (four inks only) and presented as integer fillRect runs with image
// smoothing off. renderScene is the same composition without a canvas (tests use it).

import type { ArtModel, ArtSeat } from "./model";
import { H, W } from "./model";
import { drawBehind, drawDuckHands, drawFront, drawGoneDust, drawHatFlight, fallDir, muzzleOf, shotEnd, shotPoint } from "./figure";
import { border, hitSpark, motes, muzzleFlash, smoke, tracer, wallHole } from "./fx";
import { badge, caption, sparkle, tagline, youMarker } from "./hud";
import { BADGE_Y, purseHome, purseSpot } from "./layout";
import { PAPER, Pix, SOOT, present } from "./pix";
import { FLASH_FROM } from "./reveal";
import { background, chair, lamps, plate, purse, table, watch } from "./room";

/** How long the purse takes to slide to the winner's table. */
export const PURSE_SLIDE_MS = 650;

let frameBuf: Pix | null = null;

function lerp(a: number, b: number, p: number): number {
  return a + (b - a) * p;
}

interface PursePos {
  x: number;
  y: number;
  moving: boolean;
}

/** A purse on the table of a ducked seat sits 3 px further right, clear of the hat brim. */
function spot(m: ArtModel, i: 0 | 1 | 2): { x: number; y: number } {
  const p = purseSpot(i);
  return m.seats[i].pose === "duck" ? { x: p.x + 3, y: p.y } : p;
}

export function pursePos(m: ArtModel): PursePos {
  const home = purseHome();
  if (m.purse === -1) return { x: home.x, y: home.y, moving: false };
  const dest = spot(m, m.purse);
  const p = m.reduce ? 1 : Math.min(1, Math.max(0, m.purseT) / PURSE_SLIDE_MS);
  if (p >= 1) return { x: dest.x, y: dest.y, moving: false };
  const e = 1 - (1 - p) * (1 - p);
  const hop = 16;
  return {
    x: Math.round(lerp(home.x, dest.x, e)),
    y: Math.round(lerp(home.y, dest.y, e) - hop * 4 * p * (1 - p)),
    moving: true,
  };
}

/** Whether a shot at this seat lands. Without the `struck` flag: a body on the floor, or anyone not ducking. */
function struckOf(s: ArtSeat): boolean {
  return s.struck ?? (s.pose === "fallen" || (s.pose !== "duck" && s.badge !== "table"));
}

/** ms since the first shot, while any revolver is firing (null otherwise or under reduced motion). */
export function shotAge(m: ArtModel): number | null {
  if (m.reduce) return null;
  let age: number | null = null;
  for (const s of m.seats) {
    if (!s.firing || s.pose !== "aim") continue;
    const a = Math.max(0, s.t - FLASH_FROM);
    age = age === null ? a : Math.max(age, a);
  }
  return age;
}

function hash(n: number): number {
  let x = (n | 0) * 2654435761;
  x = (x ^ (x >>> 16)) * 2246822519;
  return ((x ^ (x >>> 13)) >>> 0) / 4294967296;
}

const SHIFT = new Uint8Array(W * H);

/** Move the whole picture by (dx, dy); the uncovered edge is soot (the frame covers it). */
function shake(pix: Pix, dx: number, dy: number): void {
  if (dx === 0 && dy === 0) return;
  SHIFT.set(pix.px);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const sx = x - dx;
      const sy = y - dy;
      pix.px[y * W + x] = sx < 0 || sy < 0 || sx >= W || sy >= H ? SOOT : SHIFT[sy * W + sx];
    }
}

/**
 * Impact frame: paper and soot swap places for a frame or two, only inside a jagged burst around
 * each firing muzzle (the rest of the room stays as it is).
 */
function impact(pix: Pix, at: { x: number; y: number }[]): void {
  const px = pix.px;
  const R = 19;
  for (const c of at) {
    for (let y = Math.max(0, c.y - R - 4); y < Math.min(H, c.y + R + 5); y++)
      for (let x = Math.max(0, c.x - R - 4); x < Math.min(W, c.x + R + 5); x++) {
        const dx = x - c.x;
        const dy = y - c.y;
        const spikes = Math.cos(Math.atan2(dy, dx) * 7) > 0.55 ? 6 : 0;
        if (dx * dx + dy * dy > (R - 7 + spikes) * (R - 7 + spikes)) continue;
        const k = y * W + x;
        if (px[k] === PAPER) px[k] = SOOT;
        else if (px[k] === SOOT) px[k] = PAPER;
      }
  }
}

/** Highest row of a shot at the far seat: over the middle figure's hat, under the badge cards. */
export const FAR_SHOT_PEAK = BADGE_Y + 17;

/** Compose the frame into a framebuffer. */
export function renderScene(pix: Pix, m: ArtModel): void {
  const seats = m.seats;
  pix.copyFrom(background());
  lamps(pix, m);
  watch(pix, m);
  if (m.quiet) motes(pix, m);

  const dirs = seats.map((_, i) => fallDir(i, seats));

  seats.forEach((s, i) => chair(pix, i, s.pose === "gone"));

  // Shots: a hole in the wall where a shot went over a ducked hat, and while the revolvers fire,
  // a tracer from each muzzle to its target. Drawn behind the cowboys, so a shot at the far seat
  // passes behind the middle chair.
  seats.forEach((s, i) => {
    if (s.aimAt === null || (s.pose !== "aim" && s.pose !== "fallen")) return;
    const hits = struckOf(seats[s.aimAt]);
    const end = shotEnd(i, s.aimAt, hits);
    if (m.smoke && !hits) wallHole(pix, end.x, end.y);
    if (!s.firing || m.reduce) return;
    const mz = muzzleOf(i, s, m);
    // A shot at the far seat arcs over the middle figure's head, so it never crosses its hands.
    const far = Math.abs(s.aimAt - i) === 2;
    if (mz) tracer(pix, mz.x + mz.dir, mz.y, end.x, end.y, far ? FAR_SHOT_PEAK : undefined);
  });

  seats.forEach((s, i) => drawBehind(pix, i, s, m, dirs[i]));
  seats.forEach((s, i) => drawGoneDust(pix, i, s, m));
  seats.forEach((_, i) => table(pix, i));
  seats.forEach((s, i) => drawDuckHands(pix, i, s, m));

  const pp = pursePos(m);
  // On a table the purse sits behind the bodies on the floor; at home it lies in front of them.
  const atHome = m.purse === -1;
  if (!pp.moving && !atHome) purse(pix, pp.x, pp.y);

  seats.forEach((s, i) => drawFront(pix, i, s, m, dirs[i]));
  if (!pp.moving && atHome) purse(pix, pp.x, pp.y);
  seats.forEach((s, i) => plate(pix, i, s.name));

  // Smoke: from every drawn revolver, and where a shooter stood before falling.
  if (m.smoke) {
    seats.forEach((s, i) => {
      const mz = muzzleOf(i, s, m);
      if (mz) smoke(pix, mz.x, mz.y, mz.dir, m, i);
      else if (s.pose === "fallen" && s.aimAt !== null) {
        // the smoke of the shot hangs where the revolver fired
        const at = shotPoint(i, s);
        smoke(pix, at.x, at.y, at.dir, m, i);
      }
    });
  }
  seats.forEach((s, i) => {
    if (!s.firing || m.reduce) return;
    const mz = muzzleOf(i, s, m);
    if (mz) muzzleFlash(pix, mz.x, mz.y, mz.dir, Math.max(0, s.t - FLASH_FROM));
    // the spark where the bullet strikes
    if (s.aimAt !== null && struckOf(seats[s.aimAt])) {
      const end = shotEnd(i, s.aimAt, true);
      hitSpark(pix, end.x, end.y, Math.max(0, s.t - FLASH_FROM));
    }
  });

  seats.forEach((s, i) => drawHatFlight(pix, i, s, m, dirs[i]));
  if (pp.moving) purse(pix, pp.x, pp.y);

  seats.forEach((s, i) => {
    badge(pix, i, s, m);
    if (s.you) youMarker(pix, i, m);
    if (s.winner) sparkle(pix, i, m, s);
  });
  if (m.caption) caption(pix, m.caption);

  // The shot lands: an impact frame, then a 2 px screen shake that settles (none under reduced motion).
  const age = shotAge(m);
  if (age !== null) {
    if (age < 90) {
      const at: { x: number; y: number }[] = [];
      seats.forEach((s, i) => {
        const mz = s.firing ? muzzleOf(i, s, m) : null;
        if (mz) at.push({ x: mz.x + mz.dir * 4, y: mz.y });
      });
      impact(pix, at);
    }
    const amp = age < 140 ? 2 : 1;
    const k = Math.floor(m.time / 40);
    shake(pix, Math.round((hash(k) * 2 - 1) * amp), Math.round((hash(k + 7919) * 2 - 1) * amp));
  }
  border(pix, m.reduce ? 0 : m.panel);
  tagline(pix);
}

/** Draw the whole frame on a 384 x 216 canvas context. */
export function drawScene(ctx: CanvasRenderingContext2D, m: ArtModel): void {
  if (!frameBuf) frameBuf = new Pix(W, H);
  renderScene(frameBuf, m);
  present(ctx, frameBuf);
}

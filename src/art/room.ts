// The saloon: back wall of planks, wainscot, the window on the county, the bottle shelf, the
// floor boards, hanging lamps, the pocket watch, chairs, small tables, name plates, the purse.

import type { ArtModel } from "./model";
import { H, W } from "./model";
import { textPix, measure } from "./font";
import { CHAIR_SEAT_Y, FLOOR_Y, FRAME, PLATE_Y, SEAT_X, TABLE_TOP_Y, WAINSCOT_Y } from "./layout";
import { FELT, PAPER, Pix, RUST, SOOT, sprite, stamp, type Ink } from "./pix";

// ---------------------------------------------------------------------------------------------
// Static background, built once.

const WINDOW = { x: 228, y: 44, w: 70, h: 50 } as const;
const SHELF = { x: 90, y: 86, w: 74 } as const;

let cached: Pix | null = null;

export function background(): Pix {
  if (cached) return cached;
  const p = new Pix(W, H);
  p.clear(PAPER);
  wall(p);
  windowView(p);
  shelf(p);
  poster(p);
  calendar(p);
  wainscot(p);
  floor(p);
  cached = p;
  return p;
}

/** Tiny deterministic hash for scattering texture. */
function hash(n: number): number {
  let x = (n | 0) * 374761393 + 668265263;
  x = (x ^ (x >>> 13)) * 1274126177;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

function wall(p: Pix): void {
  // Vertical planks with soot seams, a nail pair near the top of each, sparse grain ticks.
  const top = FRAME;
  const bottom = WAINSCOT_Y - 1;
  let x = FRAME + 9;
  let k = 0;
  while (x < W - FRAME) {
    // seam with a small break so it reads hand-inked
    const gap = top + 22 + Math.floor(hash(k * 7 + 1) * 60);
    p.vline(x, top, gap - 1, SOOT);
    p.vline(x, gap + 3, bottom, SOOT);
    // nails
    p.set(x - 3, top + 4, SOOT);
    p.set(x + 3, top + 4, SOOT);
    p.set(x - 3, bottom - 4, SOOT);
    p.set(x + 3, bottom - 4, SOOT);
    // one grain tick per plank
    const gx = x + 5 + Math.floor(hash(k * 13) * 14);
    const gy = top + 12 + Math.floor(hash(k * 17) * 88);
    if (gx < W - FRAME - 1) p.hline(gx, gx + 1 + Math.floor(hash(k) * 3), gy, SOOT);
    // an occasional knot
    if (hash(k * 31) > 0.55) {
      const kx = x + 8 + Math.floor(hash(k * 37) * 8);
      const ky = top + 30 + Math.floor(hash(k * 41) * 60);
      p.set(kx, ky, SOOT);
      p.set(kx + 1, ky, SOOT);
      p.set(kx - 1, ky + 1, SOOT);
      p.set(kx + 2, ky + 1, SOOT);
      p.set(kx, ky + 2, SOOT);
      p.set(kx + 1, ky + 2, SOOT);
    }
    x += 22 + Math.floor(hash(k * 3 + 2) * 4);
    k++;
  }
}

function windowView(p: Pix): void {
  const { x, y, w, h } = WINDOW;
  // clear the planks behind the window and the frame
  p.rect(x - 3, y - 3, w + 6, h + 8, PAPER);
  const horizon = y + 27;
  // a few soot cloud dashes in the paper sky
  p.hline(x + 6, x + 13, y + 6, SOOT);
  p.hline(x + 9, x + 17, y + 8, SOOT);
  p.hline(x + 44, x + 49, y + 5, SOOT);
  // the rust mesa on the right: flat top, cliff face with strata, talus to the horizon
  const mx = x + 38;
  const my = y + 12;
  p.rect(mx + 3, my, 22, 1, RUST);
  p.rect(mx + 1, my + 1, 26, 7, RUST);
  for (let r = 0; r <= horizon - my - 8; r++) p.rect(mx - r * 2, my + 8 + r, 28 + r * 3, 1, RUST);
  p.hline(mx + 2, mx + 25, my + 3, SOOT);
  p.hline(mx + 4, mx + 23, my + 6, SOOT);
  for (let i = 0; i < 6; i++) p.vline(mx + 4 + i * 4, my + 4, my + 5, SOOT);
  // distant ridge along the horizon
  for (let i = 0; i < w; i++) if (i % 2 === 0 && (i < 30 || i > 66)) p.set(x + i, horizon - 1 - Math.round(Math.abs(Math.sin(i / 5)) * 2), SOOT);
  p.hline(x, x + w - 1, horizon, SOOT);
  // the plain: paper with sparse soot hatching, getting denser toward us
  for (let r = horizon + 2; r < y + h; r += 3) {
    const step = Math.max(4, 14 - (r - horizon));
    for (let i = (r * 7) % step; i < w; i += step) p.hline(x + i, x + Math.min(w - 1, i + 1), r, SOOT);
  }
  // the river, a thin felt ribbon winding out of the hills toward us
  for (let r = horizon + 2; r < y + h; r++) {
    const k = (r - horizon) / (y + h - horizon);
    const cx = Math.round(x + 37 + k * 16 + Math.sin(k * 6) * 5);
    const half = k < 0.35 ? 0 : 1;
    p.rect(cx - half, r, half * 2 + 1 + (k > 0.75 ? 1 : 0), 1, FELT);
  }
  // felt hill on the left (the forest of the county), with small pines on the ridge
  const ridge = (i: number): number => Math.round(y + 21 + Math.pow((i - 6) / 14, 2) * 10);
  for (let i = 0; i < 36; i++) p.vline(x + i, Math.min(ridge(i), y + h - 1), y + h - 1, FELT);
  for (let i = 1; i < 30; i += 4) {
    const ty = ridge(i);
    p.set(x + i, ty - 3, FELT);
    p.rect(x + i - 1, ty - 2, 3, 2, FELT);
  }
  for (let i = 3; i < 34; i += 5) p.vline(x + i, ridge(i) + 3, ridge(i) + 4, SOOT);
  // frame and cross bars
  p.frame(x - 3, y - 3, w + 6, h + 6, SOOT);
  p.frame(x - 2, y - 2, w + 4, h + 4, SOOT);
  p.frame(x - 1, y - 1, w + 2, h + 2, SOOT);
  p.rect(x + Math.floor(w / 2) - 1, y, 2, h, SOOT);
  p.rect(x, y + Math.floor(h / 2) - 1, w, 2, SOOT);
  // sill
  p.rect(x - 6, y + h + 3, w + 12, 3, SOOT);
  p.hline(x - 5, x + w + 4, y + h + 3, PAPER);
  p.rect(x - 4, y + h + 6, 3, 2, SOOT);
  p.rect(x + w + 1, y + h + 6, 3, 2, SOOT);
}

const FACE = sprite([
  "...kkkkk...",
  "..kkkkkkk..",
  "kkkkkkkkkkk",
  "...kpppk...",
  "...pkpkp...",
  "...ppppp...",
  "...pkkkp...",
  "....ppp....",
  "..kkkkkkk..",
]);

/** A WANTED bill, nailed to the planks at the far left. */
function poster(p: Pix): void {
  const x = 15;
  const y = 40;
  const w = 31;
  const h = 37;
  p.rect(x + 1, y + 1, w, h, SOOT);
  p.rect(x, y, w, h, SOOT);
  p.rect(x + 1, y + 1, w - 2, h - 2, PAPER);
  // a torn corner
  p.set(x + w - 2, y + h - 2, SOOT);
  p.set(x + w - 3, y + h - 2, SOOT);
  p.set(x + w - 2, y + h - 3, SOOT);
  textPix(p, "WANTED", x + 3, y + 3, SOOT);
  p.hline(x + 3, x + w - 4, y + 9, RUST);
  p.blit(FACE, x + 10, y + 12, { k: SOOT, p: PAPER });
  p.frame(x + 8, y + 11, 15, 12, SOOT);
  textPix(p, "1 XLM", x + 5, y + 26, RUST);
  p.hline(x + 5, x + w - 6, y + 32, SOOT);
  // nail
  p.rect(x + Math.floor(w / 2) - 1, y - 1, 2, 2, RUST);
}

/** A wall calendar for the year, at the far right. */
function calendar(p: Pix): void {
  const x = 344;
  const y = 44;
  const w = 21;
  const h = 24;
  p.rect(x + 1, y + 1, w, h, SOOT);
  p.rect(x, y, w, h, SOOT);
  p.rect(x + 1, y + 1, w - 2, h - 2, PAPER);
  p.rect(x + 1, y + 1, w - 2, 6, RUST);
  textPix(p, "1890", x + 3, y + 2, PAPER);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) p.rect(x + 3 + c * 3, y + 9 + r * 3, 2, 1, SOOT);
  p.rect(x + 3 + 2 * 3, y + 9 + 2 * 3 - 1, 2, 3, RUST);
  p.rect(x + Math.floor(w / 2) - 1, y - 2, 2, 2, SOOT);
}

const BOTTLES = [
  sprite(["..kk..", "..rr..", "..kk..", "..kk..", ".kkkk.", "kkkkkk", "kkkkkk", "kppppk", "kprrpk", "kppppk", "kkkkkk", "kkkkkk", "kkkkkk"]),
  sprite(["..ff..", "..ff..", ".ffff.", "ffffff", "ffffff", "fpffff", "fpffff", "ffffff", "ffffff", ".ffff."]),
  sprite([".kk.", ".kk.", ".kk.", ".kk.", "kkkk", "kkkk", "kppk", "kppk", "kkkk", "kkkk", "kkkk", "kkkk", "kkkk", "kkkk"]),
  sprite(["...kk...", "..kkkk..", ".kkkkkk.", "kkkkkkkk", "kkppppkk", "kkprrpkk", "kkppppkk", "kkkkkkkk", ".kkkkkk."]),
  sprite(["..k..", "..k..", ".kkk.", ".kkk.", "kkkkk", "kpppk", "kpppk", "kkkkk", "kkkkk", "kkkkk", "kkkkk"]),
];
const GLASS = sprite(["k...k", "kpppk", "kpppk", ".kkk."]);

function shelf(p: Pix): void {
  const { x, y, w } = SHELF;
  const pal = { k: SOOT, p: PAPER, r: RUST, f: FELT } as const;
  // bottles standing on the plank (bottom row at y - 1)
  const row: [number, number][] = [
    [0, 4],
    [1, 13],
    [2, 22],
    [4, 30],
    [3, 38],
    [0, 49],
    [2, 58],
    [1, 65],
  ];
  for (const [b, bx] of row) {
    const s = BOTTLES[b];
    p.blit(s, x + bx, y - s.h, pal);
  }
  p.blit(GLASS, x + 44, y - 4, pal);
  p.blit(GLASS, x + 71 - 6, y - 4, pal);
  // plank with a paper top edge, brackets
  p.rect(x, y, w, 3, SOOT);
  p.hline(x + 1, x + w - 2, y, PAPER);
  for (const bx of [x + 6, x + w - 9]) {
    for (let r = 0; r < 5; r++) p.rect(bx, y + 3 + r, 4 - Math.floor(r * 0.6), 1, SOOT);
  }
}

function wainscot(p: Pix): void {
  const y = WAINSCOT_Y;
  // chair rail
  p.rect(FRAME, y, W - 2 * FRAME, 3, SOOT);
  p.hline(FRAME, W - FRAME - 1, y + 1, PAPER);
  // panels
  const top = y + 5;
  const bottom = FLOOR_Y - 7;
  let x = FRAME + 4;
  while (x + 24 < W - FRAME) {
    p.frame(x, top, 26, bottom - top, SOOT);
    // bevel shadow on the right and bottom
    p.vline(x + 24, top + 2, bottom - 3, SOOT);
    p.hline(x + 2, x + 24, bottom - 3, SOOT);
    x += 30;
  }
  // baseboard
  p.rect(FRAME, FLOOR_Y - 5, W - 2 * FRAME, 5, SOOT);
  p.hline(FRAME, W - FRAME - 1, FLOOR_Y - 4, PAPER);
}

/** Rows of the soot seams between floor boards: they widen toward us. */
export const FLOOR_SEAMS: readonly number[] = [FLOOR_Y + 5, FLOOR_Y + 11, FLOOR_Y + 18, FLOOR_Y + 26, FLOOR_Y + 35, FLOOR_Y + 45];
/** Top row of the rust runner rug along the front of the floor, under the name plates. */
export const RUG_Y = PLATE_Y + 2;

/** 50% soot dither on paper, only over paper pixels (it never breaks a line). */
function dither(p: Pix, x0: number, y0: number, x1: number, y1: number, keep: (x: number, y: number) => boolean): void {
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) if ((x + y) % 2 === 0 && keep(x, y) && p.get(x, y) === PAPER) p.set(x, y, SOOT);
}

function floor(p: Pix): void {
  // Paper boards running along the wall, soot seams between them, butt joints and nail pairs.
  const x0 = FRAME;
  const x1 = W - FRAME - 1;
  p.rect(x0, FLOOR_Y, x1 - x0 + 1, H - FRAME - FLOOR_Y, PAPER);
  // contact shadow under the baseboard: a 50% then a sparse dither
  dither(p, x0, FLOOR_Y, x1, FLOOR_Y + 1, (x, y) => y === FLOOR_Y || (x % 4 === 1));
  let prev = FLOOR_Y + 1;
  FLOOR_SEAMS.forEach((ry, k) => {
    if (ry >= RUG_Y - 1) return;
    p.hline(x0, x1, ry, SOOT);
    // butt joints between this seam and the one above, staggered per board
    const span = 40 + k * 14;
    let x = x0 + 6 + Math.floor(hash(k * 11 + 3) * span);
    while (x < x1 - 4) {
      p.vline(x, prev + 1, ry - 1, SOOT);
      // nail pairs on either side of the joint
      const ny = prev + 1 + Math.floor((ry - prev - 1) / 2);
      if (ry - prev > 6) {
        p.set(x - 2, ny, SOOT);
        p.set(x + 2, ny, SOOT);
      }
      x += span + Math.floor(hash(k * 97 + x) * span);
    }
    // a few grain ticks on the board above the seam
    for (let g = 0; g < 9; g++) {
      const gx = x0 + 8 + Math.floor(hash(k * 131 + g * 17) * (x1 - x0 - 16));
      const gy = prev + 2 + Math.floor(hash(k * 7 + g * 29) * Math.max(1, ry - prev - 3));
      if (gy < ry - 1 && p.get(gx - 1, gy) === PAPER && p.get(gx + 3, gy) === PAPER) p.hline(gx, gx + 1 + (g % 3), gy, SOOT);
    }
    prev = ry;
  });
  // soft shadows under every table and chair
  for (const cx of SEAT_X) {
    // chair: under the seat, between and around the legs
    dither(p, cx - 15, FLOOR_Y + 3, cx + 15, FLOOR_Y + 8, (x, y) => {
      const dx = (x - cx) / 16;
      const dy = (y - (FLOOR_Y + 6)) / 3.2;
      return dx * dx + dy * dy <= 1;
    });
    // table: an oval around the foot
    const ty = TABLE_TOP_Y + 26;
    dither(p, cx - 15, ty - 3, cx + 15, ty + 2, (x, y) => {
      const dx = (x - cx) / 15;
      const dy = (y - ty) / 2.8;
      return dx * dx + dy * dy <= 1;
    });
  }
  rug(p);
}

/** A rust runner along the front of the floor with a soot step pattern and a paper fringe. */
function rug(p: Pix): void {
  const x0 = FRAME + 14;
  const x1 = W - FRAME - 15;
  const y0 = RUG_Y;
  const y1 = H - FRAME - 1;
  p.rect(x0, y0, x1 - x0 + 1, y1 - y0 + 1, RUST);
  // soot border, then a paper inner line
  p.hline(x0, x1, y0, SOOT);
  p.vline(x0, y0, y1, SOOT);
  p.vline(x1, y0, y1, SOOT);
  p.hline(x0 + 2, x1 - 2, y0 + 2, PAPER);
  p.vline(x0 + 2, y0 + 2, y1, PAPER);
  p.vline(x1 - 2, y0 + 2, y1, PAPER);
  // a soot zigzag down the middle of the runner
  const my = y0 + 6;
  for (let x = x0 + 5; x <= x1 - 5; x++) {
    const ph = ((x - x0) % 8);
    const dy = ph < 4 ? ph : 8 - ph;
    p.set(x, my - 2 + dy, SOOT);
  }
  // paper fringe on the ends
  for (let y = y0 + 1; y <= y1; y += 2) {
    p.hline(x0 - 3, x0 - 1, y, SOOT);
    p.hline(x1 + 1, x1 + 3, y, SOOT);
  }
}

// ---------------------------------------------------------------------------------------------
// Lamps and the watch (animated).

export function lamps(p: Pix, m: ArtModel): void {
  lamp(p, 136, m, 0);
  lamp(p, 264, m, 7);
}

function lamp(p: Pix, x: number, m: ArtModel, phase: number): void {
  const flicker = !m.reduce && (m.frame + phase) % 18 < 2;
  const y = FRAME;
  // cord and ceiling hook
  p.rect(x - 2, y, 5, 1, SOOT);
  p.vline(x, y, y + 15, SOOT);
  // glow: short rust rays around the chimney when lit
  if (!flicker) {
    const gy = y + 24;
    for (const [dx, dy] of [
      [-1, 0],
      [1, 0],
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
      [0, 1],
    ] as const) {
      const r0 = dy === 0 ? 7 : 6;
      for (let k = r0; k < r0 + 3; k++) p.set(x + dx * k, gy + dy * Math.round(k * 0.8), RUST);
    }
  }
  // smoke bell
  p.rect(x - 3, y + 16, 7, 2, SOOT);
  p.rect(x - 4, y + 18, 9, 1, SOOT);
  // glass chimney
  p.rect(x - 3, y + 19, 7, 9, SOOT);
  p.rect(x - 2, y + 20, 5, 7, PAPER);
  // flame
  if (flicker) {
    p.rect(x, y + 24, 1, 2, RUST);
  } else {
    p.rect(x - 1, y + 23, 3, 3, RUST);
    p.rect(x, y + 21, 1, 2, RUST);
  }
  // fount
  p.rect(x - 5, y + 28, 11, 2, SOOT);
  p.rect(x - 4, y + 30, 9, 3, SOOT);
  p.hline(x - 3, x + 3, y + 29, PAPER);
  p.rect(x - 1, y + 33, 3, 2, SOOT);
}

const WATCH = { x: 192, y: 27, r: 13 } as const;

export function watch(p: Pix, m: ArtModel): void {
  const { x, y, r } = WATCH;
  // chain draped from the bow to a nail at the left
  const nail = { x: 156, y: FRAME + 2 };
  p.rect(nail.x - 1, nail.y - 1, 3, 3, SOOT);
  for (let i = 0; i <= 34; i++) {
    const t = i / 34;
    const cx = Math.round(nail.x + (x - 3 - nail.x) * t);
    const cy = Math.round(nail.y + (y - r - 4 - nail.y) * t + Math.sin(t * Math.PI) * 9);
    if (i % 2 === 0) p.set(cx, cy, SOOT);
    else p.rect(cx, cy, 1, 1, SOOT);
  }
  // bow and crown
  p.frame(x - 3, y - r - 7, 6, 5, SOOT);
  p.rect(x - 2, y - r - 2, 5, 3, SOOT);
  p.rect(x - 1, y - r - 3, 3, 1, SOOT);
  // case
  p.disc(x, y, r, SOOT);
  const blink = m.urgent && !m.reduce && Math.floor(m.time / 250) % 2 === 1;
  const face: Ink = m.urgent && !blink ? RUST : PAPER;
  p.disc(x, y, r - 2, face);
  p.disc(x, y, r - 3, face);
  // ring line inside the case
  // hour ticks
  for (let h = 0; h < 12; h++) {
    const a = (h / 12) * Math.PI * 2;
    const tx = x + Math.round(Math.sin(a) * (r - 4));
    const ty = y - Math.round(Math.cos(a) * (r - 4));
    p.set(tx, ty, SOOT);
    if (h % 3 === 0) p.set(x + Math.round(Math.sin(a) * (r - 5)), y - Math.round(Math.cos(a) * (r - 5)), SOOT);
  }
  // second hand
  const s = ((Math.floor(m.second) % 60) + 60) % 60;
  const a = (s / 60) * Math.PI * 2;
  const hand: Ink = face === RUST ? PAPER : RUST;
  p.line(x, y, x + Math.round(Math.sin(a) * (r - 4)), y - Math.round(Math.cos(a) * (r - 4)), hand);
  p.line(x, y, x - Math.round(Math.sin(a) * 2), y + Math.round(Math.cos(a) * 2), hand);
  p.rect(x - 1, y - 1, 3, 3, SOOT);
  p.set(x, y, face === RUST ? PAPER : RUST);
}

// ---------------------------------------------------------------------------------------------
// Chairs, tables, plates, purse.

const CH = new Pix(40, 52);

/** A soot wooden chair, front view. `card` puts a face-down card on it. */
export function chair(p: Pix, i: number, card: boolean): void {
  const cx = SEAT_X[i];
  const L = CH;
  L.clear();
  L.place(cx - 20, 116);
  const top = 125;
  // back posts with knob finials
  L.rect(cx - 12, top - 2, 3, 2, SOOT);
  L.rect(cx + 10, top - 2, 3, 2, SOOT);
  L.rect(cx - 11, top, 2, 152 - top, SOOT);
  L.rect(cx + 10, top, 2, 152 - top, SOOT);
  // curved top rail with a paper highlight
  L.rect(cx - 10, top + 1, 20, 4, SOOT);
  L.rect(cx - 7, top, 14, 1, SOOT);
  L.hline(cx - 8, cx + 7, top + 2, PAPER);
  // spindles
  for (const sx of [-6, -2, 1, 5]) L.rect(cx + sx, top + 5, 1, CHAIR_SEAT_Y - top - 5, SOOT);
  // seat with a paper front edge
  L.rect(cx - 13, CHAIR_SEAT_Y, 27, 3, SOOT);
  L.hline(cx - 12, cx + 12, CHAIR_SEAT_Y + 1, PAPER);
  // front legs come further down (closer to us)
  L.rect(cx - 13, CHAIR_SEAT_Y + 3, 2, 155 - CHAIR_SEAT_Y - 3, SOOT);
  L.rect(cx + 12, CHAIR_SEAT_Y + 3, 2, 155 - CHAIR_SEAT_Y - 3, SOOT);
  if (card) {
    // face-down card leaning on the back rail, standing on the seat
    const w = 11;
    const h = 14;
    const x = cx - 5;
    const y = CHAIR_SEAT_Y - h + 1;
    L.rect(x, y, w, h, SOOT);
    L.rect(x + 1, y + 1, w - 2, h - 2, RUST);
    for (let yy = 0; yy < h - 2; yy++)
      for (let xx = 0; xx < w - 2; xx++) if ((xx + yy) % 4 === 1 || (xx - yy + 44) % 4 === 1) L.set(x + 1 + xx, y + 1 + yy, PAPER);
  }
  stamp(p, L, "auto", FLOOR_Y);
}

const TB = new Pix(44, 32);

/** Small round table: felt top with a soot edge, soot pedestal and foot. */
export function table(p: Pix, i: number): void {
  const cx = SEAT_X[i];
  const L = TB;
  L.clear();
  L.place(cx - 22, TABLE_TOP_Y - 2);
  const y = TABLE_TOP_Y;
  // edge (thickness) then top
  L.oval(cx - 16, y + 1, 32, 8, SOOT);
  L.oval(cx - 16, y, 32, 6, FELT);
  // highlight on the far rim, a couple of glints
  L.hline(cx - 7, cx + 4, y + 1, PAPER);
  L.set(cx + 8, y + 2, PAPER);
  // pedestal
  L.rect(cx - 2, y + 9, 4, 14, SOOT);
  L.rect(cx - 3, y + 9, 6, 2, SOOT);
  // foot
  L.rect(cx - 4, y + 22, 8, 1, SOOT);
  L.rect(cx - 6, y + 23, 12, 1, SOOT);
  L.rect(cx - 8, y + 24, 16, 2, SOOT);
  stamp(p, L);
}

const PURSE = sprite([
  "...f..f...",
  "...ffff...",
  "..rrrrrr..",
  "...frrf...",
  "..ffrrff..",
  ".ffffffff.",
  "ffffffffff",
  "ffffpfffff",
  "fffffffff.",
  ".ffffffff.",
]);
const PU = new Pix(16, 16);

/** The purse: a felt satchel tied with rust. (x, y) is its left edge and bottom row. */
export function purse(p: Pix, x: number, y: number): void {
  const L = PU;
  L.clear();
  L.place(x - 3, y - PURSE.h - 3);
  L.blit(PURSE, x, y - PURSE.h + 1, { f: FELT, r: RUST, p: PAPER, k: SOOT });
  // a full contrast ring: soot on the paper boards and the wall, a paper rim on the felt table
  stamp(p, L, "contrast");
}

/** Name plate under a chair: a soot plate with paper letters and two paper nail heads. */
export function plate(p: Pix, i: number, name: string): void {
  const label = name.slice(0, 10).toUpperCase();
  const w = measure(label) + 10;
  const x = SEAT_X[i] - Math.floor(w / 2);
  const y = PLATE_Y;
  p.rect(x, y, w, 9, SOOT);
  // a drop shadow on the boards (the rug is rust, the shadow soot)
  p.hline(x + 1, x + w, y + 9, SOOT);
  p.vline(x + w, y + 1, y + 8, SOOT);
  p.set(x + 2, y + 4, PAPER);
  p.set(x + w - 3, y + 4, PAPER);
  textPix(p, label, x + 5, y + 2, PAPER);
}

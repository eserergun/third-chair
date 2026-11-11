// Effects: muzzle flash, gun smoke, dust motes of a quiet minute, the comic panel border.

import type { ArtModel } from "./model";
import { H, W } from "./model";
import { FRAME } from "./layout";
import { NONE, PAPER, Pix, RUST, SOOT, stamp } from "./pix";

function hash(n: number): number {
  let x = (n | 0) * 2246822519 + 3266489917;
  x = (x ^ (x >>> 15)) * 668265263;
  return ((x ^ (x >>> 13)) >>> 0) / 4294967296;
}

const RAYS: readonly [number, number, number][] = [
  [1, 0, 1],
  [0, -1, 0.7],
  [0, 1, 0.7],
  [1, -1, 0.6],
  [1, 1, 0.6],
  [-1, -1, 0.35],
  [-1, 1, 0.35],
];

/** Rust and paper starburst at a muzzle. `age` is ms since the flash started. */
export function muzzleFlash(p: Pix, x: number, y: number, dir: 1 | -1, age: number): void {
  const big = age < 140;
  const cx = x + dir * (big ? 5 : 4);
  const len = big ? 10 : 7;
  for (const [dx, dy, k] of RAYS) {
    const n = Math.max(3, Math.round(len * k));
    for (let s = 2; s <= n; s++) {
      p.set(cx + dx * dir * s, y + dy * s, RUST);
      // thicken the main ray along the barrel
      if (dy === 0) p.set(cx + dx * dir * s, y + (s < n - 1 ? 1 : 0), RUST);
    }
  }
  p.disc(cx, y, big ? 4 : 3, RUST);
  p.disc(cx, y, big ? 2 : 1, PAPER);
  p.set(cx + dir * 3, y, PAPER);
  if (big) {
    // sparks
    p.set(cx + dir * 13, y - 4, RUST);
    p.set(cx + dir * 14, y + 3, RUST);
    p.set(cx + dir * 10, y + 6, PAPER);
    p.set(cx + dir * 11, y - 7, PAPER);
  }
}

const PUFF = new Pix(48, 48);
/** 4 x 4 ordered dither thresholds (0..15). */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** One lumpy puff: three filled lobes that grow from 2 px to about 6 px. */
function cloud(L: Pix, x: number, y: number, t: number): number {
  const r = Math.round(2 + t * 4);
  L.disc(x, y, r, PAPER);
  const s = Math.max(1, Math.round(r * 0.7));
  L.disc(x - Math.round(r * 0.8), y + Math.round(r * 0.4), s, PAPER);
  L.disc(x + Math.round(r * 0.8), y + Math.round(r * 0.3), s, PAPER);
  return r;
}

/**
 * Gun smoke: filled paper puffs that rise, grow and fade out through an ordered dither. Over dark
 * ink a puff is dithered paper (dense on its lit upper left, thinner on the shadow side); over the
 * paper wall it is the same paper with a soft dithered soot shade on its lower right. No outlines.
 */
export function smoke(p: Pix, x: number, y: number, dir: 1 | -1, m: ArtModel, seed: number): void {
  const L = PUFF;
  const LIFE = 2400;
  const ages = m.reduce ? [700, 1500] : [0, 1, 2].map((k) => (m.time + k * 800 + seed * 211) % LIFE);
  ages.forEach((age, k) => {
    const t = age / LIFE;
    L.clear();
    L.place(x - 24, y - 40);
    const px = Math.round(x + dir * (4 + t * 10) + Math.sin(t * 4 + k * 2 + seed) * 2);
    const py = Math.round(y - 3 - t * 24);
    const r = cloud(L, px, py, t);
    const fade = t < 0.45 ? 0 : (t - 0.45) / 0.55; // 0 solid .. 1 gone
    for (let ly = 0; ly < L.h; ly++)
      for (let lx = 0; lx < L.w; lx++) {
        if (L.px[ly * L.w + lx] === NONE) continue;
        const gx = L.ox + lx;
        const gy = L.oy + ly;
        const d = BAYER[(gy & 3) * 4 + (gx & 3)];
        const u = (gx - px) / r;
        const v = (gy - py) / r;
        const lit = u + v < -0.5; // the lit upper left of the main lobe
        const shade = L.get(gx + 2, gy + 1) === NONE || L.get(gx + 1, gy + 2) === NONE; // lower right rim
        const bg = p.get(gx, gy);
        if (bg === PAPER) {
          // a grey (dithered soot) puff body, darker on its shadow rim, clean paper where it is lit
          const dens = (lit ? 0 : shade ? 8 : 4) * (1 - fade);
          if (d < dens) p.set(gx, gy, SOOT);
        } else {
          // over dark ink: filled paper, thinner on the shadow rim
          const dens = (shade ? 9 : 15) * (1 - fade);
          if (d < dens) p.set(gx, gy, PAPER);
        }
      }
  });
}

/**
 * A 1 px rust tracer from the muzzle to where the shot lands. With `peak` (a frame row) the shot
 * arcs over the middle of its path, its highest point on that row.
 */
export function tracer(p: Pix, x0: number, y0: number, x1: number, y1: number, peak?: number): void {
  if (peak === undefined) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let k = 0; k <= n; k++) p.set(Math.round(x0 + ((x1 - x0) * k) / n), Math.round(y0 + ((y1 - y0) * k) / n), RUST);
    return;
  }
  // quadratic curve through (x0, y0), the peak at its middle, and (x1, y1)
  const cy = 2 * peak - (y0 + y1) / 2;
  const n = Math.abs(x1 - x0) * 2 + 2;
  let lx = Math.round(x0);
  let ly = Math.round(y0);
  for (let k = 0; k <= n; k++) {
    const u = k / n;
    const x = Math.round(x0 + (x1 - x0) * u);
    const y = Math.round((1 - u) * (1 - u) * y0 + 2 * u * (1 - u) * cy + u * u * y1);
    p.line(lx, ly, x, y, RUST);
    lx = x;
    ly = y;
  }
}

const SPARK = new Pix(16, 16);

/** A small hit spark where the bullet strikes a body. */
export function hitSpark(p: Pix, x: number, y: number, age: number): void {
  const L = SPARK;
  L.clear();
  L.place(x - 8, y - 8);
  const n = age < 120 ? 3 : 2;
  for (let s = 1; s <= n; s++) {
    L.set(x + s, y, RUST);
    L.set(x - s, y, RUST);
    L.set(x, y + s, RUST);
    L.set(x, y - s, RUST);
    if (s < n) {
      L.set(x + s, y + s, RUST);
      L.set(x - s, y - s, RUST);
      L.set(x + s, y - s, RUST);
      L.set(x - s, y + s, RUST);
    }
  }
  L.rect(x - 1, y - 1, 3, 3, PAPER);
  L.set(x, y, RUST);
  stamp(p, L, SOOT);
}

/** A bullet hole in the wall where a shot went over a ducked hat. */
export function wallHole(p: Pix, x: number, y: number): void {
  p.rect(x - 1, y - 1, 2, 2, SOOT);
  p.set(x + 1, y - 2, SOOT);
  p.set(x - 2, y + 1, SOOT);
  p.set(x + 1, y + 1, RUST);
}

/** Soot dust motes drifting through a quiet minute. Frozen with the frame under reduced motion. */
export function motes(p: Pix, m: ArtModel): void {
  const f = m.frame;
  for (let k = 0; k < 18; k++) {
    const span = W - 2 * FRAME - 20;
    const x0 = hash(k * 3 + 1) * span;
    const y0 = 28 + hash(k * 5 + 2) * 104;
    const speed = 0.18 + hash(k * 7 + 3) * 0.3;
    const x = FRAME + 10 + (((x0 + f * speed) % span) + span) % span;
    const y = y0 + Math.sin(f / 9 + k) * 3 + ((f * 0.05 * (k % 3)) % 6);
    p.set(Math.round(x), Math.round(y), SOOT);
    if (k % 4 === 0) p.set(Math.round(x) + 1, Math.round(y), SOOT);
  }
}

/** The 6 px soot frame, thicker while the reveal panel snaps in (level 1..3). */
export function border(p: Pix, panel: number): void {
  const extra = panel === 1 ? 12 : panel === 2 ? 8 : panel === 3 ? 4 : 0;
  const t = FRAME + extra;
  p.rect(0, 0, W, t, SOOT);
  p.rect(0, H - t, W, t, SOOT);
  p.rect(0, 0, t, H, SOOT);
  p.rect(W - t, 0, t, H, SOOT);
  if (extra > 0) {
    // a paper hairline inside the snapping border, like a panel cut
    p.frame(t, t, W - 2 * t, H - 2 * t, PAPER);
  }
}

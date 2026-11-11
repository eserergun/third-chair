// Indexed-colour framebuffer. Every frame is composed here first, then presented to the canvas
// as integer fillRect runs in the four inks. Layers (small Pix with an origin) let sprites be
// composed, rotated and stamped with a contrast outline that reads on any background.

import { H, INK, W } from "./model";

export const NONE = 0;
export const SOOT = 1;
export const PAPER = 2;
export const RUST = 3;
export const FELT = 4;

/** 0 is transparent (layers only). 1..4 are the four inks. */
export type Ink = 0 | 1 | 2 | 3 | 4;
export type Solid = 1 | 2 | 3 | 4;

export const CSS: readonly string[] = ["", INK.soot, INK.paper, INK.rust, INK.felt];

export interface Sprite {
  readonly w: number;
  readonly h: number;
  readonly rows: readonly string[];
}

/** Palette for sprite characters. Unlisted characters are transparent. "x" in a palette may map to -1 to erase. */
export type Pal = Readonly<Record<string, Ink | -1>>;

export function sprite(rows: readonly string[]): Sprite {
  let w = 0;
  for (const r of rows) w = Math.max(w, r.length);
  return { w, h: rows.length, rows };
}

export class Pix {
  readonly px: Uint8Array;
  readonly w: number;
  readonly h: number;
  /** Origin of this buffer in frame coordinates (layers). */
  ox: number;
  oy: number;

  constructor(w: number, h: number, ox = 0, oy = 0) {
    this.w = w;
    this.h = h;
    this.ox = ox;
    this.oy = oy;
    this.px = new Uint8Array(w * h);
  }

  clear(ink: Ink = NONE): void {
    this.px.fill(ink);
  }

  /** Move a layer so that frame point (x, y) maps to its local (lx, ly). */
  place(ox: number, oy: number): void {
    this.ox = ox | 0;
    this.oy = oy | 0;
  }

  get(x: number, y: number): Ink {
    const lx = (x | 0) - this.ox;
    const ly = (y | 0) - this.oy;
    if (lx < 0 || ly < 0 || lx >= this.w || ly >= this.h) return NONE;
    return this.px[ly * this.w + lx] as Ink;
  }

  set(x: number, y: number, ink: Ink): void {
    const lx = (x | 0) - this.ox;
    const ly = (y | 0) - this.oy;
    if (lx < 0 || ly < 0 || lx >= this.w || ly >= this.h) return;
    this.px[ly * this.w + lx] = ink;
  }

  rect(x: number, y: number, w: number, h: number, ink: Ink): void {
    let x0 = (x | 0) - this.ox;
    let y0 = (y | 0) - this.oy;
    let x1 = x0 + (w | 0);
    let y1 = y0 + (h | 0);
    if (x0 < 0) x0 = 0;
    if (y0 < 0) y0 = 0;
    if (x1 > this.w) x1 = this.w;
    if (y1 > this.h) y1 = this.h;
    for (let yy = y0; yy < y1; yy++) this.px.fill(ink, yy * this.w + x0, yy * this.w + x1);
  }

  hline(x0: number, x1: number, y: number, ink: Ink): void {
    const a = Math.min(x0, x1);
    const b = Math.max(x0, x1);
    this.rect(a, y, b - a + 1, 1, ink);
  }

  vline(x: number, y0: number, y1: number, ink: Ink): void {
    const a = Math.min(y0, y1);
    const b = Math.max(y0, y1);
    this.rect(x, a, 1, b - a + 1, ink);
  }

  /** 1 px outline of a rectangle. */
  frame(x: number, y: number, w: number, h: number, ink: Ink): void {
    this.rect(x, y, w, 1, ink);
    this.rect(x, y + h - 1, w, 1, ink);
    this.rect(x, y, 1, h, ink);
    this.rect(x + w - 1, y, 1, h, ink);
  }

  /** Bresenham line, inclusive. */
  line(x0: number, y0: number, x1: number, y1: number, ink: Ink): void {
    let x = x0 | 0;
    let y = y0 | 0;
    const xe = x1 | 0;
    const ye = y1 | 0;
    const dx = Math.abs(xe - x);
    const dy = -Math.abs(ye - y);
    const sx = x < xe ? 1 : -1;
    const sy = y < ye ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x, y, ink);
      if (x === xe && y === ye) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
  }

  /** Filled ellipse centred on the pixel grid: spans [cx-rx, cx+rx] x [cy-ry, cy+ry]. */
  ellipse(cx: number, cy: number, rx: number, ry: number, ink: Ink): void {
    if (rx <= 0 || ry <= 0) {
      this.rect(cx - Math.max(0, rx), cy - Math.max(0, ry), Math.max(0, rx) * 2 + 1, Math.max(0, ry) * 2 + 1, ink);
      return;
    }
    for (let dy = -ry; dy <= ry; dy++) {
      const f = 1 - (dy * dy) / ((ry + 0.5) * (ry + 0.5));
      const span = Math.floor((rx + 0.5) * Math.sqrt(Math.max(0, f)));
      this.rect(cx - span, cy + dy, span * 2 + 1, 1, ink);
    }
  }

  /** Filled ellipse with an even width: spans [x, x+w-1] x [y, y+h-1]. */
  oval(x: number, y: number, w: number, h: number, ink: Ink): void {
    const rx = w / 2;
    const ry = h / 2;
    const cy = y + ry;
    for (let row = 0; row < h; row++) {
      const dy = row + 0.5 - ry;
      const f = 1 - (dy * dy) / (ry * ry);
      const half = Math.round(rx * Math.sqrt(Math.max(0, f)));
      const left = Math.round(x + rx - half);
      this.rect(left, Math.floor(cy - ry) + row, half * 2, 1, ink);
    }
  }

  disc(cx: number, cy: number, r: number, ink: Ink): void {
    this.ellipse(cx, cy, r, r, ink);
  }

  /** Blit an ASCII sprite. flip mirrors it horizontally inside its own box. */
  blit(s: Sprite, x: number, y: number, pal: Pal, flip = false, rowFrom = 0, rowTo = s.h): void {
    const x0 = x | 0;
    const y0 = y | 0;
    for (let r = Math.max(0, rowFrom); r < Math.min(s.h, rowTo); r++) {
      const row = s.rows[r];
      for (let c = 0; c < row.length; c++) {
        const ch = row[c];
        const v = pal[ch];
        if (v === undefined || v === NONE) continue;
        const px = flip ? x0 + (s.w - 1 - c) : x0 + c;
        this.set(px, y0 + r, v === -1 ? NONE : v);
      }
    }
  }

  /** True if the layer has ink at frame point (x, y). */
  has(x: number, y: number): boolean {
    return this.get(x, y) !== NONE;
  }

  copyFrom(src: Pix): void {
    this.px.set(src.px);
  }
}

/** Ink that reads against a background ink. */
export function contrast(bg: Ink): Solid {
  return bg === SOOT || bg === FELT ? PAPER : SOOT;
}

/**
 * "auto": ink line on light ground, rim light on dark; "contrast": ink line or paper ring on every
 * side; "chalk": a soot ink line on paper and a paper chalk line on every other ink (rust too).
 */
export type Outline = "auto" | "contrast" | "chalk" | "none" | Solid;

/**
 * Composite a layer onto the frame. The outline ring (4-neighbour) takes a contrast ink against
 * whatever is already on the frame: a soot ink line on paper and rust, and a paper rim light on
 * the left and top edges over soot and felt (dark figures on the dark floor). Below `noRimBelow`
 * no paper rim is drawn at all: the shadow under the tables swallows legs.
 */
export function stamp(dst: Pix, layer: Pix, outline: Outline = "auto", noRimBelow = Number.POSITIVE_INFINITY): void {
  const { w, h, px } = layer;
  const ring = outline !== "none";
  for (let ly = -1; ly <= h; ly++) {
    for (let lx = -1; lx <= w; lx++) {
      const inside = lx >= 0 && ly >= 0 && lx < w && ly < h;
      const v = inside ? px[ly * w + lx] : NONE;
      const gx = layer.ox + lx;
      const gy = layer.oy + ly;
      if (v !== NONE) {
        dst.set(gx, gy, v as Ink);
        continue;
      }
      if (!ring) continue;
      const a = lx > 0 && ly >= 0 && ly < h ? px[ly * w + lx - 1] : NONE;
      const b = lx + 1 < w && lx + 1 >= 0 && ly >= 0 && ly < h ? px[ly * w + lx + 1] : NONE;
      const c = ly > 0 && lx >= 0 && lx < w ? px[(ly - 1) * w + lx] : NONE;
      const d = ly + 1 < h && ly + 1 >= 0 && lx >= 0 && lx < w ? px[(ly + 1) * w + lx] : NONE;
      if (a === NONE && b === NONE && c === NONE && d === NONE) continue;
      const ink =
        outline === "auto" || outline === "contrast"
          ? contrast(dst.get(gx, gy))
          : outline === "chalk"
            ? dst.get(gx, gy) === PAPER
              ? SOOT
              : PAPER
            : outline;
      // On a dark ground the paper rim is a rim light from the upper left: left and top edges only.
      if (outline === "auto" && ink === PAPER && ((b === NONE && d === NONE) || gy >= noRimBelow)) continue;
      // An outline in the same ink as every edge pixel it touches would only fatten the shape.
      if (
        (a === NONE || a === ink) &&
        (b === NONE || b === ink) &&
        (c === NONE || c === ink) &&
        (d === NONE || d === ink)
      )
        continue;
      dst.set(gx, gy, ink);
    }
  }
}

/**
 * Nearest-neighbour rotation of a layer about a pivot. (px, py) is the pivot in src frame
 * coordinates, (qx, qy) is where the pivot lands in dst frame coordinates.
 */
export function rotate(src: Pix, dst: Pix, angle: number, px: number, py: number, qx: number, qy: number): void {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  for (let y = 0; y < dst.h; y++) {
    for (let x = 0; x < dst.w; x++) {
      const gx = dst.ox + x - qx;
      const gy = dst.oy + y - qy;
      // inverse rotation
      const sx = Math.round(c * gx + s * gy + px);
      const sy = Math.round(-s * gx + c * gy + py);
      const v = src.get(sx, sy);
      if (v !== NONE) dst.px[y * dst.w + x] = v;
    }
  }
}

/** Present the frame to a canvas: one paper fill, then merged rects per ink. */
export function present(ctx: CanvasRenderingContext2D, pix: Pix): void {
  ctx.imageSmoothingEnabled = false;
  const w = Math.min(pix.w, W);
  const h = Math.min(pix.h, H);
  ctx.fillStyle = CSS[PAPER];
  ctx.fillRect(0, 0, w, h);
  for (const ink of [SOOT, RUST, FELT] as const) {
    ctx.fillStyle = CSS[ink];
    // open rects keyed by x0 * 1024 + len -> start row
    let open = new Map<number, number>();
    for (let y = 0; y <= h; y++) {
      const next = new Map<number, number>();
      if (y < h) {
        const base = y * pix.w;
        let x = 0;
        while (x < w) {
          if (pix.px[base + x] !== ink) {
            x++;
            continue;
          }
          const x0 = x;
          while (x < w && pix.px[base + x] === ink) x++;
          const key = x0 * 1024 + (x - x0);
          const start = open.get(key);
          if (start !== undefined) {
            next.set(key, start);
            open.delete(key);
          } else next.set(key, y);
        }
      }
      for (const [key, start] of open) {
        const x0 = Math.floor(key / 1024);
        const len = key % 1024;
        ctx.fillRect(x0, start, len, y - start);
      }
      open = next;
    }
  }
}

/** Count presented rects (for budget tests). */
export function rectCount(pix: Pix): number {
  let n = 1;
  for (const ink of [SOOT, RUST, FELT]) {
    let open = new Set<number>();
    for (let y = 0; y <= pix.h; y++) {
      const next = new Set<number>();
      if (y < pix.h) {
        let x = 0;
        while (x < pix.w) {
          if (pix.px[y * pix.w + x] !== ink) {
            x++;
            continue;
          }
          const x0 = x;
          while (x < pix.w && pix.px[y * pix.w + x] === ink) x++;
          const key = x0 * 1024 + (x - x0);
          if (open.has(key)) open.delete(key);
          next.add(key);
        }
      }
      n += open.size;
      open = next;
    }
  }
  return n;
}

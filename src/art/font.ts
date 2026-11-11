// Crisp 5-row pixel font. Most glyphs are 3 px wide; M, W, N, O, Q get the width they need to
// stay legible. One pixel of space between glyphs. Lower case is drawn as upper case.

import type { Ink, Pix } from "./pix";

const G: Readonly<Record<string, readonly string[]>> = {
  A: [".#.", "#.#", "###", "#.#", "#.#"],
  B: ["##.", "#.#", "##.", "#.#", "##."],
  C: [".##", "#..", "#..", "#..", ".##"],
  D: ["##.", "#.#", "#.#", "#.#", "##."],
  E: ["###", "#..", "##.", "#..", "###"],
  F: ["###", "#..", "##.", "#..", "#.."],
  G: [".##", "#..", "#.#", "#.#", ".##"],
  H: ["#.#", "#.#", "###", "#.#", "#.#"],
  I: ["###", ".#.", ".#.", ".#.", "###"],
  J: ["..#", "..#", "..#", "#.#", ".#."],
  K: ["#.#", "#.#", "##.", "#.#", "#.#"],
  L: ["#..", "#..", "#..", "#..", "###"],
  M: ["#...#", "##.##", "#.#.#", "#...#", "#...#"],
  N: ["#..#", "##.#", "#.##", "#..#", "#..#"],
  O: [".##.", "#..#", "#..#", "#..#", ".##."],
  P: ["##.", "#.#", "##.", "#..", "#.."],
  Q: [".##.", "#..#", "#..#", "#.#.", ".#.#"],
  R: ["##.", "#.#", "##.", "#.#", "#.#"],
  S: [".##", "#..", ".#.", "..#", "##."],
  T: ["###", ".#.", ".#.", ".#.", ".#."],
  U: ["#.#", "#.#", "#.#", "#.#", "###"],
  V: ["#.#", "#.#", "#.#", "#.#", ".#."],
  W: ["#...#", "#...#", "#.#.#", "##.##", "#...#"],
  X: ["#.#", "#.#", ".#.", "#.#", "#.#"],
  Y: ["#.#", "#.#", ".#.", ".#.", ".#."],
  Z: ["###", "..#", ".#.", "#..", "###"],
  "0": ["###", "#.#", "#.#", "#.#", "###"],
  "1": [".#.", "##.", ".#.", ".#.", "###"],
  "2": ["##.", "..#", ".#.", "#..", "###"],
  "3": ["##.", "..#", ".#.", "..#", "##."],
  "4": ["#.#", "#.#", "###", "..#", "..#"],
  "5": ["###", "#..", "##.", "..#", "##."],
  "6": [".##", "#..", "###", "#.#", "###"],
  "7": ["###", "..#", ".#.", ".#.", ".#."],
  "8": ["###", "#.#", "###", "#.#", "###"],
  "9": ["###", "#.#", "###", "..#", "##."],
  ".": [".", ".", ".", ".", "#"],
  ",": ["..", "..", "..", ".#", "#."],
  "!": ["#", "#", "#", ".", "#"],
  "?": ["##.", "..#", ".#.", "...", ".#."],
  "-": ["...", "...", "###", "...", "..."],
  "'": ["#", "#", ".", ".", "."],
  ":": [".", "#", ".", "#", "."],
  "/": ["..#", "..#", ".#.", "#..", "#.."],
  " ": ["..", "..", "..", "..", ".."],
};

export const GLYPH_H = 5;

function glyph(ch: string): readonly string[] {
  return G[ch] ?? G[ch.toUpperCase()] ?? G[" "];
}

/** Width in px of a string at a scale, without trailing space. */
export function measure(s: string, scale = 1): number {
  let w = 0;
  let n = 0;
  for (const ch of s) {
    w += glyph(ch)[0].length;
    n++;
  }
  if (n === 0) return 0;
  return (w + n - 1) * Math.max(1, scale | 0);
}

function each(s: string, x: number, y: number, scale: number, put: (x: number, y: number, size: number) => void): number {
  const k = Math.max(1, scale | 0);
  let cx = x | 0;
  const y0 = y | 0;
  for (const ch of s) {
    const rows = glyph(ch);
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      for (let c = 0; c < row.length; c++) if (row[c] === "#") put(cx + c * k, y0 + r * k, k);
    }
    cx += (rows[0].length + 1) * k;
  }
  return cx - (x | 0) - (s.length > 0 ? k : 0);
}

/** Draw text on a canvas with integer rects. Returns the drawn width. */
export function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, color: string, scale = 1): number {
  ctx.fillStyle = color;
  return each(s, x, y, scale, (px, py, k) => ctx.fillRect(px, py, k, k));
}

/** Draw text into a framebuffer. Returns the drawn width. */
export function textPix(pix: Pix, s: string, x: number, y: number, ink: Ink, scale = 1): number {
  return each(s, x, y, scale, (px, py, k) => pix.rect(px, py, k, k, ink));
}

/** Characters the font draws. Anything else renders as a space. */
export const FONT_CHARS = Object.keys(G).join("");

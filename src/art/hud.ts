// What floats over the chairs (badge cards, the thinking bubble, the player's marker, the
// winner's sparkle) and the paper captions on the comic.

import type { ArtModel, ArtSeat, Badge } from "./model";
import { W } from "./model";
import { measure, textPix } from "./font";
import { BADGE_Y, FRAME, SEAT_X } from "./layout";
import { FELT, PAPER, Pix, RUST, SOOT, sprite, stamp, type Pal, type Sprite } from "./pix";

const PAL: Pal = { k: SOOT, p: PAPER, r: RUST, f: FELT };

// Icons drawn inside the 8 x 12 paper face of a 10 x 14 card.
const ICON_AIR = sprite([
  "...f.f..",
  ".f.f.f..",
  ".f.f.f.f",
  ".f.f.f.f",
  ".fffffff",
  "ffffffff",
  ".fffffff",
  "..fffff.",
  "..fffff.",
  "...fff..",
]);
// Iron: a revolver with a long barrel, a rust cylinder and a grip that slants back.
const ICON_IRON = sprite([
  ".k.....k",
  "kkkkkkkk",
  "kkkkkkkk",
  "krrk.k..",
  "kkkkkk..",
  "kkk.....",
  ".kkk....",
  "..kk....",
  "..kkk...",
]);
// Table: a wide felt top on one soot leg.
const ICON_TABLE = sprite([
  ".ffffff.",
  "ffffffff",
  "ffffffff",
  "kffffffk",
  ".kkkkkk.",
  "...kk...",
  "...kk...",
  "...kk...",
  "..kkkk..",
  ".kkkkkk.",
]);
const ICON_RAN = sprite([
  "kkkk....",
  "k..k....",
  "k..k..k.",
  "k.kkkkkk",
  "k..k..k.",
  "k..k....",
  "k..k....",
  "kkkk....",
]);
const ICON_SLEPT = sprite([
  ".....kkk",
  "......k.",
  ".....kkk",
  "........",
  "kkkkk...",
  "...k....",
  "..k.....",
  ".k......",
  "kkkkk...",
]);

export const BADGE_W = 10;
export const BADGE_H = 14;

function card(p: Pix, x: number, y: number, face: "paper" | "rust" | "felt" | "back"): void {
  p.rect(x, y, BADGE_W, BADGE_H, SOOT);
  if (face !== "back") {
    p.rect(x + 1, y + 1, BADGE_W - 2, BADGE_H - 2, face === "paper" ? PAPER : face === "rust" ? RUST : FELT);
    return;
  }
  p.rect(x + 1, y + 1, BADGE_W - 2, BADGE_H - 2, RUST);
  for (let yy = 0; yy < BADGE_H - 2; yy++)
    for (let xx = 0; xx < BADGE_W - 2; xx++)
      if ((xx + yy) % 4 === 1 || (xx - yy + 40) % 4 === 1) p.set(x + 1 + xx, y + 1 + yy, PAPER);
}

/** Icons on a coloured face (ran, slept) are drawn in paper. */
const PAL_LIGHT: Pal = { k: PAPER, p: PAPER, r: PAPER, f: PAPER };

function icon(p: Pix, s: Sprite, x: number, y: number, flip = false, pal: Pal = PAL): void {
  const ix = x + 1 + Math.floor((8 - s.w) / 2);
  const iy = y + 1 + Math.floor((12 - s.h) / 2);
  p.blit(s, ix, iy, pal, flip);
}

const BUBBLE = new Pix(24, 20);

function thinking(p: Pix, cx: number, y: number, m: ArtModel): void {
  const L = BUBBLE;
  L.clear();
  L.place(cx - 10, y - 2);
  L.oval(cx - 7, y + 1, 15, 9, PAPER);
  L.rect(cx - 2, y + 11, 2, 2, PAPER);
  L.set(cx - 3, y + 14, PAPER);
  stamp(p, L, SOOT);
  const dots = m.reduce ? 3 : 1 + (Math.floor(m.frame / 4) % 3);
  for (let k = 0; k < dots; k++) p.rect(cx - 4 + k * 3, y + 5, 2, 2, SOOT);
}

/** One badge over seat i. */
export function badge(p: Pix, i: number, seat: ArtSeat, m: ArtModel): void {
  const b: Badge = seat.badge;
  if (b === null) return;
  const cx = SEAT_X[i];
  const float = m.reduce ? 0 : Math.floor((m.frame + i * 5) / 8) % 2;
  const x = cx - 5;
  const y = BADGE_Y + float;
  switch (b) {
    case "thinking":
      thinking(p, cx, y, m);
      break;
    case "down":
      card(p, x, y, "back");
      break;
    case "air":
      card(p, x, y, "paper");
      icon(p, ICON_AIR, x, y);
      break;
    case "iron": {
      card(p, x, y, "paper");
      const left = seat.aimAt !== null ? seat.aimAt < i : i === 2;
      icon(p, ICON_IRON, x, y, left);
      break;
    }
    case "table":
      card(p, x, y, "paper");
      icon(p, ICON_TABLE, x, y);
      break;
    case "ran":
      card(p, x, y, "rust");
      icon(p, ICON_RAN, x, y, i === 2, PAL_LIGHT);
      break;
    case "slept":
      card(p, x, y, "felt");
      icon(p, ICON_SLEPT, x, y, false, PAL_LIGHT);
      break;
  }
}

const ARROW = sprite(["rrrrrrr", ".rrrrr.", "..rrr..", "...r..."]);
const MARK = new Pix(12, 9);

/** The small rust arrow over the player's own chair. */
export function youMarker(p: Pix, i: number, m: ArtModel): void {
  const cx = SEAT_X[i];
  const float = m.reduce ? 0 : Math.floor((m.frame + i * 5) / 8) % 2;
  const y = BADGE_Y - 6 + float;
  MARK.clear();
  MARK.place(cx - 6, y - 2);
  MARK.blit(ARROW, cx - 3, y, PAL);
  stamp(p, MARK, SOOT);
}

const STAR_BIG = sprite(["..p..", "..p..", "ppppp", "..p..", "..p.."]);
const STAR_SMALL = sprite([".p.", "ppp", ".p."]);
const SPARK = new Pix(12, 12);

function star(p: Pix, x: number, y: number, big: boolean): void {
  const s = big ? STAR_BIG : STAR_SMALL;
  SPARK.clear();
  SPARK.place(x - 3, y - 3);
  SPARK.blit(s, x - Math.floor(s.w / 2), y - Math.floor(s.h / 2), PAL);
  stamp(p, SPARK, SOOT);
}

/** A little paper sparkle around the winner's head. */
export function sparkle(p: Pix, i: number, m: ArtModel, seat?: ArtSeat): void {
  const cx = SEAT_X[i];
  const f = m.reduce ? 0 : Math.floor(m.frame / 3);
  // A sleeping winner has its Zz beside the head (right, or left on seat 2): the stars keep clear.
  const zz = (seat?.asleep ?? seat?.badge === "slept") && seat?.pose !== "fallen" ? (i === 2 ? -1 : 1) : 0;
  if (zz === 0) {
    star(p, cx - 16, 101, f % 2 === 0);
    star(p, cx + 16, 107, f % 2 === 1);
    star(p, cx + 12, 96, f % 3 !== 2);
  } else {
    star(p, cx - zz * 16, 101, f % 2 === 0);
    star(p, cx - zz * 13, 92, f % 2 === 1);
    star(p, cx + zz * 20, 112, f % 3 !== 2);
  }
}

/** Longest caption line in px; longer captions wrap so the box stays clear of the lamp and the watch. */
export const CAPTION_MAX_W = 104;

function wrap(s: string, max: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of s.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (measure(next) <= max || !line) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  // a single word longer than a line is cut to fit
  return lines.slice(0, 3).map((l) => {
    let cut = l;
    while (cut.length > 1 && measure(cut) > max) cut = cut.slice(0, -1);
    return cut;
  });
}

/** Paper caption box with a soot border, top left. */
export function caption(p: Pix, s: string): void {
  const lines = wrap(s.toUpperCase(), CAPTION_MAX_W);
  if (lines.length === 0) return;
  const w = Math.min(CAPTION_MAX_W, Math.max(...lines.map((l) => measure(l)))) + 8;
  const h = lines.length * 7 + 4;
  const x = FRAME + 5;
  const y = FRAME + 5;
  p.rect(x + 1, y + 1, w, h, SOOT);
  p.rect(x, y, w, h, SOOT);
  p.rect(x + 1, y + 1, w - 2, h - 2, PAPER);
  lines.forEach((l, k) => textPix(p, l, x + 4, y + 3 + k * 7, SOOT));
}

export const TAGLINE = "TALK IS NOT THE PURSE";

/** The house rule, small in the top margin, on a clean strip of paper. */
export function tagline(p: Pix): void {
  const w = measure(TAGLINE);
  const x = W - FRAME - 6 - w;
  const y = FRAME + 4;
  p.rect(x - 3, y - 2, w + 6, 9, PAPER);
  textPix(p, TAGLINE, x, y, SOOT);
  p.hline(x, x + w - 1, y + 6, SOOT);
}

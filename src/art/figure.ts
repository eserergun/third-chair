// The cowboys: standing poses (idle, air, aim with its draw), the duck behind the table, the fall
// (hit), the body on the floor with its wound and pool, and the hat that flies off.

import type { ArtModel, ArtSeat, Coat } from "./model";
import { W } from "./model";
import { FALLEN_TOP_Y, FEET_Y, FLOOR_Y, FRAME, SEAT_X, TABLE_TOP_Y } from "./layout";
import { FELT, NONE, PAPER, Pix, RUST, SOOT, rotate, stamp, type Ink, type Pal, type Sprite } from "./pix";
import { FLASH_FROM } from "./reveal";
import { RUG_Y, background } from "./room";
import * as S from "./sprites";

/** Pose time used when motion is reduced: every tween is finished. */
export const SETTLED = 1e9;

// Fall timeline (ms of the fallen pose).
const HIT_MS = 150; // hit pose: jerk back, arms up, the gun flies, wound shows, hat leaves the head
const BUCKLE_MS = 110; // the knees give
const FALL_MS = 320; // rotation to the floor
const DOWN_MS = HIT_MS + BUCKLE_MS + FALL_MS; // the body lies still from here
const HAT_MS = 620; // hat flight
const POOL_MS = 1700; // pool spreading
const DUCK_MS = 140;

export function coatInk(c: Coat): Ink {
  return c === "rust" ? RUST : c === "felt" ? FELT : SOOT;
}

export function palette(seat: ArtSeat): Pal {
  return {
    k: SOOT,
    p: PAPER,
    r: RUST,
    f: FELT,
    c: coatInk(seat.coat),
    l: seat.coat === "soot" ? FELT : SOOT,
    n: seat.coat === "rust" ? FELT : RUST,
    t: SOOT,
    b: seat.bullet ? RUST : SOOT,
    h: seat.house ? PAPER : RUST,
    x: -1,
  };
}

interface Look {
  front: boolean;
  dir: 1 | -1;
}

/** Seat 0 faces right, seat 2 faces left, seat 1 faces us and turns its gun arm. */
export function look(i: number, seat: ArtSeat): Look {
  if (i === 0) return { front: false, dir: 1 };
  if (i === 2) return { front: false, dir: -1 };
  return { front: true, dir: seat.aimAt === 0 ? -1 : 1 };
}

function beat(frame: number, lag: number): 0 | 1 {
  const b = Math.floor(frame / 6) - lag;
  return (((b % 2) + 2) % 2) as 0 | 1;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function lerp(a: number, b: number, p: number): number {
  return a + (b - a) * p;
}

function poseT(seat: ArtSeat, m: ArtModel): number {
  return m.reduce ? SETTLED : Math.max(0, seat.t);
}

interface AimArm {
  s: Sprite;
  by: number; // body row of the sprite's top row
  mz: { x: number; y: number };
}

/** The gun arm: angled down at the near seat, raised over the middle chair at the far seat. */
function aimArm(i: number, seat: ArtSeat): AimArm {
  const far = seat.aimAt !== null && Math.abs(seat.aimAt - i) === 2;
  return far ? { s: S.ARM_AIM_FAR, by: 10 - S.AIM_FAR_SHOULDER, mz: S.AIM_FAR_MUZZLE } : { s: S.ARM_AIM, by: 10, mz: S.AIM_MUZZLE };
}

/** Gun kick: the arm jumps back and up one pixel for the first frames of the shot. */
function kickOf(seat: ArtSeat, m: ArtModel): number {
  if (m.reduce || !seat.firing) return 0;
  const age = seat.t - FLASH_FROM;
  return age >= 0 && age < 110 ? 1 : 0;
}

/** Draws in body space: column 13 is the seat centre, row 47 the boot sole. Mirrors for dir -1. */
class Pen {
  constructor(
    readonly L: Pix,
    readonly cx: number,
    readonly fy: number,
    readonly dir: 1 | -1,
    readonly dy = 0,
  ) {}

  x(bx: number, w = 1): number {
    return this.dir > 0 ? this.cx - 13 + bx : this.cx + 13 - bx - w + 1;
  }

  y(by: number): number {
    return this.fy - 47 + by + this.dy;
  }

  put(s: Sprite, bx: number, by: number, pal: Pal, from = 0, to = s.h): void {
    this.L.blit(s, this.x(bx, s.w), this.y(by), pal, this.dir < 0, from, to);
  }

  rect(bx: number, by: number, w: number, h: number, ink: Ink): void {
    this.L.rect(this.x(bx, w), this.y(by), w, h, ink);
  }

  dot(bx: number, by: number, ink: Ink): void {
    this.L.set(this.x(bx), this.y(by), ink);
  }

  /** A 3 px thick limb along a line. */
  limb(x0: number, y0: number, x1: number, y1: number, ink: Ink): void {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let k = 0; k <= n; k++) {
      const bx = Math.round(lerp(x0, x1, k / n));
      const by = Math.round(lerp(y0, y1, k / n));
      this.rect(bx - 1, by - 1, 3, 3, ink);
    }
  }
}

type Arms = "idle" | "air" | "draw" | "aim" | "recoil";

interface Upright {
  look: Look;
  arms: Arms;
  bob: number;
  buckle?: number; // rows the knees give (hit pose)
  kick?: number; // gun kick in px
  hat: number | null; // hat offset in rows (lag), or null when the hat is gone
  hem: boolean;
  dy: number;
  wound: boolean;
  burst?: boolean; // the wound bursts (hit pose)
  headDx?: number; // head snapped back, in frame px (hit pose)
  sleep?: boolean; // slept: head down on the chest, eyes shut, hat tipped forward
}

/** A standing cowboy, composed into layer L. */
function upright(L: Pix, seat: ArtSeat, i: number, o: Upright): void {
  const { front, dir } = o.look;
  const pen = new Pen(L, SEAT_X[i], FEET_Y, dir, o.dy);
  const pal = palette(seat);
  const k = o.buckle ?? 0;
  const b = o.bob + k;

  // Legs stay planted; the upper body bobs one pixel. Buckled knees push the thighs forward.
  const body = front ? S.BODY_FRONT : S.BODY_SIDE;
  if (k > 0) {
    pen.put(body, 0, 0, pal, 37, body.h);
    pen.put(body, 1, k, pal, 26, 37);
  } else pen.put(body, 0, 0, pal, 26, body.h);
  pen.put(body, 0, b, pal, 8, 26);
  // A snapped-back head moves away from the shot; a sleeping head sinks onto the chest.
  const hx = 9 + (o.headDx ?? 0) * dir;
  const sink = o.sleep ? 2 : 0;
  const head = o.sleep ? (front ? S.HEAD_FRONT_SLEEP : S.HEAD_SIDE_SLEEP) : front ? S.HEAD_FRONT : S.HEAD_SIDE;
  pen.put(head, hx, b + sink, pal);
  if (o.hem) pen.put(S.HEM, 0, 26 + b, pal);

  // Holstered gun grip.
  if (o.arms === "idle" || o.arms === "air" || o.arms === "recoil") pen.put(S.GRIP, 20, 19 + b, pal);

  switch (o.arms) {
    case "idle":
      pen.put(S.ARMS_IDLE, 4, 9 + b, pal);
      break;
    case "draw":
      pen.put(S.ARM_LEFT, 4, 9 + b, pal);
      pen.put(S.ARM_DRAW, 20, 10 + b, pal);
      break;
    case "aim": {
      pen.put(S.ARM_LEFT, 4, 9 + b, pal);
      const a = aimArm(i, seat);
      const kick = o.kick ?? 0;
      pen.put(a.s, 20 - kick, a.by - kick + b, pal);
      break;
    }
    case "recoil": {
      // Arms flung out and down from the shoulders, hands open low and wide: never up like Air.
      const c = pal.c as Ink;
      pen.limb(5, 10 + b, 0, 18 + b, c);
      pen.limb(21, 10 + b, 26, 18 + b, c);
      for (const [hx0, fx] of [
        [-3, -4],
        [27, 30],
      ] as const) {
        pen.rect(hx0, 18 + b, 3, 3, PAPER);
        pen.dot(fx, 19 + b, PAPER);
        pen.dot(hx0, 21 + b, PAPER);
        pen.dot(hx0 + 2, 21 + b, PAPER);
      }
      break;
    }
    case "air":
      break;
  }

  // Eyes turn toward the target when the gun comes out (front view).
  if (front && (o.arms === "aim" || o.arms === "draw")) {
    for (const ry of [2, 3]) {
      pen.dot(11, ry + b, PAPER);
      pen.dot(15, ry + b, PAPER);
      pen.dot(12, ry + b, SOOT);
      pen.dot(16, ry + b, SOOT);
    }
  }

  // The wound sits on the chest away from the paper shirt V; in the hit pose it bursts.
  if (o.wound && o.burst) pen.put(S.WOUND_BURST, 13, 11 + b, pal);
  else if (o.wound) pen.put(S.WOUND, 15, 13 + b, pal);

  if (o.hat !== null) pen.put(S.HAT, o.sleep ? 5 : 4, -8 + o.hat + sink, pal);

  // Hands up go in front of the hat brim.
  if (o.arms === "air") pen.put(S.ARMS_AIR, 1, -3 + b, pal);
}

// Shared scratch layers.
const FIG = new Pix(110, 90);
const ROT = new Pix(150, 110);
const HATL = new Pix(36, 36);
const BODY = new Pix(90, 44);

function figLayer(i: number): Pix {
  FIG.clear();
  FIG.place(SEAT_X[i] - 55, FEET_Y - 75);
  return FIG;
}

function clipBelow(L: Pix, y: number): void {
  const ly = y + 1 - L.oy;
  if (ly < L.h && ly >= 0) L.px.fill(NONE, ly * L.w);
}

export interface Bob {
  bob: number;
  hat: number;
  coat: number;
}

/** Idle rhythm: the body bobs on floor(frame / 6), the hat lags one beat and the coat two. */
export function rhythm(m: ArtModel, i: number): Bob {
  if (m.reduce) return { bob: 0, hat: 0, coat: 0 };
  const f = m.frame + i * 2;
  return { bob: beat(f, 0), hat: beat(f, 1), coat: beat(f, 2) };
}

/** Fall phase for a fallen seat. */
export type FallPhase = "hit" | "buckle" | "back" | "front" | "lie";

export function fallPhase(seat: ArtSeat, m: ArtModel): { phase: FallPhase; p: number } {
  const t = poseT(seat, m);
  if (t < HIT_MS) return { phase: "hit", p: 0 };
  if (t < HIT_MS + BUCKLE_MS) return { phase: "buckle", p: (t - HIT_MS) / BUCKLE_MS };
  if (t < DOWN_MS) {
    const p = (t - HIT_MS - BUCKLE_MS) / FALL_MS;
    return { phase: p < 0.3 ? "back" : "front", p };
  }
  return { phase: "lie", p: 1 };
}

/** Which way a hit body falls: away from whoever shot it (head toward dir). */
export function fallDir(i: number, seats: readonly ArtSeat[]): 1 | -1 {
  let left = 0;
  let right = 0;
  seats.forEach((s, j) => {
    if (j === i || s.aimAt !== i) return;
    if (s.pose !== "aim" && s.pose !== "fallen") return;
    if (j < i) left++;
    else right++;
  });
  if (left > 0 && right === 0) return 1;
  if (right > 0 && left === 0) return -1;
  return i === 0 ? -1 : 1;
}

/** Everything a seat shows behind its table: standing poses, the duck, the start of a fall. */
export function drawBehind(pix: Pix, i: number, seat: ArtSeat, m: ArtModel, dir: 1 | -1): void {
  const t = poseT(seat, m);
  const lk = look(i, seat);
  const r = rhythm(m, i);
  if ((seat.pose === "idle" || seat.pose === "air") && asleep(seat)) {
    const L = figLayer(i);
    // Slow breathing: the body bobs on half the idle beat.
    const slow = m.reduce ? 0 : beat(Math.floor((m.frame + i * 2) / 2), 0);
    upright(L, seat, i, { look: lk, arms: "idle", bob: slow, hat: slow, hem: false, dy: 0, wound: false, sleep: true });
    stamp(pix, L, "auto", FLOOR_Y);
    snore(pix, i, m);
    return;
  }
  switch (seat.pose) {
    case "idle": {
      const L = figLayer(i);
      upright(L, seat, i, { look: lk, arms: "idle", bob: r.bob, hat: r.hat, hem: r.coat === 1, dy: 0, wound: false });
      stamp(pix, L, "auto", FLOOR_Y);
      return;
    }
    case "air": {
      const L = figLayer(i);
      const up = m.reduce || t >= 90;
      upright(L, seat, i, {
        look: lk,
        arms: up ? "air" : "idle",
        bob: r.bob,
        hat: r.hat,
        hem: r.coat === 1,
        dy: 0,
        wound: false,
      });
      stamp(pix, L, "auto", FLOOR_Y);
      return;
    }
    case "aim": {
      const L = figLayer(i);
      const arms: Arms = m.reduce || t >= 180 ? "aim" : t >= 90 ? "draw" : "idle";
      upright(L, seat, i, { look: lk, arms, bob: 0, hat: 0, hem: false, dy: 0, wound: false, kick: kickOf(seat, m) });
      stamp(pix, L, "auto", FLOOR_Y);
      return;
    }
    case "duck": {
      const L = figLayer(i);
      const p = clamp01(t / DUCK_MS);
      if (p < 1) {
        upright(L, seat, i, { look: lk, arms: "idle", bob: 0, hat: 0, hem: false, dy: Math.round(26 * p), wound: false });
        clipBelow(L, TABLE_TOP_Y + 3);
        stamp(pix, L, "auto", FLOOR_Y);
      } else {
        // Behind the table only the hat shows, its brim lifted just over the far rim of the table
        // top, the brim ends rimmed in paper. A full contrast ring lifts it off the chair behind.
        new Pen(L, SEAT_X[i], FEET_Y, lk.dir).put(S.HAT_DUCK, 3, 17, palette(seat));
        stamp(pix, L, "contrast");
      }
      return;
    }
    case "fallen": {
      const f = fallPhase(seat, m);
      if (f.phase === "hit") falling(pix, i, seat, dir, -1, 0, HIT_TILT);
      else if (f.phase === "buckle") falling(pix, i, seat, dir, 0, 1 + Math.round(2 * f.p), lerp(HIT_TILT, BUCKLE_TILT, f.p));
      else if (f.phase === "back") falling(pix, i, seat, dir, f.p, 3, BUCKLE_TILT);
      return;
    }
    case "gone":
      return;
  }
}

/** A seat that slept through the minute: the reveal flag, or a "slept" badge on a standing seat. */
export function asleep(seat: ArtSeat): boolean {
  return seat.asleep ?? seat.badge === "slept";
}

/** Zz rising beside a sleeping head, clear of the badge card above the chair. */
function snore(pix: Pix, i: number, m: ArtModel): void {
  const cx = SEAT_X[i];
  const side = i === 2 ? -1 : 1;
  const k = m.reduce ? 1 : Math.floor(m.time / 420) % 3;
  const L = HATL;
  L.clear();
  L.place(cx + side * 8 - 18, 84);
  const pal: Pal = { k: SOOT };
  const zx = (w: number, off: number): number => (side > 0 ? cx + off : cx - off - w + 1);
  L.blit(S.Z_SMALL, zx(4, 8), 104 - k, pal);
  L.blit(S.Z_BIG, zx(5, 12), 96 - k, pal);
  stamp(pix, L, "none");
}

// Tilt of the body toward the fall during the hit pose and as the knees give (radians).
const HIT_TILT = 0.12;
const BUCKLE_TILT = 0.24;

/**
 * The fall: the hit pose (a recoil: head snaps back, arms flung out and down, the wound bursts,
 * the body tips toward the fall), the knees buckle, then the struck body rotates to the floor in
 * front of the table. p < 0 is the hit pose; `tilt` is the lean before the drop.
 */
function falling(pix: Pix, i: number, seat: ArtSeat, dir: 1 | -1, p: number, buckle: number, tilt: number): void {
  const L = figLayer(i);
  const lk = look(i, seat);
  const cx = SEAT_X[i];
  const hit = p < 0;
  upright(L, seat, i, {
    look: lk,
    arms: "recoil",
    bob: 0,
    buckle,
    hat: null,
    hem: false,
    dy: 0,
    wound: true,
    burst: hit,
    headDx: hit ? 2 * dir : dir,
  });
  const e = hit ? 0 : Math.pow(p, 1.6); // tips slowly, then drops
  const slide = hit ? 0 : p * p; // the feet slide forward late in the fall
  // jerk one pixel away from the shot in the hit pose
  const qx = Math.round(lerp(cx, cx - dir * 9, slide)) + (hit ? dir : 0);
  const qy = Math.round(lerp(FEET_Y, FALLEN_TOP_Y + 4, slide));
  ROT.clear();
  ROT.place(qx - 75, qy - 60);
  rotate(L, ROT, dir * lerp(tilt, Math.PI / 2, e), cx, FEET_Y, qx, qy);
  stamp(pix, ROT);
}

/** Pool, body on the floor, dropped gun and landed hat: everything in front of the tables. */
export function drawFront(pix: Pix, i: number, seat: ArtSeat, m: ArtModel, dir: 1 | -1): void {
  if (seat.pose !== "fallen") return;
  const f = fallPhase(seat, m);
  if (f.phase === "front") falling(pix, i, seat, dir, f.p, 3, BUCKLE_TILT);
  if (f.phase === "lie") {
    const t = poseT(seat, m);
    const g = m.reduce ? 1 : Math.pow(clamp01((t - DOWN_MS) / POOL_MS), 0.55);
    pool(pix, i, dir, g);
    lying(pix, i, seat, dir);
  }
  const h = hatFlight(i, seat, m, dir);
  if (h.landed) {
    HATL.clear();
    HATL.place(h.x, h.y);
    HATL.blit(S.HAT, h.x, h.y, palette(seat), dir > 0);
    clearFloor(pix, HATL);
    stamp(pix, HATL);
  }
}

/** Two fingertips of a ducked seat on the far rim of its table (drawn over the table). */
export function drawDuckHands(pix: Pix, i: number, seat: ArtSeat, m: ArtModel): void {
  if (seat.pose !== "duck" || poseT(seat, m) < DUCK_MS) return;
  const cx = SEAT_X[i];
  const L = HATL;
  L.clear();
  L.place(cx - 18, TABLE_TOP_Y - 6);
  for (const fx of [cx - 9, cx + 7]) L.rect(fx, TABLE_TOP_Y - 1, 2, 2, PAPER);
  stamp(pix, L, SOOT);
}

/**
 * Erase the soot floor-board seams and shadow dither within 2 px of a layer's ink (its outline
 * ring is the third pixel), so no board line touches a body or a hat on the floor.
 */
function clearFloor(pix: Pix, L: Pix, pad = 3): void {
  const bg = background();
  for (let ly = 0; ly < L.h; ly++)
    for (let lx = 0; lx < L.w; lx++) {
      if (L.px[ly * L.w + lx] === NONE) continue;
      const gx = L.ox + lx;
      const gy = L.oy + ly;
      for (let dy = -pad; dy <= pad; dy++) {
        const y = gy + dy;
        if (y < FLOOR_Y || y >= RUG_Y) continue;
        for (let dx = -pad; dx <= pad; dx++) {
          const x = gx + dx;
          if (x < FRAME || x >= W - FRAME) continue;
          if (bg.get(x, y) === SOOT && pix.get(x, y) === SOOT) pix.set(x, y, PAPER);
        }
      }
    }
}

/** Frame x of a lying-body local column (local 0 is the crown of the head). */
function lyingX(i: number, dir: 1 | -1, lx: number, w = 1): number {
  const cx = SEAT_X[i];
  return dir < 0 ? cx - 39 + lx : cx + 39 - lx - w + 1;
}

function pool(pix: Pix, i: number, dir: 1 | -1, g: number): void {
  // Under the body: it spreads from beneath the torso and shows below its lower edge and past the
  // hips, never over the coat (the body is drawn on top with its paper outline).
  const cx = lyingX(i, dir, 23);
  const cy = FALLEN_TOP_Y + 9;
  const rx = Math.round(lerp(8, 23, g));
  const ry = Math.round(lerp(2, 5, g));
  pix.ellipse(cx, cy, rx, ry, RUST);
  // a tongue running toward us under the chest, and a wet glint
  if (g > 0.3) pix.ellipse(lyingX(i, dir, 18), cy + 3, Math.round(lerp(2, 7, g)), Math.max(1, Math.round(2 * g)), RUST);
  if (g > 0.6) {
    const gx = lyingX(i, dir, 30);
    pix.set(gx, cy + ry - 1, PAPER);
    pix.set(gx + 1, cy + ry - 1, PAPER);
  }
}

/**
 * The body on the floor, on its back: paper head with the cross eye at one end, boots with paper
 * soles at the other, one arm thrown up the boards, wound on the chest. A full outline (soot
 * on the paper boards, paper chalk on the rust pool) keeps every coat apart from the floor.
 */
function lying(pix: Pix, i: number, seat: ArtSeat, dir: 1 | -1): void {
  const L = BODY;
  const top = FALLEN_TOP_Y;
  L.clear();
  L.place(SEAT_X[i] - 45, top - 12);
  const pal = palette(seat);
  const c = coatInk(seat.coat);
  const X = (lx: number, w = 1): number => lyingX(i, dir, lx, w);
  const rect = (lx: number, ly: number, w: number, h: number, ink: Ink): void => L.rect(X(lx, w), top + ly, w, h, ink);
  const put = (s: Sprite, lx: number, ly: number): void => L.blit(s, X(lx, s.w), top + ly, pal, dir > 0);
  const limb = (x0: number, y0: number, x1: number, y1: number, ink: Ink): void => {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let k = 0; k <= n; k++) rect(Math.round(lerp(x0, x1, k / n)) - 1, Math.round(lerp(y0, y1, k / n)) - 1, 3, 3, ink);
  };

  const seam = pal.l as Ink; // soot on rust and felt coats, felt on the soot coat
  // Torso on its back, rounded shoulders and hips.
  rect(13, 0, 16, 9, c);
  for (const [lx, ly] of [
    [13, 0],
    [28, 0],
    [13, 8],
    [28, 8],
  ] as const)
    rect(lx, ly, 1, 1, NONE);
  // Shirt V open at the neck, a lapel seam and one fold.
  rect(13, 1, 4, 1, PAPER);
  rect(13, 2, 2, 1, PAPER);
  rect(17, 1, 1, 1, seam);
  rect(15, 2, 1, 1, seam);
  rect(13, 3, 2, 1, seam);
  rect(18, 6, 4, 1, seam);
  rect(26, 2, 1, 4, seam);
  // Bandana at the neck.
  rect(12, 1, 1, 7, pal.n as Ink);
  // Belt, buckle, the round when the chair kept its bullet.
  rect(29, 0, 2, 9, SOOT);
  rect(29, 2, 2, 3, PAPER);
  rect(29, 3, 1, 1, SOOT);
  if (seat.bullet) rect(29, 6, 2, 1, RUST);
  // Coat tails spread on the floor.
  rect(31, -1, 3, 10, c);
  rect(32, 3, 1, 3, seam);
  // Two legs out straight, a little apart: filled felt trousers (they read on the dark boards),
  // a soot crease between them and a soot break at the hips.
  rect(34, 0, 1, 9, SOOT);
  rect(35, 0, 9, 3, FELT);
  rect(35, 3, 9, 1, SOOT);
  rect(35, 4, 9, 4, FELT);
  rect(38, 1, 3, 1, SOOT);
  rect(39, 5, 3, 1, SOOT);
  // Boots toes up at the far end, paper soles and spurs: it reads as feet.
  rect(44, -1, 2, 4, SOOT);
  rect(46, -3, 2, 6, SOOT);
  rect(48, -3, 1, 6, PAPER);
  rect(44, 4, 2, 4, SOOT);
  rect(46, 2, 2, 7, SOOT);
  rect(48, 2, 1, 7, PAPER);
  rect(43, 8, 1, 1, PAPER);
  // One arm flung out toward us from the shoulder, hand open on the boards.
  limb(17, 7, 20, 11, c);
  rect(19, 12, 3, 3, PAPER);
  rect(18, 15, 1, 1, PAPER);
  rect(20, 15, 1, 1, PAPER);
  rect(22, 13, 1, 1, PAPER);
  // Head on the floor, face up, cross eye.
  put(S.DEAD_HEAD, 0, -1);
  // The wound on the chest, away from the shirt V: soot hole, paper ring, rust drip.
  // (never mirrored: the drip always runs the same way down the screen)
  L.blit(S.WOUND, X(20, S.WOUND.w), top, pal, false);
  // The revolver the shooter dropped, on the floor in front.
  if (seat.aimAt !== null) put(S.GUN_FLOOR, GUN_LX, 11);
  // Clear the board lines near the body, then a full outline: a soot ink line on the paper boards,
  // a paper chalk line on the rust pool and wherever the body touches anything dark.
  clearFloor(pix, L);
  stamp(pix, L, "chalk");
}

/** Local column of the revolver a hit shooter dropped: on the boards below the head. */
const GUN_LX = 2;

/** Frame box of a body on the floor (head, flung arm and hand, boots, dropped gun, outline). */
export function lyingBounds(i: number, dir: 1 | -1): { x: number; y: number; w: number; h: number } {
  const a = lyingX(i, dir, 0);
  const b = lyingX(i, dir, 48);
  return { x: Math.min(a, b) - 1, y: FALLEN_TOP_Y - 5, w: Math.abs(b - a) + 3, h: 23 };
}

/** Where a seat's revolver fired from (its aimed muzzle), whatever pose it is in now. */
export function shotPoint(i: number, seat: ArtSeat): { x: number; y: number; dir: 1 | -1 } {
  const dir: 1 | -1 = i === 0 ? 1 : i === 2 ? -1 : seat.aimAt === 0 ? -1 : 1;
  const a = aimArm(i, seat);
  const bx = 20 + a.mz.x;
  const cx = SEAT_X[i];
  return { x: dir > 0 ? cx - 13 + bx : cx + 13 - bx, y: FEET_Y - 47 + a.by + a.mz.y, dir };
}

/** Where a shot at seat t ends: on the chest when it hits, else over the hat into the wall. */
export function shotEnd(from: number, t: number, struck: boolean): { x: number; y: number } {
  const dir = t > from ? 1 : -1;
  const cx = SEAT_X[t];
  if (struck) return { x: cx - dir * 5, y: FEET_Y - 47 + 14 };
  return { x: cx + dir * 16, y: FEET_Y - 47 - 14 };
}

export interface HatState {
  x: number;
  y: number;
  angle: number;
  landed: boolean;
}

/** How far the landed hat lies from the head (rows between the hat's brim and the crown). */
export const HAT_GAP = 11;

/**
 * The hat flies off the head in a low arc that stays in the seat's own column and lands on the
 * boards just above the head of the body (up the floor, behind it), HAT_GAP px from the head.
 */
export function hatFlight(i: number, seat: ArtSeat, m: ArtModel, dir: 1 | -1): HatState {
  const cx = SEAT_X[i];
  const x0 = cx - 9;
  const y0 = FEET_Y - 55;
  const x1 = lyingX(i, dir, 5) - 9;
  const y1 = FALLEN_TOP_Y - 1 - HAT_GAP - S.HAT.h;
  const t = poseT(seat, m);
  const p = clamp01(t / HAT_MS);
  if (p >= 1) return { x: x1, y: y1, angle: 0, landed: true };
  const arc = -6 * 4 * p * (1 - p);
  return {
    x: Math.round(lerp(x0, x1, 1 - (1 - p) * (1 - p))),
    y: Math.round(lerp(y0, y1, p * p) + arc),
    angle: dir * Math.PI * 2 * (1 - (1 - p) * (1 - p)),
    landed: false,
  };
}

/** The hat (and a hit shooter's revolver) in the air; the scene draws the badges over them. */
export function drawHatFlight(pix: Pix, i: number, seat: ArtSeat, m: ArtModel, dir: 1 | -1): void {
  if (seat.pose !== "fallen" || m.reduce) return;
  drawGunFlight(pix, i, seat, m, dir);
  const h = hatFlight(i, seat, m, dir);
  if (h.landed) return;
  const src = HATL;
  src.clear();
  src.place(h.x, h.y);
  src.blit(S.HAT, h.x, h.y, palette(seat), dir > 0);
  const cxh = h.x + 9;
  const cyh = h.y + 5;
  ROT.clear();
  ROT.place(cxh - 20, cyh - 20);
  rotate(src, ROT, h.angle, cxh, cyh, cxh, cyh);
  stamp(pix, ROT);
}

/** Muzzle of an aiming seat's revolver in frame coordinates, or null while holstered. */
export function muzzleOf(i: number, seat: ArtSeat, m: ArtModel): { x: number; y: number; dir: 1 | -1 } | null {
  if (seat.pose !== "aim") return null;
  const t = poseT(seat, m);
  if (t < 90) return null;
  const lk = look(i, seat);
  let bx: number;
  let by: number;
  if (t < 180 && !m.reduce) {
    bx = 20 + S.DRAW_MUZZLE.x;
    by = 10 + S.DRAW_MUZZLE.y;
  } else {
    const a = aimArm(i, seat);
    const kick = kickOf(seat, m);
    bx = 20 - kick + a.mz.x;
    by = a.by - kick + a.mz.y;
  }
  const cx = SEAT_X[i];
  return { x: lk.dir > 0 ? cx - 13 + bx : cx + 13 - bx, y: FEET_Y - 47 + by, dir: lk.dir };
}

/** A dust cloud and speed lines where a runner left the chair, for half a second. */
export function drawGoneDust(pix: Pix, i: number, seat: ArtSeat, m: ArtModel): void {
  if (seat.pose !== "gone" || m.reduce) return;
  const t = Math.max(0, seat.t);
  if (t > 520) return;
  const p = t / 520;
  const cx = SEAT_X[i];
  const out = i === 0 ? -1 : 1; // the side the runner went
  const L = HATL;
  L.clear();
  L.place(cx - 18, FEET_Y - 48);
  const r = Math.max(1, Math.round(1 + 4 * Math.sin(p * Math.PI)));
  const drift = Math.round(out * 6 * p);
  L.disc(cx - 5 + drift, FEET_Y - 26, r, PAPER);
  L.disc(cx + 4 + drift, FEET_Y - 29, Math.max(1, r - 1), PAPER);
  L.disc(cx + drift, FEET_Y - 35, Math.max(1, r - 2), PAPER);
  stamp(pix, L, SOOT);
  // speed lines toward the side the runner went
  const len = Math.round(14 * (1 - p));
  for (const [k, dy] of [
    [0, -34],
    [1, -29],
    [2, -24],
  ] as const) {
    if (len < 2) break;
    const x0 = cx + out * (10 + k * 2);
    pix.hline(x0, x0 + out * (len - k * 3), FEET_Y + dy, SOOT);
  }
}

/** A hit shooter's revolver flies out of the hand, spins and lands where the body will lie. */
function drawGunFlight(pix: Pix, i: number, seat: ArtSeat, m: ArtModel, dir: 1 | -1): void {
  if (seat.aimAt === null) return;
  const t = poseT(seat, m);
  if (t >= DOWN_MS) return;
  const p = t / DOWN_MS;
  const from = shotPoint(i, seat);
  const fdir = dir > 0;
  const x1 = lyingX(i, dir, GUN_LX, S.GUN_FLOOR.w);
  const y1 = FALLEN_TOP_Y + 11;
  const x = Math.round(lerp(from.x - 4, x1, p));
  const y = Math.round(lerp(from.y - 2, y1, p * p) - 10 * 4 * p * (1 - p));
  const src = HATL;
  src.clear();
  src.place(x - 4, y - 2);
  src.blit(S.GUN, x - 4, y - 2, palette(seat), fdir);
  ROT.clear();
  ROT.place(x - 20, y - 20);
  rotate(src, ROT, -dir * Math.PI * 3 * p, x, y, x, y);
  stamp(pix, ROT);
}

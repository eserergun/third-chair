// Visual self-check gallery for the saloon renderer. Open /third-chair/dev/art.html with the Vite
// dev server, or run scripts/art-shots.ts to save every canvas as a 3x PNG in scratch/art/.

import judge from "../fixtures/judge.json";
import type { ArtModel, ArtSeat, Badge, Coat, Pose } from "../src/art/model";
import { H, W } from "../src/art/model";
import { REVEAL_MS, minuteSeats, revealSeats, type MinuteState, type RevealCard, type RevealHand, type SeatBase } from "../src/art/reveal";
import { drawScene } from "../src/art/scene";

const SCALE = 3;
const COATS: readonly Coat[] = ["rust", "felt", "soot"];
const gallery = document.getElementById("gallery") as HTMLElement;

type Trio<T> = [T, T, T];

function model(seats: Trio<ArtSeat>, extra: Partial<ArtModel> = {}): ArtModel {
  return {
    frame: 0,
    time: 0,
    reduce: false,
    seats,
    purse: -1,
    purseT: 0,
    smoke: false,
    quiet: false,
    panel: 0,
    second: 42,
    urgent: false,
    caption: null,
    ...extra,
  };
}

function section(title: string, note?: string): HTMLElement {
  const h = document.createElement("h2");
  h.textContent = title;
  gallery.append(h);
  if (note) {
    const p = document.createElement("p");
    p.className = "note";
    p.textContent = note;
    gallery.append(p);
  }
  return gallery;
}

function add(name: string, label: string, m: ArtModel): void {
  const fig = document.createElement("figure");
  const cap = document.createElement("figcaption");
  cap.textContent = `${name}: ${label}`;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  canvas.dataset.name = name;
  canvas.style.width = `${W * SCALE}px`;
  canvas.style.height = `${H * SCALE}px`;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  drawScene(ctx, m);
  checkInks(name, ctx);
  fig.append(cap, canvas);
  gallery.append(fig);
}

const INKS = new Set(["20,12,8", "231,215,177", "184,67,47", "47,74,60"]);
const offPalette: string[] = [];

/** Count pixels outside the four inks (should always be zero). */
function checkInks(name: string, ctx: CanvasRenderingContext2D): void {
  const d = ctx.getImageData(0, 0, W, H).data;
  let bad = 0;
  for (let k = 0; k < d.length; k += 4) if (d[k + 3] !== 255 || !INKS.has(`${d[k]},${d[k + 1]},${d[k + 2]}`)) bad++;
  if (bad > 0) offPalette.push(`${name}: ${bad} px`);
}

/** Zoomed contact sheet: crops of several regions of one frame, side by side. */
function zoom(name: string, label: string, m: ArtModel, crops: [number, number, number, number][], scale: number): void {
  const off = document.createElement("canvas");
  off.width = W;
  off.height = H;
  const octx = off.getContext("2d");
  if (!octx) throw new Error("no 2d context");
  drawScene(octx, m);
  checkInks(name, octx);
  const gap = 2;
  const width = crops.reduce((s, c) => s + c[2], 0) + gap * (crops.length - 1);
  const height = Math.max(...crops.map((c) => c[3]));
  const fig = document.createElement("figure");
  const cap = document.createElement("figcaption");
  cap.textContent = `${name}: ${label}`;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.dataset.name = name;
  canvas.style.width = `${width * scale}px`;
  canvas.style.height = `${height * scale}px`;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#2f4a3c";
  ctx.fillRect(0, 0, width, height);
  let x = 0;
  for (const [cx, cy, cw, ch] of crops) {
    ctx.drawImage(off, cx, cy, cw, ch, x, 0, cw, ch);
    x += cw + gap;
  }
  fig.append(cap, canvas);
  gallery.append(fig);
}

function seatCrops(half: number, y0: number, y1: number): [number, number, number, number][] {
  return [72, 192, 312].map((cx) => [cx - half, y0, half * 2, y1 - y0]);
}

function base(names: Trio<string>, house: Trio<boolean>, you: number): SeatBase[] {
  return names.map((name, i) => ({ name, house: house[i], coat: COATS[i], bullet: true, you: i === you }));
}

// ---------------------------------------------------------------------------------------------
// A: the idle table.

section("A. Idle table", "Watch mode: Cal, Ivy and Ned, house, one bullet each. Frames 0, 6, 12 and 18 show the bob with the hat one beat behind and the coat two.");
const house = base(["Cal", "Ivy", "Ned"], [true, true, true], -1);
const thinking: MinuteState[] = ["thinking", "thinking", "thinking"];
for (const f of [0, 6, 12, 18]) {
  add(`a-idle-f${f}`, `idle house table, frame ${f}`, model(minuteSeats(house, thinking), { frame: f, time: f * 80, second: 12 + f }));
}
const live = base(["Wes", "Ivy", "Ned"], [false, true, true], 0);
add(
  "a-live-urgent",
  "live minute: Wes (you) shown Air by open play, Ivy face down, Ned thinking; last ten seconds, caption",
  model(minuteSeats(live, ["air", "down", "thinking"]), { frame: 3, time: 3 * 80, second: 53, urgent: true, caption: "PRACTICE TABLE" }),
);
add(
  "a-long-caption",
  "a long caption wraps clear of the watch; Cal and Ned house, a player in the middle",
  model(minuteSeats(base(["Cal", "Pearl II", "Ned"], [true, false, true], 1), ["thinking", "down", "thinking"]), {
    frame: 9,
    time: 720,
    second: 7,
    caption: "Practice table. Nothing here touches the chain.",
  }),
);
add(
  "a-live-urgent-blink",
  "same, the watch face blinks back to paper",
  model(minuteSeats(live, ["iron", "table", "down"]), { frame: 4, time: 260, second: 54, urgent: true }),
);

// ---------------------------------------------------------------------------------------------
// B: every pose for every coat.

section("B. Poses", "Each pose drawn for all three seats; the three canvases per pose rotate the coats so every coat appears in every seat (facing right, front, facing left).");

const BADGES: Record<Pose, Trio<Badge>> = {
  idle: ["thinking", "down", "thinking"],
  air: ["air", "slept", "air"],
  aim: ["iron", "iron", "iron"],
  duck: ["table", "table", "table"],
  fallen: ["iron", "air", "ran"],
  gone: ["ran", "ran", "ran"],
};
const AIM: Trio<0 | 1 | 2 | null> = [1, 2, 1];
const POSES: { key: string; pose: Pose; firing?: boolean; t: number; label: string }[] = [
  { key: "idle", pose: "idle", t: 0, label: "idle" },
  { key: "air", pose: "air", t: 2000, label: "air: hands open and up (the middle seat has a slept badge: head down, Zz)" },
  { key: "aim", pose: "aim", t: 2000, label: "aim: seat 0 at 1, seat 1 at 2, seat 2 at 1" },
  { key: "fire", pose: "aim", firing: true, t: 470, label: "aim and firing: muzzle flash" },
  { key: "duck", pose: "duck", t: 2000, label: "duck behind the table: only the hat shows" },
  { key: "fallen", pose: "fallen", t: 3000, label: "fallen: on the floor, cross eyes, wound, pool, hat apart" },
  { key: "gone", pose: "gone", t: 2000, label: "gone: empty chair, face-down card on it" },
];
function poseModel(p: (typeof POSES)[number], r: number): { coats: Coat[]; m: ArtModel } {
  const coats = [0, 1, 2].map((i) => COATS[(i + r) % 3]);
  const seats = [0, 1, 2].map(
    (i): ArtSeat => ({
      name: ["Cal", "Ivy", "Ned"][i],
      house: i !== 1,
      coat: coats[i],
      pose: p.pose,
      t: p.t,
      aimAt: p.pose === "aim" || (p.pose === "fallen" && i === 0) ? AIM[i] : null,
      firing: p.firing === true,
      bullet: p.pose !== "aim",
      badge: BADGES[p.pose][i],
      you: i === 1,
      winner: p.pose === "air" && i === 0,
    }),
  ) as Trio<ArtSeat>;
  return { coats, m: model(seats, { frame: 5, time: 1234, smoke: p.pose === "aim" }) };
}

for (const p of POSES) {
  for (let r = 0; r < 3; r++) {
    const { coats, m } = poseModel(p, r);
    add(`b-${p.key}-${coats.join("-")}`, `${p.label}; coats ${coats.join(", ")}`, m);
  }
}

// ---------------------------------------------------------------------------------------------
// C and D: reveal sequences.

const CODE: Record<RevealCard, number> = { air: 0, iron: 1, table: 2, ran: 3, slept: 4 };

interface Case {
  cards: number[];
  targets: number[];
  hit: boolean[];
  winner: number;
}

function judged(cards: RevealCard[], targets: (number | null)[], players: boolean[]): RevealHand {
  const codes = cards.map((c) => CODE[c]);
  const tg = targets.map((t, i) => (cards[i] === "iron" && t !== null ? t : 255));
  const c = (judge.cases as Case[]).find((k) => k.cards.every((v, i) => v === codes[i]) && k.targets.every((v, i) => v === tg[i]));
  if (!c) throw new Error(`no judge case for ${cards.join(",")}`);
  const winner = c.winner === 3 ? null : (c.winner as 0 | 1 | 2);
  return { cards, targets, hit: c.hit, winner, purseMoves: winner !== null && players[winner] };
}

interface Scenario {
  key: string;
  label: string;
  names: Trio<string>;
  house: Trio<boolean>;
  you: number;
  cards: RevealCard[];
  targets: (number | null)[];
}

const SCENARIOS: Scenario[] = [
  {
    key: "mutual",
    label: "mutual shootout: Wes iron at Ivy, Ivy iron at Wes, Ned table",
    names: ["Wes", "Ivy", "Ned"],
    house: [false, true, true],
    you: 0,
    cards: ["iron", "iron", "table"],
    targets: [1, 0, null],
  },
  {
    key: "winner",
    label: "one winner: Wes iron at Ivy (hit), Ivy air, Ned table; Wes takes the purse",
    names: ["Wes", "Ivy", "Ned"],
    house: [false, true, true],
    you: 0,
    cards: ["iron", "air", "table"],
    targets: [1, null, null],
  },
  {
    key: "allair",
    label: "all air: a quiet minute, nobody is paid",
    names: ["Cal", "Ada", "Ned"],
    house: [true, false, true],
    you: 1,
    cards: ["air", "air", "air"],
    targets: [null, null, null],
  },
  {
    key: "circle",
    label: "circle of shots: 0 at 1, 1 at 2, 2 at 0; all three on the floor",
    names: ["Cal", "Ivy", "Rhett"],
    house: [true, true, false],
    you: 2,
    cards: ["iron", "iron", "iron"],
    targets: [1, 2, 0],
  },
  {
    key: "ranhit",
    label: "ran: Kit sealed and ran, Ned shoots Kit, Cal table; Ned takes the minute for the house",
    names: ["Cal", "Kit", "Ned"],
    house: [true, false, true],
    you: 1,
    cards: ["table", "ran", "iron"],
    targets: [null, null, 1],
  },
  {
    key: "slept",
    label: "slept winner: Mae slept (plays as air), Ivy and Ned table; Mae takes the purse",
    names: ["Mae", "Ivy", "Ned"],
    house: [false, true, true],
    you: 0,
    cards: ["slept", "table", "table"],
    targets: [null, null, null],
  },
  {
    key: "ranaway",
    label: "ran away: June ran and was not hit (gone), Ivy shoots Ned (air)",
    names: ["June", "Ivy", "Ned"],
    house: [false, true, true],
    you: 0,
    cards: ["ran", "iron", "air"],
    targets: [null, 2, null],
  },
  {
    key: "far",
    label: "far shots: Wes iron at Ned, Ned iron at Wes, Ivy air in the middle; both ends fall",
    names: ["Wes", "Ivy", "Ned"],
    house: [false, true, true],
    you: 0,
    cards: ["iron", "air", "iron"],
    targets: [2, null, 0],
  },
  {
    key: "miss",
    label: "miss: Wes iron at Ivy, Ivy table (the shot goes over the hat into the wall), Ned air",
    names: ["Wes", "Ivy", "Ned"],
    house: [false, true, true],
    you: 0,
    cards: ["iron", "table", "air"],
    targets: [1, null, null],
  },
];

const TIMES = [0, 300, 460, 600, 900, 1400, 3000];

function revealModel(s: Scenario, ms: number, reduce: boolean): ArtModel {
  const players = s.house.map((h) => !h);
  const hand = judged(s.cards, s.targets, players);
  const r = revealSeats(base(s.names, s.house, s.you), hand, ms, reduce);
  return model(r.seats, {
    frame: reduce ? 0 : Math.floor(ms / 80),
    time: 20000 + ms,
    reduce,
    purse: r.purse,
    purseT: r.purseT,
    smoke: r.smoke,
    quiet: r.quiet,
    panel: r.panel,
    second: 0,
  });
}

section("C. Reveal sequences", `Each hand at ${TIMES.join(", ")} ms (REVEAL_MS is ${REVEAL_MS}). Beat one to 700 ms: draws, flips, flash. Then results.`);
for (const s of SCENARIOS) {
  for (const ms of TIMES) add(`c-${s.key}-${String(ms).padStart(4, "0")}`, `${s.label}; ${ms} ms`, revealModel(s, ms, false));
}
// The fall itself, frame by frame, for the mutual shootout.
for (const ms of [700, 790, 850, 920, 1050, 1300]) add(`c-fall-${String(ms).padStart(4, "0")}`, `mutual shootout, the fall at ${ms} ms`, revealModel(SCENARIOS[0], ms, false));
// The purse slide for the winner.
for (const ms of [1200, 1400, 1600, 1900]) add(`c-purse-${String(ms).padStart(4, "0")}`, `one winner, purse slide at ${ms} ms`, revealModel(SCENARIOS[1], ms, false));

section("D. Reduced motion", "The same final frames (3000 ms) with reduced motion, plus the very first frame (0 ms), which must already show the final poses.");
for (const s of SCENARIOS) {
  add(`d-${s.key}-final`, `${s.label}; reduced motion, 3000 ms`, revealModel(s, 3000, true));
  add(`d-${s.key}-start`, `${s.label}; reduced motion, 0 ms`, revealModel(s, 0, true));
}

section("Z. Close-ups", "Zoomed crops of the same frames, for checking pixels.");
for (const p of POSES) {
  const { m } = poseModel(p, 0);
  if (p.pose === "fallen") zoom(`z-${p.key}`, p.label, m, seatCrops(62, 150, 200), 4);
  else zoom(`z-${p.key}`, p.label, m, seatCrops(40, 76, 200), 5);
}
{
  const { m } = poseModel(POSES[0], 0);
  zoom("z-props", "window, shelf, lamps, watch, tagline", m, [[222, 38, 82, 68], [86, 52, 82, 44], [104, 6, 32, 40], [168, 6, 48, 42], [12, 36, 38, 44], [340, 38, 30, 34], [282, 6, 96, 14]], 5);
}
{
  const { m } = poseModel(POSES[5], 0);
  zoom("z-body", "one body on the floor, close", m, [[8, 156, 90, 34], [150, 156, 92, 34]], 8);
}
zoom(
  "z-hud",
  "caption, urgent watch, badges: air, face down, thinking / iron, table, down",
  model(minuteSeats(live, ["air", "down", "thinking"]), { frame: 3, time: 3 * 80, second: 53, urgent: true, caption: "PRACTICE TABLE" }),
  [[6, 6, 80, 22], [170, 6, 44, 42], [56, 74, 32, 30], [176, 74, 32, 30], [296, 74, 32, 30]],
  6,
);
zoom(
  "z-badges",
  "badges: iron (aiming right), table, ran, slept, air",
  model(
    [
      { ...minuteSeats(live, ["iron", "table", "down"])[0], badge: "iron", aimAt: 2 },
      { ...minuteSeats(live, ["iron", "table", "down"])[1], badge: "ran" },
      { ...minuteSeats(live, ["iron", "table", "down"])[2], badge: "slept" },
    ],
    { frame: 0 },
  ),
  [[62, 80, 20, 20], [182, 80, 20, 20], [302, 80, 20, 20]],
  8,
);
zoom(
  "z-badges-1x",
  "badges at 1x: iron, table, down / ran, slept, air",
  model(
    [
      { ...minuteSeats(live, ["iron", "table", "down"])[0], badge: "iron", aimAt: 2 },
      { ...minuteSeats(live, ["iron", "table", "down"])[1], badge: "table" },
      { ...minuteSeats(live, ["iron", "table", "down"])[2], badge: "down" },
    ],
    { frame: 0 },
  ),
  [[62, 80, 20, 20], [182, 80, 20, 20], [302, 80, 20, 20]],
  1,
);
zoom("z-reveal-mutual", "mutual shootout at 3000 ms", revealModel(SCENARIOS[0], 3000, false), seatCrops(62, 76, 202), 4);
zoom("z-shot-far", "far shots at 600 ms: tracers, sparks, raised arms", revealModel(SCENARIOS[7], 600, false), seatCrops(62, 76, 202), 4);
zoom("z-shot-near", "mutual near shots at 600 ms", revealModel(SCENARIOS[0], 600, false), seatCrops(62, 76, 202), 4);
zoom("z-shot-miss", "miss at 600 ms and the hole at 3000 ms", revealModel(SCENARIOS[8], 600, false), seatCrops(62, 76, 202), 4);
zoom("z-miss-final", "miss at 3000 ms: the duck, its fingertips, the hole in the wall", revealModel(SCENARIOS[8], 3000, false), seatCrops(62, 76, 202), 4);
zoom("z-hit-pose", "far shots at 790 ms: hit pose, arms up, gun flying, knees", revealModel(SCENARIOS[7], 790, false), seatCrops(62, 76, 202), 4);
zoom("z-reveal-far", "far shots at 3000 ms", revealModel(SCENARIOS[7], 3000, false), seatCrops(62, 76, 202), 4);
zoom(
  "z-smoke",
  "gun smoke after the shot at 900, 1400, 2000 and 2600 ms",
  revealModel(SCENARIOS[4], 900, false),
  [[262, 80, 50, 46]],
  6,
);
for (const ms of [1400, 2000, 2600]) zoom(`z-smoke-${ms}`, `gun smoke at ${ms} ms`, revealModel(SCENARIOS[4], ms, false), [[262, 80, 50, 46]], 6);
zoom("z-reveal-ranaway", "ran away at 3000 ms", revealModel(SCENARIOS[6], 3000, false), seatCrops(62, 76, 202), 4);
zoom("z-slept-0600", "slept at 600 ms (beat one): Mae head down with Zz, never open hands", revealModel(SCENARIOS[5], 600, false), seatCrops(40, 76, 170), 5);
zoom("z-slept-3000", "slept winner at 3000 ms: Zz clear of the stars and the badge", revealModel(SCENARIOS[5], 3000, false), seatCrops(40, 76, 170), 5);
for (const ms of [720, 800, 880]) {
  zoom(`z-hit-${ms}`, `far shots at ${ms} ms: the recoil (head back, arms out and down, wound burst, tipping)`, revealModel(SCENARIOS[7], ms, false), [[30, 90, 84, 72], [270, 90, 84, 72]], 5);
}
zoom("z-impact", "far shots at 460 ms: impact burst only around the muzzles", revealModel(SCENARIOS[7], 460, false), [[6, 6, 372, 204]], 2);
zoom("z-body-1x", "bodies at real size (1x): circle of shots at 3000 ms", revealModel(SCENARIOS[3], 3000, false), [[6, 140, 372, 70]], 1);
zoom("z-body-2x", "bodies at 2x: circle of shots at 3000 ms", revealModel(SCENARIOS[3], 3000, false), [[6, 140, 372, 70]], 2);
for (const ms of [800, 1000, 1200]) {
  zoom(`z-hat-${ms}`, `hats in flight at ${ms} ms (circle): each in its own column, under the badges`, revealModel(SCENARIOS[3], ms, false), [[6, 76, 372, 100]], 2);
}

document.body.dataset.offPalette = JSON.stringify(offPalette);
document.body.dataset.ready = "1";

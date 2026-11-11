import { describe, expect, it } from "vitest";
import judge from "../../fixtures/judge.json";
import { drawBehind, drawFront, fallDir, hatFlight, lyingBounds, shotEnd, shotPoint } from "./figure";
import { tracer } from "./fx";
import { measure, text } from "./font";
import { BADGE_Y, FALLEN_TOP_Y, FEET_Y, PLATE_Y, SEAT_X, TABLE_TOP_Y } from "./layout";
import { H, INK, W, type ArtModel, type ArtSeat } from "./model";
import { NONE, PAPER, Pix, RUST, rectCount } from "./pix";
import {
  BEAT_MS,
  FLASH_FROM,
  FLASH_TO,
  PURSE_FROM,
  REVEAL_MS,
  minuteSeats,
  revealSeats,
  type RevealCard,
  type RevealHand,
  type SeatBase,
} from "./reveal";
import { FAR_SHOT_PEAK, drawScene, renderScene } from "./scene";
import { DEAD_HEAD, WOUND } from "./sprites";

const BASE: SeatBase[] = [
  { name: "Wes", house: false, coat: "rust", bullet: true, you: true },
  { name: "Ivy", house: true, coat: "felt", bullet: true, you: false },
  { name: "Ned", house: true, coat: "soot", bullet: true, you: false },
];

const CARDS: RevealCard[] = ["air", "iron", "table", "ran", "slept"];

interface Case {
  cards: number[];
  targets: number[];
  hit: boolean[];
  winner: number;
}

function handOf(c: Case): RevealHand {
  const winner = c.winner === 3 ? null : (c.winner as 0 | 1 | 2);
  return {
    cards: c.cards.map((k) => CARDS[k]),
    targets: c.targets.map((t) => (t === 255 ? null : t)),
    hit: c.hit,
    winner,
    purseMoves: winner === 0,
  };
}

function find(cards: RevealCard[], targets: (number | null)[]): RevealHand {
  const codes = cards.map((c) => CARDS.indexOf(c));
  const tg = targets.map((t) => (t === null ? 255 : t));
  const c = (judge.cases as Case[]).find((k) => k.cards.every((v, i) => v === codes[i]) && k.targets.every((v, i) => v === tg[i]));
  if (!c) throw new Error("no judge case");
  return handOf(c);
}

function frameOf(r: ReturnType<typeof revealSeats>, ms: number, reduce: boolean): ArtModel {
  return {
    frame: reduce ? 0 : Math.floor(ms / 80),
    time: ms,
    reduce,
    seats: r.seats,
    purse: r.purse,
    purseT: r.purseT,
    smoke: r.smoke,
    quiet: r.quiet,
    panel: r.panel,
    second: 0,
    urgent: false,
    caption: null,
  };
}

describe("reveal timeline", () => {
  const mutual = find(["iron", "iron", "table"], [1, 0, null]);

  it("holds about 3.4 s", () => {
    expect(REVEAL_MS).toBeGreaterThanOrEqual(3000);
    expect(REVEAL_MS).toBeLessThanOrEqual(3800);
  });

  it("beat one: irons draw at their targets, the flash fires only in its window", () => {
    const at = (ms: number) => revealSeats(BASE, mutual, ms, false);
    const early = at(300);
    expect(early.seats[0].pose).toBe("aim");
    expect(early.seats[0].aimAt).toBe(1);
    expect(early.seats[1].aimAt).toBe(0);
    expect(early.seats[0].firing).toBe(false);
    expect(early.seats[2].pose).toBe("idle");
    expect(at(FLASH_FROM + 50).seats[0].firing).toBe(true);
    expect(at(FLASH_FROM + 50).flash).toBe(true);
    expect(at(FLASH_TO).seats[0].firing).toBe(false);
    expect(at(FLASH_FROM + 50).seats[0].bullet).toBe(false);
    expect(at(100).seats[0].bullet).toBe(true);
    for (let ms = 0; ms < 4000; ms += 10) expect(revealSeats(BASE, mutual, ms, true).seats.some((s) => s.firing)).toBe(false);
  });

  it("cards flip face up during beat one", () => {
    expect(revealSeats(BASE, mutual, 0, false).seats.map((s) => s.badge)).toEqual(["down", "down", "down"]);
    expect(revealSeats(BASE, mutual, 400, false).seats.map((s) => s.badge)).toEqual(["iron", "iron", "table"]);
  });

  it("results: two seats that shot each other are both on the floor, the table ducks", () => {
    const r = revealSeats(BASE, mutual, 900, false);
    expect(r.seats.map((s) => s.pose)).toEqual(["fallen", "fallen", "duck"]);
    expect(r.seats[0].t).toBe(900 - BEAT_MS);
    expect(r.smoke).toBe(true);
    expect(r.quiet).toBe(false);
  });

  it("panel steps 1, 2, 3 then rests; none under reduced motion", () => {
    const p = [0, 160, 310, 460].map((ms) => revealSeats(BASE, mutual, ms, false).panel);
    expect(p).toEqual([1, 2, 3, 0]);
    expect(revealSeats(BASE, mutual, 0, true).panel).toBe(0);
  });

  it("the purse slides to a paid winner from about 1.2 s; at once under reduced motion", () => {
    const win = find(["iron", "air", "table"], [1, null, null]);
    expect(win.winner).toBe(0);
    expect(revealSeats(BASE, win, PURSE_FROM - 10, false).purse).toBe(-1);
    const moving = revealSeats(BASE, win, PURSE_FROM + 100, false);
    expect(moving.purse).toBe(0);
    expect(moving.purseT).toBe(100);
    expect(revealSeats(BASE, win, 0, true).purse).toBe(0);
    expect(revealSeats(BASE, win, 2000, false).seats[0].winner).toBe(true);
    expect(revealSeats(BASE, { ...win, purseMoves: false }, 2000, false).purse).toBe(-1);
  });

  it("ran: a face-down card in beat one, then gone, or on the floor when hit", () => {
    const away = find(["ran", "iron", "air"], [null, 2, null]);
    expect(revealSeats(BASE, away, 400, false).seats[0].badge).toBe("down");
    const end = revealSeats(BASE, away, 2000, false).seats;
    expect(end[0].pose).toBe("gone");
    expect(end[0].badge).toBe("ran");
    expect(end[2].pose).toBe("fallen");
    const hit = find(["table", "ran", "iron"], [null, null, 1]);
    expect(revealSeats(BASE, hit, 2000, false).seats[1].pose).toBe("fallen");
  });

  it("slept shows as air with a Zz badge", () => {
    const slept = find(["slept", "table", "table"], [null, null, null]);
    const s = revealSeats(BASE, slept, 400, false).seats[0];
    expect(s.pose).toBe("air");
    expect(s.badge).toBe("slept");
    expect(revealSeats(BASE, slept, 2000, false).seats[0].winner).toBe(true);
    // drawn with the slept look (head down, Zz), not open hands
    expect(s.asleep).toBe(true);
    expect(revealSeats(BASE, slept, 2000, false).seats[0].asleep).toBe(true);
    expect(revealSeats(BASE, slept, 0, false).seats[0].asleep).toBeUndefined();
  });

  it("agrees with every hand in the judge truth table", () => {
    for (const c of judge.cases as Case[]) {
      const hand = handOf(c);
      for (const reduce of [false, true]) {
        const r = revealSeats(BASE, hand, reduce ? 0 : REVEAL_MS - 1, reduce);
        r.seats.forEach((s, i) => {
          const card = hand.cards[i];
          if (c.hit[i]) expect(s.pose).toBe("fallen");
          else if (card === "table") expect(s.pose).toBe("duck");
          else if (card === "ran") expect(s.pose).toBe("gone");
          else if (card === "iron") expect(s.pose).toBe("aim");
          else expect(s.pose).toBe("air");
          expect(s.winner).toBe(hand.winner === i);
          expect(s.firing).toBe(false);
        });
        expect(r.quiet).toBe(!hand.cards.includes("iron"));
      }
    }
  });
});

describe("live minute", () => {
  it("idle poses with badges", () => {
    const seats = minuteSeats(BASE, ["thinking", "down", "air"]);
    expect(seats.map((s) => s.pose)).toEqual(["idle", "idle", "idle"]);
    expect(seats.map((s) => s.badge)).toEqual(["thinking", "down", "air"]);
    expect(seats[0].you).toBe(true);
    expect(seats[1].house).toBe(true);
  });
});

function settled(i: number, pose: ArtSeat["pose"], over: Partial<ArtSeat> = {}): ArtSeat {
  return {
    name: BASE[i].name,
    house: true,
    coat: BASE[i].coat,
    pose,
    t: 100000,
    aimAt: null,
    firing: false,
    bullet: true,
    badge: null,
    you: false,
    winner: false,
    ...over,
  };
}

function model(seats: [ArtSeat, ArtSeat, ArtSeat], over: Partial<ArtModel> = {}): ArtModel {
  return {
    frame: 0,
    time: 0,
    reduce: true,
    seats,
    purse: -1,
    purseT: 0,
    smoke: false,
    quiet: false,
    panel: 0,
    second: 0,
    urgent: false,
    caption: null,
    ...over,
  };
}

function findSprite(p: Pix, rows: readonly string[], keys: Record<string, number>): { x: number; y: number } | null {
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) {
      let ok = true;
      for (let r = 0; r < rows.length && ok; r++)
        for (let c = 0; c < rows[r].length && ok; c++) {
          const k = keys[rows[r][c]];
          if (k !== undefined && p.get(x + c, y + r) !== k) ok = false;
        }
      if (ok) return { x, y };
    }
  return null;
}

describe("death on the floor", () => {
  for (const coat of ["rust", "felt", "soot"] as const) {
    for (const i of [0, 1, 2] as const) {
      it(`seat ${i} in a ${coat} coat: wound, cross eye, pool, hat apart`, () => {
        const seats: [ArtSeat, ArtSeat, ArtSeat] = [settled(0, "air"), settled(1, "air"), settled(2, "air")];
        seats[i] = settled(i, "fallen", { coat });
        const m = model(seats);
        const dir = fallDir(i, seats);
        const pix = new Pix(W, H);
        renderScene(pix, m);
        const box = lyingBounds(i, dir);
        // the wound: rust with a paper ring, on the body
        const wound = findSprite(pix, WOUND.rows, { p: PAPER, r: RUST });
        expect(wound).not.toBeNull();
        if (wound) {
          expect(wound.x).toBeGreaterThanOrEqual(box.x);
          expect(wound.x).toBeLessThan(box.x + box.w);
          expect(wound.y).toBeGreaterThanOrEqual(FALLEN_TOP_Y - 2);
        }
        // the cross eye on the head on the floor
        const eye = ["k.k", ".k.", "k.k"];
        const cross = findSprite(pix, dir > 0 ? eye : eye, { k: 1, ".": PAPER });
        expect(cross).not.toBeNull();
        // a rust pool on the floor below the body
        let pool = 0;
        for (let y = FALLEN_TOP_Y + 10; y < PLATE_Y; y++) for (let x = box.x; x < box.x + box.w; x++) if (pix.get(x, y) === RUST) pool++;
        expect(pool).toBeGreaterThan(40);
        // nothing of the seat stands above its table any more
        const blank = new Pix(W, H);
        drawBehind(blank, i, seats[i], m, dir);
        expect(blank.px.some((v) => v !== NONE)).toBe(false);
        // the hat (with the house H) lies apart from the body, in the seat's own column, 10 to 20 px
        // from the head (it lands on the boards just above the head)
        const hat = hatFlight(i, seats[i], m, dir);
        expect(hat.landed).toBe(true);
        const overlap = hat.x < box.x + box.w && hat.x + 19 > box.x && hat.y < box.y + box.h && hat.y + 9 > box.y;
        expect(overlap).toBe(false);
        expect(hat.x).toBeGreaterThanOrEqual(SEAT_X[i] - 60);
        expect(hat.x + 19).toBeLessThanOrEqual(SEAT_X[i] + 60);
        const gap = FALLEN_TOP_Y - 1 - (hat.y + 9);
        expect(gap).toBeGreaterThanOrEqual(10);
        expect(gap).toBeLessThanOrEqual(20);
        const crown = dir < 0 ? box.x + 1 : box.x + box.w - 2;
        const headMid = dir < 0 ? crown + 6 : crown - 6;
        expect(Math.abs(hat.x + 9 - headMid)).toBeLessThanOrEqual(4);
      });
    }
  }

  it("the H on a landed hat never overlaps the body, for every seat and direction", () => {
    for (const i of [0, 1, 2]) {
      for (const dir of [-1, 1] as const) {
        const s = settled(i, "fallen");
        const hat = hatFlight(i, s, model([s, s, s]), dir);
        const box = lyingBounds(i, dir);
        const overlapX = hat.x < box.x + box.w && hat.x + 19 > box.x;
        const overlapY = hat.y < box.y + box.h && hat.y + 9 > box.y;
        expect(overlapX && overlapY).toBe(false);
      }
    }
  });

  it("the dead head sprite has a cross eye", () => {
    expect(DEAD_HEAD.rows.slice(2, 5).map((r) => r.slice(2, 5))).toEqual(["kpk", "pkp", "kpk"]);
  });
});

describe("hit pose and shots", () => {
  it("the hit pose is a recoil: no hand rises above the head (Air keeps its hands up)", () => {
    for (const i of [0, 1, 2]) {
      for (const t of [0, 60, 140, 200]) {
        const s = { ...settled(i, "fallen"), t };
        const m = model([s, s, s], { reduce: false });
        const hit = new Pix(W, H);
        drawBehind(hit, i, s, m, i === 0 ? -1 : 1);
        let high = 0;
        for (let y = 0; y < FEET_Y - 47; y++) for (let x = 0; x < W; x++) if (hit.get(x, y) === PAPER) high++;
        expect(high).toBe(0);
      }
      const air = new Pix(W, H);
      const a = { ...settled(i, "air"), t: 2000 };
      drawBehind(air, i, a, model([a, a, a], { reduce: false }), 1);
      let up = 0;
      for (let y = 0; y < FEET_Y - 47; y++) for (let x = 0; x < W; x++) if (air.get(x, y) === PAPER) up++;
      expect(up).toBeGreaterThan(0);
    }
  });

  it("a shot at the far seat arcs over the middle figure and under the badge cards", () => {
    for (const [from, to] of [
      [0, 2],
      [2, 0],
    ] as const) {
      const shooter = { ...settled(from, "aim"), aimAt: to } as ArtSeat;
      const mz = shotPoint(from, shooter);
      const end = shotEnd(from, to, true);
      const p = new Pix(W, H);
      tracer(p, mz.x + mz.dir, mz.y, end.x, end.y, FAR_SHOT_PEAK);
      let crossed = 0;
      let top = H;
      for (let y = 0; y < H; y++)
        for (let x = SEAT_X[1] - 16; x <= SEAT_X[1] + 16; x++) {
          if (p.get(x, y) !== RUST) continue;
          top = Math.min(top, y);
          if (y >= FEET_Y - 55) crossed++; // the middle hat's top row and everything below
        }
      expect(crossed).toBe(0);
      expect(top).toBeGreaterThan(BADGE_Y + 15);
    }
  });
});

describe("duck", () => {
  it("only the hat shows above the table top", () => {
    for (const i of [0, 1, 2]) {
      const s = settled(i, "duck");
      const m = model([s, s, s]);
      const blank = new Pix(W, H);
      drawBehind(blank, i, s, m, 1);
      const cx = SEAT_X[i];
      for (let y = 0; y < TABLE_TOP_Y; y++)
        for (let x = 0; x < W; x++) {
          if (blank.get(x, y) === NONE) continue;
          expect(x).toBeGreaterThanOrEqual(cx - 11);
          expect(x).toBeLessThanOrEqual(cx + 11);
          expect(y).toBeGreaterThanOrEqual(TABLE_TOP_Y - 11);
        }
      // and no paper face anywhere
      expect(findSprite(blank, ["ppkpppkpp"], { p: PAPER, k: 1 })).toBeNull();
    }
  });
});

describe("frame", () => {
  it("draws the whole frame with integer rects in the four inks, smoothing off", () => {
    const inks = new Set<string>(Object.values(INK));
    let style = "";
    let bad = 0;
    let rects = 0;
    let smoothing = true;
    const ctx = {
      set fillStyle(v: string) {
        style = v;
      },
      get fillStyle() {
        return style;
      },
      set imageSmoothingEnabled(v: boolean) {
        smoothing = v;
      },
      fillRect(x: number, y: number, w: number, h: number) {
        rects++;
        if (![x, y, w, h].every(Number.isInteger) || !inks.has(style)) bad++;
      },
    } as unknown as CanvasRenderingContext2D;
    const r = revealSeats(BASE, find(["iron", "iron", "iron"], [1, 2, 0]), 600, false);
    drawScene(ctx, frameOf(r, 600, false));
    expect(smoothing).toBe(false);
    expect(bad).toBe(0);
    expect(rects).toBeGreaterThan(100);
    expect(rects).toBeLessThan(6000);
  });

  it("every frame of every judged hand stays in the four inks and within the rect budget", () => {
    const pix = new Pix(W, H);
    const cases = judge.cases as Case[];
    for (let k = 0; k < cases.length; k += 7) {
      const hand = handOf(cases[k]);
      for (const ms of [0, 500, 800, 1500, 3300]) {
        renderScene(pix, frameOf(revealSeats(BASE, hand, ms, false), ms, false));
        expect(pix.px.every((v) => v >= 1 && v <= 4)).toBe(true);
      }
      expect(rectCount(pix)).toBeLessThan(6000);
    }
  });

  it("name plates are never covered by the purse", () => {
    const win = find(["iron", "air", "table"], [1, null, null]);
    for (const ms of [0, 1300, 1500, 1700, 3000]) {
      const m = frameOf(revealSeats(BASE, win, ms, false), ms, false);
      const pix = new Pix(W, H);
      renderScene(pix, m);
      // the plate border is paper and its body soot: the purse (felt) never lands there
      for (let y = PLATE_Y; y < PLATE_Y + 9; y++) for (let x = 0; x < W; x++) expect(pix.get(x, y)).not.toBe(4);
    }
  });

  it("idle cowboys bob one pixel with the hat a beat behind", () => {
    const seats = minuteSeats(BASE, ["thinking", "thinking", "thinking"]);
    const a = new Pix(W, H);
    const b = new Pix(W, H);
    renderScene(a, model(seats, { reduce: false, frame: 0 }));
    renderScene(b, model(seats, { reduce: false, frame: 6 }));
    let diff = 0;
    for (let k = 0; k < a.px.length; k++) if (a.px[k] !== b.px[k]) diff++;
    expect(diff).toBeGreaterThan(0);
    // boots stay planted
    for (let x = SEAT_X[0] - 8; x <= SEAT_X[0] + 8; x++) expect(a.get(x, 158)).toBe(b.get(x, 158));
  });
});

describe("font", () => {
  it("measures and draws with integer rects", () => {
    expect(measure("CAL")).toBe(11);
    expect(measure("TALK IS NOT THE PURSE", 2)).toBe(measure("TALK IS NOT THE PURSE") * 2);
    let rects = 0;
    let fractional = 0;
    const ctx = {
      fillStyle: "",
      fillRect(x: number, y: number, w: number, h: number) {
        rects++;
        if (![x, y, w, h].every(Number.isInteger)) fractional++;
      },
    } as unknown as CanvasRenderingContext2D;
    const w = text(ctx, "Hello, world! 0-9 a/b: 'ok'?", 3, 4, INK.soot, 2);
    expect(rects).toBeGreaterThan(50);
    expect(fractional).toBe(0);
    expect(w).toBe(measure("Hello, world! 0-9 a/b: 'ok'?", 2));
  });
});

describe("front layer", () => {
  it("a settled fallen seat draws its pool and body in front of the tables", () => {
    const s = settled(1, "fallen");
    const blank = new Pix(W, H);
    drawFront(blank, 1, s, model([settled(0, "air"), s, settled(2, "air")]), 1);
    let below = 0;
    for (let y = FALLEN_TOP_Y; y < PLATE_Y; y++) for (let x = 0; x < W; x++) if (blank.get(x, y) !== NONE) below++;
    expect(below).toBeGreaterThan(300);
  });
});

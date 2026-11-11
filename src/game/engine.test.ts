import { describe, expect, it } from "vitest";
import { StrKey } from "@stellar/stellar-sdk";
import { Engine, type EngineConfig } from "./engine";
import { commitHash, sha256Bytes } from "./commit";
import { GameError } from "./errors";
import { AIR, IRON, TABLE, NONE, RAN, SLEPT } from "./rules";

const addr = (s: string) => StrKey.encodeEd25519PublicKey(Buffer.from(sha256Bytes(s)));
const A = addr("a"), B = addr("b"), C = addr("c"), D = addr("d"), E = addr("e");
const O = addr("owner");
const salt = (n: number) => new Uint8Array(32).fill(n);

type House = { card: number; target: number };
function setup(opts: { house?: House[]; config?: Partial<EngineConfig>; balance?: bigint } = {}) {
  const clock = { t: 1_800_000_000, seq: 100 };
  const e = new Engine({
    now: () => clock.t,
    ledger: () => clock.seq,
    seed: "test",
    config: opts.config,
    balance: opts.balance,
    houseCard: opts.house ? (_r, seat) => opts.house![seat] : undefined,
  });
  const tick = (secs = 5) => {
    clock.t += secs;
    clock.seq += Math.max(1, Math.round(secs / 5));
  };
  /** Resolve until the room has a new settled hand. */
  const settle = (room: number) => {
    const before = e.room(room).recent.length ? e.room(room).recent[0].hand : -1n;
    for (let i = 0; i < 6; i++) {
      const r = e.room(room);
      if (r.recent[0] && r.recent[0].hand !== before) return r.recent[0];
      if (e.due(room)) e.resolve(room, r.hand);
      else tick();
    }
    const r = e.room(room);
    if (r.recent[0] && r.recent[0].hand !== before) return r.recent[0];
    throw new Error("did not settle");
  };
  const err = (f: () => unknown) => {
    try {
      f();
    } catch (x) {
      if (x instanceof GameError) return x.errorName;
      throw x;
    }
    return "ok";
  };
  return { e, clock, tick, settle, err };
}

const QUIET: House[] = [{ card: AIR, target: NONE }, { card: TABLE, target: NONE }, { card: TABLE, target: NONE }];

describe("engine: solo play", () => {
  it("sit opens a minute; play locks; settle waits for the next ledger", () => {
    const { e, clock, tick, err } = setup({ house: [QUIET[0], { card: AIR, target: NONE }, { card: TABLE, target: NONE }] });
    expect(e.sit(A, 3)).toBe(0);
    let r = e.room(3);
    expect(r.phase).toBe(1);
    expect(r.hand).toBe(1n);
    expect(r.deadline).toBe(clock.t + 60);
    expect(r.seats.map((s) => s.who)).toEqual([A, null, null]);
    expect(e.sit(A, 3)).toBe(0); // idempotent
    e.play(A, 3, 1n, IRON, 1);
    r = e.room(3);
    expect(r.phase).toBe(3);
    expect(r.lockedAt).toBe(clock.seq);
    expect(err(() => e.resolve(3, 1n))).toBe("NotReady");
    tick();
    expect(e.resolve(3, 1n)).toBe(1);
    r = e.room(3);
    const h = r.recent[0];
    expect(h.cards).toEqual([IRON, AIR, TABLE]);
    expect(h.hit).toEqual([false, true, false]);
    expect(h.winner).toBe(0);
    expect(h.note).toBe(2); // unclaimed
    expect(r.hand).toBe(2n);
    expect(r.minute).toBe(2);
    expect(r.seats[0].bullet).toBe(0);
    expect(err(() => e.play(A, 3, 2n, IRON, 2))).toBe("NoBullet");
    expect(err(() => e.play(A, 3, 1n, AIR, NONE))).toBe("Closed");
    expect(e.stats(A)).toMatchObject({ hands: 1, wins: 1, hits: 1, falls: 0 });
  });

  it("rejects bad cards and wrong callers", () => {
    const { e, err } = setup();
    e.sit(A, 0);
    expect(err(() => e.play(B, 0, 1n, AIR, NONE))).toBe("NotSeated");
    expect(err(() => e.play(A, 9, 1n, AIR, NONE))).toBe("NoRoom");
    expect(err(() => e.play(A, 0, 1n, 5, NONE))).toBe("BadCard");
    expect(err(() => e.play(A, 0, 1n, IRON, 0))).toBe("BadTarget");
    expect(err(() => e.play(A, 0, 1n, AIR, 1))).toBe("BadTarget");
    e.play(A, 0, 1n, AIR, NONE);
    expect(err(() => e.resolve(0, 2n))).toBe("Closed");
    expect(err(() => e.sit(A, 12))).toBe("NoRoom");
  });

  it("house cards are deterministic from the seed and follow the distribution", () => {
    const counts = { air: 0, table: 0, iron: 0 };
    const run = () => {
      const { e, settle } = setup();
      const out: number[][] = [];
      e.sit(A, 0);
      for (let i = 0; i < 300; i++) {
        if (e.room(0).phase === 0) e.sit(A, 0); // re-sit after a scatter
        e.play(A, 0, e.room(0).hand, TABLE, NONE);
        out.push(settle(0).cards);
      }
      return out;
    };
    const a = run();
    expect(run()).toEqual(a);
    for (const c of a) for (const x of c.slice(1)) counts[x === AIR ? "air" : x === TABLE ? "table" : "iron"]++;
    const n = 600;
    expect(counts.air / n).toBeGreaterThan(0.2);
    expect(counts.air / n).toBeLessThan(0.38);
    expect(counts.iron / n).toBeGreaterThan(0.35);
    expect(counts.iron / n).toBeLessThan(0.52);
  });
});

describe("engine: commit-reveal with three players", () => {
  it("seals, reveals, locks, settles", () => {
    const { e, tick, settle, err } = setup({ house: QUIET });
    e.sit(A, 3);
    expect(e.sit(B, 3)).toBe(NONE);
    expect(e.sit(C, 3)).toBe(NONE);
    e.play(A, 3, 1n, AIR, NONE);
    settle(3);
    let r = e.room(3);
    expect(r.seats.map((s) => s.who)).toEqual([A, B, C]);
    const hand = r.hand;
    expect(err(() => e.play(A, 3, hand, AIR, NONE))).toBe("Choosing");
    e.commit(A, 3, hand, commitHash(hand, 0, IRON, 1, salt(1)));
    expect(err(() => e.commit(A, 3, hand, commitHash(hand, 0, IRON, 1, salt(1))))).toBe("Played");
    expect(err(() => e.reveal(A, 3, hand, IRON, 1, salt(1)))).toBe("NotReveal");
    e.commit(B, 3, hand, commitHash(hand, 1, AIR, NONE, salt(2)));
    e.play(C, 3, hand, TABLE, NONE); // others are sealed: face up allowed
    r = e.room(3);
    expect(r.phase).toBe(2);
    expect(err(() => e.reveal(B, 3, hand, TABLE, NONE, salt(2)))).toBe("BadReveal");
    e.reveal(A, 3, hand, IRON, 1, salt(1));
    expect(e.room(3).phase).toBe(2);
    e.reveal(B, 3, hand, AIR, NONE, salt(2));
    expect(e.room(3).phase).toBe(3);
    tick();
    e.resolve(3, hand);
    const h = e.room(3).recent[0];
    expect(h.cards).toEqual([IRON, AIR, TABLE]);
    expect(h.hit).toEqual([false, true, false]);
    expect(h.winner).toBe(0);
    expect(h.out).toEqual([0, 0, 0]);
  });
});

describe("engine: ran, slept, scatter", () => {
  it("a runner wins nothing for anyone: note 6, runner stood up", () => {
    const { e, tick, settle, err } = setup({ house: [QUIET[0], QUIET[1], { card: AIR, target: NONE }] });
    e.offer(A, O);
    e.accept(O, A);
    e.sit(A, 1);
    e.sit(B, 1);
    e.play(A, 1, 1n, TABLE, NONE);
    settle(1);
    const hand = e.room(1).hand;
    e.commit(A, 1, hand, commitHash(hand, 0, IRON, 2, salt(3)));
    e.commit(B, 1, hand, commitHash(hand, 1, AIR, NONE, salt(4)));
    e.reveal(A, 1, hand, IRON, 2, salt(3));
    expect(err(() => e.resolve(1, hand))).toBe("NotReady");
    tick(45);
    expect(e.resolve(1, hand)).toBe(3);
    tick();
    e.resolve(1, hand);
    const h = e.room(1).recent[0];
    expect(h.cards).toEqual([IRON, RAN, AIR]);
    expect(h.winner).toBe(0);
    expect(h.note).toBe(6);
    expect(h.paid).toBe(0n);
    expect(h.out).toEqual([0, 2, 0]);
    expect(e.room(1).seats.map((s) => s.who)).toEqual([A, null, null]);
    expect(e.stats(B).ran).toBe(1);
  });

  it("a sleeper plays air and is carried out after two slept minutes", () => {
    const { e, tick, settle } = setup({ house: QUIET });
    e.sit(A, 2);
    tick(60);
    let h = settle(2);
    expect(h.cards[0]).toBe(SLEPT);
    expect(h.out[0]).toBe(0);
    expect(e.room(2).seats[0].missed).toBe(1);
    tick(60);
    h = settle(2);
    expect(h.out[0]).toBe(3);
    expect(e.room(2).phase).toBe(0);
    expect(e.room(2).minute).toBe(2);
  });

  it("a sleeper is carried out at once when someone waits", () => {
    const { e, tick, settle } = setup({ house: QUIET });
    e.sit(A, 2);
    e.sit(B, 2);
    tick(60);
    const h = settle(2);
    expect(h.out[0]).toBe(3);
    expect(e.room(2).seats.map((s) => s.who)).toEqual([B, null, null]);
  });

  it("a stale minute carries the sleeper out", () => {
    const { e, tick, settle } = setup({ house: QUIET });
    e.sit(A, 2);
    tick(200); // more than deadline + reveal + one more minute
    expect(settle(2).out[0]).toBe(3);
  });

  it("three quiet minutes scatter the table; the queue sits fresh", () => {
    const { e, settle } = setup({ house: QUIET });
    e.sit(A, 4);
    for (let i = 0; i < 2; i++) {
      e.play(A, 4, e.room(4).hand, AIR, NONE);
      expect(settle(4).scattered).toBe(false);
    }
    expect(e.room(4).quiet).toBe(2);
    e.sit(B, 4);
    e.play(A, 4, e.room(4).hand, AIR, NONE);
    const h = settle(4);
    expect(h.scattered).toBe(true);
    expect(h.out[0]).toBe(4);
    const r = e.room(4);
    expect(r.quiet).toBe(0);
    expect(r.seats.map((s) => s.who)).toEqual([B, null, null]);
    expect(r.phase).toBe(1);
  });

  it("scatter with nobody queued goes idle and keeps recent", () => {
    const { e, settle } = setup({ house: QUIET });
    e.sit(A, 4);
    for (let i = 0; i < 3; i++) {
      e.play(A, 4, e.room(4).hand, AIR, NONE);
      settle(4);
    }
    const r = e.room(4);
    expect(r.phase).toBe(0);
    expect(r.hand).toBe(0n);
    expect(r.recent.length).toBe(3);
  });
});

describe("engine: queue, owners, leave", () => {
  it("claimed players queue ahead; queue max 3", () => {
    const { e, err } = setup();
    e.offer(C, O);
    e.accept(O, C);
    e.sit(A, 5);
    e.sit(B, 5);
    e.sit(C, 5);
    expect(e.room(5).queue).toEqual([C, B]);
    e.sit(D, 5);
    expect(err(() => e.sit(E, 5))).toBe("Full");
  });

  it("Elsewhere and moving rooms", () => {
    const { e, err } = setup();
    e.sit(A, 0);
    e.sit(B, 0);
    expect(err(() => e.sit(A, 1))).toBe("Elsewhere");
    try {
      e.sit(A, 1);
    } catch (x) {
      expect((x as Error).message).toBe("You already have a chair in Billen. Stand up there first.");
    }
    e.sit(C, 6);
    expect(e.sit(C, 7)).toBe(0);
    expect(e.room(6).phase).toBe(0);
  });

  it("OwnerBusy on sit; accept stands up the owner's other chair", () => {
    const { e, err } = setup();
    e.offer(A, O);
    e.accept(O, A);
    e.offer(B, O);
    e.accept(O, B);
    e.sit(A, 0);
    expect(err(() => e.sit(B, 1))).toBe("OwnerBusy");
    e.sit(C, 2);
    e.offer(C, O);
    e.accept(O, C); // a new device: A is marked leaving, C is linked
    expect(e.room(0).seats.find((s) => s.who === A)?.leaving).toBe(true);
    expect(e.chair(C)?.claimed).toBe(true);
    expect(err(() => e.accept(O, D))).toBe("NoOffer");
    expect(err(() => e.offer(D, D))).toBe("BadOwner");
  });

  it("leave: queued removed; lone player with no card idles the room; seated leaves at settle", () => {
    const { e, settle } = setup({ house: QUIET });
    e.sit(A, 8);
    e.leave(A, 8);
    expect(e.room(8).phase).toBe(0);
    e.sit(A, 8);
    e.sit(B, 8);
    e.leave(B, 8);
    expect(e.room(8).queue).toEqual([]);
    e.play(A, 8, e.room(8).hand, AIR, NONE);
    e.leave(A, 8);
    const h = settle(8);
    expect(h.out[0]).toBe(1);
    expect(e.room(8).phase).toBe(0);
  });

  it("rename rules", () => {
    const { e, err } = setup();
    e.rename(A, "Doc Holli", false);
    expect(e.chair(A)?.name).toBe("Doc Holli");
    for (const bad of ["", " Doc", "Doc ", "ned", "Thirteen char", "Bad!", "CaI", "lvy", "1vy", "Ca1"]) {
      expect(err(() => e.rename(A, bad, false))).toBe("BadName");
    }
    e.rename(A, "Cab", false);
    e.rename(A, "n3d", false);
  });
});

describe("engine: payouts and budgets", () => {
  const WIN: House[] = [QUIET[0], { card: AIR, target: NONE }, { card: TABLE, target: NONE }];
  function winOnce(s: ReturnType<typeof setup>, p: string, room: number) {
    const r = s.e.room(room);
    const seat = r.seats.findIndex((x) => x.who === p);
    if (r.seats[seat].bullet === 0) {
      s.e.leave(p, room); // lone player, no card: the room idles at once
      expect(s.e.room(room).phase).toBe(0);
      s.e.sit(p, room); // re-armed
    }
    const r2 = s.e.room(room);
    s.e.play(p, room, r2.hand, IRON, 1);
    return s.settle(room);
  }

  it("pays a claimed winner and counts stats and board", () => {
    const s = setup({ house: WIN });
    s.e.offer(A, O);
    s.e.accept(O, A);
    s.e.rename(A, "Wes", false);
    s.e.sit(A, 3);
    const before = s.e.purse().balance;
    const h = winOnce(s, A, 3);
    expect(h.note).toBe(4);
    expect(h.paid).toBe(10_000_000n);
    expect(s.e.purse().balance).toBe(before - 10_000_000n);
    expect(s.e.payouts.get(O)).toBe(10_000_000n);
    expect(s.e.stats(O)).toMatchObject({ wins: 1, earned: 10_000_000n, dayPaid: 1 });
    expect(s.e.board()[0]).toMatchObject({ owner: O, name: "Wes", wins: 1 });
    expect(s.e.purse().hourPaid).toBe(1);
  });

  it("a slept winner is not paid: note 8", () => {
    const s = setup({ house: [QUIET[0], { card: TABLE, target: NONE }, { card: TABLE, target: NONE }] });
    s.e.offer(A, O);
    s.e.accept(O, A);
    s.e.sit(A, 4);
    const before = s.e.purse().balance;
    s.tick(60);
    const h = s.settle(4);
    expect(h.cards[0]).toBe(SLEPT);
    expect(h.winner).toBe(0);
    expect(h.note).toBe(8);
    expect(h.paid).toBe(0n);
    expect(s.e.purse().balance).toBe(before);
    expect(s.e.purse().hourPaid).toBe(0);
    expect(s.e.stats(O).dayPaid).toBe(0);
  });

  it("house win note 1, no winner note 0", () => {
    const s = setup({ house: [QUIET[0], { card: IRON, target: 0 }, { card: TABLE, target: NONE }] });
    s.e.sit(A, 0);
    s.e.play(A, 0, 1n, AIR, NONE);
    const h = s.settle(0);
    expect(h.winner).toBe(1);
    expect(h.note).toBe(1);
    s.e.play(A, 0, s.e.room(0).hand, TABLE, NONE);
    const n = s.settle(0); // Ivy's iron finds a table: one standing, no open air
    expect(n.winner).toBe(3);
    expect(n.note).toBe(0);
  });

  it("hour budget and day cap rest the purse; empty purse", () => {
    const s = setup({ house: WIN, config: { hourBudget: 1 } });
    s.e.offer(A, O);
    s.e.accept(O, A);
    s.e.sit(A, 3);
    expect(winOnce(s, A, 3).note).toBe(4);
    expect(winOnce(s, A, 3).note).toBe(7);
    s.clock.t += 3600;
    expect(winOnce(s, A, 3).note).toBe(4);

    const d = setup({ house: WIN, config: { dayCap: 1 } });
    d.e.offer(A, O);
    d.e.accept(O, A);
    d.e.sit(A, 3);
    expect(winOnce(d, A, 3).note).toBe(4);
    d.clock.t += 3600;
    expect(winOnce(d, A, 3).note).toBe(7);

    const z = setup({ house: WIN, balance: 0n });
    z.e.offer(A, O);
    z.e.accept(O, A);
    z.e.sit(A, 3);
    expect(winOnce(z, A, 3).note).toBe(3);
    z.e.fund(B, 20_000_000n);
    expect(winOnce(z, A, 3).note).toBe(4);
  });
});

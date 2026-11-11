import { describe, expect, it } from "vitest";
import type { RoomView } from "../shared/game-client";
import { createPracticeClient, rehearsal } from "./practice";

describe("practice client", () => {
  it("sit, play, watch until a settled hand appears", async () => {
    const c = createPracticeClient({ seed: "smoke", ledgerMs: 20 });
    try {
      const id = c.identity()!;
      expect(id.door).toBe("practice");
      expect(id.claimed).toBe(true);
      expect(c.txUrl("x")).toBeNull();
      const txs: string[] = [];
      c.onTx((e) => txs.push(e.label));
      expect(await c.sit(3)).toEqual({ seat: 0, queued: false });
      const v0 = await c.room(3);
      expect(v0.phase).toBe("open");
      expect(v0.you).toMatchObject({ seat: 0, state: "waiting" });
      expect(v0.seats.map((s) => s.kind)).toEqual(["player", "house", "house"]);
      expect(await c.playCard(3, "iron", 1)).toBe("played");
      const settled = await new Promise<RoomView>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("timeout")), 5000);
        const stop = c.watch(3, (v) => {
          if (v.recent.length > 0) {
            clearTimeout(timer);
            stop();
            resolve(v);
          }
        });
      });
      const h = settled.recent[0];
      expect(h.seats[0].card).toBe("iron");
      expect(h.seats[0].target).toBe(1);
      expect(h.lines.length).toBeGreaterThan(0);
      expect(settled.phase).toBe("open");
      expect(settled.hand).not.toBe(v0.hand);
      expect(txs).toContain("Settle the minute");
      expect((await c.rooms()).find((r) => r.id === 3)?.players).toBe(1);
    } finally {
      c.dispose();
    }
  });

  it("a missed minute plays air and settles on its own", async () => {
    const c = createPracticeClient({ seed: "sleep", ledgerMs: 5 });
    try {
      await c.sit(0);
      const v = await new Promise<RoomView>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("timeout")), 5000);
        const stop = c.watch(0, (x) => {
          if (x.recent.length > 0) {
            clearTimeout(timer);
            stop();
            resolve(x);
          }
        });
      });
      expect(v.recent[0].seats[0].card).toBe("slept");
      expect(v.recent[0].lines).toContain(`${v.recent[0].seats[0].name} slept through the minute. That plays as Air.`);
    } finally {
      c.dispose();
    }
  });
});

describe("rehearsal", () => {
  it("is deterministic and follows the 60 s cycle", () => {
    const t0 = 1_800_000_000 - (1_800_000_000 % 60);
    const a = rehearsal("CABC", 3, t0 + 10);
    expect(rehearsal("CABC", 3, t0 + 10)).toEqual(a);
    expect(a.phase).toBe("open");
    expect(a.closesIn).toBe(40);
    expect(a.seats.every((s) => s.kind === "house" && s.state === "waiting")).toBe(true);
    const b = rehearsal("CABC", 3, t0 + 52);
    expect(b.phase).toBe("idle");
    expect(b.recent[0].at).toBe(t0 + 50);
    expect(b.recent[0].hand).toBe(String(t0 / 60));
    expect(b.recent[0].lines.length).toBeGreaterThan(0);
    // the open view of the next cycle shows the same hand as history
    expect(rehearsal("CABC", 3, t0 + 70).recent[0]).toEqual(b.recent[0]);
    const many = Array.from({ length: 40 }, (_, i) => rehearsal("CABC", 3, t0 + 60 * i + 55).recent[0].seats.map((s) => s.card).join());
    expect(new Set(many).size).toBeGreaterThan(5);
  });
});

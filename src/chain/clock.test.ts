import { describe, expect, it } from "vitest";
import { LedgerClock } from "./clock";

describe("LedgerClock", () => {
  it("uses the max offset over 30 s and never steps back", async () => {
    let ms = 1_000_000;
    let close = 2000;
    const c = new LedgerClock({ getHealth: async () => ({ latestLedger: 10, latestLedgerCloseTime: close }) as never }, () => ms);
    await c.sync();
    expect(c.now()).toBe(2000);
    expect(c.latestLedger).toBe(10);
    ms += 3000; // 3 s later the RPC still reports the same close time
    await c.sync();
    expect(c.now()).toBe(2003); // max offset kept
    ms += 40_000;
    close = 2030; // clock fell behind: offset re-anchors after 30 s, but display never steps back
    const before = c.now();
    await c.sync();
    expect(c.now()).toBeGreaterThanOrEqual(before);
  });

  it("works without close time", async () => {
    const c = new LedgerClock({ getHealth: async () => ({ latestLedger: 5 }) }, () => 7_000);
    await c.sync();
    expect(c.now()).toBe(7);
    expect(c.synced).toBe(false);
  });
});

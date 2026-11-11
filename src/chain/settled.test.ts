import { nativeToScVal, rpc, xdr } from "@stellar/stellar-sdk";
import { describe, expect, it, vi } from "vitest";
import { FRESH_RETRY_MS, FRESH_TRIES, SETTLED_REFRESH_MS, SettledIndex, parseSettled, settledFilter, startLedgerFor } from "./settled";
import type { Rpc } from "./tx";

const CID = "CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE";

function settledEvent(hand: bigint, txHash: string): rpc.Api.EventResponse {
  const value = nativeToScVal({ hand, minute: 1, note: 0 }, { type: { hand: ["symbol", "u64"], minute: ["symbol", "u32"], note: ["symbol", "u32"] } });
  return {
    id: txHash, type: "contract", ledger: 1, ledgerClosedAt: "", transactionIndex: 0, operationIndex: 0, txHash,
    topic: [xdr.ScVal.scvSymbol("settled"), xdr.ScVal.scvU32(5)], value,
  } as unknown as rpc.Api.EventResponse;
}

describe("settled events", () => {
  it("filters on the contract and the (settled, room) topics", () => {
    const f = settledFilter(CID, 5);
    expect(f.contractIds).toEqual([CID]);
    expect(f.topics?.[0]).toEqual([xdr.ScVal.scvSymbol("settled").toXdr("base64"), xdr.ScVal.scvU32(5).toXdr("base64")]);
  });

  it("maps hand to tx hash", () => {
    expect(parseSettled([settledEvent(42n, "aa"), settledEvent(43n, "bb")])).toEqual([{ hand: "42", tx: "aa" }, { hand: "43", tx: "bb" }]);
  });

  it("starts the scan near the oldest recent hand, inside the window and retention", () => {
    expect(startLedgerFor(50_000, 10_000, null)).toBe(40_000);
    expect(startLedgerFor(50_000, 10_000, 9_000)).toBe(50_000 - 200 - 60);
    expect(startLedgerFor(50_000, 1_000_000, 1)).toBe(40_000);
    expect(startLedgerFor(500, 10_000, null, 120)).toBe(120);
  });

  it("scans at once for a new hand, retries it quickly, then continues from the cursor", async () => {
    let t = 1_000_000;
    let indexed8 = false;
    const getEvents = vi.fn(async (req: rpc.Api.GetEventsRequest) => ({
      events: req.cursor ? (indexed8 ? [settledEvent(8n, "h8")] : []) : [settledEvent(7n, "h7")],
      cursor: req.cursor ? "c2" : "c1",
      latestLedger: 100, oldestLedger: 1, latestLedgerCloseTime: "0", oldestLedgerCloseTime: "0",
    }));
    const map = new Map<string, string>();
    const idx = new SettledIndex({ getEvents } as unknown as Rpc, CID, map, { nowMs: () => t });
    await idx.maybeRefresh(5, [{ hand: "7", at: 900 }], 100, 1000);
    expect(map.get("7")).toBe("h7");
    expect(getEvents.mock.calls[0][0]).toMatchObject({ startLedger: 20 });
    // Hand 8 is new: it scans at once from the cursor. The RPC has not indexed it yet.
    await idx.maybeRefresh(5, [{ hand: "7", at: 900 }, { hand: "8", at: 990 }], 100, 1000);
    expect(getEvents.mock.calls[1][0]).toMatchObject({ cursor: "c1" });
    expect(map.has("8")).toBe(false);
    // Still missing: the quick retry waits FRESH_RETRY_MS.
    expect(idx.maybeRefresh(5, [{ hand: "8", at: 990 }], 100, 1000)).toBeNull();
    t += FRESH_RETRY_MS;
    indexed8 = true;
    await idx.maybeRefresh(5, [{ hand: "8", at: 990 }], 100, 1000);
    expect(map.get("8")).toBe("h8");
    // Nothing missing: no call even after 15 s.
    t += SETTLED_REFRESH_MS;
    expect(idx.maybeRefresh(5, [{ hand: "8", at: 990 }], 100, 1000)).toBeNull();
    expect(getEvents).toHaveBeenCalledTimes(3);
  });

  it("falls back to one scan per 15 s for a hand the RPC never shows", async () => {
    let t = 1_000_000;
    const getEvents = vi.fn(async () => ({
      events: [], cursor: "c", latestLedger: 100, oldestLedger: 1, latestLedgerCloseTime: "0", oldestLedgerCloseTime: "0",
    }));
    const idx = new SettledIndex({ getEvents } as unknown as Rpc, CID, new Map(), { nowMs: () => t });
    const gone = [{ hand: "3", at: 1 }];
    for (let i = 0; i < FRESH_TRIES; i++) {
      await idx.maybeRefresh(5, gone, 100, 1000);
      t += FRESH_RETRY_MS;
    }
    expect(getEvents).toHaveBeenCalledTimes(FRESH_TRIES);
    expect(idx.maybeRefresh(5, gone, 100, 1000)).toBeNull();
    t += SETTLED_REFRESH_MS;
    await idx.maybeRefresh(5, gone, 100, 1000);
    expect(getEvents).toHaveBeenCalledTimes(FRESH_TRIES + 1);
  });

  it("restarts from the RPC's oldest ledger when the start is out of range", async () => {
    const getEvents = vi.fn(async (req: rpc.Api.GetEventsRequest) => {
      if ((req.startLedger ?? 0) < 400) throw new Error("startLedger must be between the oldest ledger: 400 and the latest ledger: 10300");
      return { events: [settledEvent(9n, "h9")], cursor: "c", latestLedger: 10_300, oldestLedger: 400, latestLedgerCloseTime: "0", oldestLedgerCloseTime: "0" };
    });
    const map = new Map<string, string>();
    await new SettledIndex({ getEvents } as unknown as Rpc, CID, map).maybeRefresh(5, [{ hand: "9", at: 1 }], 10_300, 100_000);
    expect(getEvents.mock.calls[1][0]).toMatchObject({ startLedger: 400 });
    expect(map.get("9")).toBe("h9");
  });
});

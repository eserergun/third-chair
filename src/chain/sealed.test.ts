import { describe, expect, it } from "vitest";
import { decodeSealed, encodeSealed, findSealed, pruneSealed, putSealed, sealedCommit } from "./sealed";
import { memoryStore } from "./store";
import { commitment, fromHex } from "./local";

const P = "standoff.v2.CTEST.";

describe("sealed records", () => {
  const salt = new Uint8Array(32).map((_, i) => 255 - i);
  const rec = { hand: 18446744073709551615n, seat: 2, card: 1, target: 0, salt };

  it("round trips BigInt and bytes through JSON", () => {
    const s = encodeSealed(rec);
    expect(JSON.parse(s).hand).toBe("18446744073709551615");
    const back = decodeSealed(s)!;
    expect(back.hand).toBe(rec.hand);
    expect([...back.salt]).toEqual([...salt]);
    expect(decodeSealed("{bad")).toBeNull();
    expect(decodeSealed(JSON.stringify({ hand: "1", seat: 0, card: 0, target: 255, salt: "00" }))).toBeNull();
  });

  it("finds the record by on-chain commit and prunes old hands", () => {
    const store = memoryStore();
    const hex = putSealed(store, P, rec);
    expect(hex).toBe(sealedCommit(rec));
    const onChain = commitment(rec.hand, 2, 1, 0, salt);
    expect(findSealed(store, P, rec.hand, onChain)?.card).toBe(1);
    expect(findSealed(store, P, rec.hand, fromHex("00".repeat(32)))).toBeNull();
    putSealed(store, P, { ...rec, hand: 5n });
    expect(pruneSealed(store, P, 6n)).toBe(1);
    expect(store.keys().length).toBe(1);
  });
});

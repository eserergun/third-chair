import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { commitPreimage, commitment, defaultName, dedupeNames, fromHex, narrate, roomId, toHex, xlm, NAMES } from "./local";
import { Keypair, StrKey } from "@stellar/stellar-sdk";

const vectors = JSON.parse(readFileSync(new URL("../../fixtures/commit.json", import.meta.url), "utf8")).vectors as Array<{
  hand: string; seat: number; card: number; target: number; salt: string; preimage: string; commit: string;
}>;

describe("commit", () => {
  for (const v of vectors) {
    it(`matches fixture hand ${v.hand}`, () => {
      const salt = fromHex(v.salt);
      expect(toHex(commitPreimage(BigInt(v.hand), v.seat, v.card, v.target, salt))).toBe(v.preimage);
      expect(toHex(commitment(BigInt(v.hand), v.seat, v.card, v.target, salt))).toBe(v.commit);
    });
  }
});

describe("names and rooms", () => {
  it("derives a default name from raw[0]", () => {
    const kp = Keypair.random();
    const raw = StrKey.decodeEd25519PublicKey(kp.publicKey());
    expect(defaultName(kp.publicKey())).toBe(NAMES[raw[0] % NAMES.length]);
  });
  it("adds II to a repeated name", () => {
    expect(dedupeNames(["Wes", "Cal", "Wes"])).toEqual(["Wes", "Cal", "Wes II"]);
  });
  it("maps slugs", () => {
    expect(roomId("live")).toBe(3);
    expect(roomId("Tucsan")).toBe(8);
    expect(roomId("nowhere")).toBeNull();
  });
  it("formats xlm", () => {
    expect(xlm(10_000_000n)).toBe("1");
    expect(xlm("15000000")).toBe("1.5");
  });
});

describe("narrate", () => {
  const base = { names: ["Wes", "Ivy", "Ned"], hit: [false, false, false], out: [0, 0, 0], scattered: false, paid: 0n, houseWinner: false };
  it("paid win", () => {
    expect(narrate({ ...base, cards: [1, 0, 2], hit: [false, true, false], winner: 0, quiet: false, note: 4, paid: 10_000_000n })[0]).toBe(
      "Wes takes the purse. 1 testnet XLM.",
    );
  });
  it("quiet and scatter and slept", () => {
    const l = narrate({ ...base, cards: [4, 0, 2], out: [4, 0, 0], winner: 3, quiet: true, scattered: true, note: 0 });
    expect(l).toEqual([
      "A quiet minute. Dust, and no iron. The purse stays.",
      "Three quiet minutes. The table scatters.",
      "Wes slept through the minute. That plays as Air.",
    ]);
  });
  it("house win and ran hit", () => {
    const l = narrate({ ...base, cards: [3, 1, 2], hit: [true, false, false], winner: 1, quiet: false, note: 1, houseWinner: true, out: [2, 0, 0] });
    expect(l).toEqual(["Ivy takes the minute. The house keeps the purse.", "Wes ran, and the iron found them."]);
  });
});

import { describe, expect, it } from "vitest";
import { narrate, formatXlm, type NarrateInput, type NarrateSeat } from "./narrate";

const seat = (name: string, p: Partial<NarrateSeat> = {}): NarrateSeat => ({
  kind: "player", name, card: "air", target: null, hit: false, out: "stays", ...p,
});
const base = (p: Partial<NarrateInput>): NarrateInput => ({
  seats: [seat("Wes"), seat("Ivy", { kind: "house" }), seat("Ned", { kind: "house" })],
  winner: null, quiet: false, scattered: false, paid: "0", note: "none", ...p,
});
const winWes = (note: NarrateInput["note"], paid = "0") =>
  base({ seats: [seat("Wes", { card: "iron", target: 1 }), seat("Ivy", { kind: "house", hit: true }), seat("Ned", { kind: "house", card: "table" })], winner: 0, note, paid });

describe("narrate main line", () => {
  it("covers every note", () => {
    expect(narrate(winWes("paid", "10000000"))[0]).toBe("Wes takes the purse. 1 testnet XLM.");
    expect(narrate(winWes("unclaimed"))[0]).toBe("Wes takes the chair, but sits unclaimed. The purse will not pay them.");
    expect(narrate(winWes("empty"))[0]).toBe("Wes takes the chair. The purse had nothing to send.");
    expect(narrate(winWes("ran"))[0]).toBe("Wes takes the chair. Somebody ran, so the purse does not move.");
    expect(narrate(winWes("resting"))[0]).toBe("Wes takes the chair. The purse is resting.");
    expect(narrate(base({ winner: 2, note: "house", seats: [seat("Wes", { hit: true }), seat("Ivy", { kind: "house", card: "table" }), seat("Ned", { kind: "house", card: "iron", target: 0 })] }))[0])
      .toBe("Ned takes the minute. The house keeps the purse.");
  });
  it("covers the no-winner lines", () => {
    expect(narrate(base({ quiet: true }))[0]).toBe("A quiet minute. Dust, and no iron. The purse stays.");
    expect(narrate(base({ seats: [seat("Wes", { card: "iron", target: 1 }), seat("Ivy", { kind: "house", card: "table" }), seat("Ned", { kind: "house", card: "table" })] }))[0])
      .toBe("One chair is standing, but the iron did not find open air. The purse stays.");
    expect(narrate(base({ seats: [seat("Wes", { card: "iron", target: 1, hit: true }), seat("Ivy", { kind: "house", card: "iron", target: 0, hit: true }), seat("Ned", { kind: "house", card: "table" })] }))[0])
      .toBe("Nobody is standing. The purse stays.");
    expect(narrate(base({ seats: [seat("Wes", { card: "iron", target: 2 }), seat("Ivy", { kind: "house" }), seat("Ned", { kind: "house", card: "table" })] }))[0])
      .toBe("More than one chair is standing. The purse stays.");
  });
  it("formats amounts", () => {
    expect(formatXlm("25000000")).toBe("2.5");
    expect(formatXlm(10_000_000n)).toBe("1");
    expect(formatXlm("1")).toBe("0.0000001");
  });
  it("practice replaces money endings", () => {
    expect(narrate(winWes("paid", "10000000"), { practice: true })[0]).toBe("Wes takes the purse. Practice. Nothing moved.");
    expect(narrate(winWes("resting"), { practice: true })[0]).toBe("Wes takes the chair. Practice. Nothing moved.");
  });
});

describe("narrate extra lines", () => {
  it("lists scatter once, then seat lines in order", () => {
    const lines = narrate(base({
      quiet: true, scattered: true,
      seats: [seat("Wes", { card: "slept", out: "carried" }), seat("Ada", { card: "ran", out: "ran" }), seat("Bo", { out: "left" })],
    }));
    expect(lines).toEqual([
      "A quiet minute. Dust, and no iron. The purse stays.",
      "Three quiet minutes. The table scatters.",
      "Wes slept through the minute. That plays as Air.",
      "Wes was carried out.",
      "Ada ran. The chair is empty.",
      "Bo stood up.",
    ]);
  });
  it("ran and hit", () => {
    const lines = narrate(base({ seats: [seat("Wes", { card: "ran", hit: true, out: "ran" }), seat("Ivy", { kind: "house", card: "iron", target: 0 }), seat("Ned", { kind: "house", card: "table" })], winner: 1, note: "house" }));
    expect(lines).toEqual(["Ivy takes the minute. The house keeps the purse.", "Wes ran, and the iron found them."]);
  });
});

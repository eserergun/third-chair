import { describe, expect, it } from "vitest";
import judgeFx from "../../fixtures/judge.json";
import commitFx from "../../fixtures/commit.json";
import { judge, validateCard, cardCode, cardName, NONE } from "./rules";
import { bytesToHex, commitHash, commitPreimage, hexToBytes, newSalt } from "./commit";
import { roomBySlug, ROOMS, DEFAULT_ROOM } from "./rooms";
import { defaultName, dedupeNames, foldLookalikeName, isHouseLookalike, NAMES, validPlayerName } from "./names";
import { StrKey } from "@stellar/stellar-sdk";

describe("judge", () => {
  it("has 216 cases", () => expect(judgeFx.cases.length).toBe(216));
  it("matches every fixture case", () => {
    for (const c of judgeFx.cases) {
      const j = judge(c.cards, c.targets);
      expect({ ...j, cards: c.cards }).toEqual({ hit: c.hit, standing: c.standing, winner: c.winner, quiet: c.quiet, cards: c.cards });
    }
  });
});

describe("validateCard", () => {
  it("follows SPEC 5.2", () => {
    expect(validateCard(0, 0, NONE, 1)).toBeNull();
    expect(validateCard(0, 2, NONE, 0)).toBeNull();
    expect(validateCard(0, 1, 1, 1)).toBeNull();
    expect(validateCard(0, 3, NONE, 1)).toBe("BadCard");
    expect(validateCard(0, 1, 0, 1)).toBe("BadTarget");
    expect(validateCard(0, 1, 3, 1)).toBe("BadTarget");
    expect(validateCard(0, 1, 2, 0)).toBe("NoBullet");
    expect(validateCard(0, 0, 1, 1)).toBe("BadTarget");
  });
  it("maps card codes", () => {
    expect(cardCode("air")).toBe(0);
    expect(cardCode("iron")).toBe(1);
    expect(cardCode("table")).toBe(2);
    expect([0, 1, 2, 3, 4].map(cardName)).toEqual(["air", "iron", "table", "ran", "slept"]);
  });
});

describe("commit", () => {
  it("matches the vectors", () => {
    for (const v of commitFx.vectors) {
      const salt = hexToBytes(v.salt);
      expect(bytesToHex(commitPreimage(BigInt(v.hand), v.seat, v.card, v.target, salt))).toBe(v.preimage);
      expect(bytesToHex(commitHash(BigInt(v.hand), v.seat, v.card, v.target, salt))).toBe(v.commit);
    }
  });
  it("makes fresh 32 byte salts", () => {
    const a = newSalt();
    expect(a.length).toBe(32);
    expect(bytesToHex(a)).not.toBe(bytesToHex(newSalt()));
  });
});

describe("rooms", () => {
  it("has nine rooms and the live alias", () => {
    expect(ROOMS.length).toBe(9);
    expect(DEFAULT_ROOM).toBe(3);
    expect(roomBySlug("live")?.id).toBe(3);
    expect(roomBySlug("tucsan")).toMatchObject({ id: 8, name: "Tucsan", x: 0.825, y: 0.788 });
    expect(roomBySlug("nowhere")).toBeUndefined();
  });
});

describe("names", () => {
  it("derives the default name from raw[0]", () => {
    for (let b = 0; b < 48; b++) {
      const raw = new Uint8Array(32).fill(7);
      raw[0] = b;
      const addr = StrKey.encodeEd25519PublicKey(Buffer.from(raw));
      expect(defaultName(addr)).toBe(NAMES[b % 24]);
    }
    expect(NAMES.length).toBe(24);
    expect(NAMES[0]).toBe("Wes");
    expect(NAMES[23]).toBe("Tess");
  });
  it("dedupes later seats", () => {
    expect(dedupeNames(["Wes", "Ivy", "Wes"])).toEqual(["Wes", "Ivy", "Wes II"]);
    expect(dedupeNames(["Ada", "Ada", "Ada"])).toEqual(["Ada", "Ada II", "Ada III"]);
  });
  it("rejects house names and ASCII lookalikes", () => {
    expect(foldLookalikeName("CaI")).toBe("cai");
    expect(foldLookalikeName("lvy")).toBe("ivy");
    expect(foldLookalikeName("N0d")).toBe("nod");
    for (const bad of ["Cal", "ivy", "NED", "CaI", "Cai", "Ca1", "lvy", "1vy"]) {
      expect(isHouseLookalike(bad), bad).toBe(true);
      expect(validPlayerName(bad), bad).toBe(false);
    }
    // 0→o yields "nod", which is not Ned; keep it allowed.
    for (const ok of ["Wes", "Cab", "Ivo", "n3d", "N0d", "Calvin Cord1", "Doc Holli"]) {
      expect(validPlayerName(ok), ok).toBe(true);
    }
    expect(validPlayerName("")).toBe(false);
    expect(validPlayerName(" Wes")).toBe(false);
    expect(validPlayerName("Wes ")).toBe(false);
    expect(validPlayerName("Bad!")).toBe(false);
    expect(validPlayerName("Thirteen char")).toBe(false);
  });
});

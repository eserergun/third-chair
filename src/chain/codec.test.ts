import { Address, Keypair, nativeToScVal, scValToNative, xdr } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { decodeChair, decodeRoom, decodeStats, dataKey, dueStep, keys, toRoomView, type ChairMap } from "./codec";

const sym = (s: string) => xdr.ScVal.scvSymbol(s);
function struct(o: Record<string, xdr.ScVal>): xdr.ScVal {
  return xdr.ScVal.scvMap(Object.keys(o).sort().map((k) => new xdr.ScMapEntry({ key: sym(k), val: o[k] })));
}
const u32 = (n: number) => xdr.ScVal.scvU32(n);
const u64 = (n: bigint) => nativeToScVal(n, { type: "u64" });
const i128 = (n: bigint) => nativeToScVal(n, { type: "i128" });
const bool = (b: boolean) => xdr.ScVal.scvBool(b);
const addr = (a: string) => new Address(a).toScVal();
const none = () => xdr.ScVal.scvVoid();
const vec = (v: xdr.ScVal[]) => xdr.ScVal.scvVec(v);

const P = Keypair.random().publicKey();
const Q = Keypair.random().publicKey();
const commit = new Uint8Array(32).map((_, i) => i);

function seat(who: string | null, state: number, card = 0, target = 255): xdr.ScVal {
  return struct({
    who: who ? addr(who) : none(),
    claimed: bool(false),
    state: u32(state),
    commit: xdr.ScVal.scvBytes(state === 1 ? commit : new Uint8Array(32)),
    card: u32(card),
    target: u32(target),
    bullet: u32(1),
    leaving: bool(false),
    missed: u32(0),
  });
}

const handVal = struct({
  hand: u64(41n),
  minute: u32(7),
  at: u64(1_700_000_000n),
  who: vec([addr(P), none(), none()]),
  cards: vec([u32(1), u32(0), u32(2)]),
  targets: vec([u32(1), u32(255), u32(255)]),
  hit: vec([bool(false), bool(true), bool(false)]),
  out: vec([u32(0), u32(0), u32(0)]),
  winner: u32(0),
  quiet: bool(false),
  scattered: bool(false),
  paid: i128(10_000_000n),
  note: u32(4),
});

const roomVal = struct({
  id: u32(3),
  phase: u32(2),
  hand: u64(18446744073709551615n),
  minute: u32(8),
  opened: u64(1_700_000_060n),
  deadline: u64(1_700_000_120n),
  reveal_by: u64(1_700_000_165n),
  locked_at: u32(0),
  commit_secs: u64(60n),
  reveal_secs: u64(45n),
  seats: vec([seat(P, 1), seat(Q, 2, 1, 0), seat(null, 2, 2)]),
  queue: vec([]),
  quiet: u32(1),
  recent: vec([handVal]),
});

describe("keys", () => {
  it("encodes enum keys as vec [symbol, arg]", () => {
    const k = keys.room(3);
    expect(scValToNative(k)).toEqual(["Room", 3]);
    expect(scValToNative(keys.chair(P))).toEqual(["Chair", P]);
    expect(scValToNative(keys.board())).toEqual(["Board"]);
    const lk = dataKey("CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE", k);
    expect(lk.type).toBe("contractData");
    // Round trip through XDR.
    expect(xdr.LedgerKey.fromXdr(lk.toXdr("base64"), "base64").toXdr("base64")).toBe(lk.toXdr("base64"));
  });
});

describe("decode", () => {
  it("decodes a room with BigInt and bytes", () => {
    const wire = xdr.ScVal.fromXdr(roomVal.toXdr("base64"), "base64");
    const r = decodeRoom(wire);
    expect(r.hand).toBe(18446744073709551615n);
    expect(r.deadline).toBe(1_700_000_120n);
    expect(r.seats[0].who).toBe(P);
    expect(r.seats[2].who).toBeNull();
    expect(r.seats[0].commit).toBeInstanceOf(Uint8Array);
    expect([...r.seats[0].commit]).toEqual([...commit]);
    expect(r.recent[0].who).toEqual([P, null, null]);
    expect(r.recent[0].paid).toBe(10_000_000n);
  });

  it("decodes chair and stats", () => {
    const c = decodeChair(struct({ owner: addr(Q), claimed: bool(true), agent: bool(true), name: nativeToScVal("Dusty", { type: "string" }), room: u32(255) }));
    expect(c).toEqual({ owner: Q, claimed: true, agent: true, name: "Dusty", room: 255 });
    const s = decodeStats(
      struct({
        busy: none(), hands: u32(3), wins: u32(1), hits: u32(1), falls: u32(0), ran: u32(0),
        earned: i128(10_000_000n), day: u64(19000n), day_paid: u32(1),
      }),
    );
    expect(s.busy).toBeNull();
    expect(s.earned).toBe(10_000_000n);
  });

  it("builds a view", () => {
    const r = decodeRoom(roomVal);
    const chairs: ChairMap = new Map([[Q, { owner: Q, claimed: true, agent: true, name: "Dusty", room: 3 }]]);
    const v = toRoomView(r, { now: 1_700_000_170, ledger: 100, you: P, chairs });
    expect(v.slug).toBe("denvar");
    expect(v.phase).toBe("reveal");
    expect(v.hand).toBe("18446744073709551615");
    expect(v.seats[0].you).toBe(true);
    expect(v.seats[0].state).toBe("sealed");
    expect(v.seats[0].card).toBeNull();
    expect(v.seats[1]).toMatchObject({ kind: "agent", name: "Dusty", card: "iron", target: 0 });
    expect(v.seats[2]).toMatchObject({ kind: "house", name: "Ned", card: "table" });
    expect(v.you).toEqual({ seat: 0, queued: false, state: "sealed", bullet: 1 });
    expect(v.due).toBe("lock");
    expect(v.recent[0].lines[0]).toMatch(/takes the purse\. 1 testnet XLM\./);
    expect(v.recent[0].seats[1]).toMatchObject({ kind: "house", name: "Ivy", hit: true });
  });

  it("due steps", () => {
    const r = decodeRoom(roomVal);
    expect(dueStep({ ...r, phase: 1 }, 1_700_000_119, 1)).toBeNull();
    expect(dueStep({ ...r, phase: 1 }, 1_700_000_120, 1)).toBe("close");
    expect(dueStep({ ...r, phase: 3, locked_at: 50 }, 0, 50)).toBeNull();
    expect(dueStep({ ...r, phase: 3, locked_at: 50 }, 0, 51)).toBe("settle");
  });
});

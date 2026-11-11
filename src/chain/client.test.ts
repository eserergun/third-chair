import { Account, Address, Keypair, Networks, SorobanDataBuilder, TransactionBuilder, nativeToScVal, rpc, scValToNative, xdr } from "@stellar/stellar-sdk";
import type { Transaction } from "@stellar/stellar-sdk";
import { describe, expect, it, vi } from "vitest";
import { createChainClient } from "./client";
import type { Deployment } from "./config";
import { commitment, toHex } from "./local";
import { memoryStore } from "./store";
import type { Rpc } from "./tx";
import type { RoomView } from "../shared/game-client";

const CID = "CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE";
const d: Deployment = {
  rpcUrl: "https://example.invalid",
  networkPassphrase: Networks.TESTNET,
  friendbotUrl: "https://friendbot.invalid",
  contractId: CID,
  nativeSac: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  explorer: "https://stellar.expert/explorer/testnet",
};

const sym = (s: string) => xdr.ScVal.scvSymbol(s);
const struct = (o: Record<string, xdr.ScVal>) =>
  xdr.ScVal.scvMap(Object.keys(o).sort().map((k) => new xdr.ScMapEntry({ key: sym(k), val: o[k] })));
const u32 = (n: number) => xdr.ScVal.scvU32(n);
const u64 = (n: bigint) => nativeToScVal(n, { type: "u64" });
const addr = (a: string) => new Address(a).toScVal();

interface SeatState { who: string | null; state: number; commit: Uint8Array }
function roomVal(phase: number, hand: bigint, seats: SeatState[]): xdr.ScVal {
  return struct({
    id: u32(3), phase: u32(phase), hand: u64(hand), minute: u32(1),
    opened: u64(1000n), deadline: u64(1060n), reveal_by: u64(phase === 2 ? 1105n : 0n), locked_at: u32(0),
    commit_secs: u64(60n), reveal_secs: u64(45n),
    seats: xdr.ScVal.scvVec(seats.map((s) => struct({
      who: s.who ? addr(s.who) : xdr.ScVal.scvVoid(), claimed: xdr.ScVal.scvBool(false), state: u32(s.state),
      commit: xdr.ScVal.scvBytes(s.commit), card: u32(0), target: u32(255), bullet: u32(1),
      leaving: xdr.ScVal.scvBool(false), missed: u32(0),
    }))),
    queue: xdr.ScVal.scvVec([]), quiet: u32(0), recent: xdr.ScVal.scvVec([]),
  });
}

function fakeChain(me: Keypair) {
  const other = Keypair.random().publicKey();
  const zero = new Uint8Array(32);
  const state = { room: roomVal(1, 9n, [{ who: me.publicKey(), state: 0, commit: zero }, { who: other, state: 0, commit: zero }, { who: null, state: 0, commit: zero }]) };
  const calls: Array<{ fn: string; args: unknown[] }> = [];
  const r: Rpc = {
    getAccount: vi.fn(async (a: string) => new Account(a, "10")),
    simulateTransaction: vi.fn(async () => ({
      id: "1", latestLedger: 10, events: [], _parsed: true, minResourceFee: "100",
      transactionData: new SorobanDataBuilder().setResources(100, 1, 1).setResourceFee(100),
      result: { auth: [], retval: xdr.ScVal.scvVoid() },
    }) as rpc.Api.SimulateTransactionSuccessResponse),
    sendTransaction: vi.fn(async (tx: Transaction) => {
      const op = tx.operations[0] as unknown as { func: { invokeContract: { functionName: { toString(): string }; args: xdr.ScVal[] } } };
      calls.push({ fn: op.func.invokeContract.functionName.toString(), args: op.func.invokeContract.args.map((a) => scValToNative(a)) });
      return { status: "PENDING", hash: `h${calls.length}`, latestLedger: 10, latestLedgerCloseTime: 1001 } as rpc.Api.SendTransactionResponse;
    }),
    getTransaction: vi.fn(async () => ({ status: rpc.Api.GetTransactionStatus.SUCCESS, events: { contractEventsXdr: [], transactionEventsXdr: [] }, ledger: 11, latestLedger: 11, latestLedgerCloseTime: 1002 }) as never),
    getHealth: vi.fn(async () => ({ status: "healthy", latestLedger: 10, oldestLedger: 1, ledgerRetentionWindow: 1, latestLedgerCloseTime: 1001 }) as never),
    getLedgerEntries: vi.fn(async (...keys: xdr.LedgerKey[]) => ({
      latestLedger: 10,
      entries: keys.flatMap((k) => {
        if (k.type !== "contractData") return [];
        const native = scValToNative(k.contractData.key) as unknown[];
        if (native[0] !== "Room") return [];
        return [{ key: k, val: xdr.LedgerEntryData.contractData(new xdr.ContractDataEntry({ ext: xdr.ExtensionPoint.v0(), contract: k.contractData.contract, key: k.contractData.key, durability: xdr.ContractDataDurability.persistent, val: state.room })) }];
      }),
    }) as never),
  };
  return { rpc: r, state, calls, other };
}

describe("ChainClient", () => {
  it("reads a room, seals a card, and the croupier reveals it", async () => {
    const me = Keypair.random();
    const chain = fakeChain(me);
    const store = memoryStore();
    store.set(`standoff.v2.${CID}.funded`, me.publicKey());
    const client = createChainClient({ deployment: d, rpc: chain.rpc, store, sessionSecret: me.secret(), pollMs: 20, tx: { sleep: async () => undefined, pollMs: 0 } });

    const view = await client.room(3);
    expect(view.seats[0].you).toBe(true);
    expect(view.seats[2].name).toBe("Ned");
    expect(view.now).toBeGreaterThanOrEqual(1001);

    // The other player is still choosing, so the card goes face down.
    const r = await client.playCard(3, "iron", 1);
    expect(r).toBe("sealed");
    expect(chain.calls[0].fn).toBe("commit");
    const commitBytes = chain.calls[0].args[3] as Uint8Array;
    const keys = store.keys().filter((k) => k.includes(".sealed.9."));
    expect(keys.length).toBe(1);
    expect(keys[0].endsWith(toHex(commitBytes))).toBe(true);

    // Chain moves to reveal with our commit stored.
    chain.state.room = roomVal(2, 9n, [
      { who: me.publicKey(), state: 1, commit: new Uint8Array(commitBytes) },
      { who: chain.other, state: 2, commit: new Uint8Array(32) },
      { who: null, state: 0, commit: new Uint8Array(32) },
    ]);
    const views: RoomView[] = [];
    const stop = client.watch(3, (v) => views.push(v));
    await vi.waitFor(() => expect(chain.calls.some((c) => c.fn === "reveal")).toBe(true), { timeout: 3000 });
    stop();
    const rev = chain.calls.find((c) => c.fn === "reveal")!;
    const salt = rev.args[5] as Uint8Array;
    expect(rev.args.slice(3, 5)).toEqual([1, 1]);
    expect(toHex(commitment(9n, 0, 1, 1, new Uint8Array(salt)))).toBe(toHex(commitBytes));
    expect(views[0].phase).toBe("reveal");
  });

  it("plays face up when every other player is down", async () => {
    const me = Keypair.random();
    const chain = fakeChain(me);
    chain.state.room = roomVal(1, 9n, [
      { who: me.publicKey(), state: 0, commit: new Uint8Array(32) },
      { who: chain.other, state: 1, commit: new Uint8Array(32).fill(1) },
      { who: null, state: 0, commit: new Uint8Array(32) },
    ]);
    const store = memoryStore();
    const client = createChainClient({ deployment: d, rpc: chain.rpc, store, sessionSecret: me.secret(), tx: { sleep: async () => undefined, pollMs: 0 } });
    const events: string[] = [];
    client.onTx((e) => events.push(`${e.label}:${e.stage}`));
    expect(await client.playCard(3, "table", null)).toBe("played");
    expect(chain.calls[0]).toMatchObject({ fn: "play", args: [me.publicKey(), 3, 9n, 2, 255] });
    expect(events[0]).toBe("Table:preparing");
    expect(events.at(-1)).toBe("Table:done");
  });

  it("shows our card down at once and settles its own lock without the seat stagger", async () => {
    const me = Keypair.random();
    const chain = fakeChain(me);
    const zero = new Uint8Array(32);
    // We sit in seat 2 (stagger 12 s by default); the other player is already shown.
    chain.state.room = roomVal(1, 9n, [
      { who: chain.other, state: 2, commit: zero },
      { who: null, state: 0, commit: zero },
      { who: me.publicKey(), state: 0, commit: zero },
    ]);
    const lockedEv = new xdr.ContractEvent({
      ext: xdr.ExtensionPoint.v0(),
      contractId: null,
      type: xdr.ContractEventType.contract,
      body: xdr.ContractEventBody.v0(new xdr.ContractEventV0({ topics: [sym("locked"), u32(3)], data: xdr.ScVal.scvVoid() })),
    });
    chain.rpc.getTransaction = vi.fn(async () => ({
      status: rpc.Api.GetTransactionStatus.SUCCESS,
      events: { contractEventsXdr: chain.calls.at(-1)?.fn === "play" ? [[lockedEv]] : [], transactionEventsXdr: [] },
      ledger: 11, latestLedger: 11, latestLedgerCloseTime: 1002,
    }) as never);
    const store = memoryStore();
    store.set(`standoff.v2.${CID}.funded`, me.publicKey());
    const client = createChainClient({ deployment: d, rpc: chain.rpc, store, sessionSecret: me.secret(), pollMs: 20, tx: { sleep: async () => undefined, pollMs: 0 } });
    const views: RoomView[] = [];
    const stop = client.watch(3, (v) => views.push(v));
    await vi.waitFor(() => expect(views.length).toBeGreaterThan(0));
    const reads = (chain.rpc.getLedgerEntries as ReturnType<typeof vi.fn>).mock.calls.length;

    expect(await client.playCard(3, "air", null)).toBe("played");
    // The fresh watched view chose play without another Room read before the send.
    expect(chain.calls[0].fn).toBe("play");
    expect(views.at(-1)!.you?.state).toBe("shown");
    expect(views.at(-1)!.seats[2].card).toBe("air");
    expect((chain.rpc.getLedgerEntries as ReturnType<typeof vi.fn>).mock.calls.length).toBeLessThanOrEqual(reads + 1);
    // The RPC still reports the seat waiting for a while: the view keeps the card down.
    const n = views.length;
    await vi.waitFor(() => expect(views.length).toBeGreaterThan(n + 2));
    expect(views.at(-1)!.you?.state).toBe("shown");

    // The chain locks; we settle at the next ledger with no 12 s stagger.
    chain.state.room = roomVal(3, 9n, [
      { who: chain.other, state: 2, commit: zero },
      { who: null, state: 0, commit: zero },
      { who: me.publicKey(), state: 2, commit: zero },
    ]);
    await vi.waitFor(() => expect(chain.calls.some((c) => c.fn === "resolve")).toBe(true), { timeout: 1500 });
    stop();
  });
});


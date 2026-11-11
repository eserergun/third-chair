import { Account, Address, Keypair, Networks, SorobanDataBuilder, TransactionBuilder, nativeToScVal, rpc, xdr } from "@stellar/stellar-sdk";
import type { Transaction } from "@stellar/stellar-sdk";
import { describe, expect, it, vi } from "vitest";
import type { Deployment } from "./config";
import {
  TEMPLATE_TTL_MS, TxSender, buildFromTemplate, keypairSigner, makeTemplate, padResources, sourceAuthEntry, templateFallsBack, type Rpc,
} from "./tx";
import { ChainError, contractError } from "./errors";

const CID = "CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE";
const SAC = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const d: Deployment = {
  rpcUrl: "https://example.invalid",
  networkPassphrase: Networks.TESTNET,
  friendbotUrl: "https://friendbot.invalid",
  contractId: CID,
  nativeSac: SAC,
  explorer: "https://stellar.expert/explorer/testnet",
};

const u32 = (n: number) => xdr.ScVal.scvU32(n);
const bytes = (b: number) => xdr.ScVal.scvBytes(new Uint8Array(32).fill(b));

function rootFor(fn: string, args: xdr.ScVal[], subs: xdr.SorobanAuthorizedInvocation[] = []) {
  return new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({ contractAddress: new Address(CID).toScAddress(), functionName: fn, args }),
    ),
    subInvocations: subs,
  });
}
const srcEntry = (root: xdr.SorobanAuthorizedInvocation) =>
  new xdr.SorobanAuthorizationEntry({ credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(), rootInvocation: root });

/** A footprint with one read-write entry so tests can see it travel from template to tx. */
function footprintData(instructions = 1000) {
  const key = xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({ contract: new Address(CID).toScAddress(), key: xdr.ScVal.scvSymbol("Room"), durability: xdr.ContractDataDurability.persistent }),
  );
  return new SorobanDataBuilder().setResources(instructions, 10, 10).setResourceFee(400).setReadWrite([key]);
}

function simFor(fn: string, args: xdr.ScVal[], instructions = 1000): rpc.Api.SimulateTransactionSuccessResponse {
  return {
    id: "1", latestLedger: 10, events: [], _parsed: true, transactionData: footprintData(instructions), minResourceFee: "400",
    result: { auth: [srcEntry(rootFor(fn, args))], retval: xdr.ScVal.scvVoid() },
  };
}

function okTx() {
  return { status: rpc.Api.GetTransactionStatus.SUCCESS, returnValue: xdr.ScVal.scvU32(1), events: { contractEventsXdr: [], transactionEventsXdr: [] }, ledger: 11, latestLedger: 11, latestLedgerCloseTime: 1005 };
}
function failedTx(code: string) {
  const ihf = (xdr.InvokeHostFunctionResult as unknown as Record<string, unknown>)[code];
  const inner = typeof ihf === "function" ? (ihf as () => xdr.InvokeHostFunctionResult)() : (ihf as xdr.InvokeHostFunctionResult);
  const opRes = xdr.OperationResult.opInner(xdr.OperationResultTr.invokeHostFunction(inner));
  const resultXdr = new xdr.TransactionResult({ feeCharged: 100n, result: xdr.TransactionResultResult.txFailed([opRes]), ext: xdr.TransactionResultExt.v0() } as never);
  return { status: rpc.Api.GetTransactionStatus.FAILED, resultXdr, diagnosticEventsXdr: [], events: { contractEventsXdr: [], transactionEventsXdr: [] }, latestLedger: 1, latestLedgerCloseTime: 1 };
}

function mockRpc(over: Partial<Rpc> = {}) {
  const kp = Keypair.random();
  const sent: Transaction[] = [];
  const base: Rpc = {
    getAccount: vi.fn(async (a: string) => new Account(a, "100")),
    // The simulation echoes the call's own shape, like the real contract (one source-account auth entry).
    simulateTransaction: vi.fn(async (tx: Transaction) => {
      const op = tx.operations[0] as unknown as { func: { invokeContract: xdr.InvokeContractArgs } };
      const c = op.func.invokeContract;
      return simFor(c.functionName.toString(), c.args);
    }),
    sendTransaction: vi.fn(async (tx: Transaction) => {
      sent.push(tx);
      return { status: "PENDING", hash: "h" + sent.length, latestLedger: 10, latestLedgerCloseTime: 1000 } as rpc.Api.SendTransactionResponse;
    }),
    getTransaction: vi.fn(async () => okTx() as never),
    getHealth: vi.fn(async () => ({ status: "healthy", latestLedger: 10, oldestLedger: 1, ledgerRetentionWindow: 100 }) as const),
    getLedgerEntries: vi.fn(async () => ({ entries: [], latestLedger: 10 })),
  };
  return { kp, rpc: { ...base, ...over }, sent };
}

function sorobanDataOf(tx: Transaction): xdr.SorobanTransactionData {
  const env = tx.toEnvelope() as unknown as { value: { tx: { ext: { value: xdr.SorobanTransactionData } } } };
  return env.value.tx.ext.value;
}
function authOf(tx: Transaction): xdr.SorobanAuthorizationEntry[] {
  return (tx.operations[0] as unknown as { auth: xdr.SorobanAuthorizationEntry[] }).auth;
}

const fast = { sleep: async () => undefined, pollMs: 0, now: () => 1_700_000_000 };
const HAND = { room: 4, hand: 77n };
const realCommit = (me: string) => [new Address(me).toScVal(), u32(4), nativeToScVal(77n, { type: "u64" }), bytes(9)];
const dummyCommit = (me: string) => [new Address(me).toScVal(), u32(4), nativeToScVal(77n, { type: "u64" }), bytes(1)];

describe("card template build", () => {
  it("keeps the padded soroban data and fee, and builds the real call with its own source auth", () => {
    const sim = simFor("commit", [bytes(1)]);
    const t = makeTemplate("commit", sim, 5)!;
    const p = padResources({ instructions: 1000, diskReadBytes: 10, writeBytes: 10, resourceFee: 400n });
    expect(t).toMatchObject({ fn: "commit", auth: 1, at: 5, resourceFee: p.resourceFee });

    const src = Keypair.random().publicKey();
    const args = [bytes(9), u32(2)];
    const tx = buildFromTemplate(t, { source: src, seq: 41n, contractId: CID, networkPassphrase: d.networkPassphrase, fn: "commit", args, maxTime: 1234 });
    expect(tx.sequence).toBe("42");
    expect(tx.timeBounds?.maxTime).toBe("1234");
    // Same fee rule as the simulated path: base fee + padded resource fee.
    expect(BigInt(tx.fee)).toBe(100n + p.resourceFee);
    const sd = sorobanDataOf(tx);
    expect(sd.resources.instructions).toBe(p.instructions);
    expect(sd.resources.diskReadBytes).toBe(p.diskReadBytes);
    expect(sd.resources.writeBytes).toBe(p.writeBytes);
    expect(BigInt(sd.resourceFee)).toBe(p.resourceFee);
    expect(sd.resources.footprint.readWrite.length).toBe(1);
    // Auth: source-account credentials, root = our contract + fn + the REAL args, no sub-invocations.
    const auth = authOf(tx);
    expect(auth.length).toBe(1);
    expect(auth[0].credentials.type).toBe("sorobanCredentialsSourceAccount");
    const root = auth[0].rootInvocation;
    expect(root.subInvocations.length).toBe(0);
    const c = (root.function as unknown as { contractFn: xdr.InvokeContractArgs }).contractFn;
    expect(Address.fromScAddress(c.contractAddress).toString()).toBe(CID);
    expect(c.functionName.toString()).toBe("commit");
    expect(c.args.map((a: xdr.ScVal) => a.toXDR("base64"))).toEqual(args.map((a) => a.toXDR("base64")));
    expect(sourceAuthEntry(CID, "commit", args).toXDR("base64")).toBe(auth[0].toXDR("base64"));
  });

  it("matches the soroban data and fee of the simulated path for the same simulation", async () => {
    const m = mockRpc();
    const s = new TxSender(m.rpc, d, fast);
    const me = m.kp.publicKey();
    const prep = TransactionBuilder.fromXDR((await s.prepare(me, 100n, "commit", realCommit(me))).xdr, d.networkPassphrase) as Transaction;
    const t = makeTemplate("commit", simFor("commit", realCommit(me)), 0)!;
    const tx = buildFromTemplate(t, { source: me, seq: 100n, contractId: CID, networkPassphrase: d.networkPassphrase, fn: "commit", args: realCommit(me), maxTime: Number(prep.timeBounds!.maxTime) });
    expect(sorobanDataOf(tx).toXDR("base64")).toBe(sorobanDataOf(prep).toXDR("base64"));
    expect(tx.fee).toBe(prep.fee);
    expect(tx.toXDR()).toBe(prep.toXDR());
  });

  it("refuses unusual auth shapes and mismatched calls", () => {
    const sub = simFor("commit", []);
    sub.result!.auth = [srcEntry(rootFor("commit", [], [rootFor("other", [])]))];
    expect(makeTemplate("commit", sub, 0)).toBeNull();
    const two = simFor("commit", []);
    two.result!.auth = [srcEntry(rootFor("commit", [])), srcEntry(rootFor("commit", []))];
    expect(makeTemplate("commit", two, 0)).toBeNull();
    const none = simFor("commit", []);
    none.result!.auth = [];
    const t = makeTemplate("commit", none, 0)!;
    expect(t.auth).toBe(0);
    const tx = buildFromTemplate(t, { source: Keypair.random().publicKey(), seq: 1n, contractId: CID, networkPassphrase: d.networkPassphrase, fn: "commit", args: [], maxTime: 9 });
    expect(authOf(tx).length).toBe(0);
    expect(() => buildFromTemplate(t, { source: Keypair.random().publicKey(), seq: 1n, contractId: CID, networkPassphrase: d.networkPassphrase, fn: "play", args: [], maxTime: 9 })).toThrow(/does not match/);
  });

  it("falls back on stale, auth, and send failures, not on contract errors or timeouts", () => {
    expect(templateFallsBack(new ChainError("x", null, "ResourceLimit"))).toBe(true);
    expect(templateFallsBack(new ChainError("The network refused the transaction (txSorobanInvalid)."))).toBe(true);
    expect(templateFallsBack(new Error("boom"))).toBe(true);
    expect(templateFallsBack(contractError(3))).toBe(false);
    expect(templateFallsBack(new ChainError("late", null, "Timeout"))).toBe(false);
  });
});

describe("TxSender card templates", () => {
  it("sends a card from the template with no simulation on the click", async () => {
    const m = mockRpc();
    const s = new TxSender(m.rpc, d, { ...fast, templates: true });
    const me = m.kp.publicKey();
    expect(await s.template(me, "commit", dummyCommit(me), HAND)).toBe(true);
    expect(m.rpc.simulateTransaction).toHaveBeenCalledTimes(1);
    const paths: string[] = [];
    const r = await s.invoke(keypairSigner(m.kp, d.networkPassphrase), "commit", realCommit(me), { template: HAND, resend: 1, onPath: (p) => paths.push(p) });
    expect(r.hash).toBe("h1");
    expect(paths).toEqual(["template"]);
    expect(m.rpc.simulateTransaction).toHaveBeenCalledTimes(1); // still only the template simulation
    const tx = m.sent[0];
    expect(tx.sequence).toBe("101");
    expect(tx.timeBounds?.maxTime).toBe(String(1_700_000_000 + 60));
    expect(tx.signatures.length).toBe(1);
    const op = tx.operations[0] as unknown as { func: { invokeContract: xdr.InvokeContractArgs } };
    expect(op.func.invokeContract.args[3].toXDR("base64")).toBe(bytes(9).toXDR("base64"));
    expect((authOf(tx)[0].rootInvocation.function as unknown as { contractFn: xdr.InvokeContractArgs }).contractFn.args[3].toXDR("base64")).toBe(bytes(9).toXDR("base64"));
    // One use per template: the next card simulates.
    await s.invoke(keypairSigner(m.kp, d.networkPassphrase), "commit", realCommit(me), { template: HAND, onPath: (p) => paths.push(p) });
    expect(paths).toEqual(["template", "simulated"]);
    expect(m.rpc.simulateTransaction).toHaveBeenCalledTimes(2);
    expect(m.sent[1].sequence).toBe("102");
  });

  it("waits for a template that is still simulating", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const m = mockRpc();
    const sim = m.rpc.simulateTransaction;
    m.rpc.simulateTransaction = vi.fn(async (tx: Transaction) => {
      await gate;
      return sim(tx);
    });
    const s = new TxSender(m.rpc, d, { ...fast, templates: true });
    const me = m.kp.publicKey();
    const building = s.template(me, "play", [u32(0)], HAND);
    const paths: string[] = [];
    const sending = s.invoke(keypairSigner(m.kp, d.networkPassphrase), "play", [u32(2)], { template: HAND, onPath: (p) => paths.push(p) });
    release();
    await building;
    await sending;
    expect(paths).toEqual(["template"]);
    expect(m.rpc.simulateTransaction).toHaveBeenCalledTimes(1);
  });

  it("falls back to a fresh simulation when the network refuses the templated tx", async () => {
    const m = mockRpc();
    let n = 0;
    const send = m.rpc.sendTransaction;
    m.rpc.sendTransaction = vi.fn(async (tx: Transaction) => {
      if (++n === 1) return { status: "ERROR", hash: "bad", latestLedger: 1, latestLedgerCloseTime: 1, errorResult: { result: { type: "txSorobanInvalid" } } } as never;
      return send(tx);
    });
    const s = new TxSender(m.rpc, d, { ...fast, templates: true });
    const me = m.kp.publicKey();
    await s.template(me, "commit", dummyCommit(me), HAND);
    const paths: string[] = [];
    const r = await s.invoke(keypairSigner(m.kp, d.networkPassphrase), "commit", realCommit(me), { template: HAND, resend: 1, onPath: (p) => paths.push(p) });
    expect(paths).toEqual(["template", "fallback"]);
    expect(r.hash).toBe("h1");
    expect(m.rpc.simulateTransaction).toHaveBeenCalledTimes(2);
    // The refused tx never took the sequence: the fallback reuses 101.
    expect(m.sent[0].sequence).toBe("101");
  });

  it("falls back after a resource failure on chain, on the next sequence", async () => {
    let gets2 = 0;
    const m2 = mockRpc({ getTransaction: vi.fn(async () => (++gets2 === 1 ? failedTx("invokeHostFunctionResourceLimitExceeded") : okTx()) as never) });
    const s = new TxSender(m2.rpc, d, { ...fast, templates: true });
    const me = m2.kp.publicKey();
    await s.template(me, "play", [u32(0)], HAND);
    const paths: string[] = [];
    const r = await s.invoke(keypairSigner(m2.kp, d.networkPassphrase), "play", [u32(1)], { template: HAND, resend: 1, onPath: (p) => paths.push(p) });
    expect(paths).toEqual(["template", "fallback"]);
    expect(r.hash).toBe("h2");
    expect(m2.sent.map((t) => t.sequence)).toEqual(["101", "102"]);
    expect(m2.rpc.simulateTransaction).toHaveBeenCalledTimes(2);
  });

  it("does not fall back on a decoded contract error", async () => {
    let sims = 0;
    const m = mockRpc();
    const sim = m.rpc.simulateTransaction;
    m.rpc.simulateTransaction = vi.fn(async (tx: Transaction) => (++sims === 1 ? sim(tx) : ({ id: "1", latestLedger: 1, events: [], _parsed: true, error: "Error(Contract, #4)" } as never)));
    m.rpc.getTransaction = vi.fn(async () => ({ status: rpc.Api.GetTransactionStatus.FAILED, events: { contractEventsXdr: [], transactionEventsXdr: [] }, latestLedger: 1, latestLedgerCloseTime: 1 }) as never);
    const s = new TxSender(m.rpc, d, { ...fast, templates: true });
    const me = m.kp.publicKey();
    await s.template(me, "play", [u32(0)], HAND);
    const paths: string[] = [];
    const err = await s.invoke(keypairSigner(m.kp, d.networkPassphrase), "play", [u32(1)], { template: HAND, resend: 1, onPath: (p) => paths.push(p) }).catch((e) => e);
    expect(err).toMatchObject({ errorName: "Played", hash: "h1" });
    expect(paths).toEqual(["template"]);
    expect(m.sent.length).toBe(1);
  });

  it("throws templates away after 40 s, on a new hand, and ignores them when templates are off", async () => {
    let now = 1_000_000;
    const m = mockRpc();
    const s = new TxSender(m.rpc, d, { ...fast, templates: true, clockMs: () => now });
    const me = m.kp.publicKey();
    const signer = keypairSigner(m.kp, d.networkPassphrase);
    const paths: string[] = [];
    const onPath = (p: string) => paths.push(p);

    await s.template(me, "play", [u32(0)], HAND);
    now += TEMPLATE_TTL_MS + 1;
    expect(await s.liveTemplate(me, "play", HAND)).toBeNull();
    await s.invoke(signer, "play", [u32(1)], { template: HAND, onPath });
    expect(paths).toEqual(["simulated"]);

    await s.template(me, "play", [u32(0)], HAND);
    await s.template(me, "commit", [u32(0)], { room: 4, hand: 78n }); // the next hand drops hand 77
    expect(await s.liveTemplate(me, "play", HAND)).toBeNull();
    expect(await s.liveTemplate(me, "commit", { room: 4, hand: 78n })).not.toBeNull();
    // Other rooms keep their templates.
    await s.template(me, "play", [u32(0)], { room: 5, hand: 1n });
    expect(await s.liveTemplate(me, "commit", { room: 4, hand: 78n })).not.toBeNull();

    const off = new TxSender(m.rpc, d, { ...fast, templates: false });
    await off.template(me, "play", [u32(0)], HAND);
    const before = (m.rpc.simulateTransaction as ReturnType<typeof vi.fn>).mock.calls.length;
    await off.invoke(signer, "play", [u32(1)], { template: HAND, onPath });
    expect((m.rpc.simulateTransaction as ReturnType<typeof vi.fn>).mock.calls.length).toBe(before + 1);
  });

  it("never templates other calls", async () => {
    const m = mockRpc();
    const s = new TxSender(m.rpc, d, { ...fast, templates: true });
    expect(await s.template(m.kp.publicKey(), "resolve", [], HAND)).toBe(false);
    expect(m.rpc.simulateTransaction).not.toHaveBeenCalled();
  });
});

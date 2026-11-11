import { Account, Address, Keypair, Networks, SorobanDataBuilder, TransactionBuilder, rpc, xdr } from "@stellar/stellar-sdk";
import { describe, expect, it, vi } from "vitest";
import type { Deployment } from "./config";
import { ChainError } from "./errors";
import { TX_LIMITS, TxSender, checkAuth, keypairSigner, padResources, type Rpc } from "./tx";
import { friendbot } from "./session";
import { assertWalletPassphrase, verifySignedBy } from "./wallet";

const CID = "CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE";
const SAC = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const OTHER = "CBQHNAXSI55GX2GN6D67GK7BHVPSLJUGZQEU7WJ5LKR5PNUCGLIMAO4K";
const d: Deployment = {
  rpcUrl: "https://example.invalid",
  networkPassphrase: Networks.TESTNET,
  friendbotUrl: "https://friendbot.invalid",
  contractId: CID,
  nativeSac: SAC,
  explorer: "https://stellar.expert/explorer/testnet",
};

function inv(contract: string, fn: string, subs: xdr.SorobanAuthorizedInvocation[] = []) {
  return new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({ contractAddress: new Address(contract).toScAddress(), functionName: fn, args: [] }),
    ),
    subInvocations: subs,
  });
}
function entry(root: xdr.SorobanAuthorizedInvocation, source = true) {
  const credentials = source
    ? xdr.SorobanCredentials.sorobanCredentialsSourceAccount()
    : xdr.SorobanCredentials.sorobanCredentialsAddress(
        new xdr.SorobanAddressCredentials({
          address: new Address(Keypair.random().publicKey()).toScAddress(),
          nonce: 1n,
          signatureExpirationLedger: 10,
          signature: xdr.ScVal.scvVoid(),
        }),
      );
  return new xdr.SorobanAuthorizationEntry({ credentials, rootInvocation: root });
}
const rule = (fn: string) => ({ contractId: CID, fn, source: "G", nativeSac: SAC });

describe("checkAuth", () => {
  it("accepts a plain source-account call", () => {
    expect(() => checkAuth([entry(inv(CID, "play"))], rule("play"))).not.toThrow();
    expect(() => checkAuth([], rule("resolve"))).not.toThrow();
  });
  it("rejects sub-invocations, other contracts, other functions, other signers", () => {
    expect(() => checkAuth([entry(inv(CID, "play", [inv(SAC, "transfer")]))], rule("play"))).toThrow(ChainError);
    expect(() => checkAuth([entry(inv(OTHER, "play"))], rule("play"))).toThrow(/unexpected call/);
    expect(() => checkAuth([entry(inv(CID, "leave"))], rule("play"))).toThrow(/unexpected call/);
    expect(() => checkAuth([entry(inv(CID, "play"), false)], rule("play"))).toThrow(/another signer/);
  });
  it("allows one native transfer under fund only", () => {
    expect(() => checkAuth([entry(inv(CID, "fund", [inv(SAC, "transfer")]))], rule("fund"))).not.toThrow();
    expect(() => checkAuth([entry(inv(CID, "fund", [inv(OTHER, "transfer")]))], rule("fund"))).toThrow();
    expect(() => checkAuth([entry(inv(CID, "fund", [inv(SAC, "transfer"), inv(SAC, "transfer")]))], rule("fund"))).toThrow();
  });
});

function simOk(auth: xdr.SorobanAuthorizationEntry[] = [], retval = xdr.ScVal.scvU32(7)): rpc.Api.SimulateTransactionSuccessResponse {
  const data = new SorobanDataBuilder().setResources(1000, 10, 10).setResourceFee(400);
  return { id: "1", latestLedger: 10, events: [], _parsed: true, transactionData: data, minResourceFee: "400", result: { auth, retval } };
}

function mockRpc(over: Partial<Rpc> = {}) {
  const kp = Keypair.random();
  let seq = 100n;
  const sent: string[] = [];
  const base: Rpc = {
    getAccount: vi.fn(async (a: string) => new Account(a, (seq).toString())),
    simulateTransaction: vi.fn(async () => simOk()),
    sendTransaction: vi.fn(async (tx) => {
      sent.push(tx.toXDR());
      return { status: "PENDING", hash: "h" + sent.length, latestLedger: 10, latestLedgerCloseTime: 1000 } as rpc.Api.SendTransactionResponse;
    }),
    getTransaction: vi.fn(async () => ({ status: rpc.Api.GetTransactionStatus.SUCCESS, returnValue: xdr.ScVal.scvU32(255), events: { contractEventsXdr: [], transactionEventsXdr: [] }, ledger: 11, latestLedger: 11, latestLedgerCloseTime: 1005 }) as never),
    getHealth: vi.fn(async () => ({ status: "healthy", latestLedger: 10, oldestLedger: 1, ledgerRetentionWindow: 100 }) as const),
    getLedgerEntries: vi.fn(async () => ({ entries: [], latestLedger: 10 })),
  };
  return { kp, rpc: { ...base, ...over }, sent, setSeq: (s: bigint) => (seq = s) };
}

function txResult(code: string): xdr.TransactionResult {
  const ihf = (xdr.InvokeHostFunctionResult as unknown as Record<string, unknown>)[code];
  const inner = typeof ihf === "function" ? (ihf as () => xdr.InvokeHostFunctionResult)() : (ihf as xdr.InvokeHostFunctionResult);
  const opRes = xdr.OperationResult.opInner(xdr.OperationResultTr.invokeHostFunction(inner));
  return new xdr.TransactionResult({ feeCharged: 100n, result: xdr.TransactionResultResult.txFailed([opRes]), ext: xdr.TransactionResultExt.v0() } as never);
}
function failedTx(code: string, diag: xdr.DiagnosticEvent[] = []) {
  return { status: rpc.Api.GetTransactionStatus.FAILED, resultXdr: txResult(code), diagnosticEventsXdr: diag, events: { contractEventsXdr: [], transactionEventsXdr: [] }, latestLedger: 1, latestLedgerCloseTime: 1 };
}
function okTx() {
  return { status: rpc.Api.GetTransactionStatus.SUCCESS, returnValue: xdr.ScVal.scvU32(1), events: { contractEventsXdr: [], transactionEventsXdr: [] }, ledger: 11, latestLedger: 11, latestLedgerCloseTime: 1005 };
}

const fast = { sleep: async () => undefined, pollMs: 0, now: () => 1_700_000_000 };

describe("padResources", () => {
  it("adds 25% CPU, max(25%, 2048) bytes, and 1.5x + 200000 stroops", () => {
    expect(padResources({ instructions: 1_000_000, diskReadBytes: 4000, writeBytes: 1000, resourceFee: 100_000n })).toEqual({
      instructions: 1_250_000,
      diskReadBytes: 6048, // 25% is 1000, the floor 2048 wins
      writeBytes: 3048,
      resourceFee: 350_000n,
    });
    // Big entries: 25% beats 2048.
    const big = padResources({ instructions: 3, diskReadBytes: 40_000, writeBytes: 20_000, resourceFee: 1n });
    expect(big.instructions).toBe(4);
    expect(big.diskReadBytes).toBe(50_000);
    expect(big.writeBytes).toBe(25_000);
    expect(big.resourceFee).toBe(200_001n);
  });
  it("never pads past the network limit, and never below the simulated value", () => {
    const p = padResources({ instructions: 0, diskReadBytes: 190_000, writeBytes: 131_000, resourceFee: 0n });
    expect(p.diskReadBytes).toBe(TX_LIMITS.diskReadBytes);
    expect(p.writeBytes).toBe(TX_LIMITS.writeBytes);
    const over = padResources({ instructions: 0, diskReadBytes: 250_000, writeBytes: 0, resourceFee: 0n });
    expect(over.diskReadBytes).toBe(250_000);
    expect(over.writeBytes).toBe(2048);
  });
});

describe("TxSender", () => {
  it("simulates, pads resources, sets timebounds, signs, sends, polls", async () => {
    const m = mockRpc();
    const s = new TxSender(m.rpc, d, fast);
    const r = await s.invoke(keypairSigner(m.kp, d.networkPassphrase), "sit", [xdr.ScVal.scvU32(3)]);
    expect(r.returnValue).toBe(255);
    expect(r.hash).toBe("h1");
    const tx = TransactionBuilder.fromXDR(m.sent[0], d.networkPassphrase) as import("@stellar/stellar-sdk").Transaction;
    expect(tx.sequence).toBe("101");
    expect(tx.timeBounds?.maxTime).toBe(String(1_700_000_000 + 60));
    const env = tx.toEnvelope();
    const sd = (env as unknown as { value: { tx: { ext: { value: xdr.SorobanTransactionData } } } }).value.tx.ext.value;
    expect(sd.resources.instructions).toBe(1250);
    expect(sd.resources.diskReadBytes).toBe(10 + 2048);
    expect(sd.resources.writeBytes).toBe(10 + 2048);
    expect(sd.resourceFee).toBe(400n * 3n / 2n + 200_000n);
    expect(BigInt(tx.fee)).toBe(100n + 200_600n);
    expect(tx.signatures.length).toBe(1);
    // Cached sequence: next tx uses 102 without another getAccount.
    await s.invoke(keypairSigner(m.kp, d.networkPassphrase), "sit", [xdr.ScVal.scvU32(3)]);
    expect((TransactionBuilder.fromXDR(m.sent[1], d.networkPassphrase) as import("@stellar/stellar-sdk").Transaction).sequence).toBe("102");
    expect(m.rpc.getAccount).toHaveBeenCalledTimes(1);
  });

  it("warm pre-simulates without consuming the sequence cache", async () => {
    const m = mockRpc();
    const s = new TxSender(m.rpc, d, fast);
    const addr = m.kp.publicKey();
    expect(await s.warm(addr, "commit", [xdr.ScVal.scvBytes(new Uint8Array(32))])).toBe(true);
    expect(m.rpc.simulateTransaction).toHaveBeenCalledTimes(1);
    expect(m.rpc.getAccount).toHaveBeenCalledTimes(1);
    expect(m.sent.length).toBe(0);
    // Real invoke still uses the same cached sequence.
    await s.invoke(keypairSigner(m.kp, d.networkPassphrase), "sit", [xdr.ScVal.scvU32(3)]);
    expect((TransactionBuilder.fromXDR(m.sent[0], d.networkPassphrase) as import("@stellar/stellar-sdk").Transaction).sequence).toBe("101");
    expect(m.rpc.getAccount).toHaveBeenCalledTimes(1);
  });

  it("reloads the sequence on txBadSeq and resends after TRY_AGAIN_LATER", async () => {
    let n = 0;
    const m = mockRpc();
    m.rpc.sendTransaction = vi.fn(async (tx) => {
      n++;
      if (n === 1) return { status: "ERROR", hash: "x", latestLedger: 1, latestLedgerCloseTime: 1, errorResult: { result: { type: "txBadSeq" } } } as never;
      if (n === 2) return { status: "TRY_AGAIN_LATER", hash: "x", latestLedger: 1, latestLedgerCloseTime: 1 } as never;
      m.sent.push(tx.toXDR());
      return { status: "PENDING", hash: "ok", latestLedger: 1, latestLedgerCloseTime: 1 } as never;
    });
    const s = new TxSender(m.rpc, d, fast);
    m.setSeq(500n);
    const r = await s.invoke(keypairSigner(m.kp, d.networkPassphrase), "leave", []);
    expect(r.hash).toBe("ok");
    expect(m.rpc.getAccount).toHaveBeenCalledTimes(2);
  });

  it("decodes a simulation error and refuses unexpected auth", async () => {
    const m = mockRpc({
      simulateTransaction: vi.fn(async () => ({ id: "1", latestLedger: 1, events: [], _parsed: true, error: "HostError: Error(Contract, #3)" }) as never),
    });
    const s = new TxSender(m.rpc, d, fast);
    await expect(s.invoke(keypairSigner(m.kp, d.networkPassphrase), "play", [])).rejects.toMatchObject({ errorName: "Closed" });
    const m2 = mockRpc({ simulateTransaction: vi.fn(async () => simOk([entry(inv(CID, "play", [inv(SAC, "transfer")]))])) });
    const s2 = new TxSender(m2.rpc, d, fast);
    await expect(s2.invoke(keypairSigner(m2.kp, d.networkPassphrase), "play", [])).rejects.toThrow(/Refused to sign/);
    expect(m2.rpc.sendTransaction).not.toHaveBeenCalled();
  });

  it("decodes a failed transaction by re-simulating", async () => {
    let sims = 0;
    const m = mockRpc({
      simulateTransaction: vi.fn(async () => (++sims === 1 ? simOk() : ({ id: "1", latestLedger: 1, events: [], _parsed: true, error: "Error(Contract, #4)" } as never))),
      getTransaction: vi.fn(async () => ({ status: rpc.Api.GetTransactionStatus.FAILED, events: { contractEventsXdr: [], transactionEventsXdr: [] }, latestLedger: 1, latestLedgerCloseTime: 1 }) as never),
    });
    const s = new TxSender(m.rpc, d, fast);
    await expect(s.invoke(keypairSigner(m.kp, d.networkPassphrase), "play", [])).rejects.toMatchObject({ errorName: "Played", hash: "h1" });
  });

  it("resends once after resource_limit_exceeded, then succeeds", async () => {
    let gets = 0;
    const m = mockRpc({
      getTransaction: vi.fn(async () => (++gets === 1 ? failedTx("invokeHostFunctionResourceLimitExceeded") : okTx()) as never),
    });
    const s = new TxSender(m.rpc, d, fast);
    const r = await s.invoke(keypairSigner(m.kp, d.networkPassphrase), "play", [], { resend: 1 });
    expect(r.hash).toBe("h2");
    expect(m.rpc.simulateTransaction).toHaveBeenCalledTimes(2);
    // The failed tx used seq 101, the resend 102.
    expect((TransactionBuilder.fromXDR(m.sent[1], d.networkPassphrase) as import("@stellar/stellar-sdk").Transaction).sequence).toBe("102");
  });

  it("surfaces a stale failure as a race when resends run out, with the hash", async () => {
    const m = mockRpc({ getTransaction: vi.fn(async () => failedTx("invokeHostFunctionResourceLimitExceeded") as never) });
    const s = new TxSender(m.rpc, d, fast);
    const err = await s.invoke(keypairSigner(m.kp, d.networkPassphrase), "resolve", []).catch((e) => e);
    expect(err).toMatchObject({ errorName: "ResourceLimit", hash: "h1", race: true });
    expect(m.rpc.sendTransaction).toHaveBeenCalledTimes(1);
  });

  it("view() decodes the return value", async () => {
    const m = mockRpc({ simulateTransaction: vi.fn(async () => simOk([], xdr.ScVal.scvU32(42))) });
    expect(await new TxSender(m.rpc, d, fast).view("now")).toBe(42);
  });
});

describe("friendbot", () => {
  it("treats 'already funded' as success", async () => {
    const m = mockRpc();
    const f = vi.fn(async () => new Response('{"detail":"createAccountAlreadyExist"}', { status: 400 }));
    const lines: string[] = [];
    await friendbot(d.friendbotUrl, m.kp.publicKey(), m.rpc, { fetch: f as never, sleep: async () => undefined, progress: (l) => lines.push(l) });
    expect(lines[0]).toBe("Friendbot is saddling your horse.");
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("retries 429 then succeeds", async () => {
    const m = mockRpc();
    let n = 0;
    const f = vi.fn(async () => new Response("", { status: ++n < 3 ? 429 : 200 }));
    const waits: number[] = [];
    await friendbot(d.friendbotUrl, m.kp.publicKey(), m.rpc, { fetch: f as never, sleep: async (ms) => void waits.push(ms) });
    expect(waits).toEqual([2000, 4000]);
  });
});

describe("wallet signature check", () => {
  it("accepts the owner signature and spots the wrong network or account", async () => {
    const owner = Keypair.random();
    const tx = new TransactionBuilder(new Account(owner.publicKey(), "1"), { fee: "100", networkPassphrase: Networks.TESTNET, timebounds: { minTime: 0, maxTime: 0 } })
      .addOperation((await import("@stellar/stellar-sdk")).Operation.bumpSequence({ bumpTo: "5" }))
      .build();
    const good = await keypairSigner(owner, Networks.TESTNET).signTransaction(tx.toXDR());
    expect(() => verifySignedBy(good, owner.publicKey(), Networks.TESTNET)).not.toThrow();
    const pub = await keypairSigner(owner, Networks.PUBLIC).signTransaction(tx.toXDR());
    expect(() => verifySignedBy(pub, owner.publicKey(), Networks.TESTNET)).toThrow(/not on testnet/);
    const other = await keypairSigner(Keypair.random(), Networks.TESTNET).signTransaction(tx.toXDR());
    expect(() => verifySignedBy(other, owner.publicKey(), Networks.TESTNET)).toThrow(/different account/);
  });

  it("rejects a wallet-reported public passphrase before signing", () => {
    expect(() => assertWalletPassphrase(Networks.TESTNET, Networks.TESTNET)).not.toThrow();
    expect(() => assertWalletPassphrase(Networks.PUBLIC, Networks.TESTNET)).toThrow(/not on testnet/);
    try {
      assertWalletPassphrase(Networks.PUBLIC, Networks.TESTNET);
    } catch (e) {
      expect((e as { errorName?: string }).errorName).toBe("WrongNetwork");
    }
  });
});

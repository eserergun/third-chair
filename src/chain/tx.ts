// SPEC 6.2: one pipeline for every contract call.
import {
  Account, Address, BASE_FEE, Contract, Keypair, Operation, SorobanDataBuilder, TransactionBuilder, rpc, scValToNative, xdr,
} from "@stellar/stellar-sdk";
import type { Transaction } from "@stellar/stellar-sdk";
import type { Deployment } from "./config";
import {
  ChainError, classifyFailure, codeFromEvents, codeFromText, contractError, diagnosticText, isStale, resultCode, toChainError,
} from "./errors";

export interface Signer {
  address: string;
  signTransaction(xdr: string): Promise<string>;
}

export function keypairSigner(kp: Keypair, networkPassphrase: string): Signer {
  return {
    address: kp.publicKey(),
    async signTransaction(txXdr: string) {
      const tx = TransactionBuilder.fromXDR(txXdr, networkPassphrase);
      tx.sign(kp);
      return tx.toXDR();
    },
  };
}

/** The subset of rpc.Server the client uses (mockable). */
export interface Rpc {
  getAccount(address: string): Promise<Account>;
  simulateTransaction(tx: Transaction): Promise<rpc.Api.SimulateTransactionResponse>;
  sendTransaction(tx: Transaction): Promise<rpc.Api.SendTransactionResponse>;
  getTransaction(hash: string): Promise<rpc.Api.GetTransactionResponse>;
  getHealth(): Promise<rpc.Api.GetHealthResponse>;
  getLedgerEntries(...keys: xdr.LedgerKey[]): Promise<rpc.Api.GetLedgerEntriesResponse>;
  /** Optional so test doubles may skip it; settlement hashes then stay local only. */
  getEvents?(request: rpc.Api.GetEventsRequest): Promise<rpc.Api.GetEventsResponse>;
}

export function makeRpc(d: Deployment): Rpc {
  return new rpc.Server(d.rpcUrl, { allowHttp: d.rpcUrl.startsWith("http://") }) as unknown as Rpc;
}

export interface TxResult {
  hash: string;
  returnValue: unknown; // scValToNative of the return value
  events: xdr.ContractEvent[];
  ledger: number;
}

export interface AuthRule {
  contractId: string;
  fn: string;
  source: string;
  /** For fund: the native SAC that may appear as the one sub-invocation. */
  nativeSac?: string;
}

/** SPEC 6.2 step 3. Throws when the simulated auth is not what we expect. */
export function checkAuth(entries: xdr.SorobanAuthorizationEntry[], rule: AuthRule): void {
  for (const e of entries) {
    if (e.credentials.type !== "sorobanCredentialsSourceAccount") {
      throw new ChainError("Refused to sign: the call asks for another signer.");
    }
    const inv = e.rootInvocation;
    const f = inv.function;
    if (f.type !== "sorobanAuthorizedFunctionTypeContractFn") {
      throw new ChainError("Refused to sign: the call is not a contract call.");
    }
    const args = f.contractFn;
    const target = Address.fromScAddress(args.contractAddress).toString();
    const name = args.functionName.toString();
    if (target !== rule.contractId || name !== rule.fn) {
      throw new ChainError(`Refused to sign: unexpected call ${name}.`);
    }
    const subs = inv.subInvocations;
    if (rule.fn === "fund" && rule.nativeSac) {
      if (subs.length > 1) throw new ChainError("Refused to sign: unexpected sub-invocations.");
      for (const s of subs) {
        const sf = s.function;
        if (sf.type !== "sorobanAuthorizedFunctionTypeContractFn") throw new ChainError("Refused to sign: unexpected sub-invocation.");
        const c = sf.contractFn;
        if (Address.fromScAddress(c.contractAddress).toString() !== rule.nativeSac || c.functionName.toString() !== "transfer" || s.subInvocations.length > 0) {
          throw new ChainError("Refused to sign: unexpected sub-invocation.");
        }
      }
    } else if (subs.length > 0) {
      throw new ChainError("Refused to sign: unexpected sub-invocations.");
    }
  }
}

type LockFn = <T>(name: string, fn: () => Promise<T>) => Promise<T>;

const localLocks = new Map<string, Promise<unknown>>();

/** Web Lock when available, else an in-process mutex. */
export const withLock: LockFn = async (name, fn) => {
  const nav = (globalThis as { navigator?: { locks?: { request(n: string, cb: () => Promise<unknown>): Promise<unknown> } } }).navigator;
  if (nav?.locks?.request) return nav.locks.request(name, fn) as Promise<Awaited<ReturnType<typeof fn>>>;
  const prev = localLocks.get(name) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((r) => (release = r));
  const chained = prev.then(() => next);
  localLocks.set(name, chained);
  await prev.catch(() => undefined);
  try {
    return await fn();
  } finally {
    release();
    if (localLocks.get(name) === chained) localLocks.delete(name);
  }
};

export const NULL_ACCOUNT = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

export interface PreparedTx {
  xdr: string;
  source: string;
  seq: string;
  fn: string;
}

export interface TxSenderOptions {
  now?: () => number; // ledger unix seconds for timebounds
  sleep?: (ms: number) => Promise<void>;
  onLedger?: (closeTime: number | undefined, ledger: number | undefined) => void;
  pollMs?: number;
  confirmMs?: number;
  lock?: LockFn;
  /**
   * Card templates (SPEC 6.2, P0 speed): send commit/play with a template simulated when the
   * minute opened instead of simulating on the click. Off unless set; ChainClient sets it (CARD_TEMPLATES).
   */
  templates?: boolean;
  /** Clock for template age (tests). */
  clockMs?: () => number;
}

export interface InvokeOptions {
  timeoutSecs?: number;
  room?: number; // for error messages
  /**
   * Resends after a stale-simulation failure (ResourceLimit, Footprint): simulate again and
   * send once more. User card transactions pass 1; croupier steps pass 0 and retry next tick.
   */
  resend?: number;
  onStage?: (stage: "preparing" | "signing" | "sending" | "confirming") => void;
  /** Card calls: use the pre-simulated template for this room and hand when one is live. */
  template?: TemplateKey;
  /** Reports which path sent the call: "template", or "fallback" after a templated send failed. */
  onPath?: (path: "template" | "fallback" | "simulated", why?: ChainError) => void;
}

// ---- card templates

/** Calls that may use a template: the card calls only. */
export const TEMPLATE_FNS = new Set(["commit", "play"]);
/** A template older than this is thrown away (the Room entry may have grown). */
export const TEMPLATE_TTL_MS = 40_000;

export interface TemplateKey {
  room: number;
  hand: bigint | string;
}

export interface CardTemplate {
  fn: string;
  /** Padded SorobanTransactionData (footprint + resources + resource fee), base64 XDR. */
  sorobanData: string;
  /** Padded resource fee in stroops (also inside sorobanData). */
  resourceFee: bigint;
  /** Auth entries the simulation asked for: 0, or 1 source-account entry with no sub-invocations. */
  auth: 0 | 1;
  /** Local time the template was simulated (ms). */
  at: number;
}

export function templateKey(source: string, k: TemplateKey, fn: string): string {
  return `${source}|${k.room}|${k.hand.toString()}|${fn}`;
}

/** Source-account authorization for a direct call of our contract: root = the call, no sub-invocations. */
export function sourceAuthEntry(contractId: string, fn: string, args: xdr.ScVal[]): xdr.SorobanAuthorizationEntry {
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({ contractAddress: new Address(contractId).toScAddress(), functionName: fn, args }),
      ),
      subInvocations: [],
    }),
  });
}

/**
 * Pads a simulation's resources in place (padResources) and returns the padded resource fee.
 * Shared by the simulated path (padAndAssemble) and the template build.
 */
function padSimulation(sim: rpc.Api.SimulateTransactionSuccessResponse): bigint {
  const res = sim.transactionData.build().resources;
  const p = padResources({
    instructions: res.instructions,
    diskReadBytes: res.diskReadBytes,
    writeBytes: res.writeBytes,
    resourceFee: BigInt(sim.minResourceFee),
  });
  sim.transactionData.setResources(p.instructions, p.diskReadBytes, p.writeBytes);
  sim.transactionData.setResourceFee(p.resourceFee.toString());
  return p.resourceFee;
}

/** Turns a checked, successful simulation into a template, or null when its auth shape is unusual. */
export function makeTemplate(fn: string, sim: rpc.Api.SimulateTransactionSuccessResponse, at: number): CardTemplate | null {
  const auth = sim.result?.auth ?? [];
  if (auth.length > 1) return null;
  if (auth.length === 1 && auth[0].rootInvocation.subInvocations.length > 0) return null;
  const resourceFee = padSimulation(sim);
  return { fn, sorobanData: sim.transactionData.build().toXDR("base64"), resourceFee, auth: auth.length as 0 | 1, at };
}

export interface TemplateBuild {
  source: string;
  seq: bigint;
  contractId: string;
  networkPassphrase: string;
  fn: string;
  args: xdr.ScVal[];
  maxTime: number;
}

/** The real call with the template's soroban data and fee and our own source-account auth. No simulation. */
export function buildFromTemplate(t: CardTemplate, b: TemplateBuild): Transaction {
  if (t.fn !== b.fn) throw new ChainError("Template does not match the call.");
  const auth = t.auth === 1 ? [sourceAuthEntry(b.contractId, b.fn, b.args)] : [];
  return new TransactionBuilder(new Account(b.source, b.seq.toString()), {
    fee: BASE_FEE,
    networkPassphrase: b.networkPassphrase,
    timebounds: { minTime: 0, maxTime: b.maxTime },
  })
    .setSorobanData(new SorobanDataBuilder(t.sorobanData).build())
    .addOperation(Operation.invokeContractFunction({ contract: b.contractId, function: b.fn, args: b.args, auth }))
    .build();
}

/**
 * True when a failed templated send should go the full path (fresh simulation and resend).
 * Not on a decoded contract error (a fresh simulation reads the same state and fails the same way,
 * so it would only repeat the refusal) and not on a confirm timeout (the tx may still land).
 */
export function templateFallsBack(e: unknown): boolean {
  if (!(e instanceof ChainError)) return true;
  if (e.errorName === "Timeout") return false;
  return e.code === null;
}

const sleepMs = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class TxSender {
  private seqs = new Map<string, bigint>();
  private templates = new Map<string, Promise<CardTemplate | null>>();
  private readonly contract: Contract;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly lock: LockFn;

  constructor(readonly rpcClient: Rpc, readonly d: Deployment, private readonly opts: TxSenderOptions = {}) {
    this.contract = new Contract(d.contractId);
    this.sleep = opts.sleep ?? sleepMs;
    this.lock = opts.lock ?? withLock;
  }

  private nowSecs(): number {
    return this.opts.now ? this.opts.now() : Math.floor(Date.now() / 1000);
  }

  private async nextSeq(address: string, reload: boolean): Promise<bigint> {
    if (reload || !this.seqs.has(address)) {
      const acc = await this.rpcClient.getAccount(address);
      this.seqs.set(address, BigInt(acc.sequenceNumber()));
    }
    return this.seqs.get(address)!;
  }

  private buildRaw(source: string, seq: bigint, fn: string, args: xdr.ScVal[], timeoutSecs: number): Transaction {
    return new TransactionBuilder(new Account(source, seq.toString()), {
      fee: BASE_FEE,
      networkPassphrase: this.d.networkPassphrase,
      timebounds: { minTime: 0, maxTime: this.nowSecs() + timeoutSecs },
    })
      .addOperation(this.contract.call(fn, ...args))
      .build();
  }

  /** Read-only call through simulation with a throwaway source. */
  async view(fn: string, args: xdr.ScVal[] = []): Promise<unknown> {
    const tx = this.buildRaw(NULL_ACCOUNT, 0n, fn, args, 300);
    const sim = await this.rpcClient.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) throw this.simError(sim);
    const rv = (sim as rpc.Api.SimulateTransactionSuccessResponse).result?.retval;
    return rv ? scValToNative(rv) : undefined;
  }

  private simError(sim: rpc.Api.SimulateTransactionErrorResponse, room?: number): ChainError {
    const code = codeFromText(sim.error) ?? codeFromEvents(sim.events);
    if (code !== null) return contractError(code, { room });
    if (/MissingValue/.test(sim.error) && /contract instance/.test(sim.error)) return new ChainError("The contract is not on this network.", null, "NoContract");
    return new ChainError((sim.error || "Simulation failed.").split("\n")[0]);
  }

  /** Simulate and check auth (SPEC 6.2 steps 2 and 3). */
  private async simulateChecked(raw: Transaction, source: string, fn: string, room?: number): Promise<rpc.Api.SimulateTransactionSuccessResponse> {
    const sim = await this.rpcClient.simulateTransaction(raw);
    if (rpc.Api.isSimulationError(sim)) throw this.simError(sim, room);
    if (rpc.Api.isSimulationRestore(sim)) throw new ChainError("Contract data expired. Run the keeper (bump) and try again.");
    const ok = sim as rpc.Api.SimulateTransactionSuccessResponse;
    checkAuth(ok.result?.auth ?? [], { contractId: this.d.contractId, fn, source, nativeSac: this.d.nativeSac });
    return ok;
  }

  /** Simulate, check auth, pad by 25%, and return an unsigned tx. Does not touch the seq cache. */
  async prepare(source: string, seq: bigint, fn: string, args: xdr.ScVal[], timeoutSecs = 60, room?: number): Promise<PreparedTx> {
    const raw = this.buildRaw(source, seq, fn, args, timeoutSecs);
    const ok = await this.simulateChecked(raw, source, fn, room);
    const tx = padAndAssemble(raw, ok);
    return { xdr: tx.toXDR(), source, seq: seq.toString(), fn };
  }

  private nowMs(): number {
    return this.opts.clockMs ? this.opts.clockMs() : Date.now();
  }

  /** True when invoke may send card calls from a template. */
  get templatesOn(): boolean {
    return !!this.opts.templates;
  }

  /**
   * Simulate a card-shaped call once (dummy args) and keep the padded soroban data and fee for
   * (source, room, hand, fn). Drops this source's templates for other hands of the room. Also warms
   * the RPC path and the sequence cache. Does not consume the sequence. Failures are ignored.
   */
  async template(source: string, fn: string, args: xdr.ScVal[], k: TemplateKey): Promise<boolean> {
    if (!TEMPLATE_FNS.has(fn)) return false;
    this.dropTemplates(source, k);
    const key = templateKey(source, k, fn);
    const job = (async () => {
      try {
        const seq = await this.nextSeq(source, false);
        const raw = this.buildRaw(source, seq, fn, args, 60);
        const ok = await this.simulateChecked(raw, source, fn, k.room);
        return makeTemplate(fn, ok, this.nowMs());
      } catch {
        return null;
      }
    })();
    this.templates.set(key, job);
    const t = await job;
    if (!t && this.templates.get(key) === job) this.templates.delete(key);
    return t !== null;
  }

  /** Throws away this source's templates for the room, except those of hand k.hand (when given). */
  dropTemplates(source: string, k?: TemplateKey): void {
    const roomPrefix = k ? `${source}|${k.room}|` : `${source}|`;
    const keep = k ? `${roomPrefix}${k.hand.toString()}|` : null;
    for (const key of [...this.templates.keys()]) {
      if (key.startsWith(roomPrefix) && (keep === null || !key.startsWith(keep))) this.templates.delete(key);
    }
  }

  /** A live template for the call (waits for one still simulating), or null. Stale ones are dropped. */
  async liveTemplate(source: string, fn: string, k: TemplateKey): Promise<CardTemplate | null> {
    const key = templateKey(source, k, fn);
    const job = this.templates.get(key);
    if (!job) return null;
    const t = await job;
    if (!t || this.nowMs() - t.at > TEMPLATE_TTL_MS) {
      if (this.templates.get(key) === job) this.templates.delete(key);
      return null;
    }
    return t;
  }

  /** Prepare for an account outside the cache (owner wallet), fresh sequence. */
  async prepareFresh(source: string, fn: string, args: xdr.ScVal[], timeoutSecs = 300): Promise<PreparedTx> {
    const acc = await this.rpcClient.getAccount(source);
    return this.prepare(source, BigInt(acc.sequenceNumber()), fn, args, timeoutSecs);
  }

  /** Load (or refresh) the cached sequence for a session account. Does not build a transaction. */
  async ensureSeq(address: string, reload = false): Promise<bigint> {
    return this.nextSeq(address, reload);
  }

  /**
   * Pre-simulate a card-shaped call when a minute opens. Warms the RPC path and the sequence
   * cache without consuming the sequence. Failures are ignored: the real click still simulates.
   * Does not change commit-reveal privacy (dummy args only).
   */
  async warm(source: string, fn: string, args: xdr.ScVal[], room?: number): Promise<boolean> {
    try {
      const seq = await this.nextSeq(source, false);
      await this.prepare(source, seq, fn, args, 60, room);
      return true;
    } catch {
      return false;
    }
  }

  /** Full pipeline for a cached-sequence signer (the session key). */
  async invoke(signer: Signer, fn: string, args: xdr.ScVal[], o: InvokeOptions = {}): Promise<TxResult> {
    if (o.template && this.templatesOn && TEMPLATE_FNS.has(fn)) {
      const t = await this.liveTemplate(signer.address, fn, o.template);
      if (t) {
        // One use per template: a resend or the next card simulates again.
        this.templates.delete(templateKey(signer.address, o.template, fn));
        o.onPath?.("template");
        try {
          return await this.invokeTemplated(signer, fn, args, t, o);
        } catch (e) {
          if (!templateFallsBack(e)) throw e;
          o.onPath?.("fallback", toChainError(e));
          // Safety net: the full path below simulates fresh and sends again.
        }
      } else {
        o.onPath?.("simulated");
      }
    }
    return this.invokeSimulated(signer, fn, args, o);
  }

  /** Card call from a template: real args, template soroban data and fee, our own auth. No simulation. */
  private async invokeTemplated(signer: Signer, fn: string, args: xdr.ScVal[], t: CardTemplate, o: InvokeOptions): Promise<TxResult> {
    // Same auth check as a simulated call, on the entry we build ourselves.
    if (t.auth === 1) checkAuth([sourceAuthEntry(this.d.contractId, fn, args)], { contractId: this.d.contractId, fn, source: signer.address, nativeSac: this.d.nativeSac });
    let reload = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      const sent = await this.lock(`standoff-tx-${signer.address}`, async () => {
        o.onStage?.("preparing");
        const seq = await this.nextSeq(signer.address, reload);
        const tx = buildFromTemplate(t, {
          source: signer.address, seq, contractId: this.d.contractId, networkPassphrase: this.d.networkPassphrase,
          fn, args, maxTime: this.nowSecs() + (o.timeoutSecs ?? 60),
        });
        o.onStage?.("signing");
        const signed = await signer.signTransaction(tx.toXDR());
        o.onStage?.("sending");
        const r = await this.send(signed);
        if (r === "badseq") return null;
        this.seqs.set(signer.address, seq + 1n);
        return r;
      });
      if (sent === null) {
        reload = true;
        continue;
      }
      o.onStage?.("confirming");
      try {
        return await this.confirm(sent, () => this.resimulate(signer.address, fn, args, o.room), o.room);
      } catch (e) {
        if (e instanceof ChainError && e.errorName === "Timeout") this.seqs.delete(signer.address);
        throw e;
      }
    }
    throw new ChainError("The account sequence kept moving. Try again.");
  }

  /** The full path: simulate on the call, resend once more after a stale failure. */
  private async invokeSimulated(signer: Signer, fn: string, args: xdr.ScVal[], o: InvokeOptions): Promise<TxResult> {
    let resends = o.resend ?? 0;
    for (;;) {
      try {
        return await this.invokeOnce(signer, fn, args, o);
      } catch (e) {
        if (resends > 0 && isStale(e)) {
          resends--;
          continue; // invokeOnce simulates again against the fresh Room
        }
        throw e;
      }
    }
  }

  private async invokeOnce(signer: Signer, fn: string, args: xdr.ScVal[], o: InvokeOptions): Promise<TxResult> {
    let reload = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      const sent = await this.lock(`standoff-tx-${signer.address}`, async () => {
        o.onStage?.("preparing");
        const seq = await this.nextSeq(signer.address, reload);
        const prep = await this.prepare(signer.address, seq, fn, args, o.timeoutSecs ?? 60, o.room);
        o.onStage?.("signing");
        const signed = await signer.signTransaction(prep.xdr);
        o.onStage?.("sending");
        const r = await this.send(signed);
        if (r === "badseq") return null;
        this.seqs.set(signer.address, seq + 1n);
        return r;
      });
      if (sent === null) {
        reload = true;
        continue;
      }
      o.onStage?.("confirming");
      try {
        return await this.confirm(sent, () => this.resimulate(signer.address, fn, args, o.room), o.room);
      } catch (e) {
        if (e instanceof ChainError && e.errorName === "Timeout") this.seqs.delete(signer.address);
        throw e;
      }
    }
    throw new ChainError("The account sequence kept moving. Try again.");
  }

  /** Send an already signed tx (owner wallet flow) and wait for it. */
  async submitSigned(signedXdr: string, prep?: PreparedTx): Promise<TxResult> {
    const r = await this.send(signedXdr);
    if (r === "badseq") throw new ChainError("The account sequence moved. Try again.");
    return this.confirm(r, prep ? () => this.resimulate(prep.source, prep.fn, null) : undefined);
  }

  private async resimulate(source: string, fn: string, args: xdr.ScVal[] | null, room?: number): Promise<ChainError | null> {
    if (!args) return null;
    try {
      await this.prepare(source, 0n, fn, args, 60, room);
      return null;
    } catch (e) {
      return toChainError(e);
    }
  }

  /** Returns the hash, or "badseq". Handles TRY_AGAIN_LATER with backoff. */
  private async send(signedXdr: string): Promise<string | "badseq"> {
    const tx = TransactionBuilder.fromXDR(signedXdr, this.d.networkPassphrase) as Transaction;
    let wait = 1000;
    for (let i = 0; i < 6; i++) {
      const res = await this.rpcClient.sendTransaction(tx);
      this.opts.onLedger?.(res.latestLedgerCloseTime, res.latestLedger);
      if (res.status === "PENDING" || res.status === "DUPLICATE") return res.hash;
      if (res.status === "TRY_AGAIN_LATER") {
        await this.sleep(wait);
        wait = Math.min(wait * 2, 8000);
        continue;
      }
      const code = res.errorResult?.result.type;
      if (code === "txBadSeq") return "badseq";
      if (code === "txInsufficientBalance" || code === "txInsufficientFee") throw new ChainError("The account cannot pay the fee.");
      if (code === "txTooLate") throw new ChainError("The transaction expired before it was sent.");
      throw new ChainError(`The network refused the transaction (${code ?? res.status}).`);
    }
    throw new ChainError("The network is busy. Try again.");
  }

  private async confirm(hash: string, explain?: () => Promise<ChainError | null>, room?: number): Promise<TxResult> {
    const poll = this.opts.pollMs ?? 1000;
    const until = Date.now() + (this.opts.confirmMs ?? 45_000);
    while (Date.now() < until) {
      await this.sleep(poll);
      let res: rpc.Api.GetTransactionResponse;
      try {
        res = await this.rpcClient.getTransaction(hash);
      } catch {
        continue;
      }
      this.opts.onLedger?.(res.latestLedgerCloseTime, res.latestLedger);
      if (res.status === rpc.Api.GetTransactionStatus.SUCCESS) {
        return {
          hash,
          returnValue: res.returnValue ? scValToNative(res.returnValue) : undefined,
          events: (res.events?.contractEventsXdr ?? []).flat(),
          ledger: res.ledger,
        };
      }
      if (res.status === rpc.Api.GetTransactionStatus.FAILED) {
        const f = res as rpc.Api.GetFailedTransactionResponse;
        const info = {
          code: codeFromEvents(f.diagnosticEventsXdr) ?? codeFromEvents((f.events?.contractEventsXdr ?? []).flat()),
          result: resultCode(f.resultXdr),
          diag: diagnosticText(f.diagnosticEventsXdr),
        };
        const first = classifyFailure(info, hash, { room });
        if (first.errorName !== "TxFailed" || !explain) throw first;
        // No reason in the result: a fresh simulation often names the contract error.
        const why = await explain();
        if (why && why.code !== null) throw classifyFailure({ ...info, code: why.code }, hash, { room });
        throw first;
      }
    }
    throw withHash(new ChainError(`The network did not confirm the transaction in time. tx ${hash}`, null, "Timeout"), hash);
  }
}

function withHash(e: ChainError, hash: string): ChainError {
  e.hash = hash;
  return e;
}

export interface Resources {
  instructions: number;
  diskReadBytes: number;
  writeBytes: number;
  resourceFee: bigint;
}

/** Per-transaction network limits (protocol 23 testnet). Padding never goes past them. */
export const TX_LIMITS = { diskReadBytes: 200_000, writeBytes: 132_096 };

/**
 * SPEC 6.2 step 4, widened after the playtest: the Room entry can grow between simulation and
 * apply (a player joins the queue), so pad bytes too. Instructions +25%; read and write bytes
 * +25% and at least +2048 (capped at the network limit); resource fee x1.5 + 200000 stroops.
 */
export function padResources(r: Resources): Resources {
  const bytes = (n: number, cap: number) => Math.max(n, Math.min(cap, Math.max(Math.ceil(n * 1.25), n + 2048)));
  return {
    instructions: Math.ceil(r.instructions * 1.25),
    diskReadBytes: bytes(r.diskReadBytes, TX_LIMITS.diskReadBytes),
    writeBytes: bytes(r.writeBytes, TX_LIMITS.writeBytes),
    resourceFee: (r.resourceFee * 3n) / 2n + 200_000n,
  };
}

/** Pads the simulated resources (padResources), then assembles. */
export function padAndAssemble(raw: Transaction, sim: rpc.Api.SimulateTransactionSuccessResponse): Transaction {
  const fee = padSimulation(sim);
  const padded = { ...sim, minResourceFee: fee.toString() } as rpc.Api.SimulateTransactionSuccessResponse;
  return rpc.assembleTransaction(raw, padded).build();
}

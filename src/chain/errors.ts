import { xdr } from "@stellar/stellar-sdk";
import { roomName } from "./local";

export const ERRORS: Record<number, { name: string; message: string }> = {
  1: { name: "NoRoom", message: "That room is not on the survey." },
  2: { name: "NotSeated", message: "You are not in this minute." },
  3: { name: "Closed", message: "The minute is closed." },
  4: { name: "Played", message: "Your card is already down." },
  5: { name: "BadCard", message: "The card is not on the table." },
  6: { name: "BadTarget", message: "Iron needs another chair." },
  7: { name: "NoBullet", message: "The belt is empty." },
  8: { name: "BadReveal", message: "That is not the card you put down." },
  9: { name: "Elsewhere", message: "You already have a chair in {Name}. Stand up there first." },
  10: { name: "OwnerBusy", message: "Your wallet already has a chair, maybe in another browser. Stand up there, or link the wallet here again." },
  11: { name: "Full", message: "The table is full." },
  12: { name: "NotReady", message: "The minute is not ready to settle." },
  13: { name: "Choosing", message: "Another chair is still choosing. Your card goes face down." },
  14: { name: "NoOffer", message: "That chair has not offered itself to you." },
  16: { name: "BadName", message: "Names are letters, numbers, and spaces. Twelve at most. The house names are taken." },
  17: { name: "BadAmount", message: "That amount does not work." },
  18: { name: "NotReveal", message: "The cards are not turning over yet." },
  19: { name: "BadOwner", message: "A chair cannot claim itself." },
};

/**
 * Lost races: never toast these from automation. ResourceLimit and Footprint come from a tx
 * whose footprint or byte budget went stale between simulation and apply (another player
 * changed the Room in between).
 */
export const RACE_ERRORS = new Set(["NotReady", "Closed", "Played", "NotReveal", "ResourceLimit", "Footprint"]);

/** Stale-simulation failures: a fresh simulation and one resend usually fixes them. */
export const RESEND_ERRORS = new Set(["ResourceLimit", "Footprint"]);

export class ChainError extends Error {
  readonly code: number | null;
  readonly errorName: string;
  /** Hash of the failed transaction, when it reached the ledger. */
  hash?: string;
  constructor(message: string, code: number | null = null, errorName = "Chain") {
    super(message);
    this.name = "ChainError";
    this.code = code;
    this.errorName = errorName;
  }
  get race(): boolean {
    return RACE_ERRORS.has(this.errorName);
  }
}

export function contractError(code: number, ctx?: { room?: number }): ChainError {
  const e = ERRORS[code];
  if (!e) return new ChainError(`The contract refused (error ${code}).`, code, `Error${code}`);
  const msg = e.message.replace("{Name}", ctx?.room !== undefined && ctx.room !== 255 ? roomName(ctx.room) : "another room");
  return new ChainError(msg, code, e.name);
}

/** Finds "Error(Contract, #n)" in a simulation error or any text. */
export function codeFromText(text: string | undefined | null): number | null {
  if (!text) return null;
  const m = /Error\(Contract,\s*#(\d+)\)/.exec(text);
  return m ? Number(m[1]) : null;
}

function codeFromScVal(v: xdr.ScVal): number | null {
  try {
    if (v.type === "scvError") {
      const err = v.error;
      if (err.type === "sceContract") return err.contractCode;
    }
    if (v.type === "scvVec") {
      for (const x of v.vec ?? []) {
        const c = codeFromScVal(x);
        if (c !== null) return c;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Finds a contract error code in diagnostic events (failed transactions, simulations). */
export function codeFromEvents(events: Array<xdr.DiagnosticEvent | xdr.ContractEvent> | undefined): number | null {
  for (const ev of events ?? []) {
    try {
      const ce = ev instanceof xdr.DiagnosticEvent ? ev.event : (ev as xdr.ContractEvent);
      const body = ce.body.v0;
      for (const t of body.topics) {
        const c = codeFromScVal(t);
        if (c !== null) return c;
      }
      const c = codeFromScVal(body.data);
      if (c !== null) return c;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/** Text for a rejection that is not an Error, such as a wallet's { error: "user-rejected" }. */
export function objectErrorText(o: object): string {
  const r = o as { message?: unknown; error?: unknown };
  const inner = r.error as { message?: unknown } | undefined;
  const m = typeof r.message === "string" ? r.message : typeof r.error === "string" ? r.error : typeof inner?.message === "string" ? inner.message : "";
  if (/reject|denied|declin|cancel/i.test(m)) return "You turned the request down in the wallet.";
  return m ? `The wallet said: ${m}.` : "The wallet returned an error.";
}

export function toChainError(e: unknown, ctx?: { room?: number }): ChainError {
  if (e instanceof ChainError) return e;
  const text = e instanceof Error ? e.message : typeof e === "object" && e !== null ? objectErrorText(e) : String(e);
  const code = codeFromText(text);
  if (code !== null) return contractError(code, ctx);
  return new ChainError(text || "The network did not answer.");
}

export function isRace(e: unknown): boolean {
  return e instanceof ChainError && e.race;
}

/** True for failures that a fresh simulation and one resend may fix. */
export function isStale(e: unknown): boolean {
  return e instanceof ChainError && RESEND_ERRORS.has(e.errorName);
}

// ---- failed transactions (result code + diagnostic events)

// The SDK 17 XDR classes are discriminated unions; read them loosely and never throw.
type Any = any;

function scText(v: xdr.ScVal, depth = 0): string {
  if (depth > 4 || !v) return "";
  try {
    const x = v as Any;
    switch (x.type) {
      case "scvSymbol":
        return String(x.sym);
      case "scvString":
        return String(x.str);
      case "scvError": {
        const e = x.error;
        const kind = String(e.type).replace(/^sce/, "");
        const code = e.type === "sceContract" ? `#${e.contractCode}` : String(e.code?.name ?? "").replace(/^scec/, "");
        return `Error(${kind}, ${code})`;
      }
      case "scvVec":
        return ((x.vec ?? []) as xdr.ScVal[]).map((y) => scText(y, depth + 1)).filter(Boolean).join(" ");
      case "scvU32":
        return String(x.u32);
      case "scvI32":
        return String(x.i32);
      default:
        return "";
    }
  } catch {
    return "";
  }
}

/** Flattens the error diagnostic events into searchable text (error topics and messages). */
export function diagnosticText(events: Array<xdr.DiagnosticEvent | xdr.ContractEvent> | undefined): string {
  const out: string[] = [];
  for (const ev of events ?? []) {
    try {
      const ce = ev instanceof xdr.DiagnosticEvent ? ev.event : (ev as xdr.ContractEvent);
      const body = ce.body.v0;
      const topics = body.topics.map((t) => scText(t));
      if (topics[0] !== "error" && !topics.some((t) => t.startsWith("Error("))) continue;
      out.push([...topics, scText(body.data)].filter(Boolean).join(" "));
    } catch {
      /* ignore */
    }
  }
  return out.join("\n");
}

/** The inner invokeHostFunction result name, e.g. "invokeHostFunctionResourceLimitExceeded". */
export function resultCode(result: xdr.TransactionResult | undefined | null): string | null {
  if (!result) return null;
  try {
    let r = (result as Any).result;
    if (r.type === "txFeeBumpInnerFailed" || r.type === "txFeeBumpInnerSuccess") r = r.innerResultPair.result.result;
    const op = (r.results ?? [])[0];
    if (!op) return String(r.type);
    if (op.type !== "opInner") return String(op.type);
    const tr = op.tr;
    if (tr.type !== "invokeHostFunction") return String(tr.type);
    return String(tr.invokeHostFunctionResult.type);
  } catch {
    return null;
  }
}

const SHORT_CODES: Record<string, string> = {
  invokeHostFunctionResourceLimitExceeded: "resource_limit_exceeded",
  invokeHostFunctionTrapped: "trapped",
  invokeHostFunctionInsufficientRefundableFee: "insufficient_refundable_fee",
  invokeHostFunctionEntryArchived: "entry_archived",
  invokeHostFunctionMalformed: "malformed",
};

export interface FailureInfo {
  /** Contract error code from the events, if any. */
  code: number | null;
  /** Result code name from resultCode(), e.g. invokeHostFunctionResourceLimitExceeded. */
  result: string | null;
  /** Diagnostic error text. */
  diag: string;
}

/**
 * Classifies an applied-but-failed transaction. Contract errors map to the 5.6 table; stale
 * footprints and byte budgets become race errors ResourceLimit / Footprint; anything else is a
 * real failure whose message carries the decoded reason and the hash.
 */
export function classifyFailure(info: FailureInfo, hash: string, ctx?: { room?: number }): ChainError {
  let e: ChainError;
  const diag = info.diag;
  const res = shortResultCode(info.result);
  if (info.code !== null) {
    e = contractError(info.code, ctx);
  } else if (/outside of the footprint/i.test(diag)) {
    e = new ChainError("The table changed while the card was on its way (footprint).", null, "Footprint");
  } else if (res === "resource_limit_exceeded" || /Error\(Storage, ExceededLimit\)|Error\(Budget, ExceededLimit\)/.test(diag)) {
    e = new ChainError("The table changed while the card was on its way (resource limit).", null, "ResourceLimit");
  } else {
    const firstDiag = diag.split("\n")[0]?.slice(0, 160);
    const reason = [res, firstDiag].filter(Boolean).join(": ") || "no reason given";
    e = new ChainError(`The transaction failed (${reason}).`, null, "TxFailed");
  }
  if (!e.race && !e.message.includes(hash)) e = new ChainError(`${e.message} tx ${hash}`, e.code, e.errorName);
  e.hash = hash;
  return e;
}

export function shortResultCode(name: string | null): string | null {
  if (!name) return null;
  return SHORT_CODES[name] ?? name;
}

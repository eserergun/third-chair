// Session key and Friendbot (SPEC 6.1).
import { Keypair } from "@stellar/stellar-sdk";
import type { Progress } from "../shared/game-client";
import { ChainError } from "./errors";
import type { KeyValueStore } from "./store";
import type { Rpc } from "./tx";

export const SESSION_KEY = "session";

export function loadSession(store: KeyValueStore, prefix: string): Keypair | null {
  const s = store.get(prefix + SESSION_KEY);
  if (!s) return null;
  try {
    return Keypair.fromSecret(s);
  } catch {
    return null;
  }
}

export function ensureSession(store: KeyValueStore, prefix: string, secret?: string): Keypair {
  if (secret) {
    const kp = Keypair.fromSecret(secret);
    store.set(prefix + SESSION_KEY, kp.secret());
    return kp;
  }
  const have = loadSession(store, prefix);
  if (have) return have;
  const kp = Keypair.random();
  store.set(prefix + SESSION_KEY, kp.secret());
  return kp;
}

export async function accountExists(rpcClient: Rpc, address: string): Promise<boolean> {
  try {
    await rpcClient.getAccount(address);
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/not found/i.test(msg)) return false;
    throw e;
  }
}

export interface FriendbotOptions {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  progress?: Progress;
  confirmTries?: number;
}

const sleepMs = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 200 or "already funded" is success; 429/5xx retry after 2, 4, 8 s; then confirm the account. */
export async function friendbot(friendbotUrl: string, address: string, rpcClient: Rpc, o: FriendbotOptions = {}): Promise<void> {
  const f = o.fetch ?? globalThis.fetch.bind(globalThis);
  const sleep = o.sleep ?? sleepMs;
  o.progress?.("Friendbot is saddling your horse.");
  const delays = [2000, 4000, 8000];
  let ok = false;
  for (let i = 0; i <= delays.length; i++) {
    let status = 0;
    let body = "";
    const abort = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = abort ? setTimeout(() => abort.abort(), 25_000) : null;
    try {
      const res = await f(`${friendbotUrl}?addr=${encodeURIComponent(address)}`, abort ? { signal: abort.signal } : undefined);
      status = res.status;
      body = await res.text().catch(() => "");
    } catch {
      status = 0;
    } finally {
      if (timer) clearTimeout(timer);
    }
    // A failed or timed-out call (Friendbot's gateway timeout has no CORS headers, so fetch
    // rejects) may still have funded the account. RPC can lag a ledger behind Friendbot, so look
    // a few times before calling Friendbot again.
    if (status === 0) {
      let seen = false;
      for (let k = 0; k < 3 && !seen; k++) {
        seen = await accountExists(rpcClient, address).catch(() => false);
        if (!seen) await sleep(2000);
      }
      if (seen) {
        ok = true;
        break;
      }
    }
    if (status === 200 || (status === 400 && /already funded|op_already_exists|createAccountAlreadyExist/i.test(body))) {
      ok = true;
      break;
    }
    if (status === 400) break;
    if (i < delays.length) await sleep(delays[i]);
  }
  if (!ok && !(await accountExists(rpcClient, address).catch(() => false))) {
    throw new ChainError("Friendbot is not answering. Try the practice table for now.", null, "Friendbot");
  }
  for (let i = 0; i < (o.confirmTries ?? 10); i++) {
    if (await accountExists(rpcClient, address).catch(() => false)) return;
    await sleep(1500);
  }
  throw new ChainError("Friendbot funded the account, but the network cannot see it yet.", null, "Friendbot");
}

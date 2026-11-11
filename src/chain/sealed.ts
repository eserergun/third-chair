// Sealed-card records (SPEC 6.4): key <prefix>sealed.<hand>.<commitHex>.
import type { KeyValueStore } from "./store";
import { commitment, fromHex, toHex } from "./local";

export interface SealedRecord {
  hand: bigint;
  seat: number;
  card: number;
  target: number;
  salt: Uint8Array;
}

export function sealedKey(prefix: string, hand: bigint, commitHex: string): string {
  return `${prefix}sealed.${hand.toString()}.${commitHex}`;
}

export function encodeSealed(r: SealedRecord): string {
  return JSON.stringify({ hand: r.hand.toString(), seat: r.seat, card: r.card, target: r.target, salt: toHex(r.salt) });
}

export function decodeSealed(s: string | null): SealedRecord | null {
  if (!s) return null;
  try {
    const o = JSON.parse(s) as { hand: string; seat: number; card: number; target: number; salt: string };
    if (typeof o.hand !== "string" || !/^\d+$/.test(o.hand)) return null;
    const salt = fromHex(o.salt);
    if (salt.length !== 32) return null;
    return { hand: BigInt(o.hand), seat: Number(o.seat), card: Number(o.card), target: Number(o.target), salt };
  } catch {
    return null;
  }
}

export function sealedCommit(r: SealedRecord): string {
  return toHex(commitment(r.hand, r.seat, r.card, r.target, r.salt));
}

export function putSealed(store: KeyValueStore, prefix: string, r: SealedRecord): string {
  const hex = sealedCommit(r);
  store.set(sealedKey(prefix, r.hand, hex), encodeSealed(r));
  return hex;
}

/** The record whose hash equals the on-chain commit, verified. */
export function findSealed(store: KeyValueStore, prefix: string, hand: bigint, onChainCommit: Uint8Array): SealedRecord | null {
  const hex = toHex(onChainCommit);
  const r = decodeSealed(store.get(sealedKey(prefix, hand, hex)));
  if (r && r.hand === hand && sealedCommit(r) === hex) return r;
  return null;
}

export function removeSealed(store: KeyValueStore, prefix: string, hand: bigint, commitHex: string): void {
  store.remove(sealedKey(prefix, hand, commitHex));
}

/** Deletes records of hands older than `current`. */
export function pruneSealed(store: KeyValueStore, prefix: string, current: bigint): number {
  const head = `${prefix}sealed.`;
  let n = 0;
  for (const k of store.keys()) {
    if (!k.startsWith(head)) continue;
    const hand = k.slice(head.length).split(".")[0];
    if (!/^\d+$/.test(hand) || BigInt(hand) < current) {
      store.remove(k);
      n++;
    }
  }
  return n;
}

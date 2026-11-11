// Commit-reveal hashing (SPEC 5.2). Must match fixtures/commit.json.
import { sha256 } from "@noble/hashes/sha2.js";

const TAG = new TextEncoder().encode("third-chair/v2"); // 14 bytes

export function bytesToHex(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}

export function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (h.length % 2 !== 0 || /[^0-9a-fA-F]/.test(h)) throw new Error("Bad hex string");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function commitPreimage(hand: bigint, seat: number, card: number, target: number, salt: Uint8Array): Uint8Array {
  if (salt.length !== 32) throw new Error("Salt must be 32 bytes");
  if (hand < 0n || hand > 0xffffffffffffffffn) throw new Error("Hand out of u64 range");
  const out = new Uint8Array(57);
  out.set(TAG, 0);
  const view = new DataView(out.buffer);
  view.setBigUint64(14, hand, false);
  out[22] = seat & 0xff;
  out[23] = card & 0xff;
  out[24] = target & 0xff;
  out.set(salt, 25);
  return out;
}

export function commitHash(hand: bigint, seat: number, card: number, target: number, salt: Uint8Array): Uint8Array {
  return sha256(commitPreimage(hand, seat, card, target, salt));
}

export function newSalt(): Uint8Array {
  const s = new Uint8Array(32);
  globalThis.crypto.getRandomValues(s);
  return s;
}

export function sha256Bytes(data: Uint8Array | string): Uint8Array {
  return sha256(typeof data === "string" ? new TextEncoder().encode(data) : data);
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

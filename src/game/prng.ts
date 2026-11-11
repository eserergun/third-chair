// Deterministic sha256 counter PRNG (stand-in for the Soroban PRNG; same distribution, not same bytes).
import { sha256 } from "@noble/hashes/sha2.js";
import { NONE, AIR, IRON, TABLE } from "./rules";

export class Prng {
  private counter = 0;
  private buf = new Uint8Array(0);
  private pos = 0;
  constructor(private readonly seed: Uint8Array) {}

  static fromString(s: string): Prng {
    return new Prng(sha256(new TextEncoder().encode(s)));
  }

  bytes(n: number): Uint8Array {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (this.pos >= this.buf.length) {
        const block = new Uint8Array(this.seed.length + 4);
        block.set(this.seed, 0);
        new DataView(block.buffer).setUint32(this.seed.length, this.counter++, false);
        this.buf = sha256(block);
        this.pos = 0;
      }
      out[i] = this.buf[this.pos++];
    }
    return out;
  }

  /** Uniform integer in 0..n-1 (rejection sampling on u32). */
  range(n: number): number {
    const limit = Math.floor(0x100000000 / n) * n;
    for (;;) {
      const v = new DataView(this.bytes(4).buffer).getUint32(0, false);
      if (v < limit) return v % n;
    }
  }
}

/** House card per SPEC 5.4: roll 0..6; 0-1 air, 2-3 table, else iron at one of the two others. */
export function houseCard(prng: Prng, seat: number): { card: number; target: number } {
  const roll = prng.range(7);
  if (roll <= 1) return { card: AIR, target: NONE };
  if (roll <= 3) return { card: TABLE, target: NONE };
  const others = [0, 1, 2].filter((s) => s !== seat);
  return { card: IRON, target: others[prng.range(2)] };
}

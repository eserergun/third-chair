// Local stand-ins for src/game helpers (names, commit, narration). src/game did not exist when
// this was written. Swap these for the src/game versions once they land.
import { sha256 } from "@noble/hashes/sha2.js";
import { StrKey } from "@stellar/stellar-sdk";
import { HOUSE_NAMES, ROOM_NAMES } from "../shared/game-client";
import type { CardName, HandCard, PayNote, SeatOut } from "../shared/game-client";

export const NONE = 255;
export const NOBODY = 3;

export const NAMES = [
  "Wes", "Ada", "Kit", "Bo", "Mae", "Sol", "Rhett", "June", "Hank", "Pearl", "Cora", "Silas",
  "Ezra", "Nell", "Jesse", "Opal", "Amos", "Ruby", "Clem", "Etta", "Gus", "Lula", "Abe", "Tess",
] as const;

export const ROOM_SLUGS = ROOM_NAMES.map((n) => n.toLowerCase());

export function roomName(id: number): string {
  return ROOM_NAMES[id] ?? "another room";
}

/** "denvar", "live", "3" -> 3; unknown -> null. */
export function roomId(slugOrId: string | number): number | null {
  if (typeof slugOrId === "number") return slugOrId >= 0 && slugOrId < 9 ? slugOrId : null;
  const s = slugOrId.trim().toLowerCase();
  if (s === "live") return 3;
  if (/^\d+$/.test(s)) return roomId(Number(s));
  const i = ROOM_SLUGS.indexOf(s);
  return i >= 0 ? i : null;
}

export function defaultName(address: string): string {
  try {
    const raw = StrKey.decodeEd25519PublicKey(address);
    return NAMES[raw[0] % NAMES.length];
  } catch {
    return NAMES[0];
  }
}

export function playerName(address: string | null, seat: number, chairName?: string | null): string {
  if (!address) return HOUSE_NAMES[seat] ?? "House";
  return chairName && chairName.length > 0 ? chairName : defaultName(address);
}

/** Adds " II" to a later seat that repeats an earlier name. */
export function dedupeNames(names: string[]): string[] {
  const seen = new Set<string>();
  return names.map((n) => {
    if (seen.has(n)) return `${n} II`;
    seen.add(n);
    return n;
  });
}

export const CARD_CODES: Record<CardName, number> = { air: 0, iron: 1, table: 2 };
export const HAND_CARDS: HandCard[] = ["air", "iron", "table", "ran", "slept"];
export const NOTES: Record<number, PayNote> = { 0: "none", 1: "house", 2: "unclaimed", 3: "empty", 4: "paid", 6: "ran", 7: "resting", 8: "slept" };
export const OUTS: SeatOut[] = ["stays", "left", "ran", "carried", "scattered"];

export function cardName(code: number): CardName | null {
  return code === 0 ? "air" : code === 1 ? "iron" : code === 2 ? "table" : null;
}

const TAG = new TextEncoder().encode("third-chair/v2");

/** SPEC 5.2 commit preimage: tag(14) | hand u64 BE | seat u8 | card u8 | target u8 | salt(32). */
export function commitPreimage(hand: bigint, seat: number, card: number, target: number, salt: Uint8Array): Uint8Array {
  if (salt.length !== 32) throw new Error("salt must be 32 bytes");
  const out = new Uint8Array(57);
  out.set(TAG, 0);
  new DataView(out.buffer).setBigUint64(14, BigInt.asUintN(64, hand), false);
  out[22] = seat;
  out[23] = card;
  out[24] = target;
  out.set(salt, 25);
  return out;
}

export function commitment(hand: bigint, seat: number, card: number, target: number, salt: Uint8Array): Uint8Array {
  return sha256(commitPreimage(hand, seat, card, target, salt));
}

export function toHex(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}

export function fromHex(h: string): Uint8Array {
  if (h.length % 2 !== 0 || /[^0-9a-f]/i.test(h)) throw new Error("bad hex");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function randomSalt(): Uint8Array {
  const b = new Uint8Array(32);
  globalThis.crypto.getRandomValues(b);
  return b;
}

/** Stroops to a short XLM string: 10_000_000 -> "1". */
export function xlm(stroops: bigint | string): string {
  const v = BigInt(stroops);
  const neg = v < 0n;
  const a = neg ? -v : v;
  const whole = a / 10_000_000n;
  const frac = (a % 10_000_000n).toString().padStart(7, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

export interface NarrateInput {
  names: string[];
  cards: number[]; // 0 air, 1 iron, 2 table, 3 ran, 4 slept
  hit: boolean[];
  out: number[];
  winner: number;
  quiet: boolean;
  scattered: boolean;
  paid: bigint | string;
  note: number;
  houseWinner: boolean;
}

/** SPEC 4.4 narration: main line first, then extra lines. */
export function narrate(h: NarrateInput): string[] {
  const lines: string[] = [];
  if (h.winner >= 0 && h.winner <= 2) {
    const n = h.names[h.winner];
    if (h.houseWinner || h.note === 1) lines.push(`${n} takes the minute. The house keeps the purse.`);
    else if (h.note === 4) lines.push(`${n} takes the purse. ${xlm(h.paid)} testnet XLM.`);
    else if (h.note === 2) lines.push(`${n} takes the chair, but sits unclaimed. The purse will not pay them.`);
    else if (h.note === 3) lines.push(`${n} takes the chair. The purse had nothing to send.`);
    else if (h.note === 6) lines.push(`${n} takes the chair. Somebody ran, so the purse does not move.`);
    else if (h.note === 7) lines.push(`${n} takes the chair. The purse is resting.`);
    else if (h.note === 8) lines.push(`${n} takes the chair asleep. The purse does not pay a sleeper.`);
    else lines.push(`${n} takes the chair.`);
  } else {
    const standing = h.cards.filter((c, i) => (c === 0 || c === 1 || c === 4) && !h.hit[i]).length;
    if (h.quiet) lines.push("A quiet minute. Dust, and no iron. The purse stays.");
    else if (standing === 1) lines.push("One chair is standing, but the iron did not find open air. The purse stays.");
    else if (standing === 0) lines.push("Nobody is standing. The purse stays.");
    else lines.push("More than one chair is standing. The purse stays.");
  }
  if (h.scattered) lines.push("Three quiet minutes. The table scatters.");
  for (let i = 0; i < 3; i++) {
    const n = h.names[i];
    if (h.cards[i] === 3) lines.push(h.hit[i] ? `${n} ran, and the iron found them.` : `${n} ran. The chair is empty.`);
    if (h.cards[i] === 4) lines.push(`${n} slept through the minute. That plays as Air.`);
    if (h.out[i] === 3) lines.push(`${n} was carried out.`);
    if (h.out[i] === 1) lines.push(`${n} stood up.`);
  }
  return lines;
}

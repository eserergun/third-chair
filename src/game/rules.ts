// Pure game rules (SPEC 2, 5.2). Must match fixtures/judge.json.

export const AIR = 0;
export const IRON = 1;
export const TABLE = 2;
export const RAN = 3;
export const SLEPT = 4;
export const NONE = 255;
export const NOBODY = 3;

export const CARD_CODES = { air: AIR, iron: IRON, table: TABLE } as const;
export const HAND_CARD_NAMES = ["air", "iron", "table", "ran", "slept"] as const;
export type HandCardName = (typeof HAND_CARD_NAMES)[number];

export function cardCode(name: "air" | "iron" | "table"): number {
  return CARD_CODES[name];
}

export function cardName(code: number): HandCardName {
  const n = HAND_CARD_NAMES[code];
  if (!n) throw new Error(`Unknown card code ${code}`);
  return n;
}

export interface Judgement {
  hit: boolean[];
  standing: number;
  winner: number; // 0..2, or 3 = nobody
  quiet: boolean;
}

/** True when the card counts as standing (if not hit). Slept plays as air. */
export function canStand(card: number): boolean {
  return card === AIR || card === IRON || card === SLEPT;
}

/** Counts as open air for the iron payout condition. */
export function isOpenAir(card: number): boolean {
  return card === AIR || card === RAN || card === SLEPT;
}

export function judge(cards: readonly number[], targets: readonly number[]): Judgement {
  const hit = [false, false, false];
  let quiet = true;
  for (let j = 0; j < 3; j++) {
    if (cards[j] !== IRON) continue;
    quiet = false;
    const t = targets[j];
    if (t <= 2 && t !== j && cards[t] !== TABLE) hit[t] = true;
  }
  const up: number[] = [];
  for (let i = 0; i < 3; i++) if (canStand(cards[i]) && !hit[i]) up.push(i);
  let winner = NOBODY;
  if (up.length === 1) {
    const w = up[0];
    if (cards[w] !== IRON || isOpenAir(cards[targets[w]])) winner = w;
  }
  return { hit, standing: up.length, winner, quiet };
}

export type CardError = "BadCard" | "BadTarget" | "NoBullet";

/** Card validation for play and reveal (SPEC 5.2). Returns null when valid. */
export function validateCard(seat: number, card: number, target: number, bullet: number): CardError | null {
  if (!Number.isInteger(card) || card < 0 || card > 2) return "BadCard";
  if (card === IRON) {
    if (!(target >= 0 && target <= 2) || target === seat) return "BadTarget";
    if (bullet < 1) return "NoBullet";
    return null;
  }
  return target === NONE ? null : "BadTarget";
}

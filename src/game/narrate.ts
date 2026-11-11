// Narration from a settled hand (SPEC 4.4).
import type { HandCard, PayNote, SeatKind, SeatOut } from "../shared/game-client";
import { canStand, cardCode } from "./rules";

export interface NarrateSeat {
  kind: SeatKind;
  name: string;
  card: HandCard;
  target: number | null;
  hit: boolean;
  out: SeatOut;
}

export interface NarrateInput {
  seats: readonly NarrateSeat[];
  winner: number | null; // 0..2, or null / 3 for nobody
  quiet: boolean;
  scattered: boolean;
  paid: string | bigint | number; // stroops
  note: PayNote;
}

export interface NarrateOptions {
  practice?: boolean;
}

export const PRACTICE_END = "Practice. Nothing moved.";

/** Stroops to a plain XLM amount: 10000000 -> "1", 25000000 -> "2.5". */
export function formatXlm(stroops: string | bigint | number): string {
  let v = BigInt(stroops);
  const neg = v < 0n;
  if (neg) v = -v;
  const whole = v / 10_000_000n;
  const frac = (v % 10_000_000n).toString().padStart(7, "0").replace(/0+$/, "");
  return (neg ? "-" : "") + whole.toString() + (frac ? "." + frac : "");
}

function code(card: HandCard): number {
  return card === "ran" ? 3 : card === "slept" ? 4 : cardCode(card);
}

export function mainLine(h: NarrateInput, opts: NarrateOptions = {}): string {
  const w = h.winner;
  if (w !== null && w >= 0 && w <= 2) {
    const s = h.seats[w];
    const name = s.name;
    if (s.kind === "house" || h.note === "house") return `${name} takes the minute. The house keeps the purse.`;
    if (opts.practice) {
      if (h.note === "paid") return `${name} takes the purse. ${PRACTICE_END}`;
      if (h.note === "empty" || h.note === "resting") return `${name} takes the chair. ${PRACTICE_END}`;
    }
    switch (h.note) {
      case "paid":
        return `${name} takes the purse. ${formatXlm(h.paid)} testnet XLM.`;
      case "unclaimed":
        return `${name} takes the chair, but sits unclaimed. The purse will not pay them.`;
      case "empty":
        return `${name} takes the chair. The purse had nothing to send.`;
      case "ran":
        return `${name} takes the chair. Somebody ran, so the purse does not move.`;
      case "resting":
        return `${name} takes the chair. The purse is resting.`;
      case "slept":
        return `${name} takes the chair asleep. The purse does not pay a sleeper.`;
      default:
        return `${name} takes the chair. The purse stays.`;
    }
  }
  if (h.quiet) return "A quiet minute. Dust, and no iron. The purse stays.";
  const standing = h.seats.filter((s) => canStand(code(s.card)) && !s.hit).length;
  if (standing === 1) return "One chair is standing, but the iron did not find open air. The purse stays.";
  if (standing === 0) return "Nobody is standing. The purse stays.";
  return "More than one chair is standing. The purse stays.";
}

export function extraLines(h: NarrateInput): string[] {
  const lines: string[] = [];
  if (h.scattered) lines.push("Three quiet minutes. The table scatters.");
  for (const s of h.seats) {
    if (s.card === "ran") lines.push(s.hit ? `${s.name} ran, and the iron found them.` : `${s.name} ran. The chair is empty.`);
    if (s.card === "slept") lines.push(`${s.name} slept through the minute. That plays as Air.`);
    if (s.out === "carried") lines.push(`${s.name} was carried out.`);
    if (s.out === "left") lines.push(`${s.name} stood up.`);
  }
  return lines;
}

export function narrate(h: NarrateInput, opts: NarrateOptions = {}): string[] {
  return [mainLine(h, opts), ...extraLines(h)];
}

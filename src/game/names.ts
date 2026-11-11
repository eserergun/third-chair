// Display names (SPEC 6.3).
import { StrKey } from "@stellar/stellar-sdk";

export const NAMES = [
  "Wes", "Ada", "Kit", "Bo", "Mae", "Sol", "Rhett", "June", "Hank", "Pearl", "Cora", "Silas",
  "Ezra", "Nell", "Jesse", "Opal", "Amos", "Ruby", "Clem", "Etta", "Gus", "Lula", "Abe", "Tess",
] as const;

export const HOUSE = ["Cal", "Ivy", "Ned"] as const;

const NAME_RE = /^[A-Za-z0-9 ]{1,12}$/;

/** Fold ASCII lookalikes used to impersonate house names (`l`/`1`/`|`→`i`, `0`→`o`). */
export function foldLookalikeName(name: string): string {
  let out = "";
  for (const ch of name) {
    const c = ch.toLowerCase();
    if (c === "l" || c === "1" || c === "|") out += "i";
    else if (c === "0") out += "o";
    else out += c;
  }
  return out;
}

/** True when `name` is Cal/Ivy/Ned or an ASCII lookalike (CaI, lvy, 1vy, Ca1, …). */
export function isHouseLookalike(name: string): boolean {
  const lower = name.toLowerCase();
  if ((HOUSE as readonly string[]).some((h) => h.toLowerCase() === lower)) return true;
  const folded = foldLookalikeName(name);
  return (HOUSE as readonly string[]).some((h) => foldLookalikeName(h) === folded);
}

/**
 * Chair rename rules (SPEC 5.2 / ROADMAP 4.2): 1..12 letters, numbers, spaces;
 * no leading/trailing space; not a house name or ASCII lookalike of one.
 */
export function validPlayerName(name: string): boolean {
  if (!NAME_RE.test(name) || name !== name.trim()) return false;
  return !isHouseLookalike(name);
}

export function defaultName(address: string): string {
  const raw = StrKey.decodeEd25519PublicKey(address);
  return NAMES[raw[0] % NAMES.length];
}

/** Chair name if set, else the default name from the address. */
export function playerName(address: string, chairName?: string | null): string {
  return chairName && chairName.length > 0 ? chairName : defaultName(address);
}

const ROMAN = ["", " II", " III"];

/** Later seats that repeat a name get " II" (a third copy gets " III"). */
export function dedupeNames(names: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const k = seen.get(n) ?? 0;
    seen.set(n, k + 1);
    return k === 0 ? n : n + (ROMAN[k] ?? ` ${k + 1}`);
  });
}

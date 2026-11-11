import type { HandCard, HandView, Phase, SeatKind, SeatView } from "../shared/game-client";

export function xlm(stroops: string | null | undefined): string {
  if (stroops == null) return "none";
  const n = Number(stroops) / 1e7;
  return `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })} XLM`;
}

export function short(addr: string | null | undefined): string {
  if (!addr) return "";
  return addr.length > 12 ? `${addr.slice(0, 4)}...${addr.slice(-4)}` : addr;
}

export function kindLabel(k: SeatKind): string {
  return k === "house" ? "House" : k === "agent" ? "Agent" : "Player";
}

export function cardLabel(c: HandCard): string {
  return { air: "Air", iron: "Iron", table: "Table", ran: "Ran", slept: "Slept" }[c];
}

export function seatCard(h: HandView, i: number): string {
  const s = h.seats[i];
  if (s.card === "iron" && s.target !== null) return `Iron at ${h.seats[s.target].name}`;
  return cardLabel(s.card);
}

/** Roster state. In reveal or locked phase a seat with no card is out of time: house seats draw at settle. */
export function seatState(s: SeatView, phase?: Phase): string {
  if (s.state === "shown") return s.card ? (s.card === "iron" ? "shown: Iron" : `shown: ${cardLabel(s.card)}`) : "shown";
  if (s.state === "sealed") return "face down";
  if (phase === "reveal" || phase === "locked") return s.kind === "house" ? "face down" : "no card (plays Air)";
  return "thinking";
}

/** One word for a seat's fate in a settled hand. */
export function handFate(h: HandView, i: number): string | null {
  const s = h.seats[i];
  if (h.winner === i) return "wins";
  if (s.hit) return "hit";
  if (s.card === "table") return "ducked";
  if (s.card === "ran") return "ran";
  if (s.card === "slept") return "slept";
  return "standing";
}

/** Who shot whom and who ducked, in seat order. */
export function actionLine(h: HandView): string {
  const parts: string[] = [];
  h.seats.forEach((s) => {
    if (s.card === "iron" && s.target !== null) parts.push(`${s.name} fired at ${h.seats[s.target].name}.`);
    else if (s.card === "iron") parts.push(`${s.name} fired.`);
  });
  h.seats.forEach((s) => {
    if (s.card === "table") parts.push(`${s.name} ducked.`);
  });
  return parts.length ? parts.join(" ") : "Nobody fired. Nobody ducked.";
}

/** Narration for a settled hand: "Minute n." + the SPEC 4.4 main line, the action line, then the extra lines. */
export function handLines(h: HandView): string[] {
  const [main, ...extra] = h.lines;
  return [`Minute ${h.minute}. ${main ?? ""}`.trim(), actionLine(h), ...extra];
}

export function clock(secs: number): string {
  const s = Math.max(0, Math.ceil(secs));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Contract id from an explorer contract URL (last path segment). */
export function contractIdFrom(url: string | null): string {
  if (!url) return "<CONTRACT_ID>";
  const seg = url.split(/[/?#]/).filter(Boolean).pop();
  return seg && /^C[A-Z2-7]{10,}$/.test(seg) ? seg : "<CONTRACT_ID>";
}

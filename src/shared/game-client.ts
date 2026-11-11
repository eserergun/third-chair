// The one interface between the UI and the two game backends:
//   ChainClient    src/chain/client.ts   (Soroban contract on Stellar testnet)
//   PracticeClient src/game/practice.ts  (local engine, nothing touches the chain)
// The UI may import only this file, src/game/* (pure rules), src/art/*, src/audio/*, and the
// two client factories. Amounts are stroop strings, hand ids are decimal strings, times are
// ledger unix seconds.

export type CardName = "air" | "iron" | "table";
export type HandCard = CardName | "ran" | "slept";
export type SeatKind = "house" | "player" | "agent";
export type Phase = "idle" | "open" | "reveal" | "locked";
export type SeatState = "waiting" | "sealed" | "shown";
/** Contract note codes: 0 none, 1 house, 2 unclaimed, 3 empty, 4 paid, 6 ran, 7 resting, 8 slept. */
export type PayNote = "none" | "house" | "unclaimed" | "empty" | "paid" | "ran" | "resting" | "slept";
/** Contract out codes: 0 stays, 1 left, 2 ran, 3 carried out, 4 scattered. */
export type SeatOut = "stays" | "left" | "ran" | "carried" | "scattered";

export interface SeatView {
  index: 0 | 1 | 2;
  kind: SeatKind;
  address: string | null; // player (session) address; null for house
  name: string; // house: Cal, Ivy, Ned
  claimed: boolean;
  state: SeatState;
  card: CardName | null; // only when shown
  target: number | null; // only when shown and iron
  bullet: number;
  leaving: boolean;
  missed: number;
  you: boolean;
  /** Payout owner of a player seat (Chair.owner; the player itself until linked). Null for house. */
  owner?: string | null;
}

export interface HandSeatView {
  kind: SeatKind;
  address: string | null;
  name: string;
  card: HandCard;
  target: number | null;
  hit: boolean;
  out: SeatOut;
}

export interface HandView {
  hand: string;
  room: number;
  minute: number;
  at: number;
  seats: [HandSeatView, HandSeatView, HandSeatView];
  winner: 0 | 1 | 2 | null;
  quiet: boolean;
  scattered: boolean;
  paid: string;
  note: PayNote;
  lines: string[]; // narration: main line first, then extra lines (SPEC 4.4)
  tx?: string; // settlement transaction hash when known
}

export interface RoomView {
  id: number;
  slug: string;
  name: string;
  phase: Phase;
  hand: string; // "0" when idle
  minute: number;
  opened: number;
  deadline: number;
  revealBy: number; // 0 unless phase is reveal
  lockedAt: number; // ledger sequence, 0 unless locked
  seats: [SeatView, SeatView, SeatView];
  queue: Array<{ address: string; name: string; claimed: boolean; you: boolean }>;
  quiet: number;
  recent: HandView[]; // newest first
  // Derived from the ledger clock at read time.
  now: number; // estimated ledger time
  ledger: number; // latest known ledger sequence
  closesIn: number; // seconds until the minute's deadline (<= 0 when passed)
  /** The next croupier step that anyone may send now, or null. */
  due: "close" | "lock" | "settle" | null;
  you: { seat: 0 | 1 | 2 | null; queued: boolean; state: SeatState | null; bullet: number } | null;
}

export interface RoomSummary {
  id: number;
  slug: string;
  name: string;
  phase: Phase;
  players: number;
  queued: number;
  deadline: number;
  lastAt: number; // ledger time of the newest settled hand, 0 if none
}

export interface BoardRow {
  owner: string;
  name: string;
  wins: number;
  hits: number;
  hands: number;
  earned: string;
}

export interface StatsView {
  hands: number;
  wins: number;
  hits: number;
  falls: number;
  ran: number;
  earned: string;
}

export interface PurseView {
  balance: string;
  pay: string;
  hourBudget: number;
  hourPaid: number;
}

export type Door = "guest" | "wallet" | "secret" | "practice";

export interface Identity {
  door: Door;
  session: string;
  owner: string; // == session until linked
  claimed: boolean;
  name: string;
  agent: boolean;
  funded: boolean;
  walletName?: string;
}

/** A wallet link that waits for the second click (the one signature). */
export interface PendingLink {
  owner: string;
  walletName: string;
  sign(): Promise<Identity>; // must be called directly from a click handler
  cancel(): void;
}

export type TxStage = "preparing" | "signing" | "sending" | "confirming" | "done" | "failed";
export interface TxEvent {
  id: string;
  label: string; // e.g. "Iron at Ivy", "Settle the minute"
  stage: TxStage;
  hash?: string;
  error?: string;
  auto: boolean; // sent by the croupier, not by a click: never show an error toast
}

export type Progress = (step: string) => void;

export interface GameClient {
  readonly mode: "chain" | "practice";
  txUrl(hash: string): string | null;
  accountUrl(address: string): string | null;
  contractUrl(): string | null;
  now(): number;

  rooms(): Promise<RoomSummary[]>;
  room(id: number): Promise<RoomView>;
  board(): Promise<BoardRow[]>;
  purse(): Promise<PurseView>;
  stats(owner: string): Promise<StatsView>;
  balance(address: string): Promise<string | null>; // stroops, null if the account does not exist

  identity(): Identity | null;
  /** Make and fund the session key if needed. Safe to call early (when a slip opens). */
  prepareSession(progress?: Progress): Promise<Identity>;
  /** Door 2, click 1: opens the wallet picker, then prepares the link in the background. */
  connectWallet(progress?: Progress): Promise<PendingLink>;
  /** Door 3: a pasted testnet secret acts as the owner wallet. */
  linkSecret(secret: string, progress?: Progress): Promise<Identity>;
  rename(name: string, agent?: boolean): Promise<void>;
  exportSecret(): string | null;
  forget(): void;

  sit(room: number): Promise<{ seat: number | null; queued: boolean }>;
  leave(room: number): Promise<void>;
  /** Chooses play or commit (SPEC 6.4). Resolves when the card is on chain. */
  playCard(room: number, card: CardName, target: number | null): Promise<"played" | "sealed" | "missed">;

  /** Polls the room, runs the croupier (reveal, close, lock, settle), and reports every view. */
  watch(room: number, onView: (view: RoomView) => void, onError?: (e: Error) => void): () => void;

  agentInfo(agent: string): Promise<{ name: string; offeredTo: string | null; claimed: boolean; owner: string }>;
  /** Accept an agent's offer with the linked wallet or secret (one signature). */
  acceptAgent(agent: string, progress?: Progress): Promise<void>;

  onTx(cb: (e: TxEvent) => void): () => void;
}

export const ROOM_NAMES = ["Billen", "Cheyen", "Amarilla", "Denvar", "Abelen", "Laramy", "Prescot", "Duranga", "Tucsan"] as const;
export const HOUSE_NAMES = ["Cal", "Ivy", "Ned"] as const;

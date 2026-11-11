// In-memory mirror of the contract room state machine (SPEC 4, 5).
// Time and ledger sequence are injected so tests and the practice client control them.
import { bytesEqual, commitHash } from "./commit";
import { GameError } from "./errors";
import { validPlayerName } from "./names";
import { Prng, houseCard } from "./prng";
import { ROOMS, ROOM_COUNT } from "./rooms";
import { IRON, NOBODY, NONE, RAN, SLEPT, judge, validateCard } from "./rules";

export interface EngineConfig {
  commitSecs: number;
  revealSecs: number;
  pay: bigint;
  hourBudget: number;
  dayCap: number;
}

export const LIVE_CONFIG: EngineConfig = { commitSecs: 60, revealSecs: 45, pay: 10_000_000n, hourBudget: 60, dayCap: 25 };

export const PHASE = { idle: 0, open: 1, reveal: 2, locked: 3 } as const;
export const SEAT_STATE = { waiting: 0, sealed: 1, shown: 2 } as const;
export const OUT = { stays: 0, left: 1, ran: 2, carried: 3, scattered: 4 } as const;
export const NOTE = { none: 0, house: 1, unclaimed: 2, empty: 3, paid: 4, ran: 6, resting: 7, slept: 8 } as const;

export interface ESeat {
  who: string | null; // null = house
  claimed: boolean;
  state: number; // 0 waiting, 1 sealed, 2 shown
  commit: Uint8Array | null;
  card: number;
  target: number;
  bullet: number;
  leaving: boolean;
  missed: number;
}

export interface EHand {
  hand: bigint;
  room: number;
  minute: number;
  at: number;
  who: (string | null)[];
  cards: number[];
  targets: number[];
  hit: boolean[];
  out: number[];
  winner: number; // 0..2 or 3
  quiet: boolean;
  scattered: boolean;
  paid: bigint;
  note: number;
}

export interface ERoom {
  id: number;
  phase: number;
  hand: bigint;
  minute: number;
  opened: number;
  deadline: number;
  revealBy: number;
  lockedAt: number;
  commitSecs: number;
  revealSecs: number;
  seats: ESeat[];
  queue: string[];
  quiet: number;
  recent: EHand[];
}

export interface EChair {
  owner: string;
  claimed: boolean;
  agent: boolean;
  name: string;
  room: number;
}

export interface EStats {
  busy: string | null;
  hands: number;
  wins: number;
  hits: number;
  falls: number;
  ran: number;
  earned: bigint;
  day: number;
  dayPaid: number;
}

export interface ERow {
  owner: string;
  name: string;
  wins: number;
  hits: number;
  hands: number;
  earned: bigint;
}

export type EngineEvent =
  | { type: "sat"; room: number; player: string; seat: number }
  | { type: "stood"; room: number; player: string }
  | { type: "sealed"; room: number; hand: bigint; seat: number }
  | { type: "shown"; room: number; hand: bigint; seat: number; card: number; target: number }
  | { type: "locked"; room: number; hand: bigint }
  | { type: "settled"; room: number; hand: EHand }
  | { type: "linked"; player: string; owner: string }
  | { type: "funded"; from: string; amount: bigint };

export interface EngineOptions {
  now: () => number; // ledger unix seconds
  ledger: () => number; // ledger sequence
  seed?: string; // seeds the lock draws (stand-in for env.prng())
  config?: Partial<EngineConfig>;
  balance?: bigint; // purse balance in stroops
  onEvent?: (e: EngineEvent) => void;
  /** Test hook: force a house seat's card. Return null to use the PRNG. */
  houseCard?: (room: number, seat: number, hand: bigint) => { card: number; target: number } | null;
}

const MAX_QUEUE = 3;
const MAX_RECENT = 8;
const MAX_BOARD = 10;
function houseSeat(): ESeat {
  return { who: null, claimed: false, state: 0, commit: null, card: 0, target: NONE, bullet: 1, leaving: false, missed: 0 };
}

function idleRoom(id: number): ERoom {
  return {
    id, phase: 0, hand: 0n, minute: 0, opened: 0, deadline: 0, revealBy: 0, lockedAt: 0,
    commitSecs: 0, revealSecs: 0, seats: [houseSeat(), houseSeat(), houseSeat()], queue: [], quiet: 0, recent: [],
  };
}

export class Engine {
  config: EngineConfig;
  seq = 0n;
  budget = { hour: 0, paid: 0 };
  balance: bigint;
  readonly payouts = new Map<string, bigint>(); // owner -> stroops received
  private readonly rooms: ERoom[];
  private readonly seeds = new Map<number, Uint8Array>();
  private readonly chairs = new Map<string, EChair>();
  private readonly statsMap = new Map<string, EStats>();
  private readonly offers = new Map<string, string>();
  private boardRows: ERow[] = [];
  private readonly lockPrng: Prng;
  private readonly now: () => number;
  private readonly ledger: () => number;
  private readonly onEvent?: (e: EngineEvent) => void;
  private readonly houseHook?: EngineOptions["houseCard"];

  constructor(opts: EngineOptions) {
    this.now = opts.now;
    this.ledger = opts.ledger;
    this.onEvent = opts.onEvent;
    this.houseHook = opts.houseCard;
    this.config = { ...LIVE_CONFIG, ...opts.config };
    this.balance = opts.balance ?? 1_000n * 10_000_000n;
    this.lockPrng = Prng.fromString(`lock|${opts.seed ?? "standoff"}`);
    this.rooms = Array.from({ length: ROOM_COUNT }, (_, i) => idleRoom(i));
  }

  // ---- views (copies, never the seed) ----

  room(id: number): ERoom {
    return structuredClone(this.getRoom(id));
  }

  chair(player: string): EChair | null {
    const c = this.chairs.get(player);
    return c ? { ...c } : null;
  }

  stats(owner: string): EStats {
    return { ...this.statsOf(owner) };
  }

  board(): ERow[] {
    return this.boardRows.map((r) => ({ ...r }));
  }

  purse(): { balance: bigint; pay: bigint; hourBudget: number; hourPaid: number } {
    const hour = Math.floor(this.now() / 3600);
    return { balance: this.balance, pay: this.config.pay, hourBudget: this.config.hourBudget, hourPaid: this.budget.hour === hour ? this.budget.paid : 0 };
  }

  /** Room the player is verifiably at, or NONE. */
  whereIs(player: string): number {
    const c = this.chairs.get(player);
    if (!c || c.room === NONE || c.room >= ROOM_COUNT) return NONE;
    return this.isAt(this.rooms[c.room], player) ? c.room : NONE;
  }

  /** The croupier step anyone may send now, or null. */
  due(id: number): "close" | "lock" | "settle" | null {
    const r = this.getRoom(id);
    const now = this.now();
    if (r.phase === 1 && now >= r.deadline) return "close";
    if (r.phase === 2 && now >= r.revealBy) return "lock";
    if (r.phase === 3 && this.ledger() > r.lockedAt) return "settle";
    return null;
  }

  // ---- player actions ----

  sit(player: string, roomId: number): number {
    const r = this.getRoom(roomId);
    const chair = this.chairs.get(player) ?? this.defaultChair(player);
    const at = this.whereIsChair(player, chair);
    if (at === roomId) {
      const idx = this.seatOf(r, player);
      return idx >= 0 ? idx : NONE;
    }
    if (at !== NONE) {
      const r2 = this.rooms[at];
      if (this.hasOtherPlayer(r2, player)) throw new GameError("Elsewhere", ROOMS[at].name);
    }
    const busy = this.statsOf(chair.owner).busy;
    if (busy && busy !== player) {
      const bc = this.chairs.get(busy);
      if (bc && bc.owner === chair.owner && this.whereIs(busy) !== NONE) throw new GameError("OwnerBusy");
    }
    if (r.phase !== 0 && r.queue.length >= MAX_QUEUE) throw new GameError("Full");

    // checks passed: mutate
    if (at !== NONE) this.goIdle(this.rooms[at]);
    let seat: number = NONE;
    if (r.phase === 0) {
      r.seats[0] = { ...houseSeat(), who: player, claimed: chair.claimed };
      this.openMinute(r);
      seat = 0;
    } else if (chair.claimed) {
      let pos = 0;
      while (pos < r.queue.length && this.chairs.get(r.queue[pos])?.claimed) pos++;
      r.queue.splice(pos, 0, player);
    } else {
      r.queue.push(player);
    }
    chair.room = roomId;
    this.chairs.set(player, chair);
    this.statsOf(chair.owner).busy = player;
    this.emit({ type: "sat", room: roomId, player, seat });
    return seat;
  }

  leave(player: string, roomId: number): void {
    const r = this.getRoom(roomId);
    const q = r.queue.indexOf(player);
    if (q >= 0) {
      r.queue.splice(q, 1);
      this.emit({ type: "stood", room: roomId, player });
      return;
    }
    const idx = this.seatOf(r, player);
    if (idx < 0) return;
    r.seats[idx].leaving = true;
    const players = r.seats.filter((s) => s.who !== null);
    if (r.phase === 1 && players.length === 1 && players.every((s) => s.state === 0) && r.queue.length === 0) {
      this.goIdle(r);
    }
    this.emit({ type: "stood", room: roomId, player });
  }

  play(player: string, roomId: number, hand: bigint, card: number, target: number): void {
    const r = this.getRoom(roomId);
    const idx = this.requireSeat(r, player);
    if (r.phase !== 1 || hand !== r.hand) throw new GameError("Closed");
    const s = r.seats[idx];
    if (s.state !== 0) throw new GameError("Played");
    const err = validateCard(idx, card, target, s.bullet);
    if (err) throw new GameError(err);
    if (r.seats.some((o, i) => i !== idx && o.who !== null && o.state === 0)) throw new GameError("Choosing");
    s.state = 2;
    s.card = card;
    s.target = target;
    this.emit({ type: "shown", room: roomId, hand, seat: idx, card, target });
    this.afterCard(r);
  }

  commit(player: string, roomId: number, hand: bigint, commit: Uint8Array): void {
    const r = this.getRoom(roomId);
    const idx = this.requireSeat(r, player);
    if (r.phase !== 1 || hand !== r.hand) throw new GameError("Closed");
    const s = r.seats[idx];
    if (s.state !== 0) throw new GameError("Played");
    if (commit.length !== 32) throw new GameError("BadReveal");
    s.state = 1;
    s.commit = new Uint8Array(commit);
    this.emit({ type: "sealed", room: roomId, hand, seat: idx });
    this.afterCard(r);
  }

  reveal(player: string, roomId: number, hand: bigint, card: number, target: number, salt: Uint8Array): void {
    const r = this.getRoom(roomId);
    const idx = this.requireSeat(r, player);
    if (hand !== r.hand || r.phase === 0 || r.phase === 3) throw new GameError("Closed");
    if (r.phase === 1) throw new GameError("NotReveal");
    const s = r.seats[idx];
    if (s.state === 2) throw new GameError("Played");
    if (s.state === 0) throw new GameError("Closed"); // missed the minute: slept
    const err = validateCard(idx, card, target, s.bullet);
    if (err) throw new GameError(err);
    if (salt.length !== 32 || !s.commit || !bytesEqual(commitHash(hand, idx, card, target, salt), s.commit)) {
      throw new GameError("BadReveal");
    }
    s.state = 2;
    s.card = card;
    s.target = target;
    this.emit({ type: "shown", room: roomId, hand, seat: idx, card, target });
    if (!r.seats.some((o) => o.who !== null && o.state === 1)) this.lock(r);
  }

  /** Advance one step. Returns the phase after the call. */
  resolve(roomId: number, hand: bigint): number {
    const r = this.getRoom(roomId);
    if (hand !== r.hand) throw new GameError("Closed");
    const now = this.now();
    if (r.phase === 1 && now >= r.deadline) {
      if (r.seats.some((s) => s.who !== null && s.state === 1)) {
        r.phase = 2;
        r.revealBy = Math.max(now, r.deadline) + r.revealSecs;
      } else {
        this.lock(r);
      }
    } else if (r.phase === 2 && now >= r.revealBy) {
      this.lock(r);
    } else if (r.phase === 3 && this.ledger() > r.lockedAt) {
      this.settle(r);
    } else {
      throw new GameError("NotReady");
    }
    return r.phase;
  }

  offer(player: string, owner: string): void {
    if (owner === player) throw new GameError("BadOwner");
    this.offers.set(player, owner);
    if (!this.chairs.has(player)) this.chairs.set(player, this.defaultChair(player));
  }

  offeredTo(player: string): string | null {
    return this.offers.get(player) ?? null;
  }

  accept(owner: string, player: string): void {
    if (this.offers.get(player) !== owner) throw new GameError("NoOffer");
    if (owner === player) throw new GameError("BadOwner");
    // One chair per owner: the owner signed, so its chair through another session stands up
    // (leaves the queue at once, or is marked leaving and drops when its minute settles).
    const busy = this.statsOf(owner).busy;
    if (busy && busy !== player) {
      if (this.chairs.get(busy)?.owner === owner) {
        const where = this.whereIs(busy);
        if (where !== NONE) {
          const rb = this.rooms[where];
          const q = rb.queue.indexOf(busy);
          if (q >= 0) {
            rb.queue.splice(q, 1);
            this.emit({ type: "stood", room: where, player: busy });
          } else {
            const i = this.seatOf(rb, busy);
            if (i >= 0) rb.seats[i].leaving = true;
          }
        }
      }
      this.statsOf(owner).busy = null;
    }
    const at = this.whereIs(player);
    const chair = this.chairs.get(player) ?? this.defaultChair(player);
    const old = this.statsOf(chair.owner);
    if (old.busy === player) old.busy = null;
    chair.owner = owner;
    chair.claimed = true;
    this.chairs.set(player, chair);
    if (at !== NONE) {
      this.statsOf(owner).busy = player;
      const r = this.rooms[at];
      const idx = this.seatOf(r, player);
      if (idx >= 0) r.seats[idx].claimed = true;
    }
    this.offers.delete(player);
    this.emit({ type: "linked", player, owner });
  }

  rename(player: string, name: string, agent: boolean): void {
    if (!validPlayerName(name)) {
      throw new GameError("BadName");
    }
    const chair = this.chairs.get(player) ?? this.defaultChair(player);
    chair.name = name;
    chair.agent = agent;
    this.chairs.set(player, chair);
  }

  fund(from: string, amount: bigint): void {
    if (amount <= 0n) throw new GameError("BadAmount");
    this.balance += amount;
    this.emit({ type: "funded", from, amount });
  }

  setConfig(c: Partial<EngineConfig>): void {
    const next = { ...this.config, ...c };
    if (next.pay < 10_000_000n) throw new GameError("BadAmount");
    this.config = next;
  }

  // ---- internals ----

  private emit(e: EngineEvent): void {
    this.onEvent?.(e);
  }

  private getRoom(id: number): ERoom {
    if (!Number.isInteger(id) || id < 0 || id >= ROOM_COUNT) throw new GameError("NoRoom");
    return this.rooms[id];
  }

  private defaultChair(player: string): EChair {
    return { owner: player, claimed: false, agent: false, name: "", room: NONE };
  }

  private statsOf(owner: string): EStats {
    let s = this.statsMap.get(owner);
    if (!s) {
      s = { busy: null, hands: 0, wins: 0, hits: 0, falls: 0, ran: 0, earned: 0n, day: 0, dayPaid: 0 };
      this.statsMap.set(owner, s);
    }
    return s;
  }

  private seatOf(r: ERoom, player: string): number {
    return r.seats.findIndex((s) => s.who === player);
  }

  private requireSeat(r: ERoom, player: string): number {
    const idx = this.seatOf(r, player);
    if (idx < 0) throw new GameError("NotSeated");
    return idx;
  }

  private isAt(r: ERoom, player: string): boolean {
    return this.seatOf(r, player) >= 0 || r.queue.includes(player);
  }

  private whereIsChair(player: string, c: EChair): number {
    if (c.room === NONE || c.room >= ROOM_COUNT) return NONE;
    return this.isAt(this.rooms[c.room], player) ? c.room : NONE;
  }

  private hasOtherPlayer(r: ERoom, player: string): boolean {
    return r.seats.some((s) => s.who !== null && s.who !== player) || r.queue.some((q) => q !== player);
  }

  private goIdle(r: ERoom): void {
    r.phase = 0;
    r.hand = 0n;
    r.opened = 0;
    r.deadline = 0;
    r.revealBy = 0;
    r.lockedAt = 0;
    r.seats = [houseSeat(), houseSeat(), houseSeat()];
    r.queue = [];
    r.quiet = 0;
    this.seeds.delete(r.id);
  }

  private openMinute(r: ERoom): void {
    const now = this.now();
    this.seq += 1n;
    r.hand = this.seq;
    r.minute += 1;
    r.phase = 1;
    r.opened = now;
    r.commitSecs = this.config.commitSecs;
    r.revealSecs = this.config.revealSecs;
    r.deadline = now + r.commitSecs;
    r.revealBy = 0;
    r.lockedAt = 0;
  }

  private afterCard(r: ERoom): void {
    const players = r.seats.filter((s) => s.who !== null);
    if (players.some((s) => s.state === 0)) return;
    if (players.some((s) => s.state === 1)) {
      r.phase = 2;
      r.revealBy = this.now() + r.revealSecs;
    } else {
      this.lock(r);
    }
  }

  private lock(r: ERoom): void {
    this.seeds.set(r.id, this.lockPrng.bytes(32));
    r.phase = 3;
    r.lockedAt = this.ledger();
    this.emit({ type: "locked", room: r.id, hand: r.hand });
  }

  private settle(r: ERoom): void {
    const now = this.now();
    const cfg = this.config;
    const prng = new Prng(this.seeds.get(r.id) ?? new Uint8Array(32));
    const cards: number[] = [];
    const targets: number[] = [];
    r.seats.forEach((s, i) => {
      if (s.who === null) {
        const h = this.houseHook?.(r.id, i, r.hand) ?? houseCard(prng, i);
        cards.push(h.card);
        targets.push(h.target);
      } else if (s.state === 2) {
        cards.push(s.card);
        targets.push(s.target);
      } else {
        cards.push(s.state === 1 ? RAN : SLEPT);
        targets.push(NONE);
      }
    });
    const j = judge(cards, targets);
    r.quiet = j.quiet ? r.quiet + 1 : 0;
    const scattered = r.quiet >= 3;
    if (scattered) r.quiet = 0;

    // payout (4.3)
    let note: number = NOTE.none;
    let paid = 0n;
    if (j.winner !== NOBODY) {
      const ws = r.seats[j.winner];
      const chair = ws.who ? this.chairs.get(ws.who) : undefined;
      if (ws.who === null) note = NOTE.house;
      else if (cards.includes(RAN)) note = NOTE.ran;
      else if (!chair?.claimed) note = NOTE.unclaimed;
      else if (cards[j.winner] === SLEPT) note = NOTE.slept;
      else {
        const hour = Math.floor(now / 3600);
        if (this.budget.hour !== hour) this.budget = { hour, paid: 0 };
        const st = this.statsOf(chair.owner);
        const day = Math.floor(now / 86400);
        if (st.day !== day) {
          st.day = day;
          st.dayPaid = 0;
        }
        if (this.budget.paid >= cfg.hourBudget || st.dayPaid >= cfg.dayCap) note = NOTE.resting;
        else if (this.balance < cfg.pay) note = NOTE.empty;
        else {
          this.balance -= cfg.pay;
          this.payouts.set(chair.owner, (this.payouts.get(chair.owner) ?? 0n) + cfg.pay);
          this.budget.paid += 1;
          st.dayPaid += 1;
          paid = cfg.pay;
          note = NOTE.paid;
        }
      }
    }

    // stats and board
    r.seats.forEach((s, i) => {
      if (s.who === null) return;
      const chair = this.chairs.get(s.who);
      const owner = chair?.owner ?? s.who;
      const st = this.statsOf(owner);
      st.hands += 1;
      if (j.hit[i]) st.falls += 1;
      if (cards[i] === IRON && j.hit[targets[i]]) st.hits += 1;
      if (cards[i] === RAN) st.ran += 1;
      if (j.winner === i) {
        st.wins += 1;
        st.earned += paid;
      }
      this.updateBoard(owner, chair?.name ?? "", st, j.winner === i);
    });

    // out per seat
    const stale = now > r.deadline + r.revealSecs + r.commitSecs;
    const queued = r.queue.length > 0;
    const out = r.seats.map((s, i) => {
      if (s.who === null) return OUT.stays;
      s.missed = cards[i] === SLEPT ? s.missed + 1 : 0;
      if (cards[i] === IRON) s.bullet = 0;
      if (cards[i] === RAN) return OUT.ran;
      if (cards[i] === SLEPT && (s.missed >= 2 || queued || stale)) return OUT.carried;
      if (s.leaving) return OUT.left;
      if (scattered) return OUT.scattered;
      return OUT.stays;
    });

    const hand: EHand = {
      hand: r.hand, room: r.id, minute: r.minute, at: now,
      who: r.seats.map((s) => s.who), cards, targets, hit: j.hit, out,
      winner: j.winner, quiet: j.quiet, scattered, paid, note,
    };
    r.recent = [hand, ...r.recent].slice(0, MAX_RECENT);
    this.seeds.delete(r.id);
    this.emit({ type: "settled", room: r.id, hand: structuredClone(hand) });

    // next minute
    r.seats = r.seats.map((s, i) => (out[i] !== OUT.stays || s.who === null ? houseSeat() : {
      ...s, state: 0, commit: null, card: 0, target: NONE, leaving: false,
    }));
    const queue = [...r.queue].sort((a, b) => Number(!!this.chairs.get(b)?.claimed) - Number(!!this.chairs.get(a)?.claimed));
    for (let i = 0; i < 3 && queue.length > 0; i++) {
      if (r.seats[i].who !== null) continue;
      const p = queue.shift()!;
      r.seats[i] = { ...houseSeat(), who: p, claimed: !!this.chairs.get(p)?.claimed };
    }
    r.queue = queue;
    if (r.seats.some((s) => s.who !== null)) {
      this.openMinute(r);
    } else {
      this.goIdle(r);
    }
  }

  private updateBoard(owner: string, name: string, st: EStats, won: boolean): void {
    const row = this.boardRows.find((x) => x.owner === owner);
    if (row) {
      if (won) row.name = name;
      Object.assign(row, { wins: st.wins, hits: st.hits, hands: st.hands, earned: st.earned });
    } else if (won) {
      this.boardRows.push({ owner, name, wins: st.wins, hits: st.hits, hands: st.hands, earned: st.earned });
    } else return;
    this.boardRows.sort((a, b) => b.wins - a.wins || (b.earned > a.earned ? 1 : b.earned < a.earned ? -1 : 0) || b.hits - a.hits);
    this.boardRows = this.boardRows.slice(0, MAX_BOARD);
  }
}

// A scripted fake GameClient for UI work and tests. Nothing here touches the chain.
// Solo play: a card locks the minute and it settles about 1.2 s later.

import type {
  BoardRow, CardName, GameClient, HandCard, HandSeatView, HandView, Identity, PendingLink, PurseView,
  RoomSummary, RoomView, SeatView, StatsView, TxEvent,
} from "../../shared/game-client";
import { HOUSE_NAMES, ROOM_NAMES } from "../../shared/game-client";
import { validPlayerName } from "../../game/names";

const SLUGS = ROOM_NAMES.map((n) => n.toLowerCase());
const PAY = "10000000";

interface StubOptions {
  mode?: "chain" | "practice";
  commitSecs?: number;
  settleMs?: number;
  /** Rooms that show a scripted running minute on the map. */
  busy?: number[];
  /** Tests: the settle tx hash shows up this long after the result, as when another client settled. */
  lateTxMs?: number;
  /** Tests: every house chair plays Table, so a player's Air stands alone. */
  houseTable?: boolean;
}

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function houseCard(r: () => number, seat: number): { card: CardName; target: number | null } {
  const roll = Math.floor(r() * 7);
  if (roll <= 1) return { card: "air", target: null };
  if (roll <= 3) return { card: "table", target: null };
  const others = [0, 1, 2].filter((x) => x !== seat);
  return { card: "iron", target: others[Math.floor(r() * 2)] };
}

export interface JudgeOut { hit: boolean[]; winner: 0 | 1 | 2 | null; quiet: boolean; fired: boolean; standing: number }

export function judge(cards: HandCard[], targets: (number | null)[]): JudgeOut {
  const hit = [false, false, false];
  cards.forEach((c, i) => {
    const t = targets[i];
    if (c === "iron" && t !== null && cards[t] !== "table") hit[t] = true;
  });
  const standing = [0, 1, 2].filter((i) => !hit[i] && (cards[i] === "air" || cards[i] === "slept" || cards[i] === "iron"));
  const fired = cards.includes("iron");
  let winner: 0 | 1 | 2 | null = null;
  if (standing.length === 1) {
    const s = standing[0] as 0 | 1 | 2;
    if (cards[s] === "iron") {
      const t = targets[s];
      const tc = t === null ? null : cards[t];
      if (tc === "air" || tc === "slept" || tc === "ran") winner = s;
    } else winner = s;
  }
  return { hit, winner, quiet: !fired, fired, standing: standing.length };
}

export function narrate(h: Omit<HandView, "lines">, fired: boolean, standing: number): string[] {
  const lines: string[] = [];
  const w = h.winner;
  if (w !== null) {
    const name = h.seats[w].name;
    if (h.seats[w].kind === "house") lines.push(`${name} takes the minute. The house keeps the purse.`);
    else if (h.note === "paid") lines.push(`${name} takes the purse. ${Number(h.paid) / 1e7} testnet XLM.`);
    else if (h.note === "unclaimed") lines.push(`${name} takes the chair, but sits unclaimed. The purse will not pay them.`);
    else if (h.note === "ran") lines.push(`${name} takes the chair. Somebody ran, so the purse does not move.`);
    else if (h.note === "resting") lines.push(`${name} takes the chair. The purse is resting.`);
    else if (h.note === "slept") lines.push(`${name} takes the chair asleep. The purse does not pay a sleeper.`);
    else lines.push(`${name} takes the chair. The purse had nothing to send.`);
  } else if (h.quiet) lines.push("A quiet minute. Dust, and no iron. The purse stays.");
  else if (fired && standing === 1) lines.push("One chair is standing, but the iron did not find open air. The purse stays.");
  else if (standing === 0) lines.push("Nobody is standing. The purse stays.");
  else lines.push("More than one chair is standing. The purse stays.");
  if (h.scattered) lines.push("Three quiet minutes. The table scatters.");
  h.seats.forEach((s) => {
    if (s.card === "ran") lines.push(s.hit ? `${s.name} ran, and the iron found them.` : `${s.name} ran. The chair is empty.`);
    if (s.card === "slept") lines.push(`${s.name} slept through the minute. That plays as Air.`);
    if (s.out === "carried") lines.push(`${s.name} was carried out.`);
    if (s.out === "left") lines.push(`${s.name} stood up.`);
  });
  return lines;
}

function houseSeat(i: 0 | 1 | 2): SeatView {
  return { index: i, kind: "house", address: null, name: HOUSE_NAMES[i], claimed: false, state: "waiting", card: null, target: null, bullet: 1, leaving: false, missed: 0, you: false };
}

function rehearsedHand(seedKey: string, room: number, k: number): HandView {
  const r = rng(hashStr(`${seedKey}|${room}|${k}`));
  const picks = [0, 1, 2].map((i) => houseCard(r, i));
  const cards = picks.map((p) => p.card) as HandCard[];
  const targets = picks.map((p) => p.target);
  const j = judge(cards, targets);
  const seats = [0, 1, 2].map((i): HandSeatView => ({
    kind: "house", address: null, name: HOUSE_NAMES[i], card: cards[i], target: targets[i], hit: j.hit[i], out: "stays",
  })) as HandView["seats"];
  const base = { hand: String(k), room, minute: (k % 1000) + 1, at: k * 60 + 50, seats, winner: j.winner, quiet: j.quiet, scattered: false, paid: "0", note: (j.winner === null ? "none" : "house") as HandView["note"] };
  return { ...base, lines: narrate(base, j.fired, j.standing) };
}

/** Same shape as rehearsal() in src/game/practice.ts: open for 50 s of each 60 s cycle, then idle. */
export function stubRehearsal(seedKey: string, room: number, ledgerTime: number): RoomView {
  const t = Math.floor(ledgerTime);
  const k = Math.floor(t / 60);
  const c = k * 60;
  const open = t - c < 50;
  const newest = open ? k - 1 : k;
  const recent = [newest, newest - 1, newest - 2].map((n) => rehearsedHand(seedKey, room, n));
  return {
    id: room, slug: SLUGS[room] ?? "", name: ROOM_NAMES[room] ?? "", phase: open ? "open" : "idle", hand: open ? String(k) : "0",
    minute: open ? (k % 1000) + 1 : recent[0].minute, opened: open ? c : 0, deadline: open ? c + 50 : 0, revealBy: 0, lockedAt: 0,
    seats: [houseSeat(0), houseSeat(1), houseSeat(2)], queue: [], quiet: 0, recent, now: ledgerTime, ledger: 0,
    closesIn: open ? c + 50 - ledgerTime : 0, due: null, you: null,
  };
}

interface StubRoom {
  id: number;
  phase: RoomView["phase"];
  hand: number;
  minute: number;
  opened: number;
  deadline: number;
  seats: [SeatView, SeatView, SeatView];
  quiet: number;
  recent: HandView[];
  settleAt: number;
  scripted: boolean;
}

export function createStubClient(opts: StubOptions = {}): GameClient {
  const mode = opts.mode ?? "practice";
  const commitSecs = opts.commitSecs ?? 60;
  const settleMs = opts.settleMs ?? 1200;
  const r = rng(Date.now() & 0xffffffff);
  const now = (): number => Date.now() / 1000;
  let seq = 100;
  let ident: Identity | null = mode === "practice" ? null : null;
  const txs = new Set<(e: TxEvent) => void>();
  const purse = { balance: "4210000000", paid: 0 };
  const board: BoardRow[] = [
    { owner: "GDUSTYWESXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX", name: "Dusty", wins: 7, hits: 4, hands: 31, earned: "70000000" },
    { owner: "GMAEXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX", name: "Mae", wins: 3, hits: 6, hands: 22, earned: "30000000" },
  ];
  const stats: StatsView = { hands: 0, wins: 0, hits: 0, falls: 0, ran: 0, earned: "0" };

  const rooms: StubRoom[] = ROOM_NAMES.map((_, id) => ({
    id, phase: "idle", hand: 0, minute: 0, opened: 0, deadline: 0,
    seats: [houseSeat(0), houseSeat(1), houseSeat(2)], quiet: 0, recent: [], settleAt: 0, scripted: false,
  }));

  function emit(e: TxEvent): void {
    txs.forEach((cb) => cb(e));
  }

  async function tx<T>(label: string, run: () => T, auto = false): Promise<T> {
    const id = `${label}-${Math.random().toString(36).slice(2)}`;
    emit({ id, label, stage: "sending", auto });
    await new Promise((res) => setTimeout(res, 150));
    try {
      const out = run();
      emit({ id, label, stage: "done", auto, hash: mode === "chain" ? id : undefined });
      return out;
    } catch (e) {
      emit({ id, label, stage: "failed", auto, error: (e as Error).message });
      throw e;
    }
  }

  function open(rm: StubRoom): void {
    rm.phase = "open";
    rm.hand = ++seq;
    rm.minute += 1;
    rm.opened = now();
    rm.deadline = now() + commitSecs;
    rm.settleAt = 0;
    rm.seats.forEach((s) => {
      s.state = "waiting";
      s.card = null;
      s.target = null;
      if (s.kind === "house") s.bullet = 1;
    });
  }

  function players(rm: StubRoom): SeatView[] {
    return rm.seats.filter((s) => s.kind !== "house");
  }

  function settle(rm: StubRoom): void {
    const cards: HandCard[] = [];
    const targets: (number | null)[] = [];
    rm.seats.forEach((s, i) => {
      if (s.kind === "house") {
        const p: { card: CardName; target: number | null } = opts.houseTable ? { card: "table", target: null } : houseCard(r, i);
        cards.push(p.card);
        targets.push(p.target);
      } else if (s.state === "shown" && s.card) {
        cards.push(s.card);
        targets.push(s.target);
      } else {
        cards.push("slept");
        targets.push(null);
      }
    });
    const j = judge(cards, targets);
    rm.quiet = j.quiet ? rm.quiet + 1 : 0;
    const scattered = rm.quiet >= 3;
    if (scattered) rm.quiet = 0;
    const seats = rm.seats.map((s, i): HandSeatView => {
      let out: HandSeatView["out"] = "stays";
      if (s.kind !== "house") {
        if (cards[i] === "slept") s.missed += 1;
        else s.missed = 0;
        if (s.leaving) out = "left";
        else if (cards[i] === "slept" && s.missed >= 2) out = "carried";
        else if (scattered) out = "scattered";
      }
      return { kind: s.kind, address: s.address, name: s.name, card: cards[i], target: targets[i], hit: j.hit[i], out };
    }) as HandView["seats"];
    let note: HandView["note"] = "none";
    let paid = "0";
    if (j.winner !== null) {
      const ws = rm.seats[j.winner];
      if (ws.kind === "house") note = "house";
      else if (!ws.claimed) note = "unclaimed";
      else {
        note = "paid";
        paid = PAY;
        purse.balance = String(Number(purse.balance) - Number(PAY));
        purse.paid++;
      }
    }
    const txHash = mode === "chain" ? `stub${rm.hand}` : undefined;
    const late = !!txHash && !!opts.lateTxMs;
    const base = { hand: String(rm.hand), room: rm.id, minute: rm.minute, at: now(), seats, winner: j.winner, quiet: j.quiet, scattered, paid, note, tx: late ? undefined : txHash };
    const hand: HandView = { ...base, lines: narrate(base, j.fired, j.standing) };
    rm.recent = [hand, ...rm.recent].slice(0, 8);
    if (late) {
      setTimeout(() => {
        rm.recent = rm.recent.map((h) => (h.hand === hand.hand ? { ...h, tx: txHash } : h));
      }, opts.lateTxMs);
    }
    rm.seats.forEach((s, i) => {
      if (s.you) {
        stats.hands++;
        if (j.winner === i) stats.wins++;
        if (j.hit[i]) stats.falls++;
        if (cards[i] === "iron") s.bullet = 0;
      }
      if (s.kind !== "house" && seats[i].out !== "stays") rm.seats[i] = houseSeat(i as 0 | 1 | 2);
    });
    if (players(rm).length === 0 && !rm.scripted) {
      rm.phase = "idle";
      rm.hand = 0;
      rm.opened = 0;
      rm.deadline = 0;
      rm.seats = [houseSeat(0), houseSeat(1), houseSeat(2)];
    } else open(rm);
  }

  function tick(rm: StubRoom): void {
    const t = now();
    if (rm.phase === "open" && t >= rm.deadline) {
      rm.phase = "locked";
      rm.settleAt = Date.now() + settleMs;
    }
    if (rm.phase === "locked" && rm.settleAt && Date.now() >= rm.settleAt) settle(rm);
  }

  // Scripted busy rooms so the map shows live minutes.
  for (const id of opts.busy ?? []) {
    const rm = rooms[id];
    rm.scripted = true;
    rm.seats[0] = { ...houseSeat(0), kind: "agent", address: "GAGENTXXXX", name: "Rhett", claimed: true };
    rm.seats[2] = { ...houseSeat(2), kind: "player", address: "GPLAYERXX", name: "Pearl" };
    open(rm);
  }

  function view(rm: StubRoom): RoomView {
    tick(rm);
    const t = now();
    const yourSeat = rm.seats.findIndex((s) => s.you);
    const you = ident
      ? { seat: yourSeat >= 0 ? (yourSeat as 0 | 1 | 2) : null, queued: false, state: yourSeat >= 0 ? rm.seats[yourSeat].state : null, bullet: yourSeat >= 0 ? rm.seats[yourSeat].bullet : 1 }
      : null;
    return {
      id: rm.id, slug: SLUGS[rm.id], name: ROOM_NAMES[rm.id], phase: rm.phase, hand: String(rm.hand), minute: rm.minute,
      opened: rm.opened, deadline: rm.deadline, revealBy: 0, lockedAt: rm.phase === "locked" ? 1 : 0,
      seats: rm.seats.map((s) => ({ ...s })) as RoomView["seats"], queue: [], quiet: rm.quiet, recent: rm.recent.slice(),
      now: t, ledger: Math.floor(t / 5), closesIn: rm.phase === "open" ? Math.max(0, Math.ceil(rm.deadline - t)) : 0,
      due: rm.phase === "locked" ? "settle" : null, you,
    };
  }

  function mkIdentity(door: Identity["door"]): Identity {
    const session = "GSTUBSESSION" + "X".repeat(44);
    return { door, session, owner: session, claimed: false, name: "Wes", agent: false, funded: true };
  }

  const client: GameClient = {
    mode,
    txUrl: (h) => (mode === "chain" ? `https://stellar.expert/explorer/testnet/tx/${h}` : null),
    accountUrl: (a) => (mode === "chain" ? `https://stellar.expert/explorer/testnet/account/${a}` : null),
    contractUrl: () => (mode === "chain" ? "https://stellar.expert/explorer/testnet/contract/CSTUBCONTRACT" : null),
    now,
    async rooms(): Promise<RoomSummary[]> {
      return rooms.map((rm) => {
        tick(rm);
        return {
          id: rm.id, slug: SLUGS[rm.id], name: ROOM_NAMES[rm.id], phase: rm.phase, players: players(rm).length, queued: 0,
          deadline: rm.deadline, lastAt: rm.recent[0]?.at ?? 0,
        };
      });
    },
    async room(id) {
      if (!rooms[id]) throw new Error("That room is not on the survey.");
      return view(rooms[id]);
    },
    async board() {
      return board.slice();
    },
    async purse(): Promise<PurseView> {
      return { balance: purse.balance, pay: PAY, hourBudget: 60, hourPaid: purse.paid };
    },
    async stats() {
      return { ...stats };
    },
    async balance() {
      return "100000000000";
    },
    identity: () => ident,
    async prepareSession(progress) {
      if (ident) return ident;
      progress?.("Friendbot is saddling your horse.");
      await new Promise((res) => setTimeout(res, 200));
      progress?.("Pulling up a chair.");
      ident = mkIdentity(mode === "practice" ? "practice" : "guest");
      return ident;
    },
    async connectWallet(progress): Promise<PendingLink> {
      const id = await client.prepareSession(progress);
      progress?.("Preparing the link.");
      await new Promise((res) => setTimeout(res, 300));
      const owner = "GSTUBOWNER" + "X".repeat(46);
      return {
        owner,
        walletName: "Stub Wallet",
        async sign() {
          await new Promise((res) => setTimeout(res, 300));
          ident = { ...id, door: "wallet", owner, claimed: true, walletName: "Stub Wallet" };
          rooms.forEach((rm) => rm.seats.forEach((s) => s.you && (s.claimed = true)));
          return ident;
        },
        cancel() {},
      };
    },
    async linkSecret(secret, progress) {
      if (!/^S[A-Z2-7]{55}$/.test(secret.trim())) throw new Error("That is not a Stellar secret key.");
      const id = await client.prepareSession(progress);
      ident = { ...id, door: "secret", owner: "GSTUBSECRETOWNER" + "X".repeat(40), claimed: true };
      return ident;
    },
    async rename(name, agent) {
      if (!validPlayerName(name)) throw new Error("Names are letters, numbers, and spaces. Twelve at most. The house names are taken.");
      if (ident) ident = { ...ident, name, agent: agent ?? ident.agent };
    },
    exportSecret: () => (ident ? "SSTUBSECRET" + "X".repeat(45) : null),
    forget() {
      ident = null;
    },
    async sit(id) {
      const id0 = await client.prepareSession();
      return tx("Sit down", () => {
        const rm = rooms[id];
        const at = rm.seats.findIndex((s) => s.you);
        if (at >= 0) return { seat: at, queued: false };
        const free = rm.phase === "idle" ? 0 : rm.seats.findIndex((s) => s.kind === "house");
        if (free < 0) throw new Error("The table is full.");
        rm.seats[free] = { ...houseSeat(free as 0 | 1 | 2), kind: id0.agent ? "agent" : "player", address: id0.session, name: id0.name, claimed: id0.claimed, you: true };
        if (rm.phase === "idle") open(rm);
        return { seat: free, queued: false };
      });
    },
    async leave(id) {
      await tx("Stand up", () => {
        const rm = rooms[id];
        const i = rm.seats.findIndex((s) => s.you);
        if (i < 0) return;
        if (rm.phase === "open" && players(rm).length === 1 && rm.seats[i].state === "waiting") {
          rm.phase = "idle";
          rm.hand = 0;
          rm.deadline = 0;
          rm.seats = [houseSeat(0), houseSeat(1), houseSeat(2)];
        } else rm.seats[i].leaving = true;
      });
    },
    async playCard(id, card, target) {
      const rm = rooms[id];
      const label = card === "iron" && target !== null ? `Iron at ${rm.seats[target].name}` : card[0].toUpperCase() + card.slice(1);
      return tx(label, () => {
        const s = rm.seats.find((x) => x.you);
        if (!s) throw new Error("You are not in this minute.");
        if (rm.phase !== "open") return "missed" as const;
        if (s.state !== "waiting") throw new Error("Your card is already down.");
        if (card === "iron" && s.bullet < 1) throw new Error("The belt is empty.");
        s.state = "shown";
        s.card = card;
        s.target = card === "iron" ? target : null;
        if (players(rm).every((p) => p.state === "shown")) {
          rm.phase = "locked";
          rm.settleAt = Date.now() + settleMs;
        }
        return "played" as const;
      });
    },
    watch(id, onView) {
      let live = true;
      const pump = (): void => {
        if (live) onView(view(rooms[id]));
      };
      pump();
      const h = setInterval(pump, 400);
      return () => {
        live = false;
        clearInterval(h);
      };
    },
    async agentInfo(agent) {
      return { name: "Rhett", offeredTo: ident?.owner ?? null, claimed: false, owner: agent };
    },
    async acceptAgent() {
      await tx("Accept the agent", () => undefined);
    },
    onTx(cb) {
      txs.add(cb);
      return () => txs.delete(cb);
    },
  };
  return client;
}

// ChainClient: GameClient over the Soroban contract (SPEC 6). No window access at import time.
import { Address, Keypair, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import type {
  BoardRow, CardName, GameClient, Identity, PendingLink, Progress, PurseView, RoomSummary, RoomView, StatsView, TxEvent, TxStage,
} from "../shared/game-client";
import { HOUSE_NAMES } from "../shared/game-client";
import { LedgerClock } from "./clock";
import {
  decodeChair, decodePurse, decodeRoom, decodeRow, decodeStats, dataKey, keys, roomAddresses, toBoardRow, toPurseView,
  toRoomView, toStatsView, toSummary, type ChairMap, type RawChair, type RawRoom,
} from "./codec";
import { loadDeployment, storagePrefix, type Deployment } from "./config";
import { ChainError, contractError, isRace, toChainError } from "./errors";
import { CARD_CODES, NONE, commitment, defaultName, dedupeNames, playerName, randomSalt, roomName, toHex } from "./local";
import { findSealed, pruneSealed, putSealed, removeSealed } from "./sealed";
import { accountExists, ensureSession, friendbot, loadSession } from "./session";
import { SettledIndex } from "./settled";
import { browserStore, type KeyValueStore } from "./store";
import { TxSender, keypairSigner, makeRpc, withLock, type PreparedTx, type Rpc, type Signer, type TxResult, type TxSenderOptions } from "./tx";
import { connectKit, loadKit, secretSigner, walletSigner } from "./wallet";

export interface CroupierOptions {
  closeSlack: number; // seconds after deadline before close (SPEC: 8)
  lockSlack: number; // seconds after reveal_by before lock (SPEC: 5)
  seatStagger: number; // seconds per seat index (SPEC: 6)
  queuedDelay: number; // SPEC: 18
  spectatorDelay: number | null; // SPEC: 20; null disables
  jitter: number; // max random seconds (SPEC: 2)
}

export const DEFAULT_CROUPIER: CroupierOptions = { closeSlack: 8, lockSlack: 5, seatStagger: 6, queuedDelay: 18, spectatorDelay: 20, jitter: 2 };

export interface ChainClientOptions {
  deployment?: Deployment;
  store?: KeyValueStore;
  rpc?: Rpc;
  fetch?: typeof fetch;
  /** Use this secret as the session key (Node agents). */
  sessionSecret?: string;
  croupier?: Partial<CroupierOptions>;
  pollMs?: number;
  /** Test hooks for the tx pipeline (sleep, pollMs, confirmMs). */
  tx?: Pick<TxSenderOptions, "sleep" | "pollMs" | "confirmMs">;
  /** Send cards from the template simulated when the minute opened (default CARD_TEMPLATES). */
  templates?: boolean;
  /** Diagnostics: which path each card call took (template, fallback, simulated). */
  onCardPath?: (fn: string, path: "template" | "fallback" | "simulated", why?: ChainError) => void;
}

/**
 * Card templates are on: the click skips simulation (ROADMAP 5.1 P0 item 4). Measured on the test
 * contract (scratch/speed): 14/14 templated cards landed, no fallback; median click-to-landing
 * 12.5 s vs 17.1 s simulated. A failed templated send falls back to the simulated path.
 */
export const CARD_TEMPLATES = true;

export interface ChainClient extends GameClient {
  readonly deployment: Deployment;
  readonly clock: LedgerClock;
  /** Session address, or null before prepareSession. */
  address(): string | null;
  resolve(room: number, hand: string, auto?: boolean): Promise<number>;
}

type Stage = "preparing" | "signing" | "sending" | "confirming";

const CHAIR_TTL_MS = 30_000;
/** playCard may choose play or commit from a watched view this young. */
const FRESH_VIEW_MS = 3_000;
/** How long our own card shows as down while the RPC still reports the seat waiting. */
const OVERLAY_MS = 20_000;

interface Overlay {
  hand: bigint;
  seat: number;
  state: 1 | 2;
  card: number;
  target: number;
  until: number;
}

interface Watcher {
  room: number;
  onView: (view: RoomView) => void;
  kick: (ms?: number) => void;
}

/** True when the tx emitted the contract's `locked` event (our card fixed the last seat). */
function emittedLocked(r: TxResult): boolean {
  for (const ev of r.events) {
    try {
      const t = ev.body.v0.topics[0] as unknown as { type?: string; sym?: unknown };
      if (t?.type === "scvSymbol" && String(t.sym) === "locked") return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

export function createChainClient(opts: ChainClientOptions = {}): ChainClient {
  const d = opts.deployment ?? loadDeployment();
  if (!d) throw new ChainError("No deployment is configured. Add deployments/testnet.json.", null, "NoDeployment");
  const prefix = storagePrefix(d);
  const store = opts.store ?? browserStore();
  const rpcClient = opts.rpc ?? makeRpc(d);
  const clock = new LedgerClock(rpcClient);
  const sender = new TxSender(rpcClient, d, {
    ...opts.tx, now: () => clock.now(), onLedger: (t, l) => clock.ingest(t, l), templates: opts.templates ?? CARD_TEMPLATES,
  });
  const croupier: CroupierOptions = { ...DEFAULT_CROUPIER, ...opts.croupier };
  const pollMs = opts.pollMs ?? 2000;

  let session: Keypair | null = opts.sessionSecret ? ensureSession(store, prefix, opts.sessionSecret) : loadSession(store, prefix);
  let ownerSigner: Signer | null = null;
  let myChair: RawChair | null = null;
  let funded = store.get(prefix + "funded") === session?.publicKey();
  const chairCache = new Map<string, { chair: RawChair | null; at: number }>();
  const txByHand = new Map<string, string>();
  const settled = new SettledIndex(rpcClient, d.contractId, txByHand);
  const watchers = new Set<Watcher>();
  /** Newest raw room per id with the local time it was read (playCard reuse, optimistic views). */
  const latest = new Map<number, { raw: RawRoom; at: number }>();
  const overlays = new Map<number, Overlay>();
  /** Hands whose lock came from our own card: settle them without the seat stagger. */
  const lockedByMe = new Set<string>();
  const txListeners = new Set<(e: TxEvent) => void>();
  let txId = 0;

  // ---- tx events

  function emit(e: TxEvent) {
    for (const cb of txListeners) {
      try {
        cb(e);
      } catch {
        /* listener error */
      }
    }
  }

  async function track<T extends { hash?: string }>(label: string, auto: boolean, fn: (stage: (s: Stage) => void) => Promise<T>): Promise<T> {
    const id = `tx${++txId}`;
    const stage = (s: TxStage, extra: Partial<TxEvent> = {}) => emit({ id, label, stage: s, auto, ...extra });
    stage("preparing");
    try {
      const r = await fn((s) => stage(s));
      stage("done", { hash: r.hash });
      return r;
    } catch (e) {
      const err = toChainError(e);
      stage("failed", { error: err.message, hash: (err as ChainError & { hash?: string }).hash });
      // The tx toast already shows this error; callers check `shown` to avoid a second toast.
      (err as ChainError & { shown?: boolean }).shown = true;
      throw err;
    }
  }

  function signer(): Signer {
    if (!session) throw new ChainError("Make a session first.", null, "NoSession");
    return keypairSigner(session, d!.networkPassphrase);
  }

  function send(fn: string, args: xdr.ScVal[], label: string, o: { auto?: boolean; room?: number; resend?: number; hand?: bigint } = {}): Promise<TxResult> {
    // Card calls name their hand so the sender can use the template simulated when the minute opened.
    const template = o.hand !== undefined && o.room !== undefined ? { room: o.room, hand: o.hand } : undefined;
    const onPath = opts.onCardPath ? (p: "template" | "fallback" | "simulated", why?: ChainError) => opts.onCardPath!(fn, p, why) : undefined;
    return track(label, !!o.auto, (stage) => sender.invoke(signer(), fn, args, { onStage: stage, room: o.room, resend: o.resend, template, onPath }));
  }

  // ---- reads

  async function readEntries(lkeys: xdr.LedgerKey[]): Promise<Map<string, xdr.ScVal>> {
    const out = new Map<string, xdr.ScVal>();
    for (let i = 0; i < lkeys.length; i += 100) {
      const res = await rpcClient.getLedgerEntries(...lkeys.slice(i, i + 100));
      clock.ingest(undefined, res.latestLedger);
      for (const e of res.entries) {
        try {
          if (e.val.type === "contractData") out.set(e.key.toXdr("base64"), e.val.contractData.val);
        } catch {
          /* not contract data */
        }
      }
    }
    return out;
  }

  const k64 = (k: xdr.LedgerKey) => k.toXdr("base64");

  async function readRooms(ids: number[]): Promise<RawRoom[]> {
    const lk = ids.map((id) => dataKey(d!.contractId, keys.room(id)));
    const m = await readEntries(lk);
    return lk.map((k, i) => {
      const v = m.get(k64(k));
      if (!v) throw contractError(1, { room: ids[i] });
      return decodeRoom(v);
    });
  }

  async function readChairs(addrs: string[], fresh: string[] = []): Promise<ChairMap> {
    const now = Date.now();
    const out: ChairMap = new Map();
    const need: string[] = [];
    for (const a of addrs) {
      const c = chairCache.get(a);
      if (c && now - c.at < CHAIR_TTL_MS && !fresh.includes(a)) out.set(a, c.chair);
      else need.push(a);
    }
    if (need.length) {
      const lk = need.map((a) => dataKey(d!.contractId, keys.chair(a)));
      const m = await readEntries(lk);
      need.forEach((a, i) => {
        const v = m.get(k64(lk[i]));
        const chair = v ? decodeChair(v) : null;
        chairCache.set(a, { chair, at: now });
        out.set(a, chair);
      });
    }
    if (session && out.has(session.publicKey())) myChair = out.get(session.publicKey()) ?? null;
    return out;
  }

  async function ensureClock() {
    if (!clock.synced) await clock.sync().catch(() => undefined);
  }

  /** Keeps our own card down in views while the RPC still shows the seat waiting. */
  function applyOverlay(raw: RawRoom): RawRoom {
    const o = overlays.get(raw.id);
    if (!o) return raw;
    if (raw.hand !== o.hand || Date.now() > o.until) {
      overlays.delete(raw.id);
      return raw;
    }
    const seat = raw.seats[o.seat];
    if (raw.phase !== 1 || !seat || seat.state !== 0) return raw;
    const seats = raw.seats.slice();
    seats[o.seat] = { ...seat, state: o.state, ...(o.state === 2 ? { card: o.card, target: o.target } : {}) };
    return { ...raw, seats };
  }

  function viewOf(raw: RawRoom, chairs: ChairMap): RoomView {
    const me = session?.publicKey() ?? null;
    return toRoomView(raw, { now: clock.now(), ledger: clock.latestLedger, you: me, chairs, txByHand });
  }

  function cachedChairs(raw: RawRoom): ChairMap {
    const m: ChairMap = new Map();
    for (const a of roomAddresses(raw)) m.set(a, chairCache.get(a)?.chair ?? null);
    const me = session?.publicKey();
    if (me) m.set(me, myChair);
    return m;
  }

  async function roomWithRaw(id: number): Promise<{ raw: RawRoom; view: RoomView }> {
    if (!Number.isInteger(id) || id < 0 || id > 8) throw contractError(1);
    const me = session?.publicKey() ?? null;
    // Room entry (+ this player's chair when known) and the ledger clock load together.
    const roomLk = dataKey(d!.contractId, keys.room(id));
    const myChairLk = me ? dataKey(d!.contractId, keys.chair(me)) : null;
    const first = myChairLk ? [roomLk, myChairLk] : [roomLk];
    const clockP = ensureClock();
    const entries = await readEntries(first);
    const roomVal = entries.get(k64(roomLk));
    if (!roomVal) throw contractError(1, { room: id });
    const read = decodeRoom(roomVal);
    if (me && myChairLk) {
      const cv = entries.get(k64(myChairLk));
      const chair = cv ? decodeChair(cv) : null;
      chairCache.set(me, { chair, at: Date.now() });
      myChair = chair;
    }
    const addrs = roomAddresses(read);
    if (me && !addrs.includes(me)) addrs.push(me);
    // Other seat chairs in parallel with finishing the clock sync.
    const others = me ? addrs.filter((a) => a !== me) : addrs;
    const [chairs] = await Promise.all([readChairs(others), clockP]);
    if (me) chairs.set(me, chairCache.get(me)?.chair ?? null);
    const raw = applyOverlay(read);
    const prev = latest.get(id);
    if (!prev || prev.raw.hand <= raw.hand) latest.set(id, { raw, at: Date.now() });
    settled.maybeRefresh(id, raw.recent.map((h) => ({ hand: h.hand.toString(), at: Number(h.at) })), clock.latestLedger, clock.now());
    return { raw, view: viewOf(raw, chairs) };
  }

  /** Hand we already warmed a card template for (commit + play shapes). */
  let warmKey: string | null = null;
  let warming: Promise<void> | null = null;

  /** Pre-simulate commit/play templates once a minute opens for this seated player. */
  function warmCardTemplates(raw: RawRoom, seatIdx: number) {
    if (!session || raw.phase !== 1 || seatIdx < 0 || raw.seats[seatIdx]?.state !== 0) return;
    const me = session.publicKey();
    const key = `${raw.id}:${raw.hand}:${me}`;
    if (warmKey === key || warming) return;
    warmKey = key;
    const hand = raw.hand;
    const room = raw.id;
    warming = (async () => {
      try {
        await sender.ensureSeq(me);
        const dummyCommit = randomSalt();
        // Template both shapes with dummy args (privacy unchanged). The click attaches the template's
        // footprint, resources, and fee to the real args, or simulates when templates are off or stale.
        await Promise.all([
          sender.template(me, "commit", [addrVal(me), u32(room), u64(hand), xdr.ScVal.scvBytes(dummyCommit)], { room, hand }),
          sender.template(me, "play", [addrVal(me), u32(room), u64(hand), u32(0), u32(NONE)], { room, hand }),
        ]);
      } catch {
        warmKey = null;
      } finally {
        warming = null;
      }
    })();
  }

  /** Optimistic update after our card landed: views show it down at once. */
  function markCard(room: number, base: RawRoom, o: Overlay) {
    overlays.set(room, o);
    const cur = latest.get(room);
    const raw = applyOverlay(cur && cur.raw.hand === base.hand ? cur.raw : base);
    latest.set(room, { raw, at: Date.now() });
    const view = viewOf(raw, cachedChairs(raw));
    for (const w of watchers) {
      if (w.room !== room) continue;
      try {
        w.onView(view);
      } catch {
        /* listener error */
      }
    }
  }

  function kickWatchers(room: number, ms = 0) {
    for (const w of watchers) if (w.room === room) w.kick(ms);
  }

  async function refreshChair(): Promise<RawChair | null> {
    if (!session) return null;
    await readChairs([session.publicKey()], [session.publicKey()]);
    return myChair;
  }

  // ---- identity

  function identity(): Identity | null {
    if (!session) return null;
    const addr = session.publicKey();
    const door = (store.get(prefix + "door") as Identity["door"] | null) ?? "guest";
    const walletName = store.get(prefix + "walletName") ?? undefined;
    return {
      door,
      session: addr,
      owner: myChair?.owner || store.get(prefix + "owner") || addr,
      claimed: !!myChair?.claimed,
      name: myChair?.name || defaultName(addr),
      agent: !!myChair?.agent,
      funded,
      ...(walletName ? { walletName } : {}),
    };
  }

  let preparing: Promise<Identity> | null = null;
  /** Idempotent and cheap: no network call when the key is funded and the chair read is fresh. */
  function prepareSession(progress?: Progress): Promise<Identity> {
    if (preparing) {
      if (!funded) progress?.("Friendbot is saddling your horse.");
      return preparing;
    }
    if (session && funded) {
      const c = chairCache.get(session.publicKey());
      if (c && Date.now() - c.at < CHAIR_TTL_MS) return Promise.resolve(identity()!);
    }
    preparing = prepareSessionOnce(progress).finally(() => {
      preparing = null;
    });
    return preparing;
  }

  async function prepareSessionOnce(progress?: Progress): Promise<Identity> {
    session = ensureSession(store, prefix);
    const addr = session.publicKey();
    if (!funded) {
      if (!(await accountExists(rpcClient, addr))) {
        await friendbot(d!.friendbotUrl, addr, rpcClient, { fetch: opts.fetch, progress });
      }
      funded = true;
      store.set(prefix + "funded", addr);
    }
    progress?.("Pulling up a chair.");
    await readChairs([addr]).catch(() => null);
    return identity()!;
  }

  async function ensureFunded(address: string, progress?: Progress) {
    if (!(await accountExists(rpcClient, address))) await friendbot(d!.friendbotUrl, address, rpcClient, { fetch: opts.fetch, progress });
  }

  /** Background part of a link: fund owner, offer, prepare accept. Null when already linked. */
  async function prepareLink(owner: string, progress?: Progress): Promise<PreparedTx | null> {
    // Only accept needs the owner's account, so a new wallet's Friendbot call runs next to the
    // session's funding and the offer instead of before them.
    const ownerFunded = ensureFunded(owner, progress);
    ownerFunded.catch(() => undefined);
    await prepareSession(progress);
    const me = session!.publicKey();
    if (owner === me) throw contractError(19);
    const offerKey = dataKey(d!.contractId, keys.offer(me));
    const [chair, offer] = await Promise.all([refreshChair(), readEntries([offerKey])]);
    if (chair?.claimed && chair.owner === owner) {
      await ownerFunded;
      return null;
    }
    const current = offer.get(k64(offerKey));
    const offeredTo = current ? (native(current) as string) : null;
    if (offeredTo !== owner) {
      progress?.("Offering the chair to your wallet.");
      await send("offer", [addrVal(me), addrVal(owner)], "Offer the chair");
    }
    await ownerFunded;
    return sender.prepareFresh(owner, "accept", [addrVal(owner), addrVal(me)], 300);
  }

  function rememberOwner(owner: string, door: Identity["door"], walletName?: string) {
    store.set(prefix + "owner", owner);
    store.set(prefix + "door", door);
    if (walletName) store.set(prefix + "walletName", walletName);
    else store.remove(prefix + "walletName");
  }

  async function finishLink(prep: PreparedTx | null, signedPromise: Promise<string> | null): Promise<void> {
    if (!prep || !signedPromise) return;
    await track("Sign the link", false, async (stage) => {
      stage("signing");
      const signed = await signedPromise;
      stage("sending");
      return sender.submitSigned(signed, prep);
    });
  }

  // ---- croupier helpers

  let channel: BroadcastChannel | null = null;
  const channelListeners = new Set<() => void>();
  function openChannel(): BroadcastChannel | null {
    if (channel) return channel;
    const BC = (globalThis as { BroadcastChannel?: typeof BroadcastChannel }).BroadcastChannel;
    if (!BC) return null;
    try {
      channel = new BC(`standoff-${d!.contractId}`);
      (channel as unknown as { unref?: () => void }).unref?.();
      channel.onmessage = () => channelListeners.forEach((f) => f());
    } catch {
      channel = null;
    }
    return channel;
  }
  function broadcast(msg: unknown) {
    try {
      openChannel()?.postMessage(msg);
    } catch {
      /* ignore */
    }
  }

  async function resolve(room: number, hand: string, auto = true): Promise<number> {
    const r = await send("resolve", [u32(room), u64(hand)], "Advance the minute", { auto });
    return Number(r.returnValue ?? 0);
  }

  // ---- client

  const client: ChainClient = {
    mode: "chain",
    deployment: d,
    clock,
    address: () => session?.publicKey() ?? null,
    txUrl: (hash) => `${d.explorer}/tx/${hash}`,
    accountUrl: (a) => `${d.explorer}/${a.startsWith("C") ? "contract" : "account"}/${a}`,
    contractUrl: () => `${d.explorer}/contract/${d.contractId}`,
    now: () => clock.now(),

    async rooms(): Promise<RoomSummary[]> {
      // One ledger-entry batch for all nine rooms; clock sync runs in parallel.
      const [raws] = await Promise.all([readRooms([0, 1, 2, 3, 4, 5, 6, 7, 8]), ensureClock()]);
      return raws.map(toSummary);
    },

    async room(id: number): Promise<RoomView> {
      return (await roomWithRaw(id)).view;
    },

    async board(): Promise<BoardRow[]> {
      const v = await sender.view("board");
      return (Array.isArray(v) ? v : []).map(decodeRow).map(toBoardRow);
    },

    async purse(): Promise<PurseView> {
      return toPurseView(decodePurse(await sender.view("purse")));
    },

    async stats(owner: string): Promise<StatsView> {
      return toStatsView(decodeStats(await sender.view("stats", [addrVal(owner)])));
    },

    async balance(address: string): Promise<string | null> {
      const key = xdr.LedgerKey.account(new xdr.LedgerKeyAccount({ accountId: Keypair.fromPublicKey(address).xdrAccountId() }));
      const res = await rpcClient.getLedgerEntries(key);
      const e = res.entries[0];
      if (!e || e.val.type !== "account") return null;
      return e.val.account.balance.toString();
    },

    identity,
    prepareSession,

    async connectWallet(progress?: Progress): Promise<PendingLink> {
      // Kit is initialized on testnet; connectKit also asks the wallet its network before we build accept.
      const { address: owner, walletName } = await connectKit(d.networkPassphrase);
      const kit = await loadKit();
      const prep = await prepareLink(owner, progress);
      const ws = walletSigner(kit, owner, d.networkPassphrase);
      let cancelled = false;
      return {
        owner,
        walletName,
        async sign() {
          if (cancelled) throw new ChainError("The link was cancelled.", null, "Cancelled");
          // First await: the wallet signature (keeps the click gesture).
          const signed = prep ? ws.signTransaction(prep.xdr) : null;
          await finishLink(prep, signed);
          ownerSigner = ws;
          rememberOwner(owner, "wallet", walletName);
          chairCache.delete(session!.publicKey());
          await refreshChair().catch(() => null);
          return identity()!;
        },
        cancel() {
          cancelled = true;
        },
      };
    },

    async linkSecret(secret: string, progress?: Progress): Promise<Identity> {
      const s = secretSigner(secret, d.networkPassphrase);
      const prep = await prepareLink(s.address, progress);
      await finishLink(prep, prep ? s.signTransaction(prep.xdr) : null);
      ownerSigner = s;
      rememberOwner(s.address, "secret");
      chairCache.delete(session!.publicKey());
      await refreshChair().catch(() => null);
      return identity()!;
    },

    async rename(name: string, agent = false): Promise<void> {
      await prepareSession();
      await send("rename", [addrVal(session!.publicKey()), nativeToScVal(name, { type: "string" }), xdr.ScVal.scvBool(agent)], "Rename");
      chairCache.delete(session!.publicKey());
      await refreshChair().catch(() => null);
    },

    exportSecret: () => session?.secret() ?? null,

    forget() {
      for (const k of store.keys()) if (k.startsWith(prefix)) store.remove(k);
      session = null;
      ownerSigner = null;
      myChair = null;
      funded = false;
      chairCache.clear();
    },

    async sit(room: number) {
      if (!Number.isInteger(room) || room < 0 || room > 8) throw contractError(1);
      await prepareSession();
      const r = await send("sit", [addrVal(session!.publicKey()), u32(room)], `Sit in ${roomName(room)}`, { room: myChair?.room });
      chairCache.delete(session!.publicKey());
      const seat = Number(r.returnValue ?? NONE);
      return seat === NONE ? { seat: null, queued: true } : { seat, queued: false };
    },

    async leave(room: number) {
      if (!session) return;
      await send("leave", [addrVal(session.publicKey()), u32(room)], "Stand up", { room, resend: 1 });
    },

    async playCard(room: number, card: CardName, target: number | null) {
      const me = signer().address;
      // A watched view under 3 s old is good enough to choose play or commit.
      const cached = latest.get(room);
      const raw = cached && Date.now() - cached.at < FRESH_VIEW_MS && cached.raw.phase === 1 ? cached.raw : (await roomWithRaw(room)).raw;
      const seatIdx = raw.seats.findIndex((s) => s.who === me);
      if (seatIdx < 0) throw contractError(2);
      if (raw.phase !== 1) return "missed";
      if (raw.seats[seatIdx].state !== 0) throw contractError(4);
      const code = CARD_CODES[card];
      const tgt = card === "iron" ? (target ?? NONE) : NONE;
      const chairs = new Map([...chairCache].map(([a, c]) => [a, c.chair]));
      const names = dedupeNames(raw.seats.map((s, i) => playerName(s.who, i, s.who ? chairs.get(s.who)?.name : null)));
      const label = card === "iron" ? `Iron at ${names[tgt] ?? HOUSE_NAMES[tgt] ?? "?"}` : card === "air" ? "Air" : "Table";
      const hand = raw.hand;
      const others = raw.seats.filter((s, i) => i !== seatIdx && s.who);
      const cardDown = (state: 1 | 2) => markCard(room, raw, { hand, seat: seatIdx, state, card: code, target: tgt, until: Date.now() + OVERLAY_MS });
      if (others.every((s) => s.state >= 1)) {
        try {
          const r = await send("play", [addrVal(me), u32(room), u64(hand), u32(code), u32(tgt)], label, { room, resend: 1, hand });
          cardDown(2);
          if (emittedLocked(r)) {
            // Our card locked the minute: settle one ledger later, no seat stagger.
            lockedByMe.add(hand.toString());
            kickWatchers(room);
          }
          broadcast({ type: "card", room, hand: hand.toString() });
          return "played";
        } catch (e) {
          const err = toChainError(e);
          if (err.errorName === "Closed") return "missed";
          if (err.errorName !== "Choosing") throw err;
        }
      }
      const salt = randomSalt();
      const rec = { hand, seat: seatIdx, card: code, target: tgt, salt };
      const hex = await withLock(`standoff-seal-${me}`, async () => putSealed(store, prefix, rec));
      try {
        await send("commit", [addrVal(me), u32(room), u64(hand), xdr.ScVal.scvBytes(commitment(hand, seatIdx, code, tgt, salt))], `${label}, face down`, { room, resend: 1, hand });
        cardDown(1);
      } catch (e) {
        const err = toChainError(e);
        if (err.code !== null) removeSealed(store, prefix, hand, hex);
        if (err.errorName === "Closed") return "missed";
        throw err;
      }
      broadcast({ type: "card", room, hand: hand.toString() });
      return "sealed";
    },

    watch(room, onView, onError) {
      let stopped = false;
      let running = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let sealedNow = false;
      let lastHandPruned = -1n;
      const inflight = new Set<string>();
      const firstDue = new Map<string, number>();
      const jitter = new Map<string, number>();
      const stopClock = clock.start(5000);

      const hidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";

      const fire = (key: string, fn: () => Promise<unknown>) => {
        if (inflight.has(key)) return;
        inflight.add(key);
        fn()
          .catch((e) => {
            if (!isRace(e)) onError?.(toChainError(e));
          })
          .finally(() => {
            inflight.delete(key);
            kick(1000);
          });
      };

      const runCroupier = (raw: RawRoom) => {
        if (!session || raw.phase === 0) return;
        const me = session.publicKey();
        const hand = raw.hand;
        if (hand !== lastHandPruned) {
          pruneSealed(store, prefix, hand);
          lastHandPruned = hand;
        }
        const seatIdx = raw.seats.findIndex((s) => s.who === me);
        const queued = raw.queue.includes(me);
        const seat = seatIdx >= 0 ? raw.seats[seatIdx] : null;
        sealedNow = !!seat && seat.state === 1;
        // Pre-simulate card templates as soon as this player can still choose.
        warmCardTemplates(raw, seatIdx);

        // Reveal at once.
        if (raw.phase === 2 && seat && seat.state === 1) {
          const rec = findSealed(store, prefix, hand, seat.commit);
          if (rec) {
            fire(`reveal:${hand}`, async () => {
              const r = await send("reveal", [addrVal(me), u32(room), u64(hand), u32(rec.card), u32(rec.target), xdr.ScVal.scvBytes(rec.salt)], "Turn your card over", { auto: true, room, resend: 1 });
              if (emittedLocked(r)) lockedByMe.add(hand.toString());
              return r;
            });
          }
        }

        // Resolve when a step is due.
        const now = clock.now();
        const stepKey = `${hand}:${raw.phase}`;
        let readyAt: number | null = null;
        if (raw.phase === 1) readyAt = Number(raw.deadline) + croupier.closeSlack;
        else if (raw.phase === 2) readyAt = Number(raw.reveal_by) + croupier.lockSlack;
        // Our own lock landed in a closed ledger, so the next transaction applies in a later one and
        // simulation already runs at latest + 1: settle at once instead of waiting to see a new ledger.
        else if (raw.phase === 3 && (clock.latestLedger > raw.locked_at || lockedByMe.has(hand.toString()))) {
          if (!firstDue.has(stepKey)) firstDue.set(stepKey, now);
          readyAt = firstDue.get(stepKey)!;
        }
        if (readyAt === null) return;
        // The player whose card locked the minute settles it as soon as the next ledger shows.
        const mine = raw.phase === 3 && lockedByMe.has(hand.toString());
        const delay = mine ? 0 : seatIdx >= 0 ? seatIdx * croupier.seatStagger : queued ? croupier.queuedDelay : funded ? croupier.spectatorDelay : null;
        if (delay === null) return;
        if (!jitter.has(stepKey)) jitter.set(stepKey, mine ? 0 : Math.random() * croupier.jitter);
        if (now < readyAt + delay + jitter.get(stepKey)!) return;
        const label = raw.phase === 1 ? "Close the minute" : raw.phase === 2 ? "Lock the cards" : "Settle the minute";
        const phase = raw.phase;
        fire(`resolve:${stepKey}`, async () => {
          const r = await send("resolve", [u32(room), u64(hand)], label, { auto: true, room });
          if (phase === 3) {
            txByHand.set(hand.toString(), r.hash);
            lockedByMe.delete(hand.toString());
          }
          return r;
        });
      };

      const tick = async () => {
        if (stopped || running) return;
        running = true;
        try {
          const { raw, view } = await roomWithRaw(room);
          if (stopped) return;
          onView(view);
          runCroupier(raw);
        } catch (e) {
          if (!stopped) onError?.(toChainError(e));
        } finally {
          running = false;
          schedule();
        }
      };

      function schedule(ms?: number) {
        if (stopped) return;
        if (timer) clearTimeout(timer);
        const wait = ms ?? (hidden() && !sealedNow ? 10_000 : pollMs);
        timer = setTimeout(() => void tick(), wait);
      }
      function kick(ms = 0) {
        if (!running) schedule(ms);
      }

      const onVis = () => kick();
      const hasDoc = typeof document !== "undefined" && typeof window !== "undefined";
      if (hasDoc) {
        document.addEventListener("visibilitychange", onVis);
        window.addEventListener("pageshow", onVis);
      }
      openChannel();
      channelListeners.add(onVis);
      const self: Watcher = { room, onView: (v) => !stopped && onView(v), kick: (ms) => kick(ms ?? 0) };
      watchers.add(self);
      void tick();

      return () => {
        stopped = true;
        watchers.delete(self);
        if (timer) clearTimeout(timer);
        stopClock();
        channelListeners.delete(onVis);
        if (hasDoc) {
          document.removeEventListener("visibilitychange", onVis);
          window.removeEventListener("pageshow", onVis);
        }
        if (channelListeners.size === 0 && channel) {
          channel.close();
          channel = null;
        }
      };
    },

    async agentInfo(agent: string) {
      const ck = dataKey(d.contractId, keys.chair(agent));
      const ok = dataKey(d.contractId, keys.offer(agent));
      const m = await readEntries([ck, ok]);
      const chair = m.get(k64(ck)) ? decodeChair(m.get(k64(ck))) : null;
      const offer = m.get(k64(ok));
      return {
        name: chair?.name || defaultName(agent),
        offeredTo: offer ? (native(offer) as string) : null,
        claimed: !!chair?.claimed,
        owner: chair?.owner || agent,
      };
    },

    async acceptAgent(agent: string, progress?: Progress) {
      let s = ownerSigner;
      const owner = store.get(prefix + "owner");
      if (!s && owner && store.get(prefix + "door") === "wallet") s = walletSigner(await loadKit(), owner, d.networkPassphrase);
      if (!s) throw new ChainError("Link a wallet or a secret key first.", null, "NoOwner");
      const signerNow = s;
      await ensureFunded(signerNow.address, progress);
      const prep = await sender.prepareFresh(signerNow.address, "accept", [addrVal(signerNow.address), addrVal(agent)], 300);
      await track("Accept the agent", false, async (stage) => {
        stage("signing");
        const signed = await signerNow.signTransaction(prep.xdr);
        stage("sending");
        return sender.submitSigned(signed, prep);
      });
      chairCache.delete(agent);
    },

    onTx(cb) {
      txListeners.add(cb);
      return () => void txListeners.delete(cb);
    },

    resolve,
  };
  return client;
}

// ---- ScVal helpers

function addrVal(a: string): xdr.ScVal {
  return new Address(a).toScVal();
}
function u32(n: number): xdr.ScVal {
  return xdr.ScVal.scvU32(n);
}
function u64(v: bigint | string | number): xdr.ScVal {
  return nativeToScVal(BigInt(v), { type: "u64" });
}
function native(v: xdr.ScVal | undefined): unknown {
  if (!v) return null;
  try {
    return Address.fromScVal(v).toString();
  } catch {
    return null;
  }
}

export { toHex };

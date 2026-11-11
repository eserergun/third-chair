import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { ArtModel } from "../art/model";
import { H, W } from "../art/model";
import { REVEAL_MS, BEAT_MS, SETTLED_T } from "../art/reveal";
import { drawScene } from "../art/scene";
import { isMuted, play } from "../audio/sfx";
import type { CardName, GameClient, HandView, RoomView } from "../shared/game-client";
import { HOUSE_NAMES } from "../shared/game-client";
import { Links, SoundToggle, useUi } from "./ctx";
import { rehearsal } from "./clients";
import { doorChosen, warmSession } from "./door";
import { clock, contractIdFrom, handFate, handLines, kindLabel, seatCard, seatState, short, xlm } from "./format";
import { intent } from "./router";
import {
  handBase, liveBase, liveFrame, liveStates, rehearsalStates, revealFrame, revealSounds, stageCaption, type Frame, type Reveal,
} from "./stage";
import { Stakes, invalidateStakes, type StakeSeat } from "./Stakes";

const FRESH_SECS = 15;
const CARDS: CardName[] = ["air", "iron", "table"];
const CARD_NAME: Record<CardName, string> = { air: "Air", iron: "Iron", table: "Table" };
const CARD_HINT: Record<CardName, string> = { air: "In the open", iron: "One bullet", table: "Duck" };
const QUIET_ERRORS = /not ready|closed|already down|not turning over/i;
const REHEARSAL_LINE = "The house is rehearsing. Nothing here touches the chain.";
const PRACTICE_LINE = "Practice table. Nothing here touches the chain.";
const READING_LINE = "Reading the table...";
const LEAVING_LINE = "You stand when this minute closes.";
const COAT_BASE = [
  { name: HOUSE_NAMES[0], house: true, coat: "rust" as const, bullet: true, you: false },
  { name: HOUSE_NAMES[1], house: true, coat: "felt" as const, bullet: true, you: false },
  { name: HOUSE_NAMES[2], house: true, coat: "soot" as const, bullet: true, you: false },
];

function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState(() => {
    try {
      return matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      const mq = matchMedia("(prefers-reduced-motion: reduce)");
      const on = (): void => setReduce(mq.matches);
      mq.addEventListener("change", on);
      return () => mq.removeEventListener("change", on);
    } catch {
      return undefined;
    }
  }, []);
  return reduce;
}

function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => {
    try {
      return matchMedia(query).matches;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      const mq = matchMedia(query);
      const f = (): void => setOn(mq.matches);
      f();
      mq.addEventListener("change", f);
      return () => mq.removeEventListener("change", f);
    } catch {
      return undefined;
    }
  }, [query]);
  return on;
}

interface Receipt {
  hand: string;
  name: string;
  owner: string | null;
  paid: string;
  tx?: string;
}

const UNPAID_TIP = "The purse does not pay this chair";

function soundsFor(h: HandView): void {
  if (isMuted()) return;
  for (const s of revealSounds(h)) play(s.s, { delay: s.delay, pan: s.pan });
}

export function Saloon({ client, room }: { client: GameClient; room: number }): React.JSX.Element {
  const ui = useUi();
  const reduce = useReducedMotion();
  const practice = client.mode === "practice";
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [view, setView] = useState<RoomView | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [rehLines, setRehLines] = useState<string[]>([]);
  const [sent, setSent] = useState<{ hand: string; r: "played" | "sealed"; card: CardName; target: number | null } | null>(null);
  const [flying, setFlying] = useState<{ card: CardName; target: number | null } | null>(null);
  const [revealing, setRevealing] = useState<{ hand: HandView; replay: boolean } | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [aim, setAim] = useState<number | null>(null);
  const [plate, setPlate] = useState<string | null>(null);
  const wide = useMedia("(min-width: 1000px)");
  const dockRef = useRef<HTMLElement>(null);
  const aimRef = useRef<number | null>(null);
  aimRef.current = aim;
  const owners = useRef(new Map<string, { owner: string; claimed: boolean }>());
  const receiptTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [replaying, setReplaying] = useState<string | null>(null);
  const [rehearsing, setRehearsing] = useState(false);
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [seatBusy, setSeatBusy] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<{ key: string; secs: number }>({ key: "", secs: 0 });

  const viewRef = useRef<RoomView | null>(null);
  const revealRef = useRef<Reveal | null>(null);
  const seen = useRef(new Set<string>());
  const first = useRef(true);
  const reduceRef = useRef(reduce);
  reduceRef.current = reduce;
  const watchMin = useRef<{ hand: string; min: number }>({ hand: "", min: Infinity });
  const lastTick = useRef(-1);
  const rehearseRef = useRef<{ sec: number; view: RoomView } | null>(null);
  const rehearsePlayed = useRef("");
  const narrTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seedKey = practice ? "practice" : contractIdFrom(client.contractUrl());

  const startReveal = useCallback(
    (h: HandView, replay = false) => {
      const session = client.identity()?.session ?? null;
      revealRef.current = { hand: h, base: handBase(h, session), start: performance.now(), replay };
      setReplaying(replay ? h.hand : null);
      setRevealing({ hand: h, replay });
      setAim(null);
      soundsFor(h);
      if (narrTimer.current) clearTimeout(narrTimer.current);
      narrTimer.current = setTimeout(
        () => {
          setLines(handLines(h));
          if (!replay && h.note === "paid" && h.winner !== null) {
            const w = h.seats[h.winner];
            const owner = w.address ? (owners.current.get(w.address)?.owner ?? w.address) : null;
            setReceipt({ hand: h.hand, name: w.name, owner, paid: h.paid, ...(h.tx ? { tx: h.tx } : {}) });
            if (receiptTimer.current) clearTimeout(receiptTimer.current);
            receiptTimer.current = setTimeout(() => setReceipt((r) => (r && r.hand === h.hand ? null : r)), 30_000);
          }
        },
        reduceRef.current ? 0 : BEAT_MS,
      );
    },
    [client],
  );

  const backToLive = useCallback(() => {
    revealRef.current = null;
    setReplaying(null);
    setRevealing(null);
    if (narrTimer.current) clearTimeout(narrTimer.current);
    const newest = viewRef.current?.recent[0];
    setLines(newest ? handLines(newest) : []);
  }, []);

  // A returning player who already chose a door gets the key ready here. A first visit starts
  // the Friendbot funding at once (SPEC 6.1), so the doors rarely wait for it.
  useEffect(() => {
    if (client.mode !== "chain") return;
    if (doorChosen() && client.identity()) void client.prepareSession().then(() => ui.refresh(), () => undefined);
    else warmSession(client);
  }, [client]); // eslint-disable-line react-hooks/exhaustive-deps

  // Room feed.
  useEffect(() => {
    first.current = true;
    seen.current = new Set();
    const stop = client.watch(
      room,
      (v) => {
        const prev = viewRef.current;
        viewRef.current = v;
        setView(v);
        for (const s of v.seats) if (s.address) owners.current.set(s.address, { owner: s.owner ?? s.address, claimed: s.claimed });
        // When another client settled the minute, its tx hash comes from the settled events a few
        // seconds after the result: put it on the open receipt.
        setReceipt((r) => {
          if (!r || r.tx) return r;
          const tx = v.recent.find((h) => h.hand === r.hand)?.tx;
          return tx ? { ...r, tx } : r;
        });
        // A new minute: the watch starts over and last minute's notes go.
        if (watchMin.current.hand !== v.hand) watchMin.current = { hand: v.hand, min: Infinity };
        if (prev && prev.hand !== v.hand) setOutcome(null);
        const fresh = v.recent.filter((h) => !seen.current.has(h.hand));
        fresh.forEach((h) => seen.current.add(h.hand));
        const newest = fresh[0];
        if (newest && !first.current) invalidateStakes(client);
        if (first.current) {
          first.current = false;
          const rp = intent.replay && intent.replay.room === room ? v.recent.find((h) => h.hand === intent.replay?.hand) : undefined;
          intent.replay = null;
          if (rp) startReveal(rp, true);
          else if (newest && v.now - newest.at <= FRESH_SECS) startReveal(newest);
          else if (v.recent[0]) setLines(handLines(v.recent[0]));
          return;
        }
        if (newest) {
          if (v.now - newest.at <= FRESH_SECS) startReveal(newest);
          else setLines(handLines(newest));
        }
      },
      () => undefined,
    );
    return () => {
      stop();
      if (narrTimer.current) clearTimeout(narrTimer.current);
      if (receiptTimer.current) clearTimeout(receiptTimer.current);
    };
  }, [client, room, startReveal]);

  // Walk in from the map.
  useEffect(() => {
    if (intent.sit === room) {
      intent.sit = null;
      void ui.sit(client, room);
    }
  }, [client, room]); // eslint-disable-line react-hooks/exhaustive-deps

  // One requestAnimationFrame loop draws every frame.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.imageSmoothingEnabled = false;
    let raf = 0;
    let lastRemain = -1;
    let lastKey = "";
    let lastReh = false;
    let lastPlate: string | null = null;
    const loop = (time: number): void => {
      raf = requestAnimationFrame(loop);
      const v = viewRef.current;
      const red = reduceRef.current;
      const nowL = client.now();
      let frame: Frame;
      let second = 0;
      let urgent = false;
      let remain = 0;
      let reh = false;

      const rv = revealRef.current;
      const ms = rv ? time - rv.start : 0;
      if (rv && ms >= REVEAL_MS) {
        revealRef.current = null;
        setReplaying(null);
        setRevealing(null);
        if (rv.replay) {
          const newest = viewRef.current?.recent[0];
          setLines(newest ? handLines(newest) : []);
        }
      }
      if (revealRef.current && rv) {
        frame = revealFrame(rv, ms, red);
      } else if (!v) {
        // No real read yet: an empty table, never the rehearsal.
        frame = liveFrame(COAT_BASE, [0, 1, 2].map(() => "thinking"));
      } else if (v.phase === "idle" && v.you?.seat == null && !v.you?.queued) {
        // House rehearsal: the same house-only minute for every viewer.
        reh = true;
        const sec = Math.floor(nowL);
        if (!rehearseRef.current || rehearseRef.current.sec !== sec) rehearseRef.current = { sec, view: rehearsal(seedKey, room, nowL) };
        const rv2 = rehearseRef.current.view;
        const h = rv2.recent[0];
        const rms = h ? (nowL - h.at) * 1000 : Infinity;
        if (h && rms >= 0 && rms < REVEAL_MS) {
          if (rehearsePlayed.current !== h.hand) {
            rehearsePlayed.current = h.hand;
            if (rms < 1500) soundsFor(h);
            setRehLines(handLines(h));
          }
          frame = revealFrame({ hand: h, base: COAT_BASE, start: 0 }, rms, red);
          remain = 60 - (nowL % 60);
        } else if (rv2.phase === "open") {
          frame = liveFrame(COAT_BASE, rehearsalStates(nowL - rv2.opened));
          remain = Math.max(0, rv2.deadline - nowL);
        } else {
          frame = liveFrame(COAT_BASE, [0, 1, 2].map(() => "thinking"));
          remain = 60 - (nowL % 60);
        }
      } else {
        frame = liveFrame(liveBase(v), liveStates(v));
      }
      // Iron picker: your cowboy draws on the chair under the pointer.
      const aimAt = aimRef.current;
      let aimName: string | null = null;
      const mySeat = v?.you?.seat;
      if (aimAt !== null && !revealRef.current && !reh && v && mySeat != null && aimAt !== mySeat) {
        const me = frame.seats[mySeat];
        frame.seats[mySeat] = { ...me, pose: "aim", aimAt: aimAt as 0 | 1 | 2, t: SETTLED_T, firing: false };
        aimName = v.seats[aimAt].name;
      }
      // The watch follows the real minute, also while a reveal plays over it.
      if (v && v.phase === "open") {
        const raw = Math.max(0, v.deadline - nowL);
        if (watchMin.current.hand !== v.hand) watchMin.current = { hand: v.hand, min: Infinity };
        watchMin.current.min = Math.min(watchMin.current.min, raw);
        remain = watchMin.current.min;
        urgent = remain > 0 && remain <= 10;
        const whole = Math.ceil(remain);
        if (urgent && whole !== lastTick.current && !revealRef.current) {
          lastTick.current = whole;
          if (!isMuted()) play("tick", { volume: 0.6 });
        }
      }
      second = Math.floor(remain) % 60;
      const whole = Math.ceil(remain);
      const key = v && v.phase === "open" ? v.hand : reh ? "rehearsal" : "";
      if (whole !== lastRemain || key !== lastKey) {
        lastRemain = whole;
        lastKey = key;
        setRemaining({ key, secs: whole });
      }
      if (reh !== lastReh) {
        lastReh = reh;
        setRehearsing(reh);
      }
      const model: ArtModel = {
        frame: red ? 0 : Math.floor(time / 80),
        time: red ? 0 : time,
        reduce: red,
        seats: frame.seats,
        purse: frame.purse,
        purseT: frame.purseT,
        smoke: red ? false : frame.smoke,
        quiet: frame.quiet,
        panel: red ? 0 : frame.panel,
        second,
        urgent,
        caption: stageCaption({ practice, rehearsal: reh, view: v, reveal: revealRef.current, aimAt: aimName }),
      };
      if (model.caption !== lastPlate) {
        lastPlate = model.caption;
        setPlate(model.caption);
      }
      drawScene(ctx, model);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [client, room, practice, seedKey]);


  // Toasts sit just above the dock on wide screens.
  useEffect(() => {
    const el = dockRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const root = document.documentElement;
    const ro = new ResizeObserver(() => root.style.setProperty("--dock-h", `${Math.round(el.getBoundingClientRect().height)}px`));
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty("--dock-h");
    };
  }, []);

  const you = view?.you ?? null;
  const seated = you?.seat != null;
  const yourSeat = seated && view && you?.seat != null ? view.seats[you.seat] : null;
  const liveReveal = revealing && !revealing.replay ? revealing.hand : null;
  const shownHand = revealing?.hand ?? null;
  const session = client.identity()?.session ?? null;

  // The card this player sent for the current hand, until the read catches up.
  const sentNow = sent && view && sent.hand === view.hand ? sent : null;

  function reason(card: CardName): string | null {
    if (!view) return "Reading the table.";
    if (!seated) return you?.queued ? "You wait in the queue." : "Take a seat to play.";
    if (busy) return "Sending your card.";
    // The last minute's result may still be turning over while the next minute already runs on
    // chain: the clock is ticking, so let the player act during the animation.
    const nextOpen = view.phase === "open" && !!revealing && revealing.hand.hand !== view.hand;
    if (revealing && !nextOpen) return revealing.replay ? "Replay showing." : "Result showing.";
    if (view.phase !== "open") return "The minute is closed.";
    if ((you?.state && you.state !== "waiting") || sentNow) return "Your card is down.";
    if (card === "iron" && (yourSeat?.bullet ?? you?.bullet ?? 0) < 1) return "The belt is empty.";
    return null;
  }

  const playCard = useCallback(
    async (card: CardName, target: number | null) => {
      if (!view || busy) return;
      const hand = view.hand;
      setPicker(false);
      setAim(null);
      setBusy(true);
      setFlying({ card, target });
      setOutcome(null);
      if (!isMuted()) play("card");
      try {
        const r = await client.playCard(room, card, target);
        if (r !== "missed") setSent({ hand, r, card, target });
        if (r === "missed") setOutcome("Your card missed the minute. You played Air.");
        else if (r === "sealed" && matchMedia("(max-width: 640px)").matches) setOutcome("Keep this tab open until the cards turn over.");
      } catch (e) {
        const msg = (e as Error).message;
        if (!QUIET_ERRORS.test(msg)) ui.toast({ text: msg, kind: "error" });
      } finally {
        setBusy(false);
        setFlying(null);
      }
    },
    [client, room, view, ui, busy],
  );

  const choose = useCallback(
    (card: CardName) => {
      if (reason(card)) return;
      if (card === "iron") {
        setPicker((p) => !p);
        setAim(null);
      } else void playCard(card, null);
    },
    [playCard, view, busy, sentNow, revealing], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Keys 1, 2, 3.
  useEffect(() => {
    const k = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") {
        setPicker(false);
        setAim(null);
      }
      const i = ["1", "2", "3"].indexOf(e.key);
      if (i >= 0) choose(CARDS[i]);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [choose]);

  // A closed minute closes the picker.
  useEffect(() => {
    if (picker && (!view || view.phase !== "open" || !!revealing)) {
      setPicker(false);
      setAim(null);
    }
  }, [picker, view, revealing]);

  async function standOrSit(): Promise<void> {
    // One sit or leave at a time: a second click would send a second transaction.
    if (seatBusy) return;
    setSeatBusy(true);
    try {
      if (seated || you?.queued) {
        // A lone player with no card down stands at once; anyone else stands when the minute settles.
        const lone = !!view && view.seats.filter((s) => s.kind !== "house").length <= 1 && you?.state === "waiting";
        const running = seated && !!view && view.phase !== "idle" && !lone;
        try {
          await client.leave(room);
          setOutcome(null);
          if (running) ui.toast({ text: LEAVING_LINE, kind: "info" });
        } catch (e) {
          if (!(e as { shown?: boolean }).shown) ui.toast({ text: (e as Error).message, kind: "error" });
        }
      } else await ui.sit(client, room);
    } finally {
      // The room view shows the new seat one poll later; hold the button until then.
      setTimeout(() => setSeatBusy(false), 2500);
    }
  }

  function yourFate(h: HandView): string {
    const i = h.seats.findIndex((s) => !!session && s.address === session);
    if (i < 0) return "";
    if (h.winner === i) return h.note === "paid" ? " You take the purse." : " You take the chair.";
    if (h.seats[i].hit) return " You were hit.";
    if (h.seats[i].card === "table") return " You ducked.";
    return " You are still standing.";
  }

  let status: string;
  if (!view) status = " ";
  else if (revealing?.replay) status = "Replay. The live minute goes on.";
  else if (liveReveal) status = `The cards are turning over.${yourFate(liveReveal)}`;
  else if (!seated) status = you?.queued ? "You wait in the queue. You sit when this minute closes." : "You are watching. Take a seat to play.";
  else if (yourSeat?.leaving) status = LEAVING_LINE;
  else if (busy) status = "Sending your card...";
  else if (you?.state === "sealed") status = "Your card is face down.";
  else if (you?.state === "shown" && yourSeat?.card) status = `Your card is shown: ${yourSeat.card === "iron" && yourSeat.target !== null ? `Iron at ${view.seats[yourSeat.target].name}` : CARD_NAME[yourSeat.card]}.`;
  else if (sentNow) status = sentNow.r === "sealed" ? "Your card is face down." : "Your card is shown.";
  else if (view.phase === "open") status = "Pick a card. Keys 1, 2, 3.";
  else if (view.phase === "idle") status = "The next minute opens soon.";
  else status = "The cards are turning over.";

  // The watch: a new hand never shows the last hand's 0:00, even before the next frame.
  let watchSecs = remaining.secs;
  if (view?.phase === "open" && remaining.key !== view.hand) watchSecs = Math.ceil(Math.max(0, view.deadline - client.now()));
  else if (rehearsing && remaining.key !== "rehearsal") watchSecs = 0;
  const watchOn = view?.phase === "open" || (rehearsing && remaining.key === "rehearsal");
  const shownLines = rehearsing ? rehLines : lines;

  let watchLabel = "left in the minute";
  if (!view) watchLabel = "reading";
  else if (rehearsing) watchLabel = "house minute";
  else if (liveReveal && view.phase === "open") watchLabel = "next minute";
  else if (view?.phase === "reveal") watchLabel = "cards turning over";
  else if (view?.phase === "locked") watchLabel = "settling";

  const others = yourSeat ? [0, 1, 2].filter((i) => i !== yourSeat.index) : [];
  const roomName = view?.name ?? "";

  // The card in your hand: pressed while it flies, then marked until the minute turns.
  let chosen: { card: CardName; target: number | null; note: string } | null = null;
  if (flying) chosen = { ...flying, note: "sending..." };
  else if (!revealing && sentNow) chosen = { card: sentNow.card, target: sentNow.target, note: sentNow.r === "sealed" ? "face down" : "shown" };

  // The settled hand the dock talks about: the one on the stage, else the newest.
  const lastHand = shownHand ?? view?.recent[0] ?? null;
  const lastTx = lastHand?.tx ? client.txUrl(lastHand.tx) : null;

  const known = (address: string | null): { owner: string | null; claimed: boolean } => {
    if (!address) return { owner: null, claimed: false };
    return owners.current.get(address) ?? { owner: address, claimed: false };
  };
  const stakeSeats: StakeSeat[] = shownHand
    ? shownHand.seats.map((s, i) => ({ index: i, name: s.name, kind: s.kind, address: s.address, ...known(s.address), you: !!session && s.address === session }))
    : (view?.seats.map((s) => ({ index: s.index, name: s.name, kind: s.kind, address: s.address, owner: s.owner ?? s.address, claimed: s.claimed, you: s.you })) ?? []);
  const identity = practice ? client.identity() : ui.identity;
  const stakes = view ? <Stakes client={client} identity={identity} seats={rehearsing ? [] : stakeSeats} collapsible={!wide} /> : null;

  let modeLine: React.ReactNode;
  if (!view) modeLine = "";
  else if (revealing?.replay) modeLine = `Replay: minute ${revealing.hand.minute}`;
  else if (liveReveal) modeLine = `Minute ${liveReveal.minute} result`;
  else if (practice) modeLine = PRACTICE_LINE;
  else if (rehearsing) modeLine = REHEARSAL_LINE;
  else modeLine = `Minute ${view.minute}`;

  const receiptUrl = receipt?.tx ? client.txUrl(receipt.tx) : null;
  const receiptOwner = receipt?.owner ? client.accountUrl(receipt.owner) : null;

  return (
    <main className="saloon">
      <div className="stage">
        {wide ? stakes : null}
        <div className="comic-wrap">
          <canvas ref={canvasRef} width={W} height={H} className="comic" role="img" aria-label={`The saloon table in ${roomName}`} />
          {/* Phones crop the comic's top: the plate and the house rule come back as paper strips. */}
          {plate ? (
            <span className="stage-plate" aria-hidden="true">
              {plate}
            </span>
          ) : null}
          <span className="stage-tag" aria-hidden="true">
            Talk is not the purse
          </span>
        </div>
      </div>
      <section ref={dockRef} className="dock saloon-dock" aria-label="Table">
        <div className="dock-head">
          <div className="dock-top">
            <div className={`watch${watchSecs > 0 && watchSecs <= 10 && !rehearsing && watchOn ? " urgent" : ""}`} aria-label="Watch">
              <b>{watchOn ? clock(watchSecs) : "--:--"}</b>
              <span>{watchLabel}</span>
            </div>
            <div className="room-name">
              <h1>{roomName}</h1>
              <span className="mode-line" data-testid="mode-line">
                {modeLine}
              </span>
              {view && !rehearsing ? (
                <span className="settle-line">
                  {revealing?.replay ? (
                    <button type="button" className="link-btn" onClick={backToLive}>
                      Back to live
                    </button>
                  ) : lastHand ? (
                    <>
                      {liveReveal ? "Settled." : `Minute ${lastHand.minute} settled.`}{" "}
                      {lastTx ? (
                        <a href={lastTx} target="_blank" rel="noreferrer">
                          tx -&gt;
                        </a>
                      ) : null}
                    </>
                  ) : null}
                </span>
              ) : null}
            </div>
            {view ? (
              <button type="button" className="btn sit-btn" disabled={seatBusy} aria-busy={seatBusy} onClick={() => void standOrSit()}>
                {seated || you?.queued ? "Stand up" : "Sit down"}
              </button>
            ) : null}
          </div>
          <div className="cards" role="group" aria-label="Your card">
            {CARDS.map((c, i) => {
              const why = reason(c);
              const isChosen = chosen?.card === c;
              const cls = `card card-${c}${picker && c === "iron" ? " open" : ""}${isChosen ? " chosen" : chosen ? " dimmed" : ""}`;
              const note = isChosen && chosen ? (c === "iron" && chosen.target !== null && view ? `at ${view.seats[chosen.target].name}, ${chosen.note}` : chosen.note) : null;
              return (
                <button
                  key={c}
                  type="button"
                  className={cls}
                  disabled={!!why}
                  title={why ?? `${CARD_NAME[c]} (key ${i + 1})`}
                  aria-label={`${CARD_NAME[c]}, key ${i + 1}${why ? `. ${why}` : ""}`}
                  onClick={() => choose(c)}
                >
                  <span className="key">{i + 1}</span>
                  <b>{CARD_NAME[c]}</b>
                  <small>{note ?? why ?? CARD_HINT[c]}</small>
                </button>
              );
            })}
            {picker && view ? (
              <div className="picker" role="group" aria-label="Iron at" onMouseLeave={() => setAim(null)}>
                <span>Iron at</span>
                {others.map((i) => (
                  <button
                    key={i}
                    type="button"
                    className="btn btn-rust"
                    onMouseEnter={() => setAim(i)}
                    onFocus={() => setAim(i)}
                    onBlur={() => setAim(null)}
                    onClick={() => void playCard("iron", i)}
                  >
                    {view.seats[i].name}
                  </button>
                ))}
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setPicker(false);
                    setAim(null);
                  }}
                >
                  Holster
                </button>
              </div>
            ) : null}
          </div>
        </div>
        <p className="narration" aria-live="polite" data-testid="narration" title={view && shownLines.length ? shownLines.join(" ") : undefined}>
          {!view ? (
            <span>{READING_LINE}</span>
          ) : shownLines.length ? (
            <>
              <b className="narr-main">{shownLines[0]}</b>
              {shownLines.length > 1 ? <span className="narr-extra"> {shownLines.slice(1).join(" ")}</span> : null}
            </>
          ) : (
            <span>{rehearsing ? "The house deals a minute to itself." : "The first minute has not settled yet."}</span>
          )}
        </p>
        <p className="your-status" data-testid="your-status">
          {outcome ?? status}
        </p>
        {receipt ? (
          <div className="receipt" role="status" data-testid="receipt">
            <b>
              +{xlm(receipt.paid)} -&gt; {receipt.name}
              {receipt.owner ? (
                <>
                  {" ("}
                  {receiptOwner ? (
                    <a href={receiptOwner} target="_blank" rel="noreferrer" title={receipt.owner}>
                      {short(receipt.owner)}
                    </a>
                  ) : (
                    <span title={receipt.owner}>{short(receipt.owner)}</span>
                  )}
                  {")"}
                </>
              ) : null}
            </b>
            {receiptUrl ? (
              <a href={receiptUrl} target="_blank" rel="noreferrer">
                tx -&gt;
              </a>
            ) : (
              <span className="dim">{practice ? "practice payout" : "paid by the purse"}</span>
            )}
            <button type="button" className="x" aria-label="Dismiss the receipt" onClick={() => setReceipt(null)}>
              x
            </button>
          </div>
        ) : null}
        {!wide ? stakes : null}
        <div className="roster-box">
          {view && view.queue.length ? (
            <p className="next-up" data-testid="next-up">
              Next: {view.queue.map((q) => (q.you ? `${q.name} (you)` : q.name)).join(", ")}
            </p>
          ) : null}
          <ul className="roster" aria-label="Roster">
            {shownHand
              ? shownHand.seats.map((s, i) => {
                  const me = !!session && s.address === session;
                  const k = known(s.address);
                  return (
                    <li key={i} className={me ? "you" : ""}>
                      <RosterParts
                        parts={[
                          <b key="n">{s.name}</b>,
                          <span key="k" className="tag">{kindLabel(s.kind)}</span>,
                          <span key="c">{seatCard(shownHand, i)}</span>,
                          <span key="f">{handFate(shownHand, i)}</span>,
                          me ? <span key="y" className="tag tag-rust">you</span> : null,
                          s.kind !== "house" && !k.claimed ? <span key="u" className="dim" title={UNPAID_TIP}>unpaid</span> : null,
                        ]}
                      />
                    </li>
                  );
                })
              : view?.seats.map((s) => (
                  <li key={s.index} className={s.you ? "you" : ""}>
                    <RosterParts
                      parts={[
                        <b key="n">{s.name}</b>,
                        <span key="k" className="tag">{kindLabel(s.kind)}</span>,
                        <span key="b">{s.bullet > 0 ? "1 bullet" : "belt empty"}</span>,
                        <span key="s">{rehearsing ? "rehearsing" : s.you && sentNow && s.state === "waiting" ? (sentNow.r === "sealed" ? "face down" : "shown") : seatState(s, view.phase)}</span>,
                        s.you ? <span key="y" className="tag tag-rust">you</span> : null,
                        s.kind !== "house" && !s.claimed ? <span key="u" className="dim" title={UNPAID_TIP}>unpaid</span> : null,
                      ]}
                    />
                  </li>
                ))}
          </ul>
        </div>
        {view && view.recent.length ? (
          <details className="recent">
            <summary>Recent hands</summary>
            <ol>
              {view.recent.map((h) => {
                const url = h.tx ? client.txUrl(h.tx) : null;
                return (
                  <li key={h.hand}>
                    <span>
                      Minute {h.minute}: {h.seats.map((_, i) => `${h.seats[i].name} ${seatCard(h, i)}`).join(", ")}. {h.lines[0]}
                    </span>{" "}
                    <button type="button" className="link-btn" disabled={replaying === h.hand} onClick={() => startReveal(h, true)}>
                      Replay
                    </button>
                    {url ? (
                      <a href={url} target="_blank" rel="noreferrer">
                        tx
                      </a>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          </details>
        ) : null}
        <div className="dock-foot">
          <Links client={client} />
          <SoundToggle />
        </div>
      </section>
    </main>
  );
}

/** Roster fields with real separators, so the text reads well when the line wraps and in textContent. */
function RosterParts({ parts }: { parts: Array<React.JSX.Element | null> }): React.JSX.Element {
  const shown = parts.filter((p): p is React.JSX.Element => p !== null);
  return (
    <>
      {shown.map((p, i) => (
        <Fragment key={i}>
          {i > 0 ? <span className="sep"> · </span> : null}
          {p}
        </Fragment>
      ))}
    </>
  );
}

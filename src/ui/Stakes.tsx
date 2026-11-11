// What a chair plays for: the purse, your payout, and the money of everyone at the table.
// Every read is cached for 20 s per client and never blocks the comic.

import { useEffect, useState, useSyncExternalStore } from "react";
import type { GameClient, Identity, PurseView, SeatKind, StatsView } from "../shared/game-client";
import { useUi } from "./ctx";
import { kindLabel, short, xlm } from "./format";

const TTL_MS = 20_000;
const RETRY_MS = 5_000;

interface Entry {
  at: number;
  v: unknown;
}

const caches = new WeakMap<GameClient, Map<string, Entry>>();
const listeners = new Set<() => void>();
let version = 0;

function bump(): void {
  version++;
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

function mapFor(client: GameClient): Map<string, Entry> {
  let m = caches.get(client);
  if (!m) {
    m = new Map();
    caches.set(client, m);
  }
  return m;
}

/** Cached read: returns the last value (or undefined) at once and refreshes it in the background when stale. */
function cached<T>(client: GameClient, key: string, fn: () => Promise<T>): T | undefined {
  const m = mapFor(client);
  const e = m.get(key);
  const now = Date.now();
  if (e && now - e.at < TTL_MS) return e.v as T | undefined;
  const entry: Entry = { at: now, v: e?.v };
  m.set(key, entry);
  fn().then(
    (v) => {
      entry.v = v;
      bump();
    },
    () => {
      entry.at = now - TTL_MS + RETRY_MS; // try again in a few seconds
    },
  );
  return entry.v as T | undefined;
}

/** Marks every cached read stale (a hand settled: wins and balances moved). */
export function invalidateStakes(client: GameClient): void {
  const m = caches.get(client);
  if (!m) return;
  for (const e of m.values()) e.at = 0;
  bump();
}

function useReads(): void {
  useSyncExternalStore(subscribe, () => version);
  // Re-render now and then so stale entries refresh without a new room view.
  const [, setTick] = useState(0);
  useEffect(() => {
    const h = setInterval(() => setTick((t) => t + 1), RETRY_MS);
    return () => clearInterval(h);
  }, []);
}

export interface StakeSeat {
  index: number;
  name: string;
  kind: SeatKind;
  address: string | null;
  owner: string | null;
  claimed: boolean;
  you: boolean;
}

function Addr({ client, address }: { client: GameClient; address: string }): React.JSX.Element {
  const url = client.accountUrl(address);
  return url ? (
    <a href={url} target="_blank" rel="noreferrer" title={address}>
      {short(address)}
    </a>
  ) : (
    <span title={address}>{short(address)}</span>
  );
}

function wins(n: number): string {
  return n === 1 ? "1 win" : `${n} wins`;
}

function amount(s: string | null | undefined): string {
  return s === undefined ? "..." : xlm(s);
}

export function payLabel(purse: PurseView | undefined): string {
  return purse ? xlm(purse.pay) : "1 XLM";
}

export function Stakes({
  client,
  identity,
  seats,
  collapsible,
}: {
  client: GameClient;
  identity: Identity | null;
  seats: StakeSeat[];
  collapsible: boolean;
}): React.JSX.Element {
  const ui = useUi();
  useReads();
  const [open, setOpen] = useState(false);
  const practice = client.mode === "practice";
  const purse = cached(client, "purse", () => client.purse());
  const pay = payLabel(purse);
  const left = purse ? Math.max(0, purse.hourBudget - purse.hourPaid) : null;
  const owner = identity?.owner ?? null;
  const linked = !!identity?.claimed;
  const mine = owner ? cached<StatsView>(client, `stats|${owner}`, () => client.stats(owner)) : undefined;
  const wallet = owner && linked ? cached<string | null>(client, `bal|${owner}`, () => client.balance(owner)) : undefined;
  const session = identity?.session ?? null;
  const fees = session ? cached<string | null>(client, `bal|${session}`, () => client.balance(session)) : undefined;
  const players = seats.filter((s) => s.kind !== "house");

  const summary = (
    <>
      <b>Purse: {pay} to the last one standing.</b>{" "}
      <span>{linked ? `You: +${pay} if you win.` : identity ? "You: guests are not paid." : "Entry: free."}</span>
    </>
  );

  const body = (
    <div className="stakes-body">
      <section aria-label="The purse">
        <h2>The purse</h2>
        <p className="stakes-big">{pay} to the last one standing</p>
        <p>
          Treasury {purse ? xlm(purse.balance) : "..."}
          {practice ? " (practice)" : ""}
        </p>
        <p>{left === null ? "..." : `${left} of ${purse?.hourBudget ?? 0} paid wins left this hour`}</p>
        <p className="stakes-fine">Paid only to a sole survivor in a linked chair. If anybody runs, nobody is paid that minute.</p>
      </section>
      <section aria-label="You">
        <h2>You</h2>
        <p>Entry: free. You only pay tiny network fees from your session key.</p>
        {!identity ? (
          <p className="stakes-win">Sit down to play. Link a wallet to be paid.</p>
        ) : linked ? (
          <p className="stakes-win">
            If you win this minute: <b>+{pay}</b> to your {practice ? "practice " : ""}wallet <Addr client={client} address={identity.owner} />
          </p>
        ) : (
          <div className="stakes-win">
            <p>Guests are not paid. Link a wallet to collect.</p>
            <button type="button" className="btn btn-rust stakes-link" onClick={() => ui.link(client)}>
              Link a wallet
            </button>
          </div>
        )}
        {identity ? (
          <div className="stakes-row stakes-mine">
            <span>{mine ? wins(mine.wins) : "... wins"}</span>
            <span>{mine ? `${xlm(mine.earned)} earned` : "..."}</span>
            {linked ? <span>wallet {amount(wallet)}</span> : null}
            <span title="Your session key pays the network fees">fees key {amount(fees)}</span>
          </div>
        ) : null}
      </section>
      <section aria-label="At the table">
        <h2>At the table</h2>
        <ul className="stakes-seats">
          {seats.map((s) => (
            <SeatMoney key={s.index} client={client} seat={s} />
          ))}
        </ul>
        {players.length === 0 ? <p className="stakes-fine">Only the house sits. Take a chair.</p> : null}
      </section>
    </div>
  );

  if (!collapsible) {
    return (
      <aside className="stakes stakes-side paper-page" aria-label="Stakes">
        {body}
      </aside>
    );
  }
  return (
    <section className={`stakes stakes-strip${open ? " open" : ""}`} aria-label="Stakes">
      <button type="button" className="stakes-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="stakes-sum">{summary}</span>
        <span className="stakes-more" aria-hidden="true">
          {open ? "less" : "more"}
        </span>
      </button>
      {open ? body : null}
    </section>
  );
}

function SeatMoney({ client, seat }: { client: GameClient; seat: StakeSeat }): React.JSX.Element {
  const owner = seat.kind === "house" ? null : (seat.owner ?? seat.address);
  const stats = owner ? cached<StatsView>(client, `stats|${owner}`, () => client.stats(owner)) : undefined;
  const bal = owner ? cached<string | null>(client, `bal|${owner}`, () => client.balance(owner)) : undefined;
  if (seat.kind === "house" || !owner) {
    return (
      <li>
        <b>{seat.name}</b> <span className="dim">House. Plays for the house.</span>
      </li>
    );
  }
  return (
    <li className={seat.you ? "you" : ""}>
      <div>
        <b>{seat.name}</b> <span className="tag">{kindLabel(seat.kind)}</span>{" "}
        {seat.claimed ? (
          <span className="tag tag-felt">linked</span>
        ) : (
          <span className="tag tag-dash" title="The purse does not pay this chair">
            unpaid
          </span>
        )}
        {seat.you ? <span className="tag tag-rust">you</span> : null}
      </div>
      <div className="stakes-row">
        <span>{stats ? wins(stats.wins) : "... wins"}</span>
        <span>{stats ? `${xlm(stats.earned)} earned` : "..."}</span>
        <span>
          {seat.claimed ? "wallet" : "key"} <Addr client={client} address={owner} /> {bal === undefined ? "..." : bal === null ? "n/a" : xlm(bal)}
        </span>
      </div>
    </li>
  );
}

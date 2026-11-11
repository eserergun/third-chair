// Settlement hashes for recent hands (HandView.tx) from the contract's `settled` events.
// Every client fills them, not only the one that sent the settling resolve.
import { rpc, scValToNative, xdr } from "@stellar/stellar-sdk";
import type { Rpc } from "./tx";

/** How far back the first scan may go, in ledgers (about 14 hours at 5 s). */
export const SETTLED_WINDOW = 10_000;
/** At most one getEvents scan per room in this window, once every missing hand had its quick scans. */
export const SETTLED_REFRESH_MS = 15_000;
/** A missing hand gets this many scans, FRESH_RETRY_MS apart, before the slow window applies. */
export const FRESH_TRIES = 6;
export const FRESH_RETRY_MS = 2_500;
const PAGE = 200;
const MAX_PAGES = 10;
/** Seconds per ledger used to estimate where the oldest recent hand sits (low = safe). */
const LEDGER_SECS = 5;
const MARGIN_LEDGERS = 60;

export function settledFilter(contractId: string, room: number): rpc.Api.EventFilter {
  return {
    type: "contract",
    contractIds: [contractId],
    topics: [[xdr.ScVal.scvSymbol("settled").toXdr("base64"), xdr.ScVal.scvU32(room).toXdr("base64")]],
  };
}

/** hand (decimal string) -> settlement tx hash. Events that do not decode are skipped. */
export function parseSettled(events: rpc.Api.EventResponse[]): Array<{ hand: string; tx: string }> {
  const out: Array<{ hand: string; tx: string }> = [];
  for (const ev of events) {
    try {
      const v = scValToNative(ev.value) as { hand?: bigint | number | string } | null;
      if (v && v.hand !== undefined && ev.txHash) out.push({ hand: BigInt(v.hand).toString(), tx: ev.txHash });
    } catch {
      /* not ours */
    }
  }
  return out;
}

/** First ledger to scan: covers the oldest recent hand, inside the window and the RPC retention. */
export function startLedgerFor(latest: number, nowSecs: number, oldestAt: number | null, oldestKnown = 0): number {
  let start = latest - SETTLED_WINDOW;
  if (oldestAt !== null && oldestAt > 0 && nowSecs > 0) {
    const back = Math.ceil(Math.max(0, nowSecs - oldestAt) / LEDGER_SECS) + MARGIN_LEDGERS;
    start = Math.max(start, latest - back);
  }
  return Math.max(start, oldestKnown, 1);
}

interface RoomScan {
  at: number;
  cursor?: string;
  running?: Promise<void>;
}

export interface SettledIndexOptions {
  nowMs?: () => number;
}

export class SettledIndex {
  private scans = new Map<number, RoomScan>();
  /** hand -> scans that looked for it and did not find it. */
  private tries = new Map<string, number>();
  private oldestKnown = 0;

  constructor(
    private readonly rpcClient: Rpc,
    private readonly contractId: string,
    readonly txByHand: Map<string, string>,
    private readonly opts: SettledIndexOptions = {},
  ) {}

  private nowMs(): number {
    return this.opts.nowMs ? this.opts.nowMs() : Date.now();
  }

  /**
   * Starts a background scan when a recent hand has no hash. A hand that no scan looked for yet
   * scans at once, so a new receipt gets its tx link in seconds. The RPC can index events a
   * little late, so a missing hand gets FRESH_TRIES quick scans; after that, one scan per
   * SETTLED_REFRESH_MS. Never throws, never blocks the caller.
   */
  maybeRefresh(room: number, hands: Array<{ hand: string; at: number }>, latest: number, nowSecs: number): Promise<void> | null {
    if (!this.rpcClient.getEvents || latest <= 0) return null;
    const missing = hands.filter((h) => !this.txByHand.has(h.hand));
    if (!missing.length) return null;
    const scan = this.scans.get(room) ?? { at: 0 };
    this.scans.set(room, scan);
    if (scan.running) return null;
    const least = Math.min(...missing.map((h) => this.tries.get(h.hand) ?? 0));
    const wait = least === 0 ? 0 : least < FRESH_TRIES ? FRESH_RETRY_MS : SETTLED_REFRESH_MS;
    if (this.nowMs() - scan.at < wait) return null;
    scan.at = this.nowMs();
    for (const h of missing) this.tries.set(h.hand, (this.tries.get(h.hand) ?? 0) + 1);
    const oldestAt = Math.min(...missing.map((h) => h.at));
    scan.running = this.scan(room, scan, latest, nowSecs, oldestAt)
      .catch(() => undefined)
      .finally(() => {
        scan.running = undefined;
      });
    return scan.running;
  }

  private async scan(room: number, scan: RoomScan, latest: number, nowSecs: number, oldestAt: number): Promise<void> {
    const getEvents = this.rpcClient.getEvents!.bind(this.rpcClient);
    const filters = [settledFilter(this.contractId, room)];
    let req: rpc.Api.GetEventsRequest = scan.cursor
      ? { filters, cursor: scan.cursor, limit: PAGE }
      : { filters, startLedger: startLedgerFor(latest, nowSecs, oldestAt, this.oldestKnown), limit: PAGE };
    let retried = false;
    for (let page = 0; page < MAX_PAGES; page++) {
      let res: rpc.Api.GetEventsResponse;
      try {
        res = await getEvents(req);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const m = /oldest ledger[^\d]*(\d+)/i.exec(msg);
        if (retried) throw e;
        retried = true;
        // Out of the retention window (or a stale cursor): restart from what the RPC still has.
        if (m) this.oldestKnown = Number(m[1]);
        scan.cursor = undefined;
        req = { filters, startLedger: startLedgerFor(latest, nowSecs, oldestAt, this.oldestKnown), limit: PAGE };
        page--;
        continue;
      }
      if (res.oldestLedger) this.oldestKnown = Math.max(this.oldestKnown, res.oldestLedger);
      for (const { hand, tx } of parseSettled(res.events ?? [])) {
        this.txByHand.set(hand, tx);
        this.tries.delete(hand);
      }
      if (res.cursor) scan.cursor = res.cursor;
      if ((res.events ?? []).length < PAGE || !res.cursor) return;
      req = { filters, cursor: res.cursor, limit: PAGE };
    }
  }
}

// Ledger clock (SPEC 6.3): offset = max(latestLedgerCloseTime - localReceiveTime) over samples
// from the last 30 s. The shown time never steps back.

export interface HealthSource {
  getHealth(): Promise<{ latestLedger: number }>;
}

interface Sample {
  offset: number; // seconds
  at: number; // local ms
}

export class LedgerClock {
  private samples: Sample[] = [];
  private offset = 0;
  private shown = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private users = 0;
  latestLedger = 0;
  synced = false;

  constructor(
    private readonly source: HealthSource | null,
    private readonly nowMs: () => number = () => Date.now(),
    readonly windowMs = 30_000,
  ) {}

  /** Feed one sample (close time in unix seconds, received at local ms). */
  ingest(closeTime: number | undefined, ledger: number | undefined, receivedMs = this.nowMs()): void {
    if (ledger && ledger > this.latestLedger) this.latestLedger = ledger;
    if (!closeTime || !Number.isFinite(closeTime)) return;
    this.samples.push({ offset: closeTime - receivedMs / 1000, at: receivedMs });
    const cutoff = receivedMs - this.windowMs;
    this.samples = this.samples.filter((s) => s.at >= cutoff);
    this.offset = Math.max(...this.samples.map((s) => s.offset));
    this.synced = true;
  }

  async sync(): Promise<void> {
    if (!this.source) return;
    const h = (await this.source.getHealth()) as { latestLedger: number; latestLedgerCloseTime?: number | string };
    this.ingest(h.latestLedgerCloseTime === undefined ? undefined : Number(h.latestLedgerCloseTime), h.latestLedger);
  }

  /** Estimated ledger time in unix seconds, monotonic. */
  now(): number {
    const t = Math.floor(this.nowMs() / 1000 + this.offset);
    if (t > this.shown) this.shown = t;
    return this.shown;
  }

  /** Starts polling getHealth every intervalMs; returns a stop function. Reference counted. */
  start(intervalMs = 5000, onError?: (e: unknown) => void): () => void {
    this.users++;
    if (!this.timer) {
      const tick = () => this.sync().catch((e) => onError?.(e));
      void tick();
      this.timer = setInterval(tick, intervalMs);
    }
    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      this.users--;
      if (this.users <= 0 && this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    };
  }
}

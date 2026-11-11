import { useCallback, useEffect, useRef, useState } from "react";
import type { GameClient, TxEvent } from "../shared/game-client";

export interface Toast {
  id: string;
  text: string;
  kind: "info" | "ok" | "error" | "tx";
  hash?: string;
}

const STAGE: Record<TxEvent["stage"], string> = {
  preparing: "preparing",
  signing: "signing",
  sending: "sending",
  confirming: "confirming",
  done: "on chain",
  failed: "failed",
};

/** Short past-tense lines for finished steps: "Settled." and a tx link beats a sentence. */
const DONE: Record<string, string> = {
  "Settle the minute": "Settled.",
  "Close the minute": "Minute closed.",
  "Lock the cards": "Cards locked.",
  "Turn the card over": "Card turned over.",
};

function doneText(label: string): string {
  if (DONE[label]) return DONE[label];
  if (/^Sit in /.test(label)) return "Seated.";
  if (/^(Air|Table|Iron)/.test(label)) return `${label}: sent.`;
  return `${label}: done.`;
}

export function useToasts(client: GameClient): { toasts: Toast[]; push: (t: Omit<Toast, "id">) => void; dismiss: (id: string) => void } {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    setToasts((ts) => ts.filter((t) => t.id !== id));
    const h = timers.current.get(id);
    if (h) clearTimeout(h);
    timers.current.delete(id);
  }, []);

  const upsert = useCallback(
    (t: Toast, ttl: number | null) => {
      setToasts((ts) => {
        const i = ts.findIndex((x) => x.id === t.id);
        const next = i >= 0 ? ts.map((x, k) => (k === i ? t : x)) : [...ts, t].slice(-4);
        return next;
      });
      const old = timers.current.get(t.id);
      if (old) clearTimeout(old);
      if (ttl !== null) timers.current.set(t.id, setTimeout(() => dismiss(t.id), ttl));
    },
    [dismiss],
  );

  const push = useCallback((t: Omit<Toast, "id">) => upsert({ ...t, id: `n${Math.random().toString(36).slice(2)}` }, t.kind === "error" ? 8000 : 5000), [upsert]);

  useEffect(
    () =>
      client.onTx((e) => {
        if (e.auto && e.stage !== "done") return; // croupier steps: only the result, never an error
        const failed = e.stage === "failed";
        const text = failed ? `${e.label}: ${e.error ?? "failed"}` : e.stage === "done" ? doneText(e.label) : `${e.label}: ${STAGE[e.stage]}...`;
        upsert({ id: e.id, text, kind: failed ? "error" : e.stage === "done" ? "ok" : "tx", hash: e.hash }, e.stage === "done" ? 4500 : failed ? 8000 : 45000);
      }),
    [client, upsert],
  );

  return { toasts, push, dismiss };
}

export function Toasts({ toasts, client, onDismiss }: { toasts: Toast[]; client: GameClient; onDismiss: (id: string) => void }): React.JSX.Element {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => {
        const url = t.hash ? client.txUrl(t.hash) : null;
        return (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            <span>{t.text}</span>
            {url ? (
              <a href={url} target="_blank" rel="noreferrer">
                tx -&gt;
              </a>
            ) : null}
            <button type="button" className="x" aria-label="Dismiss" onClick={() => onDismiss(t.id)}>
              x
            </button>
          </div>
        );
      })}
    </div>
  );
}

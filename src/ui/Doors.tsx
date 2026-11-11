// SPEC 6.1 doors: guest, wallet (two clicks), testnet secret. The guest door seats at once.
// The wallet and secret doors link first and sit after: a link takes up to a minute, and a
// chair taken before it would sleep through the minute. room === null: link only (claim, drawer).

import { useEffect, useRef, useState } from "react";
import type { GameClient, Identity, PendingLink } from "../shared/game-client";
import { objectErrorText } from "../chain/errors";
import { short } from "./format";

/** A readable line for any rejection: wallets often reject with a plain object, not an Error. */
function errText(e: unknown, fallback: string): string {
  if (e instanceof Error) return e.message || fallback;
  if (typeof e === "object" && e !== null) return objectErrorText(e);
  return typeof e === "string" && e ? e : fallback;
}

const SIGN_TIMEOUT_MS = 120_000;

type Step = "choose" | "wallet" | "secret";

export function Doors({ client, room, onClose, onLinked }: { client: GameClient; room: number | null; onClose: (seated: boolean) => void; onLinked: () => void }): React.JSX.Element {
  const [step, setStep] = useState<Step>("choose");
  const [progress, setProgress] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingLink | null>(null);
  const [signing, setSigning] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [secret, setSecret] = useState("");
  const [seated, setSeated] = useState(false);
  const [linked, setLinked] = useState(false);
  const [fundStart, setFundStart] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const seatedRef = useRef(false);
  const live = useRef(true);
  const dialog = useRef<HTMLDivElement>(null);

  // Friendbot can take a while: count the seconds so the wait reads as progress.
  useEffect(() => {
    if (fundStart === null) return;
    setElapsed(0);
    const h = setInterval(() => setElapsed(Math.floor((Date.now() - fundStart) / 1000)), 1000);
    return () => clearInterval(h);
  }, [fundStart]);

  useEffect(() => {
    live.current = true;
    dialog.current?.querySelector<HTMLElement>("button")?.focus();
    // The doors are the intent to play: make and fund the session key now (SPEC 6.1).
    prepare().catch(() => undefined);
    const k = (e: KeyboardEvent): void => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", k);
    return () => {
      live.current = false;
      window.removeEventListener("keydown", k);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const log = (s: string): void => {
    if (live.current) setProgress((p) => (p.includes(s) ? p : [...p, s].slice(-6)));
  };

  function prepare(): Promise<Identity> {
    if (!client.identity()?.funded) setFundStart((t) => t ?? Date.now());
    return client.prepareSession(log).finally(() => {
      if (live.current) setFundStart(null);
    });
  }

  function close(): void {
    pending?.cancel();
    onClose(seatedRef.current);
  }

  async function sitNow(): Promise<boolean> {
    if (room === null) return true;
    try {
      await prepare();
      const r = await client.sit(room);
      seatedRef.current = true;
      if (live.current) setSeated(true);
      log(r.queued ? "You wait in the queue. You sit when this minute closes." : "You have a chair.");
      return true;
    } catch (e) {
      if (live.current) setError(errText(e, "The chair could not sit."));
      return false;
    }
  }

  async function guest(): Promise<void> {
    setError(null);
    if (await sitNow()) onClose(true);
  }

  /** After a link: sit (if a room asked for it) and close. A failed sit keeps the doors open. */
  async function sitAfterLink(): Promise<void> {
    if (!live.current) return;
    setLinked(true);
    if (await sitNow()) onClose(true);
  }

  function wallet(): void {
    setError(null);
    setStep("wallet");
    // Click 1: connectWallet opens the picker inside this gesture. The chair waits for the link.
    client.connectWallet(log).then(
      (p) => {
        if (live.current) {
          setPending(p);
          log(`${p.walletName} is ready: ${short(p.owner)}.`);
        } else p.cancel();
      },
      (e: unknown) => live.current && setError(errText(e, "The wallet did not connect.")),
    );
  }

  function signLink(): void {
    if (!pending) return;
    setError(null);
    setTimedOut(false);
    setSigning(true);
    // Click 2: sign() is the first call in this handler, so the wallet sees the gesture.
    const signed = pending.sign();
    let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      timer = null;
      if (live.current) {
        setTimedOut(true);
        setSigning(false);
      }
    }, SIGN_TIMEOUT_MS);
    signed.then(
      () => {
        if (timer) clearTimeout(timer);
        onLinked();
        if (live.current) {
          setSigning(false);
          log("Linked. Your next win pays.");
          void sitAfterLink();
        }
      },
      (e: unknown) => {
        if (timer) clearTimeout(timer);
        if (live.current) {
          setSigning(false);
          setError(errText(e, "The wallet did not sign."));
        }
      },
    );
  }

  async function useSecret(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    const s = secret.trim();
    setSecret("");
    try {
      await client.linkSecret(s, log);
    } catch (err) {
      if (live.current) setError(errText(err, "The key did not link."));
      return;
    }
    onLinked();
    await sitAfterLink();
  }

  return (
    <div className="modal-back" onClick={(e) => e.target === e.currentTarget && close()}>
      <div className="modal paper-page doors" role="dialog" aria-modal="true" aria-labelledby="doors-title" ref={dialog}>
        <button type="button" className="x modal-x" aria-label="Close" onClick={close}>
          x
        </button>
        <h2 id="doors-title">{room === null ? "Link a wallet" : "Three doors into the saloon"}</h2>
        {step === "choose" ? (
          <div className="door-list">
            {room !== null ? (
              <button type="button" className="door" onClick={() => void guest()}>
                <b>Walk in as a guest</b>
                <span>A browser key sits for you. You play at once. The purse does not pay guests.</span>
              </button>
            ) : null}
            <button type="button" className="door" onClick={wallet}>
              <b>Connect a Stellar wallet</b>
              <span>Varial (Freighter), xBull, Albedo, Lobstr, Hana, Rabet, and more. Keep the wallet on Testnet. One signature links your chair. Your wins pay this wallet.</span>
            </button>
            <button type="button" className="door" onClick={() => setStep("secret")}>
              <b>Use a testnet secret key</b>
              <span>Paste an S... key. It signs the link here and is never stored.</span>
            </button>
          </div>
        ) : null}
        {step === "wallet" ? (
          <div className="door-step">
            <p>Your wallet asks for one signature. Stay on Testnet. After that, no card opens a wallet.</p>
            <p className="dim">If your wallet warns that this site is malicious, it is set to Mainnet. Cancel, switch it to Testnet, and connect again.</p>
            {timedOut ? <p className="warn">The wallet did not answer in two minutes. Open it and try again.</p> : null}
            {linked ? null : error && !pending && !signing ? (
              // The wallet did not connect: a new click opens the picker again (a fresh gesture).
              <button type="button" className="btn btn-rust" onClick={wallet}>
                Connect again
              </button>
            ) : (
              <button type="button" className="btn btn-rust" disabled={!pending || signing} onClick={signLink}>
                {timedOut ? "Open the wallet again" : signing ? "Waiting for the wallet" : pending ? "Sign the link (one signature)" : "Preparing the link"}
              </button>
            )}
          </div>
        ) : null}
        {step === "secret" ? (
          <form className="door-step" onSubmit={(e) => void useSecret(e)}>
            <p className="warn">Testnet only. Never paste a key that holds real money.</p>
            <label>
              Testnet secret key
              <input type="password" autoComplete="off" spellCheck={false} value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="S..." />
            </label>
            {linked ? null : (
              <button type="submit" className="btn btn-rust" disabled={!secret.trim()}>
                {room === null ? "Link" : "Link and sit"}
              </button>
            )}
          </form>
        ) : null}
        {progress.length && !error ? (
          <ul className="progress" aria-live="polite">
            {progress.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        ) : null}
        {linked && !seated && error && room !== null ? (
          <button type="button" className="btn btn-rust" onClick={() => { setError(null); void sitAfterLink(); }}>
            Sit down
          </button>
        ) : null}
        {fundStart !== null && !error ? (
          <p className="progress-line" data-testid="friendbot-wait">
            Friendbot is funding your key: {elapsed} s (usually 10 to 30 s).
          </p>
        ) : null}
        {error ? (
          <p className="warn" role="alert">
            {error}
          </p>
        ) : null}
        {step !== "choose" ? (
          <p className="door-foot">
            <button type="button" className="link-btn" onClick={() => setStep("choose")}>
              Back to the doors
            </button>
            {seated ? (
              <button type="button" className="link-btn" onClick={close}>
                Go to the table
              </button>
            ) : null}
          </p>
        ) : null}
      </div>
    </div>
  );
}

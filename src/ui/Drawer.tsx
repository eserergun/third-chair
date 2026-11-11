import { useEffect, useState } from "react";
import type { GameClient, StatsView } from "../shared/game-client";
import { useUi } from "./ctx";
import { clearDoorChosen, shownIdentity } from "./door";
import { short, xlm } from "./format";

export function Drawer({ client, onClose, onChange }: { client: GameClient; onClose: () => void; onChange: () => void }): React.JSX.Element {
  const ui = useUi();
  const me = shownIdentity(client);
  const [bal, setBal] = useState<{ session: string | null; owner: string | null } | "error" | null>(null);
  const [stats, setStats] = useState<StatsView | "error" | null>(null);
  const [name, setName] = useState(me?.name ?? "");
  const [secret, setSecret] = useState<string | null>(null);
  const [confirmExport, setConfirmExport] = useState(false);
  const [confirmForget, setConfirmForget] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [tries, setTries] = useState(0);

  useEffect(() => {
    if (!me) return;
    let live = true;
    setBal(null);
    setStats(null);
    void Promise.all([client.balance(me.session), me.owner !== me.session ? client.balance(me.owner) : Promise.resolve(null)]).then(
      ([s, o]) => live && setBal({ session: s, owner: o }),
      () => live && setBal("error"),
    );
    client.stats(me.owner).then(
      (s) => live && setStats(s),
      () => live && setStats("error"),
    );
    return () => {
      live = false;
    };
  }, [client, me?.session, me?.owner, tries]); // eslint-disable-line react-hooks/exhaustive-deps

  const retry = (
    <button type="button" className="link-btn" onClick={() => setTries((t) => t + 1)}>
      Try again
    </button>
  );
  const reading = (what: string): React.JSX.Element => (
    <span className="dim" role="status">
      Reading {what}...
    </span>
  );
  const failed = (what: string): React.JSX.Element => (
    <span className="warn" role="alert">
      The {what} did not answer. {retry}
    </span>
  );
  const balance = (v: string | null): string => (v === null ? "No account yet" : xlm(v));

  // Escape closes the drawer, also before the player has a chair.
  useEffect(() => {
    const k = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const copy = (s: string): void => {
    void navigator.clipboard?.writeText(s).then(() => setMsg("Copied."), () => setMsg("Copy failed."));
  };

  async function rename(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    try {
      await client.rename(name.trim());
      setMsg("Name saved.");
      onChange();
    } catch (err) {
      setMsg((err as Error).message);
    }
  }

  const acct = (a: string): React.JSX.Element => {
    const url = client.accountUrl(a);
    return url ? (
      <a href={url} target="_blank" rel="noreferrer">
        {short(a)}
      </a>
    ) : (
      <span>{short(a)}</span>
    );
  };

  return (
    <div className="modal-back drawer-back" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer paper-page" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
        <button type="button" className="x modal-x" aria-label="Close" onClick={onClose}>
          x
        </button>
        <h2 id="drawer-title">Your chair</h2>
        {!me ? (
          <>
            <p>No chair yet. Walk into a room to get one.</p>
            {client.mode === "chain" ? (
              <>
                <p>You can link a wallet now. Your wins pay it once you sit.</p>
                <button type="button" className="btn btn-rust" onClick={() => { onClose(); ui.link(client); }}>
                  Link a wallet
                </button>
              </>
            ) : null}
          </>
        ) : (
          <>
            <dl className="facts">
              <dt>Name</dt>
              <dd>
                {me.name}
                {me.agent ? " (agent)" : ""}
              </dd>
              <dt>Session key</dt>
              <dd>
                {acct(me.session)}{" "}
                <button type="button" className="link-btn" onClick={() => copy(me.session)}>
                  copy
                </button>
              </dd>
              <dt>Owner</dt>
              <dd>{me.owner === me.session ? "not linked" : acct(me.owner)}</dd>
              <dt>Status</dt>
              <dd>{client.mode === "practice" ? "Practice. Nothing here touches the chain." : me.claimed ? `Linked${me.walletName ? ` with ${me.walletName}` : ""}. Your wins pay.` : "Unclaimed. The purse does not pay."}</dd>
              <dt>Session balance</dt>
              <dd>
                {bal === null ? reading("balance") : bal === "error" ? failed("balance") : balance(bal.session)}
                <br />
                <small className="dim">Session key (pays fees only). The purse pays your wallet.</small>
              </dd>
              {me.owner !== me.session ? (
                <>
                  <dt>Wallet balance</dt>
                  <dd>{bal === null ? reading("balance") : bal === "error" ? failed("balance") : balance(bal.owner)}</dd>
                </>
              ) : null}
              <dt>Stats</dt>
              <dd>
                {stats === null
                  ? reading("stats")
                  : stats === "error"
                    ? failed("stats")
                    : `${stats.hands} hands, ${stats.wins} wins, ${stats.hits} hits, ${stats.falls} falls, ${stats.ran} ran, ${xlm(stats.earned)} earned`}
              </dd>
            </dl>
            {!me.claimed && client.mode === "chain" ? (
              <button type="button" className="btn btn-rust" onClick={() => { onClose(); ui.link(client); }}>
                Link a wallet
              </button>
            ) : null}
            <form className="rename" onSubmit={(e) => void rename(e)}>
              <label>
                Rename
                <input value={name} maxLength={12} onChange={(e) => setName(e.target.value)} />
              </label>
              <button type="submit" className="btn">
                Save
              </button>
            </form>
            <section className="drawer-sec" aria-labelledby="drawer-backup">
              <h3 id="drawer-backup">Back up the session key</h3>
              {secret ? (
                <>
                  <p className="cmd">{secret}</p>
                  <button type="button" className="link-btn" onClick={() => { setSecret(null); setConfirmExport(false); }}>
                    Hide the secret
                  </button>
                </>
              ) : confirmExport ? (
                <>
                  <p className="warn">Anyone with this key plays your chair. Show it only on a screen nobody else sees.</p>
                  <p className="drawer-row">
                    <button type="button" className="btn" onClick={() => setSecret(client.exportSecret())}>
                      Show the session secret
                    </button>
                    <button type="button" className="link-btn" onClick={() => setConfirmExport(false)}>
                      Cancel
                    </button>
                  </p>
                </>
              ) : (
                <button type="button" className="btn" onClick={() => setConfirmExport(true)}>
                  Export session secret
                </button>
              )}
            </section>
            <section className="danger drawer-danger" aria-labelledby="drawer-forget">
              <h3 id="drawer-forget">Leave this browser</h3>
              {confirmForget ? (
                <>
                  <p>This drops the session key from this browser. Export it first if you want to keep the chair.</p>
                  <p className="drawer-row">
                    <button
                      type="button"
                      className="btn btn-rust"
                      onClick={() => {
                        client.forget();
                        clearDoorChosen();
                        onChange();
                        onClose();
                      }}
                    >
                      Forget it
                    </button>
                    <button type="button" className="link-btn" onClick={() => setConfirmForget(false)}>
                      Cancel
                    </button>
                  </p>
                </>
              ) : (
                <button type="button" className="link-btn" onClick={() => setConfirmForget(true)}>
                  Forget this browser
                </button>
              )}
            </section>
          </>
        )}
        {msg ? <p className="progress-line">{msg}</p> : null}
      </aside>
    </div>
  );
}

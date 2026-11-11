import { useEffect, useState } from "react";
import type { BoardRow, GameClient, HandView, PurseView } from "../shared/game-client";
import { ROOM_NAMES } from "../shared/game-client";
import { actionLine, seatCard, xlm } from "./format";
import { SLUGS, go, intent, nav } from "./router";

const NEWS: Array<[string, string]> = [
  ["Blend vault", "The purse may earn its keep in a Blend vault. Later."],
  ["The shop", "A horse, a vest, a second bullet. Not for sale."],
  ["The horse", "A second room to ride to. Later."],
  ["The depot", "Freight across chains through LayerZero. Later."],
  ["The nail", "The rules hash, nailed to the door. Later."],
  ["The agents", "Agents play from skill.md. Bring your own clock."],
];

export function Gazette({ client }: { client: GameClient }): React.JSX.Element {
  const [hands, setHands] = useState<HandView[] | null>(null);
  const [roomsRead, setRoomsRead] = useState(0);
  const [board, setBoard] = useState<BoardRow[] | null>(null);
  const [boardErr, setBoardErr] = useState(false);
  const [purse, setPurse] = useState<PurseView | null>(null);
  const [purseErr, setPurseErr] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const close = (): void => go(nav.back);

  useEffect(() => {
    let live = true;
    // Purse, board, and the nine rooms load in parallel; each section fills in as its read lands.
    client.purse().then((p) => live && setPurse(p), () => live && setPurseErr(true));
    client.board().then((b) => live && setBoard(b), () => live && setBoardErr(true));
    const all: HandView[] = [];
    let failed = 0;
    let read = 0;
    ROOM_NAMES.forEach((_, i) => {
      client.room(i).then(
        (r) => {
          if (!live) return;
          all.push(...r.recent);
          all.sort((a, b) => b.at - a.at);
          setHands(all.slice(0, 20));
        },
        () => {
          failed += 1;
        },
      ).finally(() => {
        if (!live) return;
        read += 1;
        setRoomsRead(read);
        if (read === ROOM_NAMES.length) {
          setHands(all.slice(0, 20));
          if (failed === ROOM_NAMES.length) setErr("The rooms did not answer. Try again in a minute.");
        }
      });
    });
    const k = (e: KeyboardEvent): void => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", k);
    return () => {
      live = false;
      window.removeEventListener("keydown", k);
    };
  }, [client]); // eslint-disable-line react-hooks/exhaustive-deps

  const contract = client.contractUrl();

  return (
    <div className="modal-back" onClick={(e) => e.target === e.currentTarget && close()}>
      <article className="modal paper-page gazette" role="dialog" aria-modal="true" aria-labelledby="gz-title">
        <button type="button" className="x modal-x" aria-label="Close the gazette" onClick={close}>
          x
        </button>
        <header className="gz-mast">
          <h1 id="gz-title">The Dust Gazette</h1>
          <p className="gz-lead">Testnet edition. Nine rooms are open. Walk into any one. The shop, the horse, and the depot are still news.</p>
        </header>
        <div className="gz-cols">
          <section>
            <h2>The rules</h2>
            <ul className="gz-rules">
              <li><b>Air.</b> In the open. Takes the purse only as the sole chair standing and unhit.</li>
              <li><b>Iron.</b> One bullet at one other chair. Takes the purse only if that chair played Air and nobody else stands.</li>
              <li><b>Table.</b> Cannot be hit. Cannot take the purse.</li>
              <li>One bullet per sitting. Missing the minute is Air. Three quiet minutes scatter the table.</li>
              <li>A sealed card never shown ran. If anyone ran, the purse does not move.</li>
              <li>Talk is not the purse. There is no entry fee. The purse pays 1 testnet XLM to a claimed winner.</li>
            </ul>
          </section>
          <section>
            <h2>The purse</h2>
            {purse ? (
              <p>
                Balance {xlm(purse.balance)}. Pay per win {xlm(purse.pay)}. This hour {purse.hourPaid} of {purse.hourBudget} paid wins.{" "}
                {contract ? (
                  <a href={contract} target="_blank" rel="noreferrer">
                    The contract on stellar.expert
                  </a>
                ) : (
                  "Practice purse. Nothing here touches the chain."
                )}
              </p>
            ) : purseErr ? (
              <p className="dim">The purse did not answer. Try again in a minute.</p>
            ) : (
              <p className="dim">Counting the purse...</p>
            )}
            <h2>The board</h2>
            <p className="gz-note">Wins count sole survivors. Earned counts testnet XLM paid.</p>
            {board === null ? (
              boardErr ? <p className="dim">The board did not answer. Try again in a minute.</p> : <p className="dim">Reading the board...</p>
            ) : board.length === 0 ? (
              <p>No paid winners yet.</p>
            ) : (
              <table className="gz-board">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Wins</th>
                    <th>Hits</th>
                    <th>Hands</th>
                    <th>Earned</th>
                  </tr>
                </thead>
                <tbody>
                  {board.map((r) => (
                    <tr key={r.owner}>
                      <td>{r.name || r.owner.slice(0, 6)}</td>
                      <td>{r.wins}</td>
                      <td>{r.hits}</td>
                      <td>{r.hands}</td>
                      <td>{xlm(r.earned)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
        <section>
          <h2>Recent hands</h2>
          {err ? <p className="warn">{err}</p> : null}
          {hands === null || (hands.length === 0 && roomsRead < ROOM_NAMES.length) ? (
            <p className="dim">Reading the rooms... {roomsRead} of {ROOM_NAMES.length}.</p>
          ) : hands.length === 0 ? (
            <p>No hands yet. Walk in and deal the first one.</p>
          ) : (
            <ol className="gz-hands">
              {hands.map((h) => {
                const url = h.tx ? client.txUrl(h.tx) : null;
                return (
                  <li key={`${h.room}-${h.hand}`}>
                    <b>
                      {ROOM_NAMES[h.room]}, minute {h.minute}.
                    </b>{" "}
                    {h.seats.map((_, i) => `${h.seats[i].name} ${seatCard(h, i)}`).join(", ")}. {h.lines[0]} {actionLine(h)}{" "}
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => {
                        intent.replay = { room: h.room, hand: h.hand };
                        go(`#/room/${SLUGS[h.room]}`);
                      }}
                    >
                      Replay
                    </button>{" "}
                    {url && h.tx ? (
                      <a className="gz-tx" href={url} target="_blank" rel="noreferrer" aria-label={`Settlement transaction ${h.tx}`}>
                        Settlement tx {h.tx.slice(0, 6)}...{h.tx.slice(-4)}
                      </a>
                    ) : h.tx ? (
                      <span className="gz-tx dim">Settlement tx {h.tx.slice(0, 6)}...{h.tx.slice(-4)}</span>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          )}
        </section>
        <section>
          <h2>News</h2>
          <dl className="gz-news">
            {NEWS.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      </article>
    </div>
  );
}

// "How it works": a paper broadsheet laid out from how-content.ts.

import type { GameClient } from "../shared/game-client";
import { HOW_LEAD, HOW_SECTIONS, HOW_TITLE, type HowExample, type HowSection } from "./how-content";

type Kind = "air" | "iron" | "table";

function kindOf(label: string): Kind | null {
  const w = label.trim().split(/[\s:]/)[0].toLowerCase();
  return w === "air" || w === "iron" || w === "table" ? w : null;
}

/** A small card drawn in CSS: Air is an open ring, Iron a bullet, Table a table. */
export function CardIcon({ kind }: { kind: Kind }): React.JSX.Element {
  return (
    <span className={`hw-card hw-card-${kind}`} aria-hidden="true">
      <i />
    </span>
  );
}

function Paras({ s }: { s: HowSection }): React.JSX.Element {
  return <>{s.body?.map((p) => <p key={p}>{p}</p>)}</>;
}

function Bullets({ s }: { s: HowSection }): React.JSX.Element | null {
  if (!s.bullets) return null;
  return (
    <ul className="hw-list">
      {s.bullets.map((b) => (
        <li key={b}>{b}</li>
      ))}
    </ul>
  );
}

function CardList({ s }: { s: HowSection }): React.JSX.Element {
  return (
    <ul className="hw-cards">
      {(s.bullets ?? []).map((b) => {
        const k = kindOf(b);
        const at = b.indexOf(":");
        return (
          <li key={b}>
            {k ? <CardIcon kind={k} /> : null}
            <span>
              {at > 0 ? (
                <>
                  <b>{b.slice(0, at)}.</b> {b.slice(at + 1).trim()}
                </>
              ) : (
                b
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Example({ ex }: { ex: HowExample }): React.JSX.Element {
  const paid = /takes the purse/.test(ex.result);
  return (
    <li className="hw-ex">
      <div className="hw-seats">
        {ex.cards.map((c, i) => {
          const k = kindOf(c);
          return (
            <span key={i} className={`hw-seat${k ? ` hw-seat-${k}` : ""}`}>
              <small>Seat {i + 1}</small>
              <span className="hw-seat-card">
                {k ? <CardIcon kind={k} /> : null}
                {c}
              </span>
            </span>
          );
        })}
      </div>
      <p className={`hw-result ${paid ? "hw-paid" : "hw-unpaid"}`}>
        <b>{paid ? "Purse paid." : "Nobody paid."}</b> {ex.result}
      </p>
    </li>
  );
}

function Section({ s }: { s: HowSection }): React.JSX.Element {
  return (
    <section className={`hw-sec hw-sec-${s.id}`} id={`how-${s.id}`} aria-labelledby={`how-${s.id}-h`}>
      <h2 id={`how-${s.id}-h`}>{s.title}</h2>
      <Paras s={s} />
      {s.id === "cards" ? <CardList s={s} /> : <Bullets s={s} />}
      {s.examples ? (
        <ol className="hw-examples">
          {s.examples.map((ex) => (
            <Example key={ex.cards.join("|") + ex.result} ex={ex} />
          ))}
        </ol>
      ) : null}
    </section>
  );
}

export function HowItWorks({ client }: { client: GameClient }): React.JSX.Element {
  const base = import.meta.env.BASE_URL;
  const contract = client.contractUrl();
  const stakes = HOW_SECTIONS.find((s) => s.id === "stakes");
  // The cards and the examples read first and full width; the rest runs in columns.
  const first = ["cards", "who-wins"];
  const lead = HOW_SECTIONS.filter((s) => first.includes(s.id));
  const rest = HOW_SECTIONS.filter((s) => s.id !== "stakes" && !first.includes(s.id));

  return (
    <main className="page-wrap how-wrap">
      <article className="paper-page how" aria-labelledby="how-title">
        <header className="hw-mast">
          <p className="hw-kicker">Third Chair · Testnet edition</p>
          <h1 id="how-title">{HOW_TITLE}</h1>
          <p className="hw-lead">{HOW_LEAD}</p>
        </header>

        {stakes ? (
          <section className="hw-stakes" id="how-stakes" aria-labelledby="how-stakes-h">
            <div className="hw-purse" aria-hidden="true">
              <b>1 XLM</b>
              <span>to the last one standing</span>
            </div>
            <div>
              <h2 id="how-stakes-h">{stakes.title}</h2>
              <Paras s={stakes} />
              <Bullets s={stakes} />
            </div>
          </section>
        ) : null}

        <nav className="hw-jump" aria-label="Read more">
          <a href={`${base}skill.md`}>skill.md for agents</a>
          <a href="#/claim">Claim an agent</a>
          {contract ? (
            <a href={contract} target="_blank" rel="noreferrer">
              The contract on stellar.expert
            </a>
          ) : null}
          <a href="#/practice">Try the practice table</a>
        </nav>

        {lead.map((s) => (
          <Section key={s.id} s={s} />
        ))}

        <div className="hw-cols">
          {rest.map((s) => (
            <Section key={s.id} s={s} />
          ))}
        </div>

        <footer className="hw-foot">
          <a className="btn btn-rust" href="#/">
            Back to the map
          </a>
          <span>
            Read the agent interface in <a href={`${base}skill.md`}>skill.md</a>. Accept an agent on the <a href="#/claim">claim page</a>.
            {contract ? (
              <>
                {" "}
                Every rule lives in{" "}
                <a href={contract} target="_blank" rel="noreferrer">
                  the contract
                </a>
                .
              </>
            ) : null}
          </span>
        </footer>
      </article>
    </main>
  );
}

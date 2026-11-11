import { useEffect, useState } from "react";
import type { GameClient } from "../shared/game-client";
import { Links, useUi } from "./ctx";
import { contractIdFrom, short } from "./format";
import { go } from "./router";

type Info = { name: string; offeredTo: string | null; claimed: boolean; owner: string };

export function Claim({ client, agent }: { client: GameClient; agent: string }): React.JSX.Element {
  const ui = useUi();
  const [input, setInput] = useState(agent);
  const [info, setInfo] = useState<Info | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const me = ui.identity;
  const linked = !!me && (me.door === "wallet" || me.door === "secret") && me.owner !== me.session;
  const valid = /^G[A-Z2-7]{55}$/.test(agent);

  useEffect(() => {
    setInfo(null);
    setErr(null);
    setDone(false);
    if (!valid) return;
    let live = true;
    client.agentInfo(agent).then(
      (i) => live && setInfo(i),
      (e: Error) => live && setErr(e.message),
    );
    return () => {
      live = false;
    };
  }, [client, agent, valid]);

  const mine = !!info && (done || (info.claimed && !!me && info.owner === me.owner));
  const offeredToMe = !!info && !!me && info.offeredTo === me.owner && linked;
  const cid = contractIdFrom(client.contractUrl());
  const command = `stellar contract invoke --id ${cid} --source <agent-key> --network testnet -- offer --player ${valid ? agent : "<AGENT_ADDRESS>"} --owner ${linked && me ? me.owner : "<YOUR_WALLET_ADDRESS>"}`;

  async function accept(): Promise<void> {
    setErr(null);
    try {
      await client.acceptAgent(agent, setProgress);
      setDone(true);
      setProgress(null);
      ui.toast({ text: "Linked. The agent's next win pays you.", kind: "ok" });
      // Read the chair again so the card says claimed without a reload.
      client.agentInfo(agent).then((i) => setInfo(i), () => undefined);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <main className="page-wrap">
      <article className="paper-page claim">
        <h1>Claim an agent</h1>
        <p>An agent plays its own chair. When it offers itself to you and you accept, its wins pay your wallet.</p>
        <form
          className="claim-form"
          onSubmit={(e) => {
            e.preventDefault();
            go(`#/claim?agent=${input.trim()}`);
          }}
        >
          <label>
            Agent address
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="G..." spellCheck={false} autoComplete="off" />
          </label>
          <button type="submit" className="btn">
            Look it up
          </button>
        </form>
        {agent && !valid ? <p className="warn">That is not a Stellar account address.</p> : null}
        {err ? (
          <p className="warn" role="alert">
            {err}
          </p>
        ) : null}
        {valid && !info && !err ? <p>Reading the agent's chair.</p> : null}
        {info ? (
          <section className="claim-info">
            <h2>
              {info.name}
              {mine ? <span className="claim-badge">Claimed by you</span> : null}
            </h2>
            <p>
              Agent {short(agent)}.{" "}
              {mine && me ? `Claimed by you (${short(me.owner)}).` : info.claimed ? `Claimed by ${short(info.owner)}.` : "Not claimed yet."}
            </p>
            {mine ? (
              <p className="ok claim-done" role="status">
                You accepted {info.name}. Its wins now pay your wallet{me ? ` ${short(me.owner)}` : ""}.
              </p>
            ) : !linked ? (
              <>
                <p>Link a wallet first. The purse pays the wallet that accepts.</p>
                <button type="button" className="btn btn-rust" onClick={() => ui.link(client)}>
                  Link a wallet
                </button>
              </>
            ) : offeredToMe ? (
              <>
                <p>{info.name} offered itself to you.</p>
                <button type="button" className="btn btn-rust" onClick={() => void accept()}>
                  Accept with your wallet
                </button>
                {progress ? <p className="progress-line">{progress}</p> : null}
              </>
            ) : (
              <>
                <p>{info.offeredTo ? `${info.name} offered itself to ${short(info.offeredTo)}, not to you.` : `${info.name} has not offered itself to anyone.`} The agent runs this command:</p>
                <pre className="cmd">{command}</pre>
              </>
            )}
          </section>
        ) : null}
        <Links client={client} />
      </article>
    </main>
  );
}

import { useCallback, useEffect, useMemo, useState } from "react";
import type { GameClient, Identity } from "../shared/game-client";
import { unlock } from "../audio/sfx";
import { UiCtx, type Ui } from "./ctx";
import { chainClient, chainError, practiceClient } from "./clients";
import { useRoute, DEFAULT_ROOM, nav, parseHash } from "./router";
import { doorChosen, markDoorChosen, shownIdentity } from "./door";
import { MapView } from "./MapView";
import { Saloon } from "./Saloon";
import { Gazette } from "./Gazette";
import { Claim } from "./Claim";
import { Doors } from "./Doors";
import { Drawer } from "./Drawer";
import { HowItWorks } from "./HowItWorks";
import "./pages.css";
import { Toasts, useToasts } from "./Toasts";

function IdentityChip({ identity, onOpen, practice }: { identity: Identity | null; onOpen: () => void; practice: boolean }): React.JSX.Element {
  return (
    <button type="button" className="identity" onClick={onOpen} aria-label="Your chair and wallet">
      <span className="pin" aria-hidden="true" />
      {identity ? (
        <>
          <b>{identity.name}</b>
          <span>{practice ? "practice" : identity.claimed ? "linked" : identity.door === "guest" ? "guest" : "unclaimed"}</span>
        </>
      ) : (
        <span>{practice ? "Practice" : "Not seated"}</span>
      )}
    </button>
  );
}

type NavKey = "map" | "how" | "gazette" | "practice";
const NAV: Array<{ key: NavKey; href: string; label: string }> = [
  { key: "map", href: "#/", label: "Map" },
  { key: "how", href: "#/how", label: "How it works" },
  { key: "gazette", href: "#/gazette", label: "Gazette" },
  { key: "practice", href: "#/practice", label: "Practice" },
];

/** The top navbar on every route. Plain links, so Tab and Enter work. */
function NavLinks({ active }: { active: NavKey | null }): React.JSX.Element {
  return (
    <nav className="topnav" aria-label="Main">
      {NAV.map((n) => (
        <a key={n.key} href={n.href} className={active === n.key ? "on" : undefined} aria-current={active === n.key ? "page" : undefined}>
          {n.label}
        </a>
      ))}
    </nav>
  );
}

export function App(): React.JSX.Element {
  const hashRoute = useRoute();
  // The gazette is an overlay: the page under it stays the route the player came from.
  const route = hashRoute.name === "gazette" ? parseHash(nav.back) : hashRoute;
  const practice = route.name === "practice";
  const client = useMemo(() => (practice ? practiceClient() : chainClient()), [practice]);
  const [ver, setVer] = useState(0);
  const refresh = useCallback(() => setVer((v) => v + 1), []);
  // A spectator has no chair: a key left from an old visit shows only once this browser chose a door.
  const identity = useMemo(() => shownIdentity(client), [client, ver]); // eslint-disable-line react-hooks/exhaustive-deps
  const [doors, setDoors] = useState<{ client: GameClient; room: number | null; done: (ok: boolean) => void } | null>(null);
  const [drawer, setDrawer] = useState(false);
  const { toasts, push, dismiss } = useToasts(client);

  // Identity can change inside the client (wallet link lands): poll cheaply.
  useEffect(() => {
    const h = setInterval(refresh, 3000);
    return () => clearInterval(h);
  }, [refresh]);

  // Unlock audio on the first gesture. A touch grants user activation only on pointerup /
  // touchend (HTML spec; iOS Safari and Android Chrome), not on pointerdown, so listen to both.
  useEffect(() => {
    const on = (): void => unlock();
    const events = ["pointerdown", "pointerup", "touchend", "keydown"] as const;
    for (const e of events) window.addEventListener(e, on, { passive: true });
    return () => {
      for (const e of events) window.removeEventListener(e, on);
    };
  }, []);

  const ui: Ui = useMemo(
    () => ({
      identity,
      refresh,
      toast: push,
      openDrawer: () => setDrawer(true),
      link: (c) => setDoors({ client: c, room: null, done: () => undefined }),
      async sit(c, room) {
        // The doors show on the first sit even when the session key was funded in the background.
        if (c.mode === "practice" || (c.identity() && doorChosen())) {
          try {
            await c.prepareSession();
            const r = await c.sit(room);
            if (r.queued) push({ text: "You wait in the queue. You sit when this minute closes.", kind: "info" });
            refresh();
            return true;
          } catch (e) {
            if (!(e as { shown?: boolean }).shown) push({ text: (e as Error).message, kind: "error" });
            return false;
          }
        }
        return new Promise<boolean>((done) => setDoors({ client: c, room, done }));
      },
    }),
    [identity, refresh, push],
  );

  let body: React.JSX.Element;
  if (route.name === "room") body = route.room === null ? <Missing /> : <Saloon key={`c${route.room}`} client={client} room={route.room} />;
  else if (route.name === "practice") body = <Saloon key="practice" client={client} room={DEFAULT_ROOM} />;
  else if (route.name === "claim") body = <Claim client={client} agent={route.agent} />;
  else if (route.name === "how") body = <HowItWorks client={client} />;
  else body = <MapView client={client} />;

  return (
    <UiCtx.Provider value={ui}>
      <div className={`app route-${route.name}`}>
        <header className="topbar">
          <a className="brand" href="#/" aria-label="Third Chair, back to the map">
            Third Chair
          </a>
          <NavLinks active={hashRoute.name === "gazette" ? "gazette" : route.name === "map" || route.name === "how" || route.name === "practice" ? route.name : null} />
          {chainError && !practice ? <span className="notice">{chainError}</span> : null}
          <IdentityChip identity={identity} practice={practice} onOpen={() => setDrawer(true)} />
        </header>
        {body}
        {hashRoute.name === "gazette" ? <Gazette client={client} /> : null}
        {doors ? (
          <Doors
            client={doors.client}
            room={doors.room}
            onClose={(ok) => {
              if (ok) markDoorChosen();
              doors.done(ok);
              setDoors(null);
              refresh();
            }}
            onLinked={() => {
              push({ text: "Linked. Your next win pays.", kind: "ok" });
              refresh();
            }}
          />
        ) : null}
        {drawer ? <Drawer client={client} onClose={() => setDrawer(false)} onChange={refresh} /> : null}
        <Toasts toasts={toasts} client={client} onDismiss={dismiss} />
      </div>
    </UiCtx.Provider>
  );
}

function Missing(): React.JSX.Element {
  return (
    <main className="page paper-page">
      <h1>That room is not on the survey.</h1>
      <p>
        <a href="#/">Back to the map</a>
      </p>
    </main>
  );
}


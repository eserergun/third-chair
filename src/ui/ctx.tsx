import { createContext, useContext, useSyncExternalStore } from "react";
import type { GameClient, Identity } from "../shared/game-client";
import { isMuted, setMuted, subscribe, unlock } from "../audio/sfx";
import type { Toast } from "./Toasts";

export interface Ui {
  /** Sit with doors on first sit (chain). Resolves true when seated or queued. */
  sit(client: GameClient, room: number): Promise<boolean>;
  link(client: GameClient): void;
  openDrawer(): void;
  toast(t: Omit<Toast, "id">): void;
  identity: Identity | null;
  refresh(): void;
}

export const UiCtx = createContext<Ui | null>(null);
export function useUi(): Ui {
  const ui = useContext(UiCtx);
  if (!ui) throw new Error("no ui");
  return ui;
}

export function Links({ client }: { client?: GameClient }): React.JSX.Element {
  const base = import.meta.env.BASE_URL;
  return (
    <nav className="links" aria-label="Site">
      <a href="#/">Map</a>
      <a href="#/gazette">Dust Gazette</a>
      <a href={`${base}skill.md`}>skill.md</a>
      <a href="#/claim">Claim an agent</a>
      <a href="#/practice">Practice</a>
      {client?.contractUrl() ? (
        <a href={client.contractUrl() ?? "#"} target="_blank" rel="noreferrer">
          Contract
        </a>
      ) : null}
    </nav>
  );
}

export function SoundToggle(): React.JSX.Element {
  const muted = useSyncExternalStore(subscribe, isMuted, () => true);
  return (
    <button
      type="button"
      className="chip-btn"
      aria-pressed={!muted}
      onClick={() => {
        setMuted(!muted);
        unlock();
      }}
    >
      Sound {muted ? "off" : "on"}
    </button>
  );
}


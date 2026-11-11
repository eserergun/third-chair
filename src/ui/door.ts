// Remembers that this browser already chose a door (SPEC 6.1). Every access is wrapped.

import type { GameClient, Identity } from "../shared/game-client";

const DOOR_KEY = "standoff.v2.door";

export function doorChosen(): boolean {
  try {
    return localStorage.getItem(DOOR_KEY) === "1";
  } catch {
    return false;
  }
}

export function markDoorChosen(): void {
  try {
    localStorage.setItem(DOOR_KEY, "1");
  } catch {
    // storage may be blocked; the doors will show again next time
  }
}

export function clearDoorChosen(): void {
  try {
    localStorage.removeItem(DOOR_KEY);
  } catch {
    // nothing to clear
  }
}

/**
 * SPEC 6.1: make and fund the session key as soon as a room slip or a room opens, so Friendbot
 * (often 15 to 30 s) runs while the visitor looks around, not after "Walk in". Quiet: the doors
 * show any error. The key stays hidden until a door is chosen (shownIdentity).
 */
export function warmSession(client: GameClient): void {
  if (client.mode !== "chain" || client.identity()?.funded) return;
  client.prepareSession().catch(() => undefined);
}

/** The identity for the header and the drawer. A spectator has no chair: a key left from an old visit shows only once this browser chose a door. */
export function shownIdentity(client: GameClient): Identity | null {
  const me = client.identity();
  if (!me || client.mode === "practice") return me;
  return doorChosen() || me.claimed ? me : null;
}

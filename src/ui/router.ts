import { useEffect, useState } from "react";
import { ROOM_NAMES } from "../shared/game-client";

export const SLUGS = ROOM_NAMES.map((n) => n.toLowerCase());
export const DEFAULT_ROOM = 3; // Denvar

export type Route =
  | { name: "map" }
  | { name: "room"; room: number | null; slug: string }
  | { name: "gazette" }
  | { name: "claim"; agent: string }
  | { name: "practice" }
  | { name: "how" };

export function roomBySlug(slug: string): number | null {
  const s = slug.toLowerCase();
  if (s === "live") return DEFAULT_ROOM;
  const i = SLUGS.indexOf(s);
  return i >= 0 ? i : null;
}

export function parseHash(hash: string): Route {
  const h = hash.replace(/^#/, "") || "/";
  const [path, query = ""] = h.split("?");
  const parts = path.split("/").filter(Boolean);
  if (parts[0] === "room") return { name: "room", room: roomBySlug(parts[1] ?? ""), slug: parts[1] ?? "" };
  if (parts[0] === "gazette") return { name: "gazette" };
  if (parts[0] === "practice") return { name: "practice" };
  if (parts[0] === "how") return { name: "how" };
  if (parts[0] === "claim") return { name: "claim", agent: new URLSearchParams(query).get("agent") ?? "" };
  return { name: "map" };
}

/** The last route that is not the gazette: the gazette overlays it and closes back to it. */
export const nav: { back: string } = { back: "#/" };
function remember(hash: string, r: Route): Route {
  if (r.name !== "gazette") nav.back = hash || "#/";
  return r;
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => remember(location.hash, parseHash(location.hash)));
  useEffect(() => {
    const on = (): void => setRoute(remember(location.hash, parseHash(location.hash)));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

export function go(hash: string): void {
  if (location.hash !== hash) location.hash = hash;
}

/** One-shot intents carried across a route change (Walk in, replay from the gazette). */
export const intent: { sit: number | null; replay: { room: number; hand: string } | null } = { sit: null, replay: null };

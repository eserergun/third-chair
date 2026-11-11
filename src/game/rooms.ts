// The nine rooms along the Glass River (SPEC 3).

export interface RoomInfo {
  id: number;
  slug: string;
  name: string;
  x: number;
  y: number;
}

export const ROOMS: readonly RoomInfo[] = [
  { id: 0, slug: "billen", name: "Billen", x: 0.368, y: 0.256 },
  { id: 1, slug: "cheyen", name: "Cheyen", x: 0.552, y: 0.26 },
  { id: 2, slug: "amarilla", name: "Amarilla", x: 0.818, y: 0.303 },
  { id: 3, slug: "denvar", name: "Denvar", x: 0.373, y: 0.497 },
  { id: 4, slug: "abelen", name: "Abelen", x: 0.608, y: 0.547 },
  { id: 5, slug: "laramy", name: "Laramy", x: 0.862, y: 0.484 },
  { id: 6, slug: "prescot", name: "Prescot", x: 0.185, y: 0.725 },
  { id: 7, slug: "duranga", name: "Duranga", x: 0.602, y: 0.814 },
  { id: 8, slug: "tucsan", name: "Tucsan", x: 0.825, y: 0.788 },
];

export const ROOM_COUNT = 9;
export const DEFAULT_ROOM = 3;
export const NO_ROOM_MESSAGE = "That room is not on the survey.";

export function roomBySlug(slug: string): RoomInfo | undefined {
  const s = slug.trim().toLowerCase();
  if (s === "live") return ROOMS[DEFAULT_ROOM];
  return ROOMS.find((r) => r.slug === s);
}

export function roomById(id: number): RoomInfo | undefined {
  return Number.isInteger(id) ? ROOMS[id] : undefined;
}

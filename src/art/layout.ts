// Shared geometry of the saloon frame (384 x 216).

export const FRAME = 6; // soot comic frame
export const SEAT_X: readonly [number, number, number] = [72, 192, 312];

export const WAINSCOT_Y = 116; // chair rail
export const FLOOR_Y = 147; // first row of floor boards
export const FEET_Y = 158; // boot sole of a standing cowboy
export const TABLE_TOP_Y = 138; // first row of a small table's felt top
export const CHAIR_SEAT_Y = 139;
export const FALLEN_TOP_Y = 170; // top row of the torso of a body on the floor
export const BADGE_Y = 84; // top of a badge card
export const PLATE_Y = 197; // top of a name plate (low, so the purse can rest on the boards above it)

/** Purse resting spot on a table: left x and bottom y of the satchel. */
export function purseSpot(i: number): { x: number; y: number } {
  return { x: SEAT_X[i] + 7, y: TABLE_TOP_Y + 5 };
}

/**
 * Purse resting spot while nobody has won it: on the boards at the front centre of the room,
 * between the chairs and below every table, so it belongs to no seat. Left x and bottom y.
 */
export function purseHome(): { x: number; y: number } {
  return { x: SEAT_X[1] - 5, y: PLATE_Y - 4 };
}

// ASCII pixel sprites. Keys (mapped per seat in figure.ts):
//   . transparent   k soot   p paper   r rust   f felt
//   c coat ink      l coat seam (soot on rust/felt coats, felt on the soot coat)
//   n bandana (felt on the rust coat, rust otherwise)   t trousers (soot)
//   b belt round (rust while the chair has its bullet)  h house H in the hat band (paper on house hats)
// Figures face right; the renderer mirrors them. Body sprites are 27 px wide, column 13 is the
// seat centre, row 47 is the boot sole. Every seat shares the torso; seats 0 and 2 wear a
// profile head turned toward the middle of the table (a three-quarter view).

import { sprite } from "./pix";

/** Hat, 19 x 9: soot crown, rust band (a paper H on house hats), brim. Column 9 is its centre. Row 8 overlaps the head's top row. */
export const HAT = sprite([
  "......kkk.kkk......",
  ".....kkkkkkkkk.....",
  ".....kkkkkkkkk.....",
  ".....kkkkkkkkk.....",
  ".....rrrhrhrrr.....",
  ".....rrrhhhrrr.....",
  "k....rrrhrhrrr....k",
  "kkkkkkkkkkkkkkkkkkk",
  ".kkkkkkkkkkkkkkkkk.",
]);

/** Front head, 9 x 8, at body columns 9..17: eyes and a small mouth. */
export const HEAD_FRONT = sprite([
  ".kpppppk.",
  ".ppppppp.",
  "ppkpppkpp",
  "ppkpppkpp",
  ".ppppppp.",
  ".ppppppp.",
  ".ppkkkpp.",
  "..ppppp..",
]);

/** Profile head facing right, 10 x 8, at body columns 9..18: hair, ear, eye, nose, mouth. */
export const HEAD_SIDE = sprite([
  ".kkkppppp.",
  "kkkpppppp.",
  "kkpppppkp.",
  "kpkppppkpp",
  "kppppppppp",
  ".pppppppp.",
  ".pppppkk..",
  "..pppppp..",
]);

const TORSO = [
  "........" + "cc" + "nnnnnnn" + "cc" + "........",
  "......." + "cccc" + "nnnnn" + "cccc" + ".......",
  "......." + "ccc" + "l" + "p" + "nnn" + "p" + "l" + "ccc" + ".......",
  "......." + "cccc" + "l" + "p" + "n" + "p" + "l" + "cccc" + ".......",
  "......." + "ccccc" + "l" + "p" + "l" + "ccccc" + ".......",
  "......." + "cccccc" + "l" + "cccccc" + ".......",
  "......." + "cccccc" + "l" + "cccccc" + ".......",
  "......." + "ccccccpcccccc" + ".......",
  "......." + "cccccc" + "l" + "cccccc" + ".......",
  "......." + "ccccccpcccccc" + ".......",
  "......." + "kkkkk" + "ppp" + "k" + "b" + "kkk" + ".......",
  "......." + "kkkkk" + "pkp" + "kkkkk" + ".......",
  "......." + "cccccc" + "l" + "cccccc" + ".......",
  "......." + "cccccc" + "t" + "cccccc" + "kk" + ".....",
  "......." + "cccccc" + "t" + "cccccc" + "kk" + ".....",
  "......." + "cccccc" + "t" + "cccccc" + "kk" + ".....",
  "......." + "cccccc" + "t" + "cccccc" + "kk" + ".....",
  "......." + "ccccc" + "ttt" + "ccccc" + "kk" + ".....",
  ...Array.from({ length: 18 }, () => "........." + "tttt" + "." + "tttt" + "........."),
];

/** Torso, trousers and boots (rows 8..47); the head is drawn on rows 0..7. */
export const BODY_FRONT = sprite([
  ...Array.from({ length: 8 }, () => "..........................."),
  ...TORSO,
  "........" + "kkkkk" + "." + "kkkkk" + "........",
  "........" + "kkkkk" + "." + "kkkkk" + "........",
  "......." + "kkkkkk" + "." + "kkkkkk" + ".......",
  "......." + "kkkkkk" + "." + "kkkkkk" + ".......",
]);

/** Same torso, boots turned toward the facing side, spurs at the heels. */
export const BODY_SIDE = sprite([
  ...Array.from({ length: 8 }, () => "..........................."),
  ...TORSO,
  "........." + "kkkk" + "." + "kkkk" + ".........",
  "........." + "kkkk" + "." + "kkkk" + ".........",
  "........." + "kkkkk" + "." + "kkkkk" + ".......",
  "........" + "p" + "kkkkk" + "p" + "kkkkk" + ".......",
]);

/** Coat hem that swings one beat behind, drawn on row 26 when the coat lags. */
export const HEM = sprite(["......." + "ccccc" + "..." + "ccccc" + "......."]);

/** Both arms hanging, hands by the hips. Offset (4, 9) in body space. */
export const ARMS_IDLE = sprite([
  ".cc" + "............." + "cc.",
  ...Array.from({ length: 10 }, () => "cccl" + "..........." + "lccc"),
  "ppp" + "............." + "ppp",
  "ppp" + "............." + "ppp",
  "ppp" + "............." + "ppp",
]);

/** Only the left arm hanging (the right one draws). Offset (4, 9). */
export const ARM_LEFT = sprite([".cc", ...Array.from({ length: 10 }, () => "cccl"), "ppp", "ppp", "ppp"]);

/** Hands up, open. Offset (1, -3). */
export const ARMS_AIR = sprite([
  "p.p.p" + "..............." + "p.p.p",
  "p.p.p" + "..............." + "p.p.p",
  "ppppp" + "..............." + "ppppp",
  "ppppp" + "..............." + "ppppp",
  ".ppp." + "..............." + ".ppp.",
  ".lll." + "..............." + ".lll.",
  ".ccc." + "..............." + ".ccc.",
  ".ccc." + "..............." + ".ccc.",
  ".ccc." + "..............." + ".ccc.",
  ".ccc." + "..............." + ".ccc.",
  "..ccc" + "..............." + "ccc..",
  "...ccc" + "............." + "ccc...",
  "....cc" + "............." + "cc....",
]);

/** Gun grip in the right holster, offset (20, 19). */
export const GRIP = sprite(["kk", "kp"]);

/**
 * Gun arm at a near target, angled a little down (faces right). Shoulder rows 0..2 at (0, 0).
 * The revolver is 9 x 4 (hammer, top strap and barrel, fluted cylinder, trigger) plus its grip.
 */
export const ARM_AIM = sprite([
  "cccccc..................",
  "cccccccccccl...kk......k",
  "llllllcccccl" + "ppp" + "kkkkkkkkk",
  "......llllll" + "ppp" + "kpkpkkkkk",
  "............" + "ppp" + "kkkk.k...",
  "............." + "kk" + ".........",
]);
export const AIM_MUZZLE = { x: 23, y: 2 } as const;

/** Gun arm raised at the far seat (faces right): it aims over the middle chair. Shoulder rows 3..5. */
export const ARM_AIM_FAR = sprite([
  "...............kk......k",
  "..........cl" + "ppp" + "kkkkkkkkk",
  "........cccl" + "ppp" + "kpkpkkkkk",
  "......ccccll" + "ppp" + "kkkk.k...",
  "....ccccll..." + "kk" + ".........",
  "..ccccll................",
  "ccccll..................",
  "cccl....................",
  "ll......................",
]);
export const AIM_FAR_MUZZLE = { x: 23, y: 1 } as const;
/** Row of ARM_AIM_FAR that sits on the shoulder row. */
export const AIM_FAR_SHOULDER = 6;

/** A revolver in the air (faces right), 9 x 5. */
export const GUN = sprite(["kk......k", "kkkkkkkkk", "kpkpkkkkk", "kkkk.k...", ".kk......"]);

/** Gun arm on the way up (faces right). Shoulder at (0, 0). */
export const ARM_DRAW = sprite([
  "ccc........",
  "lccc.......",
  ".lccc......",
  "..lccc.....",
  "...lccc....",
  "....lppp...",
  ".....pppkk.",
  ".....pppkkk",
  ".........kk",
  "..........k",
]);
export const DRAW_MUZZLE = { x: 10, y: 9 } as const;

/** Open hand flung sideways (fingers to the left), 5 x 5. */
export const HAND_FLUNG = sprite(["pp...", "..ppp", "ppppp", "..ppp", "pp..."]);

/** A revolver lying on the floor (faces right). */
export const GUN_FLOOR = sprite(["..kk......k", ".kkkkkkkkkk", "kkkpkpkkkkk", "kkkkkk.k...", "kk........."]);

/**
 * Head on the floor in profile, face up: crown to the left, the face profile on top (brow, nose,
 * lips), chin to the right, soot hair under the back of the head. One big cross eye with paper
 * around it. 12 x 10; the bottom row rests on the floor.
 */
export const DEAD_HEAD = sprite([
  "..pppp.p....",
  ".ppppppppp..",
  "kpkpkppppkp.",
  "kppkpppppppp",
  "kpkpkppppppp",
  "kkpppppkpppp",
  "kkkppppkppp.",
  ".kkkpppppp..",
  "..kkkkkpp...",
  "...kkkk.....",
]);

/**
 * Bullet hole: a soot core in a paper ring, with a rust drip below it. Reads on rust, felt and
 * soot coats. 5 x 6.
 */
export const WOUND = sprite([".ppp.", "pkkkp", "pkkkp", ".prp.", "..rr.", "...r."]);

/** The hat as it shows over the table on a duck: the brim ends catch a paper rim. */
export const HAT_DUCK = sprite([
  "......kkk.kkk......",
  ".....kkkkkkkkk.....",
  ".....kkkkkkkkk.....",
  ".....rrrhrhrrr.....",
  ".....rrrhhhrrr.....",
  "p....rrrhrhrrr....p",
  "pkkkkkkkkkkkkkkkkkp",
  ".ppkkkkkkkkkkkkkpp.",
]);

/**
 * The wound bursting on the chest in the hit pose: a soot hole in a rust ring, a paper ring and
 * paper spray rays, so it reads on rust, felt and soot coats. 9 x 9, centre at (4, 3).
 */
export const WOUND_BURST = sprite([
  "p...p...p",
  ".p.ppp.p.",
  "..prrrp..",
  "pprkkkrpp",
  "..rkkkr..",
  "..prrrp..",
  ".p.prp.p.",
  "p...r...p",
  "....r....",
]);

/** Front head asleep, chin on the chest: eyes shut (short dashes), mouth slack. 9 x 8. */
export const HEAD_FRONT_SLEEP = sprite([
  ".kpppppk.",
  ".ppppppp.",
  "ppppppppp",
  "pkkpppkkp",
  ".ppppppp.",
  ".pppkppp.",
  ".ppppppp.",
  "..ppppp..",
]);

/** Profile head asleep, facing right and tipped down: eye shut. 10 x 8. */
export const HEAD_SIDE_SLEEP = sprite([
  ".kkkppppp.",
  "kkkpppppp.",
  "kkppppppp.",
  "kpkpppkkpp",
  "kppppppppp",
  ".pppppppp.",
  ".pppppkp..",
  "..pppppp..",
]);

/** The letters of a snore: a big Z and a small one. */
export const Z_BIG = sprite(["kkkkk", "...k.", "..k..", ".k...", "kkkkk"]);
export const Z_SMALL = sprite(["kkkk", "..k.", ".k..", "kkkk"]);

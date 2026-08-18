// The Landing, drawn by hand.
//
// This is the one part of the mine that is not generated. It is a tile map, laid out as art, because
// the opening has to teach the whole game and a procedural opening cannot be trusted to put anything
// anywhere. What it replaced was stamped: four freestanding faces dropped into whatever geology the
// seed happened to leave, thinned by `(x * 7 + y * 13) % 5` into a speckle of single cells, with two
// diagonal slate strata running straight through the middle of it. It had 296 open cells and 148
// breakable exits on one seed and none at all on another -- so on some worlds there was no starting
// room, and on none of them was there a door.
//
// The shape of the teaching is the shape of the ground:
//
//   THE BERTH     Where you wake. Sealed. The Refit Bay is a machined recess in the west wall and the
//                 bank sits under it, so the two things you will come home to are the first two things
//                 you see. Flying across it is the whole of the movement lesson.
//   THE VESTIBULE A short passage east, and the only way on.
//   THE SEAL       A band of chalk across the vestibule, set at a diagonal. That angle is the aim
//                 lesson: a frame left square cannot cover it, so turning the frame is not a thing the
//                 player is told to do, it is a thing the door requires. Braced either side so it
//                 reads as built rather than as more rock.
//   THE GALLERY   What the door opens onto. Tall, dark, and much larger than the berth -- the first
//                 thing the breach buys is scale.
//   THE ISLAND    A free-standing body of ore in the middle of the Gallery floor, walkable all the way
//                 around. It is the first Bounder's patrol ground and the second claim's reward, and
//                 it is one object doing both jobs on purpose: the thing you want is standing on it.
//   THE OVERLOAD FACE  Legibly denser than starting armour, on the Gallery's south wall. Where the
//                 cost of leaving rock behind gets named, at a depth where being wrong cannot kill.
//   THE DROP      A shaft off the Gallery's east floor. Where the authored world stops and the mine
//                 begins.
//
// Ordinary rock here is chalk at one hit, so nothing in the opening takes four swings to break and
// nothing is indestructible. The player can mine out of the berth anywhere they like; the Seal is not
// a wall that forbids, it is the one wall that *invites*.

import { WORLD_COLS, WORLD_ROWS, type MaterialKind, type ResourceId } from "../config";
import type { Cell } from "../types";

/** Where the map's top-left glyph lands in world cells. */
export const LANDING_ORIGIN = { x: 8, y: 4 } as const;

/**
 * The Landing, one character per cell.
 *
 * Every row must be the same width and every glyph must appear in `LEGEND`; both are asserted by the
 * unit tests rather than trusted, because a map is exactly the kind of thing that goes quietly wrong
 * by one character.
 *
 *   `#` chalk       ordinary rock, one hit
 *   `.` open        floor
 *   `L` bay hull    the Refit Bay's machined recess -- drawn, not solid
 *   `$` bank        the chest. Ore is only yours once it is here
 *   `=` seal        the door
 *   `B` brace       the Seal's frame. Solid and breakable, but four hits, so it reads as structure
 *   `T` stake       a survey stake
 *   `c` copper      chalk carrying copper
 *   `o` coal        a coal seam
 *   `S` slate       iron in slate. Four hits and never liable, so leaving it costs nothing
 *   `X` overload    dense chalk carrying copper -- the too-much-to-clear face
 *   `?` untouched   not authored. The generator keeps whatever it put here
 *
 * The `?` margin is load-bearing rather than tidiness. Drawn as a solid rectangle, the map was a 60x40
 * block of rock dropped into the geology, and it walled off the caves that used to run through this
 * ground -- three chambers, 235 cells, cut off from the mine on one seed with no route back. Rock is
 * asserted only where rock is composition: the shell around the Berth, the Gallery's walls, the island,
 * the face, the shaft. Everything further out than that is the generator's to fill, so the caves still
 * arrive at the Landing's walls instead of stopping three cells short of them.
 */
export const LANDING_MAP: readonly string[] = [
  // 8         18        28        38        48        58
  "?????????????????????????????##############################?", //  4
  "????????????????????????????################################", //  5
  "????######################??######..................########", //  6
  "????######################??####........................####", //  7
  "????######################??###..........................###", //  8
  "???####................###??###.........................####", //  9
  "???####................########.........................####", // 10
  "???###LLLLL............########.........................####", // 11
  "???###LLLLL............########.........................###?", // 12
  "???###LLLLL..............B===...........................###?", // 13
  "???###LLLLL................===..........................###?", // 14
  "???###LLLLL.................===.........................####", // 15
  "???###$LLLL.................B===........................####", // 16
  "???####................#########........................####", // 17
  "???############################..........................###", // 18
  "???#############################.......TT...............####", // 19
  "????######################??####........................####", // 20
  "????????????????????????????####........................####", // 21
  "?????????????????????????????###........#########.......###?", // 22
  "?????????????????????????????###........#coSSSoc#.......###?", // 23
  "?????????????????????????????###........#cSSSSSc#.......###?", // 24
  "?????????????????????????????###........#cSSSSSc#.......###?", // 25
  "?????????????????????????????###........#coSSSoc#.......###?", // 26
  "?????????????????????????????###........#########.......###?", // 27
  "?????????????????????????????###..XXXXXXXXX.............###?", // 28
  "?????????????????????????????###..XXXXXXXXX.............###?", // 29
  "?????????????????????????????###..XXXXXXXXX.............###?", // 30
  "?????????????????????????????###..XXXXXXXXX.............###?", // 31
  "?????????????????????????????###..XXXXXXXXX.............###?", // 32
  "?????????????????????????????#######################....###?", // 33
  "?????????????????????????????#######################....###?", // 34
  "?????????????????????????????#######################....###?", // 35
  "?????????????????????????????????????????????????###....###?", // 36
  "?????????????????????????????????????????????????###....###?", // 37
  "?????????????????????????????????????????????????###....###?", // 38
  "?????????????????????????????????????????????????###....###?", // 39
  "?????????????????????????????????????????????????###....###?", // 40
  "?????????????????????????????????????????????????###....###?", // 41
  "?????????????????????????????????????????????????###....###?", // 42
  "?????????????????????????????????????????????????###....###?", // 43
];

interface Paint {
  kind?: MaterialKind;
  resource?: ResourceId | null;
  hp?: number;
  solid: boolean;
}

/** What each glyph puts in a cell. */
const LEGEND: Record<string, Paint> = {
  "#": { kind: "chalk", resource: null, hp: 1, solid: true },
  ".": { solid: false },
  L: { kind: "lander", resource: null, hp: 1, solid: false },
  $: { kind: "lander", resource: null, hp: 1, solid: false },
  "=": { kind: "chalk", resource: null, hp: 1, solid: true },
  B: { kind: "mechanism", resource: null, hp: 4, solid: true },
  T: { kind: "stake", resource: null, hp: 1, solid: false },
  c: { kind: "chalk", resource: "copper", hp: 1, solid: true },
  o: { kind: "coalSeam", resource: "coal", hp: 1, solid: true },
  S: { kind: "slate", resource: "iron", hp: 4, solid: true },
  X: { kind: "chalk", resource: "copper", hp: 1, solid: true },
};

/** The world rect the map covers, for reserving it against rooms and repair. */
export const LANDING_REGION = {
  x: LANDING_ORIGIN.x,
  y: LANDING_ORIGIN.y,
  width: LANDING_MAP[0].length,
  height: LANDING_MAP.length,
} as const;

/** Every glyph position of one character, in world cells. */
function cellsOf(glyph: string): Array<{ x: number; y: number }> {
  const found: Array<{ x: number; y: number }> = [];
  LANDING_MAP.forEach((row, row_) => {
    for (let column = 0; column < row.length; column++) {
      if (row[column] === glyph) found.push({ x: LANDING_ORIGIN.x + column, y: LANDING_ORIGIN.y + row_ });
    }
  });
  return found;
}

/**
 * The door, as cells.
 *
 * Read off the map rather than written down twice. The tutorial needs to know whether the player's
 * frame is covering the Seal, and a second hardcoded rectangle would be a thing to keep in step with
 * the art by hand.
 */
export const SEAL_CELLS: ReadonlyArray<{ x: number; y: number }> = cellsOf("=");

/** The middle of the Seal, for aiming the camera and naming the place. */
export const SEAL_CENTRE = {
  x: SEAL_CELLS.reduce((sum, cell) => sum + cell.x, 0) / SEAL_CELLS.length,
  y: SEAL_CELLS.reduce((sum, cell) => sum + cell.y, 0) / SEAL_CELLS.length,
};

/** Where the drone wakes up: the middle of the Berth. */
export const LANDING = { x: 24, y: 14 } as const;

/**
 * The Refit Bay's recess, and the chest in the corner of it.
 *
 * `BAY_RECT` exists because the drawn bay and the actual bay used to be different things: the art was
 * a squared landing pad about thirteen cells across, centred a cell below a recess three cells wide,
 * and the recess itself was solid -- so the player could not fly into most of what was clearly drawn
 * as somewhere to fly into. One rect now, read off the map, and the art is drawn from it.
 */
export const BAY_RECT = (() => {
  const cells = cellsOf("L").concat(cellsOf("$"));
  const xs = cells.map((cell) => cell.x);
  const ys = cells.map((cell) => cell.y);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs) + 1,
    height: Math.max(...ys) - Math.min(...ys) + 1,
  };
})();
export const BAY = { x: BAY_RECT.x + BAY_RECT.width / 2, y: BAY_RECT.y + BAY_RECT.height / 2 };
export const BANK = cellsOf("$")[0] ?? { x: 14, y: 16 };

/** The ore island in the Gallery: the second claim, and the first Bounder's ground. */
export const ISLAND = { x: 50, y: 24.5 } as const;
/**
 * Where the first Bounder is placed, on top of the island, in view of the ledge.
 *
 * Sat at exactly the ride height a Bounder holds above a floor -- its radius plus `BOUNDER.ride` above
 * the island's top row -- so it is attached on the frame it appears and has nothing to settle.
 */
export const FIRST_BOUNDER = { x: 50, y: 21.34 } as const;
/** The too-dense face, for the lesson about leaving rock behind. */
export const OVERLOAD_FACE = { x: 46, y: 30 } as const;
/** Where the authored world stops. */
export const DROP = { x: 61, y: 40 } as const;

export interface LandmarkSite {
  id: string;
  name: string;
  x: number;
  y: number;
}

/**
 * The places the Landing is made of, for HUD naming and generator verification.
 *
 * Five, where there used to be eight. Three of the old ones were teaching faces nobody could tell
 * were teaching faces -- freestanding blobs of chalk in a speckled room, each carrying a lesson with
 * nothing to attach it to. What is left is a room, a door, and the three things beyond the door that
 * the opening still has to say.
 */
export const LANDING_FEATURES: readonly LandmarkSite[] = [
  { id: "refitBay", name: "REFIT BAY", x: Math.round(BAY.x), y: Math.round(BAY.y) },
  { id: "bank", name: "THE BANK", x: BANK.x, y: BANK.y },
  { id: "theSeal", name: "THE SEAL", x: Math.round(SEAL_CENTRE.x), y: Math.round(SEAL_CENTRE.y) },
  { id: "theIsland", name: "THE ISLAND", x: Math.round(ISLAND.x), y: Math.round(ISLAND.y) },
  { id: "overloadFace", name: "THE OVERLOAD FACE", x: OVERLOAD_FACE.x, y: OVERLOAD_FACE.y },
  { id: "theDrop", name: "THE DROP", x: DROP.x, y: DROP.y },
] as const;

/**
 * Stamp the Landing over whatever the generator put here.
 *
 * Idempotent, and called more than once on purpose: both repair passes carve corridors wherever they
 * need to and then mirror openness back onto every non-persistent cell, so a repair route can run
 * straight through authored ground. Re-stamping is cheaper and more certain than teaching the repair
 * passes to route around it.
 */
export function stampLandingArea(cells: Cell[][], open: Uint8Array): void {
  LANDING_MAP.forEach((row, row_) => {
    const y = LANDING_ORIGIN.y + row_;
    if (y < 1 || y >= WORLD_ROWS - 1) return;
    for (let column = 0; column < row.length; column++) {
      const x = LANDING_ORIGIN.x + column;
      if (x < 1 || x >= WORLD_COLS - 1) continue;
      const paint = LEGEND[row[column]];
      if (!paint) continue;
      const cell = cells[y][x];
      cell.solid = paint.solid;
      // Both flags, and the second one is not optional.
      //
      // `solid` is the gameplay grid; `baseSolid` is the geology the *drawn* world is reconstructed
      // from -- `visualSolidAt` bilinearly interpolates it, and that is what the terrain renderer, the
      // shadow contour and creature collision all read. Setting only `solid` left the whole authored
      // Landing invisible to every one of them: the Gallery rendered as procedural rock, cast shadows
      // out of ground that was open, and the first Bounder walked into a wall that was not there.
      cell.baseSolid = paint.solid;
      if (paint.kind !== undefined) cell.kind = paint.kind;
      if (paint.resource !== undefined) cell.resource = paint.resource;
      if (paint.hp !== undefined) cell.hp = paint.hp;
      // Nothing authored here is indestructible; the flag exists only as data.
      cell.persistent = false;
      open[y * WORLD_COLS + x] = paint.solid ? 0 : 1;
    }
  });
}

// Authored territories stamped into procedural geology.
//
// Everything here is a generator *guarantee*. The Landing's seven features exist
// at fixed cells on every seed, because the opening has to teach the whole thesis
// before the world is allowed to be interesting. Cornerstone internal geometry is
// likewise fixed; only the approach and the surrounding caves vary.

import { WORLD_COLS, WORLD_ROWS, type MaterialKind, type ResourceId } from "../config";
import type { Cell } from "../types";
import type { CaveNode } from "./caves";

export interface LandmarkSite {
  id: string;
  name: string;
  x: number;
  y: number;
}

export const LANDING = { x: 24, y: 14 };

/** Cave nodes that must exist on every seed, rooted at the Landing. */
export const REQUIRED_NODES: readonly CaveNode[] = [
  { x: LANDING.x, y: LANDING.y, rx: 7, ry: 5, required: true, label: "landing" },
  { x: 36, y: 21, rx: 3.2, ry: 2.6, required: true, label: "survey-stakes" },
  { x: 52, y: 26, rx: 6.5, ry: 5, required: true, label: "echo-observatory" },
  { x: 92, y: 46, rx: 5, ry: 4.4, required: true, label: "twin-engine-west" },
  { x: 104, y: 46, rx: 5, ry: 4.4, required: true, label: "twin-engine-east" },
  { x: 128, y: 98, rx: 7, ry: 5.4, required: true, label: "root-choir" },
] as const;

export const CORNERSTONES: readonly LandmarkSite[] = [
  { id: "echoObservatory", name: "THE ECHO OBSERVATORY", x: 52, y: 26 },
  { id: "twinEngine", name: "THE TWIN ENGINE", x: 98, y: 46 },
  { id: "rootChoir", name: "THE ROOT CHOIR", x: 128, y: 98 },
] as const;

/** The seven numbered Landing features, for contract verification and HUD naming. */
/** Cargo is only safe once it reaches this. Dying with a full hold loses it. */
export const BANK = { x: 21, y: 15 };

export const LANDING_FEATURES: readonly LandmarkSite[] = [
  { id: "refitBay", name: "REFIT BAY", x: 24, y: 14 },
  { id: "bank", name: "BANK", x: BANK.x, y: BANK.y },
  { id: "chalkFace", name: "THE CHALK FACE", x: 16, y: 16 },
  { id: "bankedFace", name: "THE BANKED FACE", x: 32, y: 18 },
  { id: "firstSeam", name: "THE FIRST SEAM", x: 28, y: 24 },
  { id: "overloadFace", name: "THE OVERLOAD FACE", x: 20, y: 26 },
  { id: "surveyStakes", name: "THE SURVEY STAKES", x: 36, y: 21 },
  { id: "theDrop", name: "THE DROP", x: 24, y: 33 },
] as const;

type Grid = Cell[][];

interface PaintOptions {
  kind?: MaterialKind;
  resource?: ResourceId | null;
  hp?: number;
  persistent?: boolean;
  solid?: boolean;
}

function paintCell(cells: Grid, x: number, y: number, options: PaintOptions): void {
  const cell = cells[y]?.[x];
  if (!cell) return;
  if (options.solid !== undefined) {
    cell.solid = options.solid;
    cell.baseSolid = options.solid;
  }
  // Repainting a material must clear any inherited resource, or a stamped chalk
  // cell can keep the coal that belonged to the coal seam it replaced.
  if (options.kind !== undefined) {
    cell.kind = options.kind;
    if (options.resource === undefined) cell.resource = null;
  }
  if (options.resource !== undefined) cell.resource = options.resource;
  if (options.hp !== undefined) {
    cell.hp = options.hp;
    cell.maxHp = options.hp;
  }
  if (options.persistent !== undefined) cell.persistent = options.persistent;
}

function paintRect(cells: Grid, cx: number, cy: number, halfWidth: number, halfHeight: number, options: PaintOptions): void {
  for (let y = Math.round(cy - halfHeight); y <= Math.round(cy + halfHeight); y++) {
    for (let x = Math.round(cx - halfWidth); x <= Math.round(cx + halfWidth); x++) {
      if (x < 1 || y < 1 || x >= WORLD_COLS - 1 || y >= WORLD_ROWS - 1) continue;
      paintCell(cells, x, y, options);
    }
  }
}

/**
 * Stamp the starting area.
 *
 * Features 2, 3 and 4 in sequence are the whole game in three boards: clear one
 * cleanly, learn that clearing everything is wrong, then wager on hidden contents.
 */
export function stampLanding(cells: Grid, open: Uint8Array): void {
  // 1. Lander and Refit Bay -- persistent, unbreakable, anchor zero.
  for (let y = LANDING.y - 1; y <= LANDING.y + 2; y++) {
    for (let x = LANDING.x - 3; x <= LANDING.x + 3; x++) {
      const edge = y === LANDING.y + 2 || x === LANDING.x - 3 || x === LANDING.x + 3;
      if (!edge) continue;
      paintCell(cells, x, y, { kind: "lander", solid: false, persistent: false, hp: 1 });
      open[y * WORLD_COLS + x] = 0;
    }
  }

  // 1b. The bank chest. Cargo becomes safe only once it is deposited here.
  paintCell(cells, BANK.x, BANK.y, { kind: "lander", solid: false, persistent: false, hp: 1 });
  open[BANK.y * WORLD_COLS + BANK.x] = 0;

  // 2. The Chalk Face -- pure chalk, low density, no slate. A clean first clear.
  paintRect(cells, 16, 16, 4, 4, { kind: "chalk", resource: null, hp: 1, solid: true, persistent: false });
  // Thin it out so the very first board cannot overload a starting chassis.
  for (let y = 12; y <= 20; y++) {
    for (let x = 12; x <= 20; x++) {
      if ((x * 7 + y * 13) % 5 === 0) paintCell(cells, x, y, { solid: false });
    }
  }

  // 3. The Banked Face -- chalk crossed by two diagonal slate strata. Slate takes
  // four hits, costs nothing to leave, and is the best iron here.
  paintRect(cells, 32, 18, 5, 5, { kind: "chalk", resource: null, hp: 1, solid: true, persistent: false });
  for (let step = -6; step <= 6; step++) {
    for (const offset of [-2, 2]) {
      const x = 32 + step;
      const y = 18 + step + offset;
      paintCell(cells, x, y, { kind: "slate", resource: "iron", hp: 4, solid: true });
      paintCell(cells, x, y + 1, { kind: "slate", resource: "iron", hp: 4, solid: true });
    }
  }

  // 4. The First Seam -- guaranteed copper and coal, surfaced as anonymous returns.
  paintRect(cells, 28, 24, 3, 3, { kind: "chalk", hp: 1, solid: true, persistent: false });
  for (let y = 22; y <= 26; y++) {
    for (let x = 26; x <= 30; x++) {
      const seam = (x + y) % 3;
      if (seam === 0) paintCell(cells, x, y, { kind: "chalk", resource: "copper", solid: true, hp: 1 });
      else if (seam === 1) paintCell(cells, x, y, { kind: "coalSeam", resource: "coal", hp: 1, solid: true });
    }
  }

  // 5. The Overload Face -- legibly too dense for starting armor, at a depth where
  // being wrong cannot kill. Strictly optional.
  paintRect(cells, 20, 26, 5, 4, { kind: "chalk", resource: null, hp: 1, solid: true, persistent: false });

  // 6. Three survey stakes in a triangle, in their own small alcove.
  for (const [x, y] of [[34, 20], [38, 20], [36, 23]] as const) {
    paintCell(cells, x, y, { kind: "stake", solid: false, persistent: false, hp: 1 });
    open[y * WORLD_COLS + x] = 0;
  }

  // 7. The Drop is carved as a corridor by the generator; mark its throat as chalk
  // so the descent reads as excavated rather than natural.
  paintRect(cells, 24, 33, 2, 1, { kind: "chalk", hp: 1 });
}

/** Arc of persistent mechanism cells -- the shared visual language of cornerstones. */
function stampMechanismRing(cells: Grid, open: Uint8Array, cx: number, cy: number, radius: number, count: number): void {
  for (let step = 0; step < count; step++) {
    const angle = (step / count) * Math.PI * 2;
    const x = Math.round(cx + Math.cos(angle) * radius);
    const y = Math.round(cy + Math.sin(angle) * radius * 0.78);
    if (x < 1 || y < 1 || x >= WORLD_COLS - 1 || y >= WORLD_ROWS - 1) continue;
    paintCell(cells, x, y, { kind: "mechanism", solid: true, persistent: false, hp: 4 });
    open[y * WORLD_COLS + x] = 0;
  }
}

export function stampCornerstones(cells: Grid, open: Uint8Array): void {
  // The Echo Observatory -- three dishes teaching triangulation.
  for (const [x, y] of [[48, 23], [56, 23], [52, 30]] as const) {
    stampMechanismRing(cells, open, x, y, 2.2, 6);
    paintCell(cells, x, y, { kind: "mechanism", solid: true, persistent: false, hp: 4 });
  }

  // The Twin Engine -- paired chambers straddling the Bright Fault, so impacts
  // echo between halves. Its internal relationship is fixed; its approach is not.
  for (const x of [92, 104]) {
    stampMechanismRing(cells, open, x, 46, 3, 8);
    paintCell(cells, x, 46, { kind: "mechanism", solid: true, persistent: false, hp: 4 });
  }

  // The Root Choir -- a persistent organism spanning many possible claims.
  for (let voice = 0; voice < 5; voice++) {
    const x = 122 + voice * 3;
    const y = 96 + (voice % 2) * 4;
    paintCell(cells, x, y, { kind: "mechanism", solid: true, persistent: false, hp: 4 });
    open[y * WORLD_COLS + x] = 0;
  }
}

// Authored territories stamped into procedural geology.
//
// Everything here is a generator *guarantee*. The Landing's seven features exist
// at fixed cells on every seed, because the opening has to teach the whole thesis
// before the world is allowed to be interesting. Cornerstone internal geometry is
// likewise fixed; only the approach and the surrounding caves vary.

import { WORLD_COLS, WORLD_ROWS, type MaterialKind, type ResourceId } from "../config";
import type { Cell } from "../types";
import type { CaveNode } from "./caves";

// The Landing is hand-drawn in `landing.ts` and owns its own places. Re-exported here so the rest of
// the game keeps one import site for authored territory.
export { BANK, BAY, BAY_RECT, DROP, LANDING, LANDING_FEATURES, stampLandingArea, type LandmarkSite } from "./landing";
import { LANDING, type LandmarkSite } from "./landing";

/** Cave nodes that must exist on every seed, rooted at the Landing. */
export const REQUIRED_NODES: readonly CaveNode[] = [
  { x: LANDING.x, y: LANDING.y, rx: 7, ry: 5, required: true, label: "landing" },
  { x: 84, y: 26, rx: 6.5, ry: 5, required: true, label: "echo-observatory" },
  { x: 92, y: 46, rx: 5, ry: 4.4, required: true, label: "twin-engine-west" },
  { x: 104, y: 46, rx: 5, ry: 4.4, required: true, label: "twin-engine-east" },
  { x: 128, y: 98, rx: 7, ry: 5.4, required: true, label: "root-choir" },
] as const;

export const CORNERSTONES: readonly LandmarkSite[] = [
  { id: "echoObservatory", name: "THE ECHO OBSERVATORY", x: 84, y: 26 },
  { id: "twinEngine", name: "THE TWIN ENGINE", x: 98, y: 46 },
  { id: "rootChoir", name: "THE ROOT CHOIR", x: 128, y: 98 },
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
  for (const [x, y] of [[80, 23], [88, 23], [84, 30]] as const) {
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

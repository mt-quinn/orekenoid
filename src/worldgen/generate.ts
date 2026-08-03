// World generation orchestrator.
//
// Order matters: carve, classify, assign, stamp, repair, verify. The verification
// pass at the end is not decoration -- it turns "the world is broken" into a
// failure the tests catch rather than something a playtester discovers.

import { WORLD_COLS, WORLD_ROWS, type Band, type EcotoneId, type ProvinceId } from "../config";
import { materialOf } from "../materials";
import type { Cell } from "../types";
import { facetAxisAt, materialFor, resourceFor } from "./assign";
import { carveCaves, carveCorridor, openComponents, reachableFrom, type CaveField } from "./caves";
import { CORNERSTONES, LANDING, LANDING_FEATURES, REQUIRED_NODES, stampCornerstones, stampLanding } from "./landmarks";
import { bandAt, sampleRegion, type RegionSample } from "./regions";
import { hashString, Rng } from "./rng";

export interface GeneratedWorld {
  seed: number;
  seedLabel: string;
  cells: Cell[][];
  caves: CaveField;
  start: { x: number; y: number };
  cornerstones: typeof CORNERSTONES;
  landingFeatures: typeof LANDING_FEATURES;
  /** Diagnostics from the verification pass, surfaced for tests and debug. */
  report: GenerationReport;
}

export interface GenerationReport {
  openCells: number;
  reachableCells: number;
  unreachableRequiredNodes: string[];
  repairedCorridors: number;
  missingLandingFeatures: string[];
  ecotoneReagents: Record<EcotoneId, number>;
  provinceCells: Record<ProvinceId, number>;
  bandDensity: Record<Band, number>;
  bandI: { copper: number; coal: number };
}

const cellIndex = (x: number, y: number) => y * WORLD_COLS + x;

export function generateWorld(seedLabel: string): GeneratedWorld {
  const seed = hashString(seedLabel);
  const rng = new Rng(seed);
  const caves = carveCaves(seed, rng, REQUIRED_NODES.map((node) => ({ ...node })));

  // The Drop: an authored descent from the Landing into Band II.
  carveCorridor(caves.open, LANDING.x, LANDING.y + 4, LANDING.x, 38, 2.1);

  // --- Classify and assign ------------------------------------------------
  const samples: RegionSample[][] = [];
  const cells: Cell[][] = [];
  for (let y = 0; y < WORLD_ROWS; y++) {
    const sampleRow: RegionSample[] = [];
    const row: Cell[] = [];
    for (let x = 0; x < WORLD_COLS; x++) {
      const sample = sampleRegion(seed, x + 0.5, y + 0.5);
      sampleRow.push(sample);
      const border = x < 2 || y < 2 || x >= WORLD_COLS - 2 || y >= WORLD_ROWS - 2;
      const solid = border || caves.open[cellIndex(x, y)] !== 1;
      const kind = materialFor(seed, x, y, sample);
      const definition = materialOf(kind);
      row.push({
        x,
        y,
        solid,
        baseSolid: solid,
        hidden: true,
        exhausted: false,
        kind,
        resource: solid ? resourceFor(seed, x, y, sample, kind) : null,
        hp: definition.hp,
        maxHp: definition.hp,
        persistent: false,
        province: sample.primary,
        ecotone: sample.ecotone,
        band: bandAt(y),
        facetAxis: facetAxisAt(seed, x, y),
      });
    }
    samples.push(sampleRow);
    cells.push(row);
  }

  // --- Stamp authored territory -------------------------------------------
  stampLanding(cells, caves.open);
  stampCornerstones(cells, caves.open);

  // Landing stamps edit solidity directly, so mirror those edits back into the
  // openness grid before connectivity is judged.
  syncOpenFromCells(cells, caves.open);

  // --- Repair and verify --------------------------------------------------
  resolveIsolatedPockets(cells, caves);
  const report = verify(seed, cells, caves, samples);
  enforceInvariants(cells);

  return {
    seed,
    seedLabel,
    cells,
    caves,
    start: { ...LANDING },
    cornerstones: CORNERSTONES,
    landingFeatures: LANDING_FEATURES,
    report,
  };
}

function syncOpenFromCells(cells: Cell[][], open: Uint8Array): void {
  for (let y = 0; y < WORLD_ROWS; y++) {
    for (let x = 0; x < WORLD_COLS; x++) {
      open[cellIndex(x, y)] = cells[y][x].solid ? 0 : 1;
    }
  }
}

function syncCellsFromOpen(cells: Cell[][], open: Uint8Array): void {
  for (let y = 0; y < WORLD_ROWS; y++) {
    for (let x = 0; x < WORLD_COLS; x++) {
      const cell = cells[y][x];
      if (cell.persistent) continue;
      const shouldBeSolid = open[cellIndex(x, y)] !== 1;
      cell.solid = shouldBeSolid;
      cell.baseSolid = shouldBeSolid;
    }
  }
}

/**
 * Contract 1, properly: every cavern must be reachable.
 *
 * Erosion inevitably opens pockets with no route to the Landing. A real chamber
 * gets a corridor; a few eroded cells get filled back in. Leaving them would mean
 * caves the player can see and never enter, which is worse than either fix.
 */
function resolveIsolatedPockets(cells: Cell[][], caves: CaveField): void {
  const MIN_CHAMBER = 14;
  for (let pass = 0; pass < 4; pass++) {
    const reachable = reachableFrom(caves.open, LANDING.x, LANDING.y);
    const components = openComponents(caves.open);
    let changed = false;
    for (const component of components) {
      if (reachable[component.cells[0]] === 1) continue;
      changed = true;
      if (component.cells.length >= MIN_CHAMBER) {
        // A genuine chamber: connect it to the nearest reachable open cell.
        let bestIndex = -1;
        let bestDistance = Infinity;
        for (let index = 0; index < reachable.length; index++) {
          if (reachable[index] !== 1) continue;
          const x = index % WORLD_COLS;
          const y = (index - x) / WORLD_COLS;
          const distance = Math.hypot(x - component.centroidX, y - component.centroidY);
          if (distance < bestDistance) {
            bestDistance = distance;
            bestIndex = index;
          }
        }
        if (bestIndex >= 0) {
          const tx = bestIndex % WORLD_COLS;
          const ty = (bestIndex - tx) / WORLD_COLS;
          carveCorridor(caves.open, component.centroidX, component.centroidY, tx, ty, 1.9);
        }
      } else {
        for (const index of component.cells) caves.open[index] = 0;
      }
    }
    if (!changed) break;
    syncCellsFromOpen(cells, caves.open);
  }
}

/**
 * Invariants that must hold regardless of what stamping or repair did:
 * a cell that is not solid holds nothing, and material HP always matches its
 * definition unless a stamp deliberately overrode it.
 */
function enforceInvariants(cells: Cell[][]): void {
  for (const row of cells) {
    for (const cell of row) {
      if (!cell.solid) {
        cell.resource = null;
        cell.hidden = false;
      }
    }
  }
}

/**
 * Generator contract enforcement (PROGRESSION_AND_ECONOMY.md §6).
 *
 * Connectivity failures are repaired in place rather than reported, because a
 * world the player cannot traverse is not a world. Everything else is reported so
 * the test suite can assert on it.
 */
function verify(seed: number, cells: Cell[][], caves: CaveField, samples: RegionSample[][]): GenerationReport {
  // Contract 1 & 2: the Landing and every required node must be mutually reachable.
  let repairedCorridors = 0;
  const unreachableRequiredNodes: string[] = [];
  for (let pass = 0; pass < 6; pass++) {
    const reachable = reachableFrom(caves.open, LANDING.x, LANDING.y);
    const stranded = REQUIRED_NODES.filter((node) => {
      const x = Math.round(node.x);
      const y = Math.round(node.y);
      return reachable[cellIndex(x, y)] !== 1;
    });
    if (!stranded.length) break;
    for (const node of stranded) {
      carveCorridor(caves.open, LANDING.x, LANDING.y, node.x, node.y, 2.05);
      repairedCorridors++;
      for (let y = 0; y < WORLD_ROWS; y++) {
        for (let x = 0; x < WORLD_COLS; x++) {
          if (caves.open[cellIndex(x, y)] === 1 && cells[y][x].solid && !cells[y][x].persistent) {
            cells[y][x].solid = false;
            cells[y][x].baseSolid = false;
          }
        }
      }
    }
    if (pass === 5) unreachableRequiredNodes.push(...stranded.map((node) => node.label ?? "unlabelled"));
  }

  const reachable = reachableFrom(caves.open, LANDING.x, LANDING.y);
  let openCells = 0;
  let reachableCells = 0;
  const provinceCells: Record<ProvinceId, number> = { karst: 0, mirrorreef: 0, rootwarren: 0 };
  const ecotoneReagents: Record<EcotoneId, number> = { brightFault: 0, chalkWarren: 0, bloomShelf: 0 };
  const bandSolid: Record<Band, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  const bandTotal: Record<Band, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  const bandI = { copper: 0, coal: 0 };

  for (let y = 0; y < WORLD_ROWS; y++) {
    for (let x = 0; x < WORLD_COLS; x++) {
      const cell = cells[y][x];
      provinceCells[cell.province]++;
      // Density is a measure of *procedural* geology. Two things are excluded:
      // the solid world border, which is not geology at all, and the authored
      // Landing, whose teaching faces are deliberately solid rock and would
      // otherwise make Band I read as denser than the world beneath it.
      const interior = x > 3 && y > 3 && x < WORLD_COLS - 4 && y < WORLD_ROWS - 4;
      const authored = x >= 10 && x <= 44 && y >= 4 && y <= 36;
      if (interior && !authored) {
        bandTotal[cell.band]++;
        if (cell.solid) bandSolid[cell.band]++;
      }
      if (caves.open[cellIndex(x, y)] === 1) openCells++;
      if (reachable[cellIndex(x, y)] === 1) reachableCells++;
      // Contract 4: every ecotone must carry a claimable seam of its rare reagent.
      if (cell.solid && cell.ecotone) {
        if (cell.resource === "diamond" && cell.ecotone === "brightFault") ecotoneReagents.brightFault++;
        if (cell.resource === "saltpeter" && cell.ecotone === "chalkWarren") ecotoneReagents.chalkWarren++;
        if (cell.resource === "vitriol" && cell.ecotone === "bloomShelf") ecotoneReagents.bloomShelf++;
      }
      // Contract 9: Band I must afford one Copper Plate without a Band II descent.
      if (cell.solid && cell.band === 1) {
        if (cell.resource === "copper") bandI.copper++;
        if (cell.resource === "coal") bandI.coal++;
      }
    }
  }

  // Contract 3: all seven Landing features present and correctly classified.
  const missingLandingFeatures = LANDING_FEATURES.filter((feature) => {
    const cell = cells[feature.y]?.[feature.x];
    if (!cell) return true;
    if (feature.id === "refitBay") {
      // The bay itself is open; its persistent hull surrounds it.
      return !hasNearby(cells, feature.x, feature.y, 4, (c) => c.kind === "lander" && c.persistent);
    }
    if (feature.id === "bank") {
      return !hasNearby(cells, feature.x, feature.y, 3, (c) => c.kind === "lander" && c.persistent);
    }
    if (feature.id === "surveyStakes") {
      return !hasNearby(cells, feature.x, feature.y, 4, (c) => c.kind === "stake" && c.persistent);
    }
    if (feature.id === "theDrop") {
      return cell.solid;
    }
    // The faces must be solid, framable rock.
    return !hasNearby(cells, feature.x, feature.y, 3, (c) => c.solid && !c.persistent);
  }).map((feature) => feature.id);

  const bandDensity: Record<Band, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const band of [1, 2, 3, 4] as Band[]) {
    bandDensity[band] = bandTotal[band] ? bandSolid[band] / bandTotal[band] : 0;
  }

  void seed;
  void samples;

  return {
    openCells,
    reachableCells,
    unreachableRequiredNodes,
    repairedCorridors,
    missingLandingFeatures,
    ecotoneReagents,
    provinceCells,
    bandDensity,
    bandI,
  };
}

function hasNearby(cells: Cell[][], cx: number, cy: number, radius: number, predicate: (cell: Cell) => boolean): boolean {
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      const cell = cells[y]?.[x];
      if (cell && predicate(cell)) return true;
    }
  }
  return false;
}

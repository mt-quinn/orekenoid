// World generation orchestrator.
//
// Order matters: carve, classify, assign, stamp, repair, verify. The verification
// pass at the end is not decoration -- it turns "the world is broken" into a
// failure the tests catch rather than something a playtester discovers.

import { WORLD_COLS, WORLD_ROWS, type Band, type EcotoneId, type ProvinceId } from "../config";
import { materialOf } from "../materials";
import type { Cell } from "../types";
import { facetAxisAt, materialFor, resourceFor } from "./assign";
import { carveCaves, carveCorridor, openComponents, type CaveField, type OpenComponent } from "./caves";
import { CORNERSTONES, LANDING, LANDING_FEATURES, REQUIRED_NODES, stampCornerstones, stampLanding } from "./landmarks";
import { bandAt, sampleRegion, type RegionSample } from "./regions";
import { hashString, Rng } from "./rng";
import { stampRooms, type RoomStampReport } from "./rooms";
import { StructureMap } from "./structureMap";

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
  /** Which authored rooms landed where, and the features they placed. */
  rooms: RoomStampReport;
}

export interface GenerationReport {
  openCells: number;
  /** The largest connected body of open space: the mine proper. */
  networkCells: number;
  /**
   * Open cells the Landing can walk to without breaking anything.
   *
   * Small on purpose -- the start is sealed by its five teaching faces. Reported separately so
   * that seal can never again be mistaken for a connectivity failure.
   */
  startPocketCells: number;
  /** Open cells in neither: caves the player can see and never enter. */
  strandedCells: number;
  /** Breakable solid cells touching the start pocket -- the ways out of the Landing. */
  landingExits: number;
  unreachableRequiredNodes: string[];
  repairedCorridors: number;
  missingLandingFeatures: string[];
  ecotoneReagents: Record<EcotoneId, number>;
  provinceCells: Record<ProvinceId, number>;
  bandDensity: Record<Band, number>;
  bandI: { copper: number; coal: number };
  /** Rooms stamped, and features placed by their markers. */
  roomsPlaced: number;
  featuresPlaced: number;
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
        worked: false,
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

  // --- Density contract ---------------------------------------------------
  // Measured here, before anything is stamped, because the contract is a statement
  // about the *procedural* generator: rock must get denser with depth. Measuring it at
  // the end meant every authored thing perturbed it -- which is why the old code had to
  // exclude the Landing with a hardcoded rectangle, and why a hall carving 648 cells out
  // of a shallow band could invert two adjacent bands by less than a percent. Taken here
  // the number means exactly what it claims, and nothing downstream can launder it.
  const bandDensity = measureBandDensity(cells);

  // --- Stamp authored territory -------------------------------------------
  stampLanding(cells, caves.open);
  stampCornerstones(cells, caves.open);

  // --- Stamp rooms --------------------------------------------------------
  // After authored territory, so the Landing and the cornerstones can reserve their
  // ground first and no room can ever land on a guaranteed teaching feature. Before
  // the repair passes, so a room that pinches a route shut gets reconnected rather
  // than orphaning part of the world.
  const structures = new StructureMap();
  structures.reserve({ x: LANDING.x - 18, y: LANDING.y - 14, width: 40, height: 32 });
  for (const site of CORNERSTONES) {
    structures.reserve({ x: site.x - 12, y: site.y - 10, width: 24, height: 20 });
  }
  const rooms = stampRooms(cells, seed, samples, rng, structures, (x, y) => ({
    province: cells[y]?.[x]?.province ?? "karst",
    ecotone: cells[y]?.[x]?.ecotone ?? null,
  }));

  // Landing, cornerstone and room stamps all edit solidity directly, so mirror those
  // edits back into the openness grid before connectivity is judged.
  syncOpenFromCells(cells, caves.open);

  // --- Repair and verify --------------------------------------------------
  // Buried room contents are protected from the repair passes below, which are free to
  // carve anywhere they need to and would otherwise open a seam or a cache and hand the
  // player its reward for nothing.
  const protectedCells = new Set<number>();
  for (const feature of rooms.features) {
    if (feature.marker !== "seam" && feature.marker !== "cache") continue;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const x = feature.x + ox;
        const y = feature.y + oy;
        if (x < 0 || y < 0 || x >= WORLD_COLS || y >= WORLD_ROWS) continue;
        if (cells[y][x].resource) protectedCells.add(cellIndex(x, y));
      }
    }
  }

  resolveIsolatedPockets(cells, caves, protectedCells, seed);

  // Re-assert authored territory, *before* verification.
  //
  // Both repair passes carve corridors wherever they need to, and `syncCellsFromOpen`
  // then applies that openness to every non-persistent cell -- so a repair route can pass
  // straight through the Landing's teaching faces and quietly hollow them out. Reserving
  // ground against *room placement* does not help, because the damage comes from repair
  // rather than from stamping. Stamping is idempotent, so the fix is to stamp again.
  //
  // The ordering matters and cost me a false pass: doing this *after* `verify` fixed the
  // world but left the report describing the damaged one, so `missingLandingFeatures`
  // named a feature that was present by the time anyone could look at it. Verification
  // has to run on the world that ships.
  stampLanding(cells, caves.open);
  stampCornerstones(cells, caves.open);
  // And mirror it into the openness grid. The stamps write cell solidity but only touch
  // `open` for the lander hull, so without this the two disagree -- and verification's
  // corridor repair, which trusts `open`, un-solidifies the very teaching faces that were
  // just restored. That is what made the Banked Face vanish once enough rooms placed to
  // trigger repairs regularly.
  syncOpenFromCells(cells, caves.open);

  const report = verify(seed, cells, caves, samples, protectedCells, bandDensity);

  // Verification's own corridor repair can carve as well, on the rare seed where a
  // required node is unreachable. Idempotent, so simply assert the authored ground again.
  stampLanding(cells, caves.open);
  stampCornerstones(cells, caves.open);

  enforceInvariants(cells);

  // Mirror the final re-stamp into the openness grid, so the world that ships has `cells` and
  // `caves.open` agreeing. Without this they differed by ninety cells.
  syncOpenFromCells(cells, caves.open);

  // Connectivity is measured *last*, on the world that ships.
  //
  // Taking it inside `verify` is what let the report claim 20,474 of 20,490 cells reachable
  // while the shipped world had 262: verification's own repair carved an escape route out of
  // the Landing, the re-stamp immediately after put the teaching faces back, and the number
  // described the moment in between. The same mistake as `missingLandingFeatures`, which had
  // already been fixed once by moving verification earlier -- and left standing here.
  measureConnectivity(cells, report);

  report.roomsPlaced = rooms.placed.length;
  report.featuresPlaced = rooms.features.length;

  return {
    seed,
    seedLabel,
    cells,
    caves,
    start: { ...LANDING },
    cornerstones: CORNERSTONES,
    landingFeatures: LANDING_FEATURES,
    report,
    rooms,
  };
}

/**
 * Connectivity, taken from `cells` on the finished world.
 *
 * From `cells` rather than `caves.open` deliberately: solidity is what the drone's hull tests
 * and therefore what the player actually meets, so it is the only honest source for a claim
 * about where they can go.
 */
function measureConnectivity(cells: Cell[][], report: GenerationReport): void {
  const open = new Uint8Array(WORLD_COLS * WORLD_ROWS);
  let openCells = 0;
  for (let y = 0; y < WORLD_ROWS; y++) {
    for (let x = 0; x < WORLD_COLS; x++) {
      if (cells[y][x].solid) continue;
      open[cellIndex(x, y)] = 1;
      openCells++;
    }
  }
  const { network, startPocket } = surveyOpenSpace(open);
  const networkCells = network?.cells.length ?? 0;
  const startPocketCells = startPocket === network ? 0 : startPocket?.cells.length ?? 0;

  // The ways out of the Landing. A start pocket walled entirely in persistent material would
  // make an expedition unwinnable from the first frame, and nothing else would notice.
  let landingExits = 0;
  for (const index of startPocket === network ? [] : startPocket?.cells ?? []) {
    const x = index % WORLD_COLS;
    const y = (index - x) / WORLD_COLS;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= WORLD_COLS || ny >= WORLD_ROWS) continue;
      const neighbour = cells[ny][nx];
      if (neighbour.solid && !neighbour.persistent) landingExits++;
    }
  }

  report.openCells = openCells;
  report.networkCells = networkCells;
  report.startPocketCells = startPocketCells;
  report.strandedCells = openCells - networkCells - startPocketCells;
  report.landingExits = landingExits;
}

/**
 * Solid fraction per depth band, over procedural geology only.
 *
 * The two-cell world border is excluded because it is not geology at all -- it is a
 * frame, and counting it makes every band read denser than it is.
 */
function measureBandDensity(cells: Cell[][]): Record<Band, number> {
  const solid: Record<Band, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  const total: Record<Band, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (let y = 4; y < WORLD_ROWS - 4; y++) {
    for (let x = 4; x < WORLD_COLS - 4; x++) {
      const cell = cells[y][x];
      total[cell.band]++;
      if (cell.solid) solid[cell.band]++;
    }
  }
  const density: Record<Band, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const band of [1, 2, 3, 4] as Band[]) density[band] = total[band] ? solid[band] / total[band] : 0;
  return density;
}

function syncOpenFromCells(cells: Cell[][], open: Uint8Array): void {
  for (let y = 0; y < WORLD_ROWS; y++) {
    for (let x = 0; x < WORLD_COLS; x++) {
      open[cellIndex(x, y)] = cells[y][x].solid ? 0 : 1;
    }
  }
}

/**
 * Apply the openness grid back onto the cells.
 *
 * `protected` cells are left alone. They hold room contents -- a buried seam, a cache
 * -- and a repair corridor routed straight through one would delete the reward the
 * room exists to offer. Leaving them solid can plug a repaired corridor with a few
 * cells of mineable rock, which is a cost the design already accepts elsewhere: the
 * carve deliberately seals fourteen tubes with 3x3 plugs for exactly this reason, so
 * that progress sometimes requires committing a claim rather than walking around.
 */
function syncCellsFromOpen(cells: Cell[][], open: Uint8Array, protectedCells: ReadonlySet<number>): void {
  for (let y = 0; y < WORLD_ROWS; y++) {
    for (let x = 0; x < WORLD_COLS; x++) {
      const cell = cells[y][x];
      if (cell.persistent) continue;
      const index = cellIndex(x, y);
      if (protectedCells.has(index)) continue;
      const shouldBeSolid = open[index] !== 1;
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
function resolveIsolatedPockets(
  cells: Cell[][], caves: CaveField, protectedCells: ReadonlySet<number>, seed: number,
): void {
  const MIN_CHAMBER = 14;
  for (let pass = 0; pass < 4; pass++) {
    const { components, network, startPocket, networkMask } = surveyOpenSpace(caves.open);
    if (!network) break;
    let changed = false;
    for (const component of components) {
      if (component === network) continue;
      // The Landing's pocket is sealed on purpose. Connecting it would carve away the tutorial
      // and, because it sits in one corner, would do it with a corridor spanning the world.
      if (component === startPocket) continue;
      changed = true;
      if (component.cells.length >= MIN_CHAMBER) {
        // A genuine chamber: joined to the *network*, at its nearest point, so the corridor is
        // as short as the geometry allows instead of being aimed at a fixed address.
        const target = nearestInMask(networkMask, component.centroidX, component.centroidY);
        if (target) {
          carveCorridor(
            caves.open, component.centroidX, component.centroidY, target.x, target.y, 1.9,
            seed + pass * 131 + component.cells[0],
          );
        }
      } else {
        for (const index of component.cells) caves.open[index] = 0;
      }
    }
    if (!changed) break;
    syncCellsFromOpen(cells, caves.open, protectedCells);
  }
}

/**
 * The bodies of open space, with the two that matter named.
 *
 * `network` is the mine proper: the largest connected body. `startPocket` is whatever the
 * Landing can walk to without breaking anything, which is deliberately sealed by the five
 * teaching faces -- the first lesson *is* to break the Chalk Face.
 *
 * Both repair passes used to measure against `reachableFrom(LANDING)` instead, and on any seed
 * where that seal held it was a catastrophe rather than a nuisance: with the Landing sealed,
 * the entire 16,000-cell cave network read as an isolated pocket, so the repair carved a
 * 113-cell corridor from the middle of the world to the front door -- and did the same for
 * every other component, producing a fan of twenty ruler-straight hallways converging on one
 * corner of the map. That is what made worlds look pre-mined, and why it only showed on the
 * seeds where erosion happened not to breach the Landing.
 */
function surveyOpenSpace(open: Uint8Array): {
  components: OpenComponent[];
  network: OpenComponent | null;
  startPocket: OpenComponent | null;
  networkMask: Uint8Array;
} {
  const components = openComponents(open);
  const landingAt = cellIndex(LANDING.x, LANDING.y);
  let network: OpenComponent | null = null;
  let startPocket: OpenComponent | null = null;
  for (const component of components) {
    if (!network || component.cells.length > network.cells.length) network = component;
    if (!startPocket && component.cells.includes(landingAt)) startPocket = component;
  }
  const networkMask = new Uint8Array(WORLD_COLS * WORLD_ROWS);
  for (const index of network?.cells ?? []) networkMask[index] = 1;
  return { components, network, startPocket, networkMask };
}

/** The masked cell closest to a point, for routing a repair from somewhere sensible. */
function nearestInMask(mask: Uint8Array, fromX: number, fromY: number): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bestDistance = Infinity;
  for (let index = 0; index < mask.length; index++) {
    if (mask[index] !== 1) continue;
    const x = index % WORLD_COLS;
    const y = (index - x) / WORLD_COLS;
    const distance = Math.hypot(x - fromX, y - fromY);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { x, y };
    }
  }
  return best;
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
function verify(
  seed: number,
  cells: Cell[][],
  caves: CaveField,
  samples: RegionSample[][],
  protectedCells: ReadonlySet<number>,
  bandDensity: Record<Band, number>,
): GenerationReport {
  // Contract 1 & 2: every required node must be somewhere the player can get to -- either in
  // the cave network, or inside the Landing's own sealed pocket, which they start in.
  //
  // Measured against those two bodies rather than against `reachableFrom(LANDING)`. The old
  // test called every required node stranded on any seed whose Landing seal held, and then
  // carved a corridor to each one *from the Landing*, all on pass 0, before anything had
  // actually gone wrong. Five straight lines radiating from one corner of the map.
  let repairedCorridors = 0;
  const unreachableRequiredNodes: string[] = [];
  for (let pass = 0; pass < 6; pass++) {
    const { startPocket, networkMask } = surveyOpenSpace(caves.open);
    const inStartPocket = new Uint8Array(WORLD_COLS * WORLD_ROWS);
    for (const index of startPocket?.cells ?? []) inStartPocket[index] = 1;
    const stranded = REQUIRED_NODES.filter((node) => {
      const at = cellIndex(Math.round(node.x), Math.round(node.y));
      return networkMask[at] !== 1 && inStartPocket[at] !== 1;
    });
    if (!stranded.length) break;
    for (const node of stranded) {
      // From the nearest point on the network, not from the Landing.
      const from = nearestInMask(networkMask, node.x, node.y) ?? { x: LANDING.x, y: LANDING.y };
      carveCorridor(caves.open, from.x, from.y, node.x, node.y, 2.05, seed + pass * 977 + repairedCorridors);
      repairedCorridors++;
      for (let y = 0; y < WORLD_ROWS; y++) {
        for (let x = 0; x < WORLD_COLS; x++) {
          if (protectedCells.has(cellIndex(x, y))) continue;
          if (caves.open[cellIndex(x, y)] === 1 && cells[y][x].solid && !cells[y][x].persistent) {
            cells[y][x].solid = false;
            cells[y][x].baseSolid = false;
          }
        }
      }
    }
    if (pass === 5) unreachableRequiredNodes.push(...stranded.map((node) => node.label ?? "unlabelled"));
  }

  let openCells = 0;
  const provinceCells: Record<ProvinceId, number> = { karst: 0, mirrorreef: 0, rootwarren: 0 };
  const ecotoneReagents: Record<EcotoneId, number> = { brightFault: 0, chalkWarren: 0, bloomShelf: 0 };
  const bandI = { copper: 0, coal: 0 };

  for (let y = 0; y < WORLD_ROWS; y++) {
    for (let x = 0; x < WORLD_COLS; x++) {
      const cell = cells[y][x];
      provinceCells[cell.province]++;
      if (caves.open[cellIndex(x, y)] === 1) openCells++;
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

  void seed;
  void samples;

  return {
    // The connectivity numbers are placeholders here and are overwritten by
    // `measureConnectivity` after the final re-stamp. Measuring them in this function is what
    // made the old report describe a world that never shipped.
    openCells,
    networkCells: 0,
    startPocketCells: 0,
    strandedCells: 0,
    landingExits: 0,
    unreachableRequiredNodes,
    repairedCorridors,
    missingLandingFeatures,
    ecotoneReagents,
    provinceCells,
    bandDensity,
    bandI,
    // Filled in by the caller: rooms are stamped before verification runs, but the
    // counts belong in the same report the contract tests read.
    roomsPlaced: 0,
    featuresPlaced: 0,
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

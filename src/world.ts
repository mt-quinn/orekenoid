import { CELL, WORLD_COLS, WORLD_ROWS, DEFAULT_SEED, type EcotoneId, type MaterialKind, type ProvinceId } from "./config";
import { materialOf } from "./materials";
import type { Cell, FrameGeometry, OrientedFootprint, Vec2 } from "./types";
import { generateWorld, type GeneratedWorld } from "./worldgen/generate";
import { BAND_NAMES, bandAt, dialsFor, ECOTONE_NAMES, PROVINCE_NAMES, sampleRegion, type Dials } from "./worldgen/regions";
import { sfbm } from "./worldgen/rng";

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/**
 * Which source cell gives a remeshed brick its identity.
 *
 * Persistent structure outranks everything, then resource-bearing rock, then
 * rule-active material, then plain host rock. This means a claim never silently
 * loses a landmark or a seam to a coverage tie.
 */
function identityPriority(cell: Cell): number {
  const definition = materialOf(cell.kind);
  if (definition.persistent) return 6;
  if (cell.resource) return 4;
  if (definition.reflect === "facet" || definition.regrows || definition.spawnsMembrane) return 3;
  if (!definition.liable) return 2;
  return definition.hp > 1 ? 1 : 0;
}

export interface FramedBrick {
  cell: Cell;
  sourceCells: Cell[];
  u: number;
  v: number;
  footprint: OrientedFootprint;
  persistent: boolean;
}

/**
 * An ordered log of every mutation applied to the generated world.
 *
 * Geology is a pure function of the seed, so a save does not store terrain -- it
 * stores this log and replays it. Keys are terse because a long expedition
 * produces thousands of cuts and the whole log goes into one save file.
 */
export type WorldEdit =
  | {
    /** A cut: one oriented footprint removed from the rock. */
    t: "cut";
    x: number;
    y: number;
    hw: number;
    hh: number;
    a: number;
    /** 1 when the cut exhausted the resources it covered. */
    e?: 1;
    /** 1 when the cut was allowed to break persistent structure. */
    p?: 1;
  }
  | {
    /** Bounded Rootwarren regrowth restoring a cell to solid. */
    t: "grow";
    x: number;
    y: number;
    k: MaterialKind;
  };

export interface SurveyReading {
  province: ProvinceId;
  ecotone: EcotoneId | null;
  band: number;
  provinceName: string;
  regionName: string;
  bandName: string;
  depthMetres: number;
  dials: Dials;
}

export class WorldModel {
  readonly generated: GeneratedWorld;
  readonly cells: Cell[][];
  readonly cuts: OrientedFootprint[] = [];
  private readonly cutsByCell = new Map<string, OrientedFootprint[]>();
  /** Listeners notified when a cut changes terrain, so rendering can stay incremental. */
  private readonly cutListeners: Array<(footprint: OrientedFootprint) => void> = [];
  readonly start: { x: number; y: number };
  /**
   * Ordered mutation log. Replaying this over a freshly generated world of the
   * same seed reproduces the exact world state, which is what a save file holds.
   */
  readonly history: WorldEdit[] = [];
  /** Suppressed while a save is being replayed, so replay does not re-log itself. */
  private recording = true;
  /** One bit per cell: has the player ever seen this cell? Drives the map's fog. */
  readonly discovered = new Uint8Array(WORLD_COLS * WORLD_ROWS);
  discoveredCount = 0;

  constructor(seedLabel: string = DEFAULT_SEED) {
    this.generated = generateWorld(seedLabel);
    this.cells = this.generated.cells;
    this.start = this.generated.start;
  }

  // --- Discovery ----------------------------------------------------------

  isDiscovered(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= WORLD_COLS || y >= WORLD_ROWS) return false;
    return this.discovered[Math.floor(y) * WORLD_COLS + Math.floor(x)] === 1;
  }

  /**
   * Reveal a disc of cells around a point. Called from the drone each frame, so
   * the map records where the player has actually been rather than what the
   * generator produced.
   */
  markDiscovered(cx: number, cy: number, radius: number): number {
    let added = 0;
    const minX = Math.max(0, Math.floor(cx - radius));
    const maxX = Math.min(WORLD_COLS - 1, Math.ceil(cx + radius));
    const minY = Math.max(0, Math.floor(cy - radius));
    const maxY = Math.min(WORLD_ROWS - 1, Math.ceil(cy + radius));
    const limit = radius * radius;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        if (dx * dx + dy * dy > limit) continue;
        const index = y * WORLD_COLS + x;
        if (this.discovered[index] === 1) continue;
        this.discovered[index] = 1;
        added++;
      }
    }
    this.discoveredCount += added;
    return added;
  }

  // --- Mutation replay ----------------------------------------------------

  /**
   * Replay a saved mutation log. Terrain listeners still fire, so whatever
   * rendering is attached rebuilds itself exactly as it would have during play.
   */
  applyHistory(edits: readonly WorldEdit[]): void {
    this.recording = false;
    try {
      for (const edit of edits) {
        if (edit.t === "cut") {
          this.removeFootprint(
            { center: { x: edit.x, y: edit.y }, halfWidth: edit.hw, halfHeight: edit.hh, angle: edit.a },
            edit.e === 1,
            edit.p === 1,
          );
        } else {
          this.restoreCell(edit.x, edit.y, edit.k);
        }
      }
    } finally {
      this.recording = true;
    }
    this.history.push(...edits);
  }

  get seedLabel(): string {
    return this.generated.seedLabel;
  }

  onCut(listener: (footprint: OrientedFootprint) => void): void {
    this.cutListeners.push(listener);
  }

  // --- Region queries -----------------------------------------------------

  provinceAt(x: number, y: number): ProvinceId {
    return this.cellAt(x, y)?.province ?? sampleRegion(this.generated.seed, x, y).primary;
  }

  ecotoneAt(x: number, y: number): EcotoneId | null {
    return this.cellAt(x, y)?.ecotone ?? null;
  }

  /** Coarse survey reading. Never reveals contents -- only the three dials. */
  readRegion(x: number, y: number): SurveyReading {
    const sample = sampleRegion(this.generated.seed, x, y);
    const band = bandAt(y);
    return {
      province: sample.primary,
      ecotone: sample.ecotone,
      band,
      provinceName: PROVINCE_NAMES[sample.primary],
      regionName: sample.ecotone ? ECOTONE_NAMES[sample.ecotone] : PROVINCE_NAMES[sample.primary],
      bandName: BAND_NAMES[band],
      depthMetres: sample.depthMetres,
      dials: dialsFor(sample),
    };
  }

  cellAt(x: number, y: number): Cell | undefined {
    return this.cells[Math.floor(y)]?.[Math.floor(x)];
  }

  // --- Solidity and persistent cuts --------------------------------------

  private pointInFootprint(x: number, y: number, footprint: OrientedFootprint): boolean {
    const dx = x - footprint.center.x;
    const dy = y - footprint.center.y;
    const cosine = Math.cos(footprint.angle);
    const sine = Math.sin(footprint.angle);
    const u = dx * cosine + dy * sine;
    const v = dx * sine - dy * cosine;
    return Math.abs(u) <= footprint.halfWidth + 1e-7 && Math.abs(v) <= footprint.halfHeight + 1e-7;
  }

  solidAt(x: number, y: number): boolean {
    const cell = this.cellAt(x, y);
    if (!cell?.solid) return false;
    if (cell.persistent) return true;
    const cuts = this.cutsByCell.get(`${Math.floor(x)},${Math.floor(y)}`);
    return !cuts?.some((cut) => this.pointInFootprint(x, y, cut));
  }

  private cellSolidity(cx: number, cy: number): number {
    const cell = this.cells[cy]?.[cx];
    if (!cell) return 1;
    if (cell.persistent) return 1;
    return cell.baseSolid ? 1 : 0;
  }

  /**
   * Solidity for rendering only.
   *
   * Gameplay solidity is exact per cell, which is correct for collision and
   * remeshing but renders as hard stair-stepped blocks. Natural rock is therefore
   * drawn from a bilinear reconstruction of the cell grid plus a little coherent
   * noise, giving organic cavity boundaries -- while excavated cuts are applied
   * exactly, so a machined edge stays crisp against weathered stone. That contrast
   * is deliberate: the player should be able to tell excavation from geology.
   */
  visualSolidAt(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= WORLD_COLS || y >= WORLD_ROWS) return false;
    const cell = this.cellAt(x, y);
    if (cell?.persistent) return true;

    const fx = x - 0.5;
    const fy = y - 0.5;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const field = this.cellSolidity(x0, y0) * (1 - tx) * (1 - ty)
      + this.cellSolidity(x0 + 1, y0) * tx * (1 - ty)
      + this.cellSolidity(x0, y0 + 1) * (1 - tx) * ty
      + this.cellSolidity(x0 + 1, y0 + 1) * tx * ty;
    // Kept modest on purpose: a larger amplitude makes the boundary noisy enough
    // that edge-lighting samples straddle it and smear into soft clouds.
    const wobble = sfbm(this.generated.seed + 8821, x * 1.15, y * 1.15, 3) * 0.1;
    if (field + wobble <= 0.5) return false;

    const cuts = this.cutsByCell.get(`${Math.floor(x)},${Math.floor(y)}`);
    return !cuts?.some((cut) => this.pointInFootprint(x, y, cut));
  }

  /**
   * Is an oriented rectangle clear of rock?
   *
   * This is the drone's real hull test. It replaced a fixed 24-pixel square, which
   * was 0.57 cells across against a machine drawn 3.7 cells wide -- so the drone
   * clipped visibly through rock and, worse, *no passage in the world could ever
   * constrain it*. With an honest oriented hull, heading becomes a traversal tool:
   * a drone turned broadside needs nearly four cells, the same drone turned edge-on
   * needs half of one, and the player has to decide which way to face to get
   * through. That is the same key that aims the survey frame, so squeezing through a
   * gap and choosing where to claim are the same act.
   *
   * Extents are in cells, measured along the hull's own axes: `halfLength` runs
   * along the machine's long axis (the direction its paddle face spans), and
   * `halfThickness` across it.
   */
  isHullOpen(x: number, y: number, heading: number, halfLength: number, halfThickness: number): boolean {
    // The hull's long axis in world space. This matches the drone's drawn rotation
    // and `FrameGeometry`'s `side` vector, so the hitbox and the survey frame agree.
    const alongX = Math.cos(heading);
    const alongY = Math.sin(heading);
    const acrossX = -alongY;
    const acrossY = alongX;

    // Sample at strictly under one cell so a one-cell wall can never be tunnelled.
    // Endpoints are always included, so the extremities are tested exactly.
    const steps = (extent: number) => Math.max(1, Math.ceil((extent * 2) / 0.4));
    const lengthSteps = steps(halfLength);
    const thicknessSteps = steps(halfThickness);

    for (let i = 0; i <= lengthSteps; i++) {
      const along = -halfLength + (i / lengthSteps) * halfLength * 2;
      for (let j = 0; j <= thicknessSteps; j++) {
        const across = -halfThickness + (j / thicknessSteps) * halfThickness * 2;
        const cellX = x / CELL + alongX * along + acrossX * across;
        const cellY = y / CELL + alongY * along + acrossY * across;
        if (this.solidAt(cellX, cellY)) return false;
      }
    }
    return true;
  }

  removeCell(x: number, y: number, exhausted = false): void {
    const cell = this.cells[y]?.[x];
    if (!cell || (cell.persistent && cell.solid)) return;
    this.removeFootprint({ center: { x: x + 0.5, y: y + 0.5 }, halfWidth: 0.5, halfHeight: 0.5, angle: 0 }, exhausted);
  }

  // --- Frame transforms ---------------------------------------------------

  localToWorld(u: number, v: number, frame: FrameGeometry): Vec2 {
    const side = { x: Math.cos(frame.angle), y: Math.sin(frame.angle) };
    const direction = { x: Math.sin(frame.angle), y: -Math.cos(frame.angle) };
    return { x: frame.origin.x + side.x * u + direction.x * v, y: frame.origin.y + side.y * u + direction.y * v };
  }

  worldToLocal(x: number, y: number, frame: FrameGeometry): Vec2 {
    const dx = x - frame.origin.x;
    const dy = y - frame.origin.y;
    return {
      x: dx * Math.cos(frame.angle) + dy * Math.sin(frame.angle),
      y: dx * Math.sin(frame.angle) - dy * Math.cos(frame.angle),
    };
  }

  /**
   * Coverage-sample the framed world into a clean paddle-local brick lattice.
   * Every generated brick faces flat toward the paddle while retaining its exact
   * oriented world footprint, so excavation persists at any heading.
   */
  framedBricks(frame: FrameGeometry): FramedBrick[] {
    const result: FramedBrick[] = [];
    for (let row = 0; row < frame.depth; row++) for (let column = 0; column < frame.width; column++) {
      const u = -frame.width / 2 + 0.5 + column;
      const v = 0.5 + row;
      const footprint: OrientedFootprint = { center: this.localToWorld(u, v, frame), halfWidth: 0.5, halfHeight: 0.5, angle: frame.angle };
      const counts = new Map<Cell, number>();
      let solidSamples = 0;
      for (let sy = 0; sy < 5; sy++) for (let sx = 0; sx < 5; sx++) {
        const point = this.localToWorld(u + (sx - 2) * 0.2, v + (sy - 2) * 0.2, frame);
        if (!this.solidAt(point.x, point.y)) continue;
        solidSamples++;
        const cell = this.cellAt(point.x, point.y);
        if (cell) counts.set(cell, (counts.get(cell) ?? 0) + 1);
      }
      if (solidSamples < 7) continue;
      const sourceCells = [...counts.keys()];
      const minX = Math.max(0, Math.floor(footprint.center.x - 1));
      const maxX = Math.min(WORLD_COLS - 1, Math.floor(footprint.center.x + 1));
      const minY = Math.max(0, Math.floor(footprint.center.y - 1));
      const maxY = Math.min(WORLD_ROWS - 1, Math.floor(footprint.center.y + 1));
      for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
        const cell = this.cells[y][x];
        const local = this.worldToLocal(x + 0.5, y + 0.5, frame);
        if (Math.abs(local.x - u) <= 0.5 && Math.abs(local.y - v) <= 0.5 && this.solidAt(x + 0.5, y + 0.5) && !sourceCells.includes(cell)) sourceCells.push(cell);
      }
      let cell = sourceCells[0] ?? this.cellAt(footprint.center.x, footprint.center.y);
      for (const candidate of sourceCells) {
        if (!cell) { cell = candidate; continue; }
        const candidateRank = identityPriority(candidate);
        const currentRank = identityPriority(cell);
        if (candidateRank > currentRank || (candidateRank === currentRank && (counts.get(candidate) ?? 0) > (counts.get(cell) ?? 0))) cell = candidate;
      }
      if (!cell) continue;
      result.push({ cell, sourceCells, u, v, footprint, persistent: sourceCells.some((source) => source.persistent) });
    }
    return result;
  }

  /** Anonymous returns: resource locations inside the frame, identity withheld. */
  surveyedItems(frame: FrameGeometry): Cell[] {
    const result: Cell[] = [];
    const half = frame.width / 2;
    // Only sweep the frame's world-space bounding box rather than the whole world.
    const corners = [[-half, 0], [half, 0], [half, frame.depth], [-half, frame.depth]]
      .map(([u, v]) => this.localToWorld(u, v, frame));
    const minX = Math.max(0, Math.floor(Math.min(...corners.map((point) => point.x))));
    const maxX = Math.min(WORLD_COLS - 1, Math.ceil(Math.max(...corners.map((point) => point.x))));
    const minY = Math.max(0, Math.floor(Math.min(...corners.map((point) => point.y))));
    const maxY = Math.min(WORLD_ROWS - 1, Math.ceil(Math.max(...corners.map((point) => point.y))));
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const cell = this.cells[y][x];
      if (!cell.hidden || cell.exhausted || !cell.resource || !this.solidAt(cell.x + 0.5, cell.y + 0.5)) continue;
      const local = this.worldToLocal(cell.x + 0.5, cell.y + 0.5, frame);
      if (Math.abs(local.x) <= half && local.y >= 0 && local.y <= frame.depth) result.push(cell);
    }
    return result;
  }

  removeFootprint(footprint: OrientedFootprint, exhausted = false, includePersistent = false): void {
    this.cuts.push(footprint);
    if (this.recording) {
      const edit: WorldEdit = {
        t: "cut",
        x: footprint.center.x,
        y: footprint.center.y,
        hw: footprint.halfWidth,
        hh: footprint.halfHeight,
        a: footprint.angle,
      };
      if (exhausted) edit.e = 1;
      if (includePersistent) edit.p = 1;
      this.history.push(edit);
    }
    const cosine = Math.abs(Math.cos(footprint.angle));
    const sine = Math.abs(Math.sin(footprint.angle));
    const extentX = cosine * footprint.halfWidth + sine * footprint.halfHeight;
    const extentY = sine * footprint.halfWidth + cosine * footprint.halfHeight;
    for (let y = Math.floor(footprint.center.y - extentY); y <= Math.floor(footprint.center.y + extentY); y++) {
      for (let x = Math.floor(footprint.center.x - extentX); x <= Math.floor(footprint.center.x + extentX); x++) {
        if (x < 0 || y < 0 || x >= WORLD_COLS || y >= WORLD_ROWS) continue;
        const key = `${x},${y}`;
        const bucket = this.cutsByCell.get(key) ?? [];
        bucket.push(footprint);
        this.cutsByCell.set(key, bucket);
        const cell = this.cells[y][x];
        if (includePersistent && cell.persistent && this.pointInFootprint(cell.x + 0.5, cell.y + 0.5, footprint)) cell.persistent = false;
        if (this.pointInFootprint(cell.x + 0.5, cell.y + 0.5, footprint)) {
          cell.hidden = false;
          // Paid for once. Regrowth can put the rock back but never the liability, and this is
          // what the brick display desaturates on.
          cell.worked = true;
          if (exhausted && cell.resource) cell.exhausted = true;
        }
      }
    }
    for (const listener of this.cutListeners) listener(footprint);
  }

  /**
   * Restore a cell to solid. Used by bounded Rootwarren regrowth.
   *
   * The guard used to read `cell.solid`, which is never false during play: solidity is *derived*
   * from the cut footprints in `cutsByCell`, and `removeFootprint` deliberately leaves the field
   * alone. So this refused every call, regrowth never reached the world model, and no `grow` edit
   * was ever recorded -- regrowth was cosmetic and a reload silently forgot it. The right question
   * is whether the cell has cuts to undo.
   */
  restoreCell(x: number, y: number, kind: MaterialKind): boolean {
    const cell = this.cells[y]?.[x];
    if (!cell || cell.exhausted) return false;
    // The one question that matters: is this cell open right now? That covers both cases regrowth
    // has to serve -- space the generator left hollow, and space the player cut -- where the old
    // `cell.solid` guard covered only the first and silently refused the second.
    if (this.solidAt(x + 0.5, y + 0.5)) return false;
    const definition = materialOf(kind);
    cell.solid = true;
    cell.kind = kind;
    cell.hp = definition.hp;
    cell.maxHp = definition.hp;
    this.cutsByCell.delete(`${x},${y}`);
    if (this.recording) this.history.push({ t: "grow", x, y, k: kind });
    return true;
  }

  footprintContainsPersistent(footprint: OrientedFootprint): boolean {
    const cosine = Math.abs(Math.cos(footprint.angle));
    const sine = Math.abs(Math.sin(footprint.angle));
    const extentX = cosine * footprint.halfWidth + sine * footprint.halfHeight;
    const extentY = sine * footprint.halfWidth + cosine * footprint.halfHeight;
    for (let y = Math.floor(footprint.center.y - extentY); y <= Math.floor(footprint.center.y + extentY); y++) {
      for (let x = Math.floor(footprint.center.x - extentX); x <= Math.floor(footprint.center.x + extentX); x++) {
        const cell = this.cells[y]?.[x];
        if (cell?.persistent && this.pointInFootprint(x + 0.5, y + 0.5, footprint)) return true;
      }
    }
    return false;
  }

  /**
   * Clear everything a resolved claim consumed, leaving landmarks standing.
   *
   * Cuts are applied unconditionally rather than skipping any footprint that touches
   * persistent material. Skipping was the obvious reading of "landmarks survive claim
   * resolution", but it is wrong at the sub-cell scale a rotated frame works at: a
   * footprint straddling a landmark and ordinary rock was abandoned whole, leaving
   * shards of solid rock inside a claim the player had already paid for. Applying the
   * cut is safe because `solidAt` short-circuits on `persistent`, so a landmark stays
   * solid however many cuts cover it -- the flag protects the landmark, not the
   * footprint around it.
   */
  exhaustFrame(frame: FrameGeometry): void {
    for (let row = 0; row < frame.depth; row++) for (let column = 0; column < frame.width; column++) {
      const u = -frame.width / 2 + 0.5 + column;
      const v = row + 0.5;
      this.removeFootprint(
        { center: this.localToWorld(u, v, frame), halfWidth: 0.5, halfHeight: 0.5, angle: frame.angle },
        true,
      );
    }
    // The paddle's own lane, half a cell deep, so no lip is left along the near edge.
    for (let column = 0; column < frame.width; column++) {
      const u = -frame.width / 2 + 0.5 + column;
      this.removeFootprint(
        { center: this.localToWorld(u, frame.depth + 0.25, frame), halfWidth: 0.5, halfHeight: 0.25, angle: frame.angle },
        true,
      );
    }
  }

  /**
   * Is there anything in this frame worth cutting?
   *
   * Replaced `frameWithinBounds`, which refused any claim whose corners left the map. That was the
   * wrong question: outside the world there is simply nothing to cut, and a board is perfectly happy
   * to carry empty space, so overhanging the edge cost the player every claim along a border for no
   * reason. The condition that actually refuses a commit is an empty frame, and this is it.
   *
   * Cell centres only, with an early exit. This runs every frame for the survey preview, and the
   * authoritative sampling in `framedBricks` is twenty-five points per cell -- three thousand point
   * tests a frame would be a real cost on a phone for a question a hundred can answer. A frame whose
   * every cell centre is empty will not produce bricks, and the commit re-checks properly anyway.
   */
  frameHasMaterial(frame: FrameGeometry): boolean {
    for (let row = 0; row < frame.depth; row++) {
      for (let column = 0; column < frame.width; column++) {
        const u = -frame.width / 2 + 0.5 + column;
        const point = this.localToWorld(u, 0.5 + row, frame);
        if (this.solidAt(point.x, point.y)) return true;
      }
    }
    return false;
  }

  /** Nearest cornerstone, for world-scale telegraphing in the HUD. */
  nearestCornerstone(x: number, y: number): { name: string; distance: number; bearing: number } | null {
    let best: { name: string; distance: number; bearing: number } | null = null;
    for (const site of this.generated.cornerstones) {
      const distance = Math.hypot(site.x - x, site.y - y);
      if (best && distance >= best.distance) continue;
      best = { name: site.name, distance, bearing: Math.atan2(site.y - y, site.x - x) };
    }
    return best;
  }

  static clampToWorld(value: number, max: number): number {
    return clamp(value, 0, max);
  }
}

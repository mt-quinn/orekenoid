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

/** A brick's address on the paddle-local lattice. Both `FramedBrick` and the arena's own bricks satisfy it. */
export interface LatticeCell {
  u: number;
  v: number;
  persistent?: boolean;
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
  private readonly growListeners: Array<(cellX: number, cellY: number) => void> = [];
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

  /**
   * Notified when regrowth puts rock back.
   *
   * Separate from `onCut` because the two need opposite treatment: a cut is composited into the
   * terrain raster as an erase, where growth has to make the raster be rebuilt from current state.
   * Handing growth to the cut listeners would erase the very rock that just appeared.
   */
  onGrow(listener: (cellX: number, cellY: number) => void): void {
    this.growListeners.push(listener);
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

  /**
   * Does rock stop something here?
   *
   * The rock *as drawn*, which is the only answer a player can act on. This used to be `solidAt` --
   * exact per cell -- while the terrain is drawn from an organic contour that pulls inside the cell
   * grid by up to half a cell. Buried inside a rock mass that gap is unreachable and invisible, so it
   * cost nothing. Excavate around it and it becomes both: the reported symptom was slate that had
   * vanished but still stopped the drone, and slate because slate is non-liable and is exactly what a
   * player leaves standing as a wall.
   *
   * `solidAt` stays exactly as it was and stays authoritative for the *model* -- what a claim
   * remeshes into bricks, what a cut removes, what regrowth may restore. Those want the grid. Only
   * things with a physical presence in the world ask this instead.
   */
  blocksAt(x: number, y: number): boolean {
    return this.visualSolidAt(x, y);
  }

  /**
   * The same question as an oracle, for the modules that take one.
   *
   * The ball solver, the creatures and line of sight are all handed this rather than the model's own
   * `solidAt`, so everything that occupies space in the mine agrees with everything that is drawn in
   * it -- and with the shadows, which are traced from the same silhouette.
   */
  readonly drawn = { solidAt: (x: number, y: number) => this.visualSolidAt(x, y) };

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
    if (this.visualFieldAt(x, y) <= 0) return false;
    // Landmarks survive excavation, so they are solid whatever has been cut over them.
    if (this.cellAt(x, y)?.persistent) return true;
    const cuts = this.cutsByCell.get(`${Math.floor(x)},${Math.floor(y)}`);
    return !cuts?.some((cut) => this.pointInFootprint(x, y, cut));
  }

  /**
   * The geology behind `visualSolidAt`, as a signed scalar rather than a yes or no.
   *
   * Positive is rock, negative is air, and zero is exactly the boundary the terrain renderer draws.
   * Excavation is deliberately *not* applied here: cuts are oriented rectangles with exact edges,
   * and anything tracing this field wants to handle them from their own geometry rather than
   * rediscover a straight line by sampling across it.
   *
   * Exists so the shadow contour can interpolate the real curve instead of approximating it. Same
   * arithmetic `visualSolidAt` used to do inline, factored out rather than copied, because two
   * functions that must agree on where the rock is should not be two functions.
   */
  visualFieldAt(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= WORLD_COLS || y >= WORLD_ROWS) return -1;
    if (this.cellAt(x, y)?.persistent) return 1;

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
    return field + wobble - 0.5;
  }

  /**
   * The signed field the terrain is actually *drawn* from.
   *
   * `visualFieldAt` is geology alone: cuts are deliberately not in it, so the organic boundary stays
   * put while excavation is applied as exact rectangles over the top. That is right for the renderer,
   * which does both. It was wrong for the shadow contour, which traced the geology field and therefore
   * cast shadows out of rock the player had already dug away -- excavated space stayed black, and
   * anything left standing in it read as an invisible blocker with a shadow attached.
   *
   * Negative inside any cut, so a tracer following this follows the silhouette on screen.
   */
  drawnFieldAt(x: number, y: number): number {
    if (this.cellAt(x, y)?.persistent) return 1;
    const cuts = this.cutsByCell.get(`${Math.floor(x)},${Math.floor(y)}`);
    if (cuts?.some((cut) => this.pointInFootprint(x, y, cut))) return -1;
    return this.visualFieldAt(x, y);
  }

  /**
   * Every cut footprint overlapping a region, without duplicates.
   *
   * A long expedition accumulates thousands of cuts and only the ones on screen can cast a shadow,
   * so this walks `cutsByCell` rather than the whole log.
   */
  cutsInRegion(minX: number, minY: number, maxX: number, maxY: number): OrientedFootprint[] {
    const found = new Set<OrientedFootprint>();
    const left = Math.max(0, Math.floor(minX));
    const right = Math.min(WORLD_COLS - 1, Math.ceil(maxX));
    const top = Math.max(0, Math.floor(minY));
    const bottom = Math.min(WORLD_ROWS - 1, Math.ceil(maxY));
    for (let y = top; y <= bottom; y++) {
      for (let x = left; x <= right; x++) {
        const bucket = this.cutsByCell.get(`${x},${y}`);
        if (bucket) for (const cut of bucket) found.add(cut);
      }
    }
    return [...found];
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
  /**
   * Is this point inside the world at all?
   *
   * A half-cell margin, so the hull cannot be flush against the outermost row -- which would leave
   * half the drone drawn over a void that no longer has terrain behind it.
   */
  withinBounds(cellX: number, cellY: number): boolean {
    return cellX >= 0.5 && cellY >= 0.5 && cellX <= WORLD_COLS - 1.5 && cellY <= WORLD_ROWS - 1.5;
  }

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
        // The edge of the world is a wall, whatever has been dug out of it.
        //
        // `solidAt` reports a cell that does not exist as not solid, which is the right answer for
        // sampling a claim -- outside the map there is simply nothing to cut -- and exactly the wrong
        // one here, where it meant the border stopped the drone only for as long as the rock in front
        // of it did. Excavate to the boundary and the machine flew straight out into nothing.
        //
        // Handled at the hull rather than in `solidAt` so the two questions stay separate: a frame
        // may hang off the edge of the world, and the drone may not.
        if (!this.withinBounds(cellX, cellY)) return false;
        if (this.blocksAt(cellX, cellY)) return false;
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
    // The geology field too, not just the gameplay flag. `visualFieldAt` reads `baseSolid`, so rock
    // restored without it is rock that blocks and is never drawn -- the same defect slate had, and one
    // this function would otherwise keep producing every time a Rootwarren cell grew back.
    cell.baseSolid = true;
    cell.kind = kind;
    cell.hp = definition.hp;
    cell.maxHp = definition.hp;
    this.cutsByCell.delete(`${x},${y}`);
    if (this.recording) this.history.push({ t: "grow", x, y, k: kind });
    for (const listener of this.growListeners) listener(x, y);
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
   * Clear what a resolved claim actually broke, leaving landmarks -- and anything still
   * standing -- as terrain.
   *
   * `standing` is the lattice addresses of bricks that survived the claim. Those cells are
   * never cut and never exhausted: the rock and the ore under them go back into the world
   * exactly as they were, so ending a claim early costs the hull its unresolved load and
   * nothing else. Everything the ball did reach is cut here as before, which also cleans up
   * the sub-brick slivers coverage sampling refused to raise a brick for -- the arena showed
   * those as empty air, so the world must agree.
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
  exhaustFrame(frame: FrameGeometry, standing: readonly LatticeCell[] = []): void {
    // Landmark bricks are dropped rather than spared, even though an arena keeps them permanently
    // alive. Sparing their lattice square would abandon any footprint straddling a landmark and
    // ordinary rock -- the shard-leaving bug this function was fixed for once already. They need no
    // sparing: `solidAt` short-circuits on `persistent`, so the landmark survives its own cut.
    const spared = new Set(
      standing.filter((brick) => !brick.persistent).map((brick) => this.latticeKey(frame, brick)),
    );
    for (let row = 0; row < frame.depth; row++) for (let column = 0; column < frame.width; column++) {
      if (spared.has(`${column},${row}`)) continue;
      const u = -frame.width / 2 + 0.5 + column;
      const v = row + 0.5;
      this.removeFootprint(
        { center: this.localToWorld(u, v, frame), halfWidth: 0.5, halfHeight: 0.5, angle: frame.angle },
        true,
      );
    }
    // A half-cell lane past the deepest row, so no sub-brick lip is left along the far boundary
    // where coverage sampling refused to raise a brick. Skipped under a column whose deepest brick
    // is still standing, since cutting there would hollow a slot behind rock the player kept.
    for (let column = 0; column < frame.width; column++) {
      if (spared.has(`${column},${frame.depth - 1}`)) continue;
      const u = -frame.width / 2 + 0.5 + column;
      this.removeFootprint(
        { center: this.localToWorld(u, frame.depth + 0.25, frame), halfWidth: 0.5, halfHeight: 0.25, angle: frame.angle },
        true,
      );
    }
  }

  /** Lattice address of a brick, recovered from the paddle-local coordinates it was built at. */
  private latticeKey(frame: FrameGeometry, brick: LatticeCell): string {
    return `${Math.round(brick.u + frame.width / 2 - 0.5)},${Math.round(brick.v - 0.5)}`;
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

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

  constructor(seedLabel: string = DEFAULT_SEED) {
    this.generated = generateWorld(seedLabel);
    this.cells = this.generated.cells;
    this.start = this.generated.start;
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

  isOpenWorldPixels(x: number, y: number, radius = 12): boolean {
    return [[-radius, -radius], [radius, -radius], [-radius, radius], [radius, radius]].every(([ox, oy]) => {
      return !this.solidAt((x + ox) / CELL, (y + oy) / CELL);
    });
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
          if (exhausted && cell.resource) cell.exhausted = true;
        }
      }
    }
    for (const listener of this.cutListeners) listener(footprint);
  }

  /** Restore a cell to solid. Used by bounded Rootwarren regrowth. */
  restoreCell(x: number, y: number, kind: MaterialKind): boolean {
    const cell = this.cells[y]?.[x];
    if (!cell || cell.solid || cell.exhausted) return false;
    const definition = materialOf(kind);
    cell.solid = true;
    cell.kind = kind;
    cell.hp = definition.hp;
    cell.maxHp = definition.hp;
    this.cutsByCell.delete(`${x},${y}`);
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

  exhaustFrame(frame: FrameGeometry): void {
    for (let row = 0; row < frame.depth; row++) for (let column = 0; column < frame.width; column++) {
      const u = -frame.width / 2 + 0.5 + column;
      const v = row + 0.5;
      const footprint: OrientedFootprint = { center: this.localToWorld(u, v, frame), halfWidth: 0.5, halfHeight: 0.5, angle: frame.angle };
      if (!this.footprintContainsPersistent(footprint)) this.removeFootprint(footprint, true);
    }
    for (let column = 0; column < frame.width; column++) {
      const u = -frame.width / 2 + 0.5 + column;
      const footprint: OrientedFootprint = { center: this.localToWorld(u, frame.depth + 0.25, frame), halfWidth: 0.5, halfHeight: 0.25, angle: frame.angle };
      if (!this.footprintContainsPersistent(footprint)) this.removeFootprint(footprint, true);
    }
  }

  frameWithinBounds(frame: FrameGeometry): boolean {
    const half = frame.width / 2;
    return [[-half, 0], [half, 0], [-half, frame.depth + 0.5], [half, frame.depth + 0.5]].every(([u, v]) => {
      const point = this.localToWorld(u, v, frame);
      return point.x >= 1 && point.y >= 1 && point.x < WORLD_COLS - 1 && point.y < WORLD_ROWS - 1;
    });
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

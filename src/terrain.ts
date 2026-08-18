// Chunked terrain rendering.
//
// The world is 240 x 144 cells. Rasterized whole at gameplay resolution that is
// roughly 8300 x 5000 pixels -- past texture limits on plenty of hardware, and far
// too slow to build in one frame. Terrain is therefore cut into square chunks,
// built lazily near the camera, and amortized across frames.
//
// Cuts composite directly into the chunk canvases they touch, so excavation stays
// incremental and no chunk is ever rebuilt from scratch during play.

import { Container, Sprite, Texture } from "pixi.js";
import {
  CELL,
  CHUNK_CELLS,
  CHUNK_RESIDENCY_CELLS,
  PALETTE,
  TERRAIN_SCALE,
  WORLD_COLS,
  WORLD_ROWS,
} from "./config";
import { materialOf } from "./materials";
import type { OrientedFootprint } from "./types";
import type { WorldModel } from "./world";
import { sfbm, warp } from "./worldgen/rng";

const CHUNK_COLS = Math.ceil(WORLD_COLS / CHUNK_CELLS);
const CHUNK_ROWS = Math.ceil(WORLD_ROWS / CHUNK_CELLS);
const PIXELS_PER_CELL = CELL * TERRAIN_SCALE;

interface Chunk {
  cx: number;
  cy: number;
  canvas: HTMLCanvasElement;
  sprite: Sprite;
  texture: Texture;
  built: boolean;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export class ChunkedTerrain {
  readonly container = new Container();
  private readonly chunks = new Map<string, Chunk>();
  private readonly queue: Array<{ cx: number; cy: number }> = [];

  constructor(private readonly world: WorldModel) {
    world.onCut((footprint) => this.applyCut(footprint));
  }

  private key(cx: number, cy: number): string {
    return `${cx},${cy}`;
  }

  /** Mark chunks near the focus as needed. Cheap; safe to call every frame. */
  requestAround(worldX: number, worldY: number): void {
    const cellX = worldX / CELL;
    const cellY = worldY / CELL;
    const minCx = clamp(Math.floor((cellX - CHUNK_RESIDENCY_CELLS) / CHUNK_CELLS), 0, CHUNK_COLS - 1);
    const maxCx = clamp(Math.floor((cellX + CHUNK_RESIDENCY_CELLS) / CHUNK_CELLS), 0, CHUNK_COLS - 1);
    const minCy = clamp(Math.floor((cellY - CHUNK_RESIDENCY_CELLS) / CHUNK_CELLS), 0, CHUNK_ROWS - 1);
    const maxCy = clamp(Math.floor((cellY + CHUNK_RESIDENCY_CELLS) / CHUNK_CELLS), 0, CHUNK_ROWS - 1);
    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        if (this.chunks.has(this.key(cx, cy))) continue;
        if (this.queue.some((entry) => entry.cx === cx && entry.cy === cy)) continue;
        this.queue.push({ cx, cy });
      }
    }
    // Nearest-first, so the chunk under the player is never the last one built.
    this.queue.sort((a, b) => {
      const da = Math.hypot((a.cx + 0.5) * CHUNK_CELLS - cellX, (a.cy + 0.5) * CHUNK_CELLS - cellY);
      const db = Math.hypot((b.cx + 0.5) * CHUNK_CELLS - cellX, (b.cy + 0.5) * CHUNK_CELLS - cellY);
      return da - db;
    });
  }

  /** Build at most `budget` queued chunks. Keeps frame cost bounded. */
  pump(budget = 1): number {
    let built = 0;
    while (built < budget && this.queue.length) {
      const next = this.queue.shift()!;
      this.buildChunk(next.cx, next.cy);
      built++;
    }
    return built;
  }

  /** Build every chunk immediately. Used by tests and by deterministic captures. */
  buildAll(): void {
    for (let cy = 0; cy < CHUNK_ROWS; cy++) {
      for (let cx = 0; cx < CHUNK_COLS; cx++) {
        if (!this.chunks.has(this.key(cx, cy))) this.buildChunk(cx, cy);
      }
    }
    this.queue.length = 0;
  }

  /**
   * Discard every built chunk so they rasterize again from current world state.
   *
   * Loading a save replays excavation into `WorldModel` before the terrain knows
   * about it, and `applyCut` only touches chunks that already exist. Rebuilding
   * from scratch is the only way to guarantee a loaded world looks like the world
   * that was saved rather than the world the seed generates.
   */
  reset(): void {
    for (const chunk of this.chunks.values()) {
      chunk.sprite.destroy();
      chunk.texture.destroy(true);
    }
    this.chunks.clear();
    this.queue.length = 0;
    this.container.removeChildren();
  }

  /**
   * Throw away the chunk covering a cell so it rasterises again from current world state.
   *
   * Cuts are composited in incrementally, which is what keeps excavation cheap. Growth cannot be:
   * there is no "un-erase" to composite, so the only honest answer is to rebuild. Rare enough that
   * rebuilding one chunk is nothing, and the lazy builder picks it up on the next frame.
   */
  invalidateAt(cellX: number, cellY: number): void {
    const cx = Math.floor(cellX / CHUNK_CELLS);
    const cy = Math.floor(cellY / CHUNK_CELLS);
    const key = this.key(cx, cy);
    const chunk = this.chunks.get(key);
    if (!chunk) return;
    chunk.sprite.destroy();
    chunk.texture.destroy(true);
    this.chunks.delete(key);
    if (!this.queue.some((entry) => entry.cx === cx && entry.cy === cy)) this.queue.push({ cx, cy });
  }

  /**
   * Alpha of the live chunk canvas at a world cell, 0..255, or -1 when no chunk is built there.
   *
   * Diagnostic. Chunks are rasterised once and then composited into, so "what the world model says"
   * and "what is actually on the canvas" can drift apart -- and when they do, no amount of reading the
   * model will show it. This reads the pixels.
   */
  alphaAt(cellX: number, cellY: number): number {
    const cx = Math.floor(cellX / CHUNK_CELLS);
    const cy = Math.floor(cellY / CHUNK_CELLS);
    const chunk = this.chunks.get(this.key(cx, cy));
    if (!chunk) return -1;
    const context = chunk.canvas.getContext("2d");
    if (!context) return -1;
    const px = Math.floor((cellX - cx * CHUNK_CELLS) * PIXELS_PER_CELL);
    const py = Math.floor((cellY - cy * CHUNK_CELLS) * PIXELS_PER_CELL);
    if (px < 0 || py < 0 || px >= chunk.canvas.width || py >= chunk.canvas.height) return -1;
    return context.getImageData(px, py, 1, 1).data[3];
  }

  /** RGBA of the live chunk canvas at a world cell. Diagnostic. */
  colourAt(cellX: number, cellY: number): number[] {
    const cx = Math.floor(cellX / CHUNK_CELLS);
    const cy = Math.floor(cellY / CHUNK_CELLS);
    const chunk = this.chunks.get(this.key(cx, cy));
    const context = chunk?.canvas.getContext("2d");
    if (!chunk || !context) return [-1, -1, -1, -1];
    const px = Math.floor((cellX - cx * CHUNK_CELLS) * PIXELS_PER_CELL);
    const py = Math.floor((cellY - cy * CHUNK_CELLS) * PIXELS_PER_CELL);
    return [...context.getImageData(px, py, 1, 1).data];
  }

  get chunkCount(): number {
    return this.chunks.size;
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  private buildChunk(cx: number, cy: number): void {
    const cellOriginX = cx * CHUNK_CELLS;
    const cellOriginY = cy * CHUNK_CELLS;
    const cellsWide = Math.min(CHUNK_CELLS, WORLD_COLS - cellOriginX);
    const cellsHigh = Math.min(CHUNK_CELLS, WORLD_ROWS - cellOriginY);
    if (cellsWide <= 0 || cellsHigh <= 0) return;
    const canvas = this.rasterize(cellOriginX, cellOriginY, cellsWide, cellsHigh);
    if (!canvas) return;

    const texture = Texture.from(canvas);
    const sprite = new Sprite(texture);
    sprite.position.set(cellOriginX * CELL, cellOriginY * CELL);
    sprite.width = cellsWide * CELL;
    sprite.height = cellsHigh * CELL;
    this.container.addChild(sprite);
    this.chunks.set(this.key(cx, cy), { cx, cy, canvas, sprite, texture, built: true });
  }

  /**
   * Rasterize an arbitrary cell region with the production terrain renderer.
   *
   * Deliberately public: the deployment previews need real terrain behind their
   * live arenas, and they must come from *this* rasterizer rather than a parallel
   * path, so a preview can never drift from how the world actually looks.
   */
  regionTexture(originCellX: number, originCellY: number, cellsWide: number, cellsHigh: number): Texture | null {
    const canvas = this.rasterize(originCellX, originCellY, cellsWide, cellsHigh);
    return canvas ? Texture.from(canvas) : null;
  }

  private rasterize(cellOriginX: number, cellOriginY: number, cellsWide: number, cellsHigh: number): HTMLCanvasElement | null {
    if (cellsWide <= 0 || cellsHigh <= 0) return null;

    const width = Math.round(cellsWide * PIXELS_PER_CELL);
    const height = Math.round(cellsHigh * PIXELS_PER_CELL);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return null;

    const image = context.createImageData(width, height);
    const data = image.data;
    const seed = this.world.generated.seed;

    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        const wx = cellOriginX + px / PIXELS_PER_CELL;
        const wy = cellOriginY + py / PIXELS_PER_CELL;
        const offset = (py * width + px) * 4;
        if (!this.world.visualSolidAt(wx, wy)) continue;
        const cell = this.world.cellAt(wx, wy);
        if (!cell) continue;
        const definition = materialOf(cell.kind);

        // Material colour comes from a *warped* lookup rather than the cell the
        // pixel sits in. Blending colours washed hue-adjacent materials into fog;
        // keeping the cell's own colour made them hard axis-aligned blocks. Warping
        // the sample position gives organic seams at pixel resolution while every
        // material keeps its exact colour -- so slate strata, coal seams and
        // crystal lattices stay readable in the rock before anything is framed.
        const warped = warp(seed + 9001, wx, wy, 0.62, 0.85);
        const visual = this.world.cellAt(warped.x, warped.y);
        const paint = visual?.solid ? materialOf(visual.kind) : definition;
        let r = (paint.base >> 16) & 0xff;
        let g = (paint.base >> 8) & 0xff;
        let b = paint.base & 0xff;

        // Grain is pure coherent noise at two scales. Trigonometric grain produced
        // a visible regular cross-hatch at cell scale, which read as fabric.
        const grain = sfbm(seed + 5501, wx * 2.7, wy * 2.7, 3) * 0.62
          + sfbm(seed + 7703, wx * 9.4, wy * 9.4, 2) * 0.3;
        const depthShade = 1 - (wy / WORLD_ROWS) * 0.22;
        const tint = (1 + grain * 0.19) * depthShade;
        r *= tint;
        g *= tint;
        b *= tint;

        // Directional edge light: lit from up-left, shadowed down-right. Sampled
        // tightly so the rim stays a crisp line on the silhouette.
        const openLeft = !this.world.visualSolidAt(wx - 0.1, wy);
        const openRight = !this.world.visualSolidAt(wx + 0.1, wy);
        const openUp = !this.world.visualSolidAt(wx, wy - 0.1);
        const openDown = !this.world.visualSolidAt(wx, wy + 0.1);
        if (openLeft || openUp) {
          const edge = paint.edge;
          r += (((edge >> 16) & 0xff) - r) * 0.42;
          g += (((edge >> 8) & 0xff) - g) * 0.42;
          b += ((edge & 0xff) - b) * 0.42;
        }
        if (openRight || openDown) {
          r *= 0.64;
          g *= 0.64;
          b *= 0.62;
        }

        // Resource inclusions glint, but anonymously -- a glint says "something is
        // here", never what it is. Identity stays a wager until commitment.
        if (cell.resource && !cell.hidden) {
          const glint = sfbm(seed + 6607, wx * 2.4, wy * 2.4, 2);
          if (glint > 0.42) {
            r += 26;
            g += 22;
            b += 14;
          }
        }

        data[offset] = clamp(r, 0, 255);
        data[offset + 1] = clamp(g, 0, 255);
        data[offset + 2] = clamp(b, 0, 255);
        data[offset + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);
    return canvas;
  }

  /**
   * Composite an oriented cut into every chunk it overlaps.
   * Cuts are destructive on the chunk canvas, so a claim's excavation persists
   * without rebuilding terrain.
   */
  private applyCut(footprint: OrientedFootprint): void {
    // A landmark under this cut survives it, so the canvas must not lose it.
    //
    // The erase below is an unconditional `destination-out` over the whole footprint, and claim
    // resolution cuts every lattice cell -- including the ones a landmark sits under, deliberately,
    // because `solidAt` short-circuits on `persistent` and the flag protects the landmark rather than
    // the footprint. The model therefore kept the Refit Bay solid and drawable while the raster wiped
    // it, which is a wall you cannot see, cannot break, and still collide with -- and it still cast a
    // shadow, because the shadow is traced from the model.
    //
    // There is no un-erase to composite, so the honest answer is to throw the chunk away and let it
    // rasterise again from current state: a fresh raster draws the landmark and applies every cut.
    // Rare enough to be free -- only claims that overlap authored structure pay it.
    if (this.world.footprintContainsPersistent(footprint)) {
      this.rebuildAround(footprint);
      return;
    }
    this.eraseCut(footprint);
  }

  /** Drop every chunk a footprint touches, so they rasterise again from current world state. */
  private rebuildAround(footprint: OrientedFootprint): void {
    const cosine = Math.abs(Math.cos(footprint.angle));
    const sine = Math.abs(Math.sin(footprint.angle));
    const extentX = cosine * footprint.halfWidth + sine * footprint.halfHeight + 1;
    const extentY = sine * footprint.halfWidth + cosine * footprint.halfHeight + 1;
    for (let y = footprint.center.y - extentY; y <= footprint.center.y + extentY; y++) {
      for (let x = footprint.center.x - extentX; x <= footprint.center.x + extentX; x++) {
        this.invalidateAt(x, y);
      }
    }
  }

  private eraseCut(footprint: OrientedFootprint): void {
    const cosine = Math.abs(Math.cos(footprint.angle));
    const sine = Math.abs(Math.sin(footprint.angle));
    const extentX = cosine * footprint.halfWidth + sine * footprint.halfHeight + 0.5;
    const extentY = sine * footprint.halfWidth + cosine * footprint.halfHeight + 0.5;
    const minCx = clamp(Math.floor((footprint.center.x - extentX) / CHUNK_CELLS), 0, CHUNK_COLS - 1);
    const maxCx = clamp(Math.floor((footprint.center.x + extentX) / CHUNK_CELLS), 0, CHUNK_COLS - 1);
    const minCy = clamp(Math.floor((footprint.center.y - extentY) / CHUNK_CELLS), 0, CHUNK_ROWS - 1);
    const maxCy = clamp(Math.floor((footprint.center.y + extentY) / CHUNK_CELLS), 0, CHUNK_ROWS - 1);

    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const chunk = this.chunks.get(this.key(cx, cy));
        if (!chunk) continue;
        const context = chunk.canvas.getContext("2d");
        if (!context) continue;
        context.save();
        context.setTransform(PIXELS_PER_CELL, 0, 0, PIXELS_PER_CELL, 0, 0);
        context.translate(footprint.center.x - cx * CHUNK_CELLS, footprint.center.y - cy * CHUNK_CELLS);
        context.rotate(footprint.angle);
        context.globalCompositeOperation = "destination-out";
        context.fillStyle = "#000";
        context.fillRect(
          -footprint.halfWidth - 0.01,
          -footprint.halfHeight - 0.01,
          footprint.halfWidth * 2 + 0.02,
          footprint.halfHeight * 2 + 0.02,
        );
        // A cut edge is machined, so it gets a hard bright rim distinguishing it
        // from natural cavity boundaries.
        context.globalCompositeOperation = "source-atop";
        const province = this.world.provinceAt(footprint.center.x, footprint.center.y);
        context.strokeStyle = province === "mirrorreef"
          ? "rgba(143, 182, 224, .8)"
          : province === "rootwarren"
            ? "rgba(192, 176, 85, .8)"
            : "rgba(195, 179, 148, .78)";
        context.lineWidth = 0.1;
        context.strokeRect(-footprint.halfWidth, -footprint.halfHeight, footprint.halfWidth * 2, footprint.halfHeight * 2);
        context.restore();
        chunk.texture.source.update();
      }
    }
  }

  /** Far-field backdrop so the world does not end in flat void beyond the chunks. */
  static backdropColour(): number {
    return PALETTE.void;
  }
}

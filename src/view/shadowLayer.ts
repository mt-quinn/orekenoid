// Drawing the dark, as geometry, composited once.
//
// The shadows themselves are Teleglitch's: black polygons extruded from wall faces away from the
// drone, hard-edged, with no radius and no falloff. What is different here is that they are not
// opaque -- terrain and background show faintly through, so the player keeps the shape of a chamber
// they are standing in the dark half of, and the mine stays readable.
//
// That translucency is the whole reason for the render texture. Shadow quads overlap constantly:
// every wall behind another wall is inside its shadow. Drawn straight into the scene at partial
// alpha they compound -- measured in this renderer, a 50% quad reads 128 and its overlap with a
// second reads 64 -- and shadow-behind-shadow gets progressively darker, which is a gradient
// arrived at by accident in the one system whose whole point is not having one. Rendered *opaquely*
// into an off-screen texture and then multiplied over the world as a single sprite, the overlaps
// collapse into one flat value and the dim level becomes a free parameter.
//
// Enemies are not dimmed by this. They are hidden outright, by a line-of-sight test in
// `FieldCombat`, because a creature at a third brightness is a creature you can still see.

import { Container, Graphics, RenderTexture, Sprite, type Renderer } from "pixi.js";
import { CELL, CHUNK_CELLS, WORLD_COLS, WORLD_ROWS } from "../config";
import { traceVisualContour, type VisualField } from "../light/contour";
import { shadowQuad, type Occluder } from "../light/shadow";

export const SHADOW = {
  /**
   * How much of the world survives in shadow, 0..1, as a multiply.
   *
   * Zero is the reference behaviour and unreadable here: Teleglitch's floors are textured, so lit
   * ground *looks* lit, where this mine's open cells had no tone of their own and lit and unseen
   * came out equally black. Low enough that the boundary is unmistakable, high enough that the
   * silhouette of a chamber survives it.
   */
  dim: 0.3,
  /**
   * How far a shadow is extruded, in cells.
   *
   * Only needs to clear the viewport, since anything past the screen edge is not drawn. Generous
   * rather than exact, because the camera swings when a claim is framed near the edge of the world.
   */
  reach: 90,
  /** Extra cells of geometry gathered beyond the visible rect, so walls just off screen still cast. */
  margin: 6,
  /**
   * How many chunks may be traced in one frame.
   *
   * The contour is cached per chunk, exactly as the terrain rasterisation is, because it answers the
   * same question about the same ground and goes stale for the same reasons. One region-wide trace
   * cost ten milliseconds and had to be redone every time the drone walked out of its padding -- a
   * visible hitch every second or so. Per chunk it is about a millisecond, only newly-visible chunks
   * pay it, and a budget keeps even a camera jump from spending the whole frame on it.
   */
  traceBudget: 2,
} as const;

export class ShadowLayer {
  /** Goes into the world, above everything in the mine and below the instruments. */
  readonly container = new Container();
  /** World-space shadow geometry. Never added to the stage -- only rendered into the texture. */
  private readonly geometry = new Graphics();
  private readonly cap = new Graphics();
  private readonly offscreen = new Container();
  private texture: RenderTexture;
  private readonly sprite: Sprite;
  private width = 2;
  private height = 2;
  /** Occluder count from the last rebuild, for the render diagnostics. */
  lastOccluders = 0;

  /** Traced faces per chunk, keyed `cx,cy`. Missing means not traced yet or invalidated. */
  private readonly tracedChunks = new Map<string, Occluder[]>();
  /** Face count across the cached chunks, for the render diagnostics. */
  lastTracedFaces = 0;

  constructor(private readonly world: VisualField, private readonly renderer: Renderer) {
    this.offscreen.addChild(this.geometry, this.cap);
    this.texture = RenderTexture.create({ width: 2, height: 2 });
    this.sprite = new Sprite(this.texture);
    // Multiply, so the texture darkens what is already drawn rather than painting over it.
    this.sprite.blendMode = "multiply";
    this.container.addChild(this.sprite);
  }

  /**
   * Terrain changed here: the traced silhouette is no longer the silhouette.
   *
   * Takes the world rect that changed and drops only the chunks it touches, plus their neighbours --
   * a cut near a chunk edge moves a contour that the adjacent chunk traced part of.
   */
  /** The composited mask, for diagnostics: white where lit, dark where not. */
  get maskTexture(): RenderTexture {
    return this.texture;
  }

  invalidate(minX?: number, minY?: number, maxX?: number, maxY?: number): void {
    if (minX === undefined || minY === undefined || maxX === undefined || maxY === undefined) {
      this.tracedChunks.clear();
      return;
    }
    const left = Math.floor((minX - 1) / CHUNK_CELLS);
    const right = Math.floor((maxX + 1) / CHUNK_CELLS);
    const top = Math.floor((minY - 1) / CHUNK_CELLS);
    const bottom = Math.floor((maxY + 1) / CHUNK_CELLS);
    for (let cy = top; cy <= bottom; cy++) {
      for (let cx = left; cx <= right; cx++) this.tracedChunks.delete(`${cx},${cy}`);
    }
  }

  /**
   * Match the texture to the viewport.
   *
   * One texel per screen pixel. Cheaper than the world-sized mask this replaces, which allocated
   * for the whole 240x144 mine whatever was on screen.
   */
  resize(width: number, height: number): void {
    const nextWidth = Math.max(2, Math.ceil(width));
    const nextHeight = Math.max(2, Math.ceil(height));
    if (nextWidth === this.width && nextHeight === this.height) return;
    this.width = nextWidth;
    this.height = nextHeight;
    this.texture.destroy(true);
    this.texture = RenderTexture.create({ width: nextWidth, height: nextHeight });
    this.sprite.texture = this.texture;
  }

  /**
   * Rebuild the shadows and composite them.
   *
   * `focus` is the camera's world-space centre in cells and the halves are the world rect it can
   * see. The geometry is drawn in world pixels and squeezed into the texture by that same rect, so
   * the sprite laid back over the world lines up exactly.
   *
   * Redrawn every frame rather than cached: the geometry depends on where the drone is standing, and
   * a cache keyed on a position that changes continuously is not a cache.
   */
  update(
    eyeX: number,
    eyeY: number,
    focusX: number,
    focusY: number,
    halfWidth: number,
    halfHeight: number,
    /** Direction the paddle's face points, in radians. Everything behind it is unlit. */
    forward: number,
  ): void {
    const geometry = this.geometry;
    geometry.clear();
    const castMinX = focusX - halfWidth - SHADOW.margin;
    const castMinY = focusY - halfHeight - SHADOW.margin;
    const castMaxX = focusX + halfWidth + SHADOW.margin;
    const castMaxY = focusY + halfHeight + SHADOW.margin;
    const traced = this.occludersFor(castMinX, castMinY, castMaxX, castMaxY);
    // Traced wide for cache stability, extruded narrow. A face beyond the margin cannot reach the
    // screen anyway: its shadow runs *away* from the eye, and the eye is inside the viewport -- so
    // extruding the whole padded trace was a few hundred quads a frame of provably invisible work.
    const occluders = traced.filter((face) => {
      const midX = (face.x1 + face.x2) / 2;
      const midY = (face.y1 + face.y2) / 2;
      return midX >= castMinX && midX <= castMaxX && midY >= castMinY && midY <= castMaxY;
    });
    this.lastOccluders = occluders.length;

    // Opaque, one quad at a time. Overlap is free here precisely because this is going into its own
    // texture -- the translucency is applied once, later, by the sprite.
    for (const occluder of occluders) {
      const quad = shadowQuad(occluder, eyeX, eyeY, SHADOW.reach);
      if (!quad) continue;
      const points: number[] = [];
      for (let index = 0; index < quad.length; index += 2) {
        points.push(quad[index] * CELL, quad[index + 1] * CELL);
      }
      geometry.poly(points).fill({ color: 0x000000, alpha: 1 });
    }
    this.drawFacing(eyeX, eyeY, forward);

    // Squeeze the visible world rect into the texture. Rotation is deliberately not handled: this
    // layer only runs in survey, where the camera never rotates.
    const originX = (focusX - halfWidth) * CELL;
    const originY = (focusY - halfHeight) * CELL;
    const scale = this.width / (halfWidth * 2 * CELL);
    this.offscreen.scale.set(scale, this.height / (halfHeight * 2 * CELL));
    this.offscreen.position.set(-originX * scale, -originY * (this.height / (halfHeight * 2 * CELL)));
    // White ground, black shadows: the sprite multiplies, so untouched ground passes through at full
    // brightness and shadow lands at `dim`.
    this.renderer.render({ container: this.offscreen, target: this.texture, clear: true, clearColor: 0xffffff });

    this.sprite.position.set(originX, originY);
    this.sprite.width = halfWidth * 2 * CELL;
    this.sprite.height = halfHeight * 2 * CELL;
    // The dim level rides on the sprite rather than on the fills, which is what stops overlapping
    // quads compounding. One sprite, one alpha, applied once.
    this.sprite.alpha = 1 - SHADOW.dim;
  }

  /**
   * The drawn rock faces covering this region, chunk by chunk.
   *
   * Chunks already traced are reused untouched; missing ones are traced up to the frame's budget, so
   * a camera jump reveals its shadows over a couple of frames instead of stalling one.
   */
  private occludersFor(minX: number, minY: number, maxX: number, maxY: number): Occluder[] {
    const left = Math.max(0, Math.floor(minX / CHUNK_CELLS));
    const right = Math.min(Math.ceil(WORLD_COLS / CHUNK_CELLS) - 1, Math.floor(maxX / CHUNK_CELLS));
    const top = Math.max(0, Math.floor(minY / CHUNK_CELLS));
    const bottom = Math.min(Math.ceil(WORLD_ROWS / CHUNK_CELLS) - 1, Math.floor(maxY / CHUNK_CELLS));

    const faces: Occluder[] = [];
    let budget = SHADOW.traceBudget;
    let total = 0;
    for (let cy = top; cy <= bottom; cy++) {
      for (let cx = left; cx <= right; cx++) {
        const key = `${cx},${cy}`;
        let traced = this.tracedChunks.get(key);
        if (!traced) {
          if (budget <= 0) continue;
          budget--;
          // Exact chunk bounds, no overlap. The sample step divides the chunk evenly, so adjacent
          // chunks share their seam sample line exactly: the contour is contiguous across the join
          // with neither a gap nor a doubled face.
          traced = traceVisualContour(
            this.world,
            cx * CHUNK_CELLS,
            cy * CHUNK_CELLS,
            (cx + 1) * CHUNK_CELLS,
            (cy + 1) * CHUNK_CELLS,
          );
          this.tracedChunks.set(key, traced);
        }
        total += traced.length;
        for (const face of traced) faces.push(face);
      }
    }
    this.lastTracedFaces = total;
    return faces;
  }

  /**
   * Everything behind the paddle.
   *
   * The lamp is on the front face of the machine and the machine is opaque, so the lit region is a
   * half turn ahead of it and nothing else -- which makes turning the drone the act of looking, and
   * makes the player's own body the wall they most often have to work around.
   *
   * Drawn as one quad covering the half-plane behind the face rather than by extruding a shadow from
   * the hull. Extruding would be the more literal model and gives the wrong answer: the light sits
   * *on* the occluder, so the occluder blocks nothing at all and the shadow behind it is empty.
   */
  private drawFacing(eyeX: number, eyeY: number, forward: number): void {
    this.cap.clear();
    const reach = SHADOW.reach * CELL;
    const originX = eyeX * CELL;
    const originY = eyeY * CELL;
    // Along the face, and away from it.
    const sideX = -Math.sin(forward);
    const sideY = Math.cos(forward);
    const backX = -Math.cos(forward);
    const backY = -Math.sin(forward);
    this.cap
      .poly([
        originX + sideX * reach, originY + sideY * reach,
        originX - sideX * reach, originY - sideY * reach,
        originX - sideX * reach + backX * reach, originY - sideY * reach + backY * reach,
        originX + sideX * reach + backX * reach, originY + sideY * reach + backY * reach,
      ])
      .fill({ color: 0x000000, alpha: 1 });
  }
}

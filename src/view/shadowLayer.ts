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
import { CELL } from "../config";
import type { SolidityOracle } from "../combat/ballField";
import { collectOccluders, shadowQuad } from "../light/shadow";

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

  constructor(private readonly world: SolidityOracle, private readonly renderer: Renderer) {
    this.offscreen.addChild(this.geometry, this.cap);
    this.texture = RenderTexture.create({ width: 2, height: 2 });
    this.sprite = new Sprite(this.texture);
    // Multiply, so the texture darkens what is already drawn rather than painting over it.
    this.sprite.blendMode = "multiply";
    this.container.addChild(this.sprite);
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
    lampReach: number,
  ): void {
    const geometry = this.geometry;
    geometry.clear();
    const occluders = collectOccluders(
      this.world,
      focusX - halfWidth - SHADOW.margin,
      focusY - halfHeight - SHADOW.margin,
      focusX + halfWidth + SHADOW.margin,
      focusY + halfHeight + SHADOW.margin,
    );
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
    this.drawLampCap(eyeX, eyeY, lampReach);

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
   * Close the dark in to a fixed distance regardless of what is in the way.
   *
   * Off at full reach, which is the point: ordinary sight has no radius. It exists so a Douser on
   * the hull has something to actually take. Drawn as one enormously thick circular stroke rather
   * than a rectangle with a hole in it, because a stroke needs no even-odd winding to make the hole.
   */
  private drawLampCap(eyeX: number, eyeY: number, reach: number): void {
    this.cap.clear();
    if (reach >= SHADOW.reach) return;
    const band = SHADOW.reach * CELL;
    this.cap
      .circle(eyeX * CELL, eyeY * CELL, reach * CELL + band / 2)
      .stroke({ width: band, color: 0x000000, alpha: 1 });
  }
}

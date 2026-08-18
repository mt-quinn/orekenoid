// Drawing the dark.
//
// The mask is one texel per world cell -- 240 x 144 -- scaled up by `CELL` with nearest-neighbour
// filtering and multiplied over the whole world. Nearest filtering is the entire trick: it is what
// makes a shadow edge a hard line instead of a gradient, and it costs nothing.
//
// Deliberately *not* baked into the terrain chunks. Light changes every frame and chunks are built
// once and composited into incrementally as the player cuts; folding one into the other would mean
// rebuilding chunks at frame rate, and would throw away the incremental-excavation property that
// makes the terrain cheap in the first place.

import { Container, Sprite, Texture } from "pixi.js";
import { CELL, WORLD_COLS, WORLD_ROWS } from "../config";
import { LIGHT, type LightField } from "../light/field";

export class LightMask {
  readonly container = new Container();
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly image: ImageData;
  private readonly texture: Texture;
  private readonly sprite: Sprite;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = WORLD_COLS;
    this.canvas.height = WORLD_ROWS;
    const context = this.canvas.getContext("2d", { willReadFrequently: false });
    if (!context) throw new Error("Light mask needs a 2D context");
    this.context = context;
    this.image = context.createImageData(WORLD_COLS, WORLD_ROWS);
    // Fully dark until the first frame is computed, so a mine never flashes fully lit on load.
    for (let index = 0; index < this.image.data.length; index += 4) this.image.data[index + 3] = 255;

    this.texture = Texture.from(this.canvas);
    this.texture.source.scaleMode = "nearest";
    this.sprite = new Sprite(this.texture);
    this.sprite.width = WORLD_COLS * CELL;
    this.sprite.height = WORLD_ROWS * CELL;
    // Multiply, so the mask darkens what is already drawn rather than painting over it. Anything
    // that must never be dimmed lives outside this container.
    this.sprite.blendMode = "multiply";
    this.container.addChild(this.sprite);
  }

  /**
   * Push the field to the GPU.
   *
   * Only the cells near the camera are written. The full grid is 34,560 texels and almost all of
   * them are off screen every frame; writing the lot was measurably the most expensive thing in
   * the frame for pixels nobody could see.
   */
  update(field: LightField, focusX: number, focusY: number, halfWidth: number, halfHeight: number): void {
    const data = this.image.data;
    const minX = Math.max(0, Math.floor(focusX - halfWidth) - 1);
    const maxX = Math.min(WORLD_COLS - 1, Math.ceil(focusX + halfWidth) + 1);
    const minY = Math.max(0, Math.floor(focusY - halfHeight) - 1);
    const maxY = Math.min(WORLD_ROWS - 1, Math.ceil(focusY + halfHeight) + 1);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const index = y * WORLD_COLS + x;
        const lit = field.lit[index];
        // Remembered ground is floored at a dim constant rather than faded to it, so the boundary
        // between "lit now" and "seen once" is a step the player can actually read.
        const level = lit > LIGHT.remembered ? lit : field.seen[index] ? LIGHT.remembered : 0;
        const value = Math.round(Math.max(0, Math.min(1, level)) * 255);
        const offset = index * 4;
        data[offset] = value;
        data[offset + 1] = value;
        data[offset + 2] = value;
      }
    }
    this.context.putImageData(this.image, 0, 0, minX, minY, maxX - minX + 1, maxY - minY + 1);
    this.texture.source.update();
  }
}

// A glyph canvas for authoring rooms in code.
//
// Every cell is one palette glyph, addressed by coordinate. This exists so a room
// can be *written* rather than painted: text is reviewable in a diff, and drawing
// primitives make deliberate shapes -- a pinch, a shelf, a shaft -- easy to state
// exactly. A painted PNG and a canvas-drawn room compile to the same thing.
//
// Origin is top-left, +y downward, matching the world grid and the PNG.

import { entryForGlyph } from "./palette.mjs";

export class Canvas {
  /**
   * @param {number} width
   * @param {number} height
   * @param {string} fill initial glyph for every cell
   */
  constructor(width, height, fill = "-") {
    entryForGlyph(fill);
    this.width = width;
    this.height = height;
    this.cells = new Array(width * height).fill(fill);
  }

  /** Build from ASCII rows. Rows may be ragged; short rows pad with transparent. */
  static fromAscii(rows, pad = "-") {
    const lines = (Array.isArray(rows) ? rows : String(rows).split("\n"))
      .filter((line, index, all) => !(line.trim() === "" && (index === 0 || index === all.length - 1)));
    const width = Math.max(...lines.map((line) => line.length));
    const canvas = new Canvas(width, lines.length, pad);
    lines.forEach((line, y) => {
      for (let x = 0; x < line.length; x++) canvas.set(x, y, line[x]);
    });
    return canvas;
  }

  inside(x, y) {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  /** Place one glyph. Out-of-bounds writes are ignored, so primitives can overrun. */
  set(x, y, glyph) {
    entryForGlyph(glyph);
    if (this.inside(x, y)) this.cells[y * this.width + x] = glyph;
    return this;
  }

  get(x, y) {
    return this.inside(x, y) ? this.cells[y * this.width + x] : "-";
  }

  /** Filled rectangle, inclusive of both corners. */
  rect(x0, y0, x1, y1, glyph) {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
      for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) this.set(x, y, glyph);
    }
    return this;
  }

  /** Rectangle outline only. */
  frame(x0, y0, x1, y1, glyph) {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
      this.set(x, Math.min(y0, y1), glyph);
      this.set(x, Math.max(y0, y1), glyph);
    }
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
      this.set(Math.min(x0, x1), y, glyph);
      this.set(Math.max(x0, x1), y, glyph);
    }
    return this;
  }

  /** Bresenham line, one cell thick. */
  line(x0, y0, x1, y1, glyph) {
    let x = x0;
    let y = y0;
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let error = dx - dy;
    for (;;) {
      this.set(x, y, glyph);
      if (x === x1 && y === y1) break;
      const e2 = error * 2;
      if (e2 > -dy) { error -= dy; x += sx; }
      if (e2 < dx) { error += dx; y += sy; }
    }
    return this;
  }

  /**
   * A solid band between two points.
   *
   * Not the same as stacking offset `line()` calls: at angles steeper than 45° an
   * offset Bresenham line reads as stair-step scatter rather than a continuous band,
   * which is wrong for something like a slate bank that the player must perceive as
   * one object. This walks the long axis and fills across the short one, so the band
   * is solid at every angle.
   */
  band(x0, y0, x1, y1, thickness, glyph) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const steps = Math.max(Math.abs(dx), Math.abs(dy));
    const half = (thickness - 1) / 2;
    for (let i = 0; i <= steps; i++) {
      const t = steps === 0 ? 0 : i / steps;
      const cx = x0 + dx * t;
      const cy = y0 + dy * t;
      // Thicken across whichever axis the band is *not* travelling along.
      if (Math.abs(dx) >= Math.abs(dy)) {
        for (let o = -half; o <= half; o += 1) this.set(Math.round(cx), Math.round(cy + o), glyph);
      } else {
        for (let o = -half; o <= half; o += 1) this.set(Math.round(cx + o), Math.round(cy), glyph);
      }
    }
    return this;
  }

  /** Filled ellipse. `ry` defaults to `rx`, giving a disc. */
  ellipse(cx, cy, rx, ry = rx, glyph) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const nx = (x - cx) / Math.max(0.001, rx);
        const ny = (y - cy) / Math.max(0.001, ry);
        if (nx * nx + ny * ny <= 1) this.set(x, y, glyph);
      }
    }
    return this;
  }

  /**
   * Flood-replace a region of one glyph with another, four-connected.
   * Useful for hollowing a shape after outlining it.
   */
  flood(x, y, glyph) {
    const target = this.get(x, y);
    if (target === glyph || !this.inside(x, y)) return this;
    const queue = [[x, y]];
    while (queue.length) {
      const [cx, cy] = queue.pop();
      if (!this.inside(cx, cy) || this.get(cx, cy) !== target) continue;
      this.set(cx, cy, glyph);
      queue.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
    return this;
  }

  /** Replace every occurrence of one glyph with another. */
  replace(from, to) {
    entryForGlyph(to);
    for (let i = 0; i < this.cells.length; i++) if (this.cells[i] === from) this.cells[i] = to;
    return this;
  }

  /**
   * Stamp another canvas at an offset. Transparent cells in the source are skipped,
   * so overlays compose.
   */
  stamp(other, atX, atY) {
    for (let y = 0; y < other.height; y++) {
      for (let x = 0; x < other.width; x++) {
        const glyph = other.get(x, y);
        if (glyph === "-") continue;
        this.set(atX + x, atY + y, glyph);
      }
    }
    return this;
  }

  toAscii() {
    const rows = [];
    for (let y = 0; y < this.height; y++) {
      rows.push(this.cells.slice(y * this.width, (y + 1) * this.width).join(""));
    }
    return rows.join("\n");
  }

  toPixels() {
    return this.cells.map((glyph) => entryForGlyph(glyph).colour);
  }
}

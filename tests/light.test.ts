import { describe, expect, it } from "vitest";
import type { SolidityOracle } from "../src/combat/ballField";
import { LIGHT, LightField } from "../src/light/field";

function cave(rows: string[], originX = 20, originY = 20): SolidityOracle {
  return {
    solidAt(x: number, y: number): boolean {
      const column = Math.floor(x) - originX;
      const row = Math.floor(y) - originY;
      if (row < 0 || row >= rows.length) return false;
      const line = rows[row];
      if (column < 0 || column >= line.length) return false;
      return line[column] === "#";
    },
  };
}

const OPEN: SolidityOracle = { solidAt: () => false };

describe("the light field", () => {
  it("lights open ground out to the radius and no further", () => {
    const field = new LightField(OPEN);
    field.compute([{ x: 60.5, y: 60.5, radius: 6, strength: 1 }]);
    expect(field.isLit(60.5, 60.5)).toBe(true);
    expect(field.isLit(64.5, 60.5)).toBe(true);
    // Well past the edge, with nothing in the way. Distance alone stops it.
    expect(field.isLit(70.5, 60.5)).toBe(false);
    expect(field.litAt(80.5, 60.5)).toBe(0);
  });

  it("casts a hard shadow behind a wall", () => {
    // A single pillar due east of the lamp.
    const world = cave([
      "..........",
      "..........",
      "....#.....",
      "..........",
    ]);
    const field = new LightField(world);
    field.compute([{ x: 20.5, y: 22.5, radius: 9, strength: 1 }]);
    // Near side lit, far side dark, along the same row.
    expect(field.isLit(23.5, 22.5)).toBe(true);
    expect(field.isLit(25.5, 22.5)).toBe(false);
    expect(field.isLit(27.5, 22.5)).toBe(false);
    // The rows either side of the pillar are untouched by its shadow.
    expect(field.isLit(26.5, 21.5)).toBe(true);
    expect(field.isLit(26.5, 23.5)).toBe(true);
  });

  it("does not leak light through a wall into a sealed room", () => {
    const world = cave([
      "##########",
      "#........#",
      "##########",
      "#........#",
      "##########",
    ]);
    const field = new LightField(world);
    // Standing in the upper room.
    field.compute([{ x: 24.5, y: 21.5, radius: 12, strength: 1 }]);
    for (let x = 21.5; x < 29; x++) {
      expect(field.isLit(x, 21.5), `${x} in the lit room`).toBe(true);
      expect(field.isLit(x, 23.5), `${x} in the sealed room`).toBe(false);
    }
  });

  it("sees through a doorway and not through the wall beside it", () => {
    const world = cave([
      "..........",
      "..........",
      "####.#####",
      "..........",
      "..........",
    ]);
    const field = new LightField(world);
    field.compute([{ x: 24.5, y: 21.5, radius: 10, strength: 1 }]);
    // Straight through the gap at column 4.
    expect(field.isLit(24.5, 23.5)).toBe(true);
    // Behind the slab, well off to the side of the doorway.
    expect(field.isLit(28.5, 23.5)).toBe(false);
  });

  it("remembers everything it has ever lit, and forgets no ground", () => {
    const field = new LightField(OPEN);
    field.compute([{ x: 40.5, y: 40.5, radius: 5, strength: 1 }]);
    const seenIndex = field.index(42, 40);
    expect(field.seen[seenIndex]).toBe(1);

    // The lamp moves far away. The cell goes dark, but stays remembered.
    field.compute([{ x: 90.5, y: 90.5, radius: 5, strength: 1 }]);
    expect(field.isLit(42.5, 40.5)).toBe(false);
    expect(field.seen[seenIndex]).toBe(1);
  });

  it("switches light off behind a lamp that has moved on", () => {
    // The bug this guards: clearing only around this frame's sources leaves last frame's light
    // burning, and a lamp carried down a corridor smears a lit trail behind it.
    const field = new LightField(OPEN);
    field.compute([{ x: 40.5, y: 40.5, radius: 5, strength: 1 }]);
    expect(field.isLit(40.5, 40.5)).toBe(true);
    field.compute([{ x: 60.5, y: 40.5, radius: 5, strength: 1 }]);
    expect(field.isLit(40.5, 40.5)).toBe(false);
    expect(field.isLit(60.5, 40.5)).toBe(true);
  });

  it("takes the brightest of overlapping lights rather than summing them", () => {
    const field = new LightField(OPEN);
    field.compute([
      { x: 50.5, y: 50.5, radius: 6, strength: 0.5 },
      { x: 51.5, y: 50.5, radius: 6, strength: 0.9 },
    ]);
    // Summing would blow past one and the mask would clip; brightest keeps the scale honest.
    expect(field.litAt(51.5, 50.5)).toBeLessThanOrEqual(1);
    expect(field.litAt(51.5, 50.5)).toBeCloseTo(0.9, 5);
  });

  it("lights the cell a lamp is standing in even when the grid calls it solid", () => {
    const solid: SolidityOracle = { solidAt: () => true };
    const field = new LightField(solid);
    field.compute([{ x: 50.5, y: 50.5, radius: 6, strength: 1 }]);
    expect(field.isLit(50.5, 50.5)).toBe(true);
  });

  it("treats the edge of the world as a wall", () => {
    const field = new LightField(OPEN);
    field.compute([{ x: 1.5, y: 40.5, radius: 8, strength: 1 }]);
    // Nothing off-map is ever marked, and nothing crashes reaching for it.
    expect(field.litAt(-3, 40.5)).toBe(0);
    expect(field.isLit(1.5, 40.5)).toBe(true);
  });

  it("holds remembered ground clearly below any real light", () => {
    // The mask draws a step between the two, so a lit cell must never fall into the remembered
    // band and read as memory.
    expect(LIGHT.remembered).toBeGreaterThan(0);
    expect(LIGHT.remembered).toBeLessThan(0.5);
  });
});

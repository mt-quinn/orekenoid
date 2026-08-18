import { describe, expect, it } from "vitest";
import type { SolidityOracle } from "../src/combat/ballField";
import { collectOccluders, shadowQuad, type Occluder } from "../src/light/shadow";

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

/** Even-odd point-in-polygon over a flat `[x, y, ...]` ring. */
function inside(polygon: number[], x: number, y: number): boolean {
  let hit = false;
  const count = polygon.length / 2;
  for (let i = 0, j = count - 1; i < count; j = i++) {
    const xi = polygon[i * 2];
    const yi = polygon[i * 2 + 1];
    const xj = polygon[j * 2];
    const yj = polygon[j * 2 + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** Is this point inside any shadow the eye casts in this world? */
function shadowed(world: SolidityOracle, eyeX: number, eyeY: number, x: number, y: number): boolean {
  const occluders = collectOccluders(world, 0, 0, 60, 60);
  for (const occluder of occluders) {
    const quad = shadowQuad(occluder, eyeX, eyeY, 200);
    if (quad && inside(quad, x, y)) return true;
  }
  return false;
}

describe("occluder collection", () => {
  it("finds the four faces of a lone pillar, and no more", () => {
    const world = cave([
      ".....",
      "..#..",
      ".....",
    ]);
    const occluders = collectOccluders(world, 20, 20, 25, 23);
    // One face per side. Any more means unmerged runs or duplicated edges.
    expect(occluders.length).toBe(4);
    for (const occluder of occluders) {
      expect(Math.hypot(occluder.x2 - occluder.x1, occluder.y2 - occluder.y1)).toBeCloseTo(1, 6);
    }
  });

  it("merges a long wall into one face instead of one per cell", () => {
    const world = cave([
      "..........",
      "##########",
      "..........",
    ]);
    const occluders = collectOccluders(world, 20, 20, 30, 23);
    // Two long faces, top and bottom. Twenty would mean the merge is not working, and a screen of
    // ordinary cave would cost thousands of polygons instead of a couple of hundred.
    const long = occluders.filter((o) => Math.abs(o.x2 - o.x1) >= 9);
    expect(long.length).toBe(2);
    expect(occluders.length).toBeLessThan(6);
  });

  it("points every normal into the open air", () => {
    const world = cave([
      ".....",
      "..#..",
      ".....",
    ]);
    for (const occluder of collectOccluders(world, 20, 20, 25, 23)) {
      const midX = (occluder.x1 + occluder.x2) / 2 + occluder.nx * 0.25;
      const midY = (occluder.y1 + occluder.y2) / 2 + occluder.ny * 0.25;
      expect(world.solidAt(midX, midY)).toBe(false);
      // And rock on the other side.
      const backX = (occluder.x1 + occluder.x2) / 2 - occluder.nx * 0.25;
      const backY = (occluder.y1 + occluder.y2) / 2 - occluder.ny * 0.25;
      expect(world.solidAt(backX, backY)).toBe(true);
    }
  });
});

describe("shadow quads", () => {
  const face: Occluder = { x1: 5, y1: 5, x2: 6, y2: 5, nx: 0, ny: -1 };

  it("refuses a face the eye is behind", () => {
    // Eye below the face, which opens upward: this face is turned away and casts nothing.
    expect(shadowQuad(face, 5.5, 9, 100)).toBeNull();
    expect(shadowQuad(face, 5.5, 1, 100)).not.toBeNull();
  });

  it("extrudes away from the eye, not toward it", () => {
    const quad = shadowQuad(face, 5.5, 1, 100)!;
    // The far pair is on the opposite side of the face from the eye.
    expect(quad[5]).toBeGreaterThan(5);
    expect(quad[7]).toBeGreaterThan(5);
  });

  it("refuses a face the eye is standing exactly on", () => {
    expect(shadowQuad(face, 5, 5, 100)).toBeNull();
  });
});

describe("what a wall actually hides", () => {
  const world = cave([
    "..........",
    "..........",
    "....#.....",
    "..........",
    "..........",
  ]);

  it("hides what is directly behind a pillar", () => {
    // Eye due west of the pillar at cell (24, 22).
    expect(shadowed(world, 20.5, 22.5, 27.5, 22.5)).toBe(true);
    expect(shadowed(world, 20.5, 22.5, 40.5, 22.5)).toBe(true);
  });

  it("hides nothing clear of the pillar, however far away it is", () => {
    // This is the whole difference from the lantern the old mask was: thirty-five cells away with
    // nothing in the way is visible, because distance never hides anything.
    expect(shadowed(world, 20.5, 22.5, 50.5, 12.5)).toBe(false);
    expect(shadowed(world, 20.5, 22.5, 55.5, 33.5)).toBe(false);
  });

  it("does not hide the face of the wall the eye is looking at", () => {
    // The near side of the pillar is lit; only what is behind it is not.
    expect(shadowed(world, 20.5, 22.5, 23.9, 22.5)).toBe(false);
  });

  it("throws a wedge that widens with distance", () => {
    // A shadow from a one-cell pillar covers more than one cell of width far away, which is what
    // makes it a wedge rather than the cell-wide staircase the grid mask drew.
    const nearWidth = [22.2, 22.8].filter((y) => shadowed(world, 20.5, 22.5, 26, y)).length;
    const farWidth = [21.4, 22.5, 23.6].filter((y) => shadowed(world, 20.5, 22.5, 46, y)).length;
    expect(nearWidth).toBe(2);
    expect(farWidth).toBe(3);
  });

  it("leaves a room with no walls entirely visible", () => {
    const open: SolidityOracle = { solidAt: () => false };
    expect(shadowed(open, 30.5, 30.5, 44.5, 38.5)).toBe(false);
  });
});

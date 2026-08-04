import { describe, expect, it } from "vitest";
import { annotationAt, atlasToWorld, ATLAS_HEIGHT, ATLAS_ICONS, ATLAS_SCALE, ATLAS_WIDTH } from "../src/atlas";
import { WORLD_COLS, WORLD_ROWS } from "../src/config";
import type { MapAnnotation } from "../src/persistence";

const note = (id: string, x: number, y: number): MapAnnotation => ({ id, x, y, icon: ATLAS_ICONS[0], note: "" });

describe("atlas geometry", () => {
  it("fits the whole world inside the 1280x720 aperture at fit zoom", () => {
    expect(ATLAS_WIDTH).toBe(WORLD_COLS * ATLAS_SCALE);
    expect(ATLAS_HEIGHT).toBe(WORLD_ROWS * ATLAS_SCALE);
    expect(ATLAS_WIDTH).toBeLessThanOrEqual(1280);
    expect(ATLAS_HEIGHT).toBeLessThanOrEqual(720);
  });

  it("maps canvas pixels back to fractional world cells", () => {
    expect(atlasToWorld(0, 0)).toEqual({ x: 0, y: 0 });
    expect(atlasToWorld(ATLAS_SCALE * 10, ATLAS_SCALE * 4)).toEqual({ x: 10, y: 4 });
    // Fractional, so a marker sits exactly where it was clicked rather than
    // snapping to a cell corner.
    expect(atlasToWorld(ATLAS_SCALE * 10 + ATLAS_SCALE / 2, 0).x).toBe(10.5);
  });
});

describe("annotation hit testing", () => {
  const annotations = [note("a", 20, 20), note("b", 60, 40)];

  it("finds a marker under the click", () => {
    expect(annotationAt(annotations, 20 * ATLAS_SCALE, 20 * ATLAS_SCALE)?.id).toBe("a");
    expect(annotationAt(annotations, 60 * ATLAS_SCALE + 4, 40 * ATLAS_SCALE - 3)?.id).toBe("b");
  });

  it("returns nothing when the click is on empty map", () => {
    expect(annotationAt(annotations, 120 * ATLAS_SCALE, 100 * ATLAS_SCALE)).toBeNull();
  });

  it("prefers the nearest marker when two overlap", () => {
    const crowded = [note("far", 30, 30), note("near", 30.8, 30)];
    expect(annotationAt(crowded, 30.9 * ATLAS_SCALE, 30 * ATLAS_SCALE)?.id).toBe("near");
  });

  it("respects the hit radius", () => {
    expect(annotationAt(annotations, 20 * ATLAS_SCALE + 40, 20 * ATLAS_SCALE)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { CONTOUR, traceVisualContour, type VisualField } from "../src/light/contour";
import { shadowQuad, type Occluder } from "../src/light/shadow";
import type { OrientedFootprint } from "../src/types";

/**
 * A world with a real curved boundary.
 *
 * The point of the contour tracer is to follow the outline the *renderer* draws rather than the cell
 * grid underneath it, so the fixture has to be a smooth field rather than a grid of blocks. A disc:
 * positive inside, negative outside, so the boundary is a circle at no angle the cell grid has.
 */
function disc(centreX: number, centreY: number, radius: number, cuts: OrientedFootprint[] = []): VisualField {
  const field = (x: number, y: number) => radius - Math.hypot(x - centreX, y - centreY);
  const inCut = (x: number, y: number) => cuts.some((cut) => {
    const dx = x - cut.center.x;
    const dy = y - cut.center.y;
    const u = dx * Math.cos(cut.angle) + dy * Math.sin(cut.angle);
    const v = -dx * Math.sin(cut.angle) + dy * Math.cos(cut.angle);
    return Math.abs(u) <= cut.halfWidth && Math.abs(v) <= cut.halfHeight;
  });
  return {
    // The field the tracer follows already has excavation in it, which is the whole point: a contour
    // traced from geology alone casts shadows out of rock that has been dug away.
    drawnFieldAt: (x, y) => (inCut(x, y) ? -1 : field(x, y)),
    visualSolidAt: (x, y) => field(x, y) > 0 && !inCut(x, y),
    cutsInRegion: () => cuts,
  };
}

const EMPTY: VisualField = {
  drawnFieldAt: () => -1,
  visualSolidAt: () => false,
  cutsInRegion: () => [],
};

describe("tracing the drawn silhouette", () => {
  const world = disc(60, 60, 8);
  const faces = traceVisualContour(world, 40, 40, 80, 80);

  it("finds the boundary and nothing else", () => {
    expect(faces.length).toBeGreaterThan(8);
    // Every face sits on the circle, to within the simplification tolerance.
    for (const face of faces) {
      const midX = (face.x1 + face.x2) / 2;
      const midY = (face.y1 + face.y2) / 2;
      expect(Math.abs(Math.hypot(midX - 60, midY - 60) - 8)).toBeLessThan(CONTOUR.simplifyTolerance * 3);
    }
  });

  it("follows the curve at angles the cell grid cannot express", () => {
    // The old collector could only emit axis-aligned faces. A circle has tangents everywhere, so a
    // tracer that follows it must produce plenty that are neither horizontal nor vertical.
    const oblique = faces.filter((face) => {
      const angle = Math.abs(Math.atan2(face.y2 - face.y1, face.x2 - face.x1)) % (Math.PI / 2);
      return angle > 0.15 && angle < Math.PI / 2 - 0.15;
    });
    expect(oblique.length).toBeGreaterThan(faces.length * 0.5);
  });

  it("points every normal out of the rock", () => {
    for (const face of faces) {
      const midX = (face.x1 + face.x2) / 2;
      const midY = (face.y1 + face.y2) / 2;
      // Outward from the disc's centre is the open side.
      const outX = (midX - 60) / Math.hypot(midX - 60, midY - 60);
      const outY = (midY - 60) / Math.hypot(midX - 60, midY - 60);
      expect(face.nx * outX + face.ny * outY).toBeGreaterThan(0.5);
    }
  });

  it("simplifies to about the count the cell grid cost, not ten times it", () => {
    // Chaining and Douglas-Peucker are what make tracing at sub-cell resolution affordable. Without
    // them this is one face per sub-cell square crossed.
    expect(faces.length).toBeLessThan(80);
  });

  it("traces nothing in a region with no rock in it", () => {
    expect(traceVisualContour(EMPTY, 0, 0, 30, 30)).toEqual([]);
  });
});

describe("excavated edges", () => {
  it("keeps a cut's own edges straight instead of resampling them", () => {
    // A cut clean through the middle of the disc, at an angle no sampling grid shares.
    const cut: OrientedFootprint = {
      center: { x: 60, y: 60 },
      halfWidth: 6,
      halfHeight: 1.5,
      angle: 0.37,
    };
    const faces = traceVisualContour(disc(60, 60, 8, [cut]), 40, 40, 80, 80);
    // The cut's long sides are 12 cells; a face that long can only have come from the rectangle
    // itself, because the tracer never emits anything longer than a sub-cell square.
    const long = faces.filter((face) => Math.hypot(face.x2 - face.x1, face.y2 - face.y1) > 6);
    expect(long.length).toBeGreaterThan(0);
    for (const face of long) {
      const angle = Math.atan2(face.y2 - face.y1, face.x2 - face.x1);
      const aligned = Math.min(
        Math.abs(Math.abs(angle) - 0.37),
        Math.abs(Math.abs(angle) - (Math.PI - 0.37)),
      );
      expect(aligned).toBeLessThan(0.02);
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

describe("what the drawn rock hides", () => {
  const world = disc(60, 60, 5);
  const faces = traceVisualContour(world, 40, 40, 80, 80);
  const shadowed = (eyeX: number, eyeY: number, x: number, y: number) => faces.some((face) => {
    const quad = shadowQuad(face, eyeX, eyeY, 200);
    return quad ? inside(quad, x, y) : false;
  });

  it("hides what is directly behind the rock", () => {
    // Eye due west of the disc, target due east of it.
    expect(shadowed(45, 60, 70, 60)).toBe(true);
    expect(shadowed(45, 60, 95, 60)).toBe(true);
  });

  it("hides nothing clear of it, however far away", () => {
    expect(shadowed(45, 60, 95, 40)).toBe(false);
    expect(shadowed(45, 60, 95, 80)).toBe(false);
  });

  it("does not hide the near face the eye is looking at", () => {
    expect(shadowed(45, 60, 54.6, 60)).toBe(false);
  });

  it("throws a wedge that widens with distance", () => {
    const near = [58, 62].filter((y) => shadowed(45, 60, 68, y)).length;
    const far = [52, 60, 68].filter((y) => shadowed(45, 60, 110, y)).length;
    expect(near).toBe(2);
    expect(far).toBe(3);
  });
});

/**
 * A convex polygon as a signed field: positive inside, negative outside, zero on the boundary.
 *
 * Straight edges meeting at a chosen angle are the point. A disc has curvature everywhere but a
 * corner nowhere, and the corner is what broke.
 */
function wedge(points: Array<[number, number]>): VisualField {
  const field = (x: number, y: number) => {
    let inward = Infinity;
    for (let i = 0; i < points.length; i++) {
      const [ax, ay] = points[i];
      const [bx, by] = points[(i + 1) % points.length];
      const dx = bx - ax;
      const dy = by - ay;
      const length = Math.hypot(dx, dy);
      // Wound anticlockwise, so the inside is to the left of every edge.
      inward = Math.min(inward, ((x - ax) * dy - (y - ay) * dx) / length);
    }
    return inward;
  };
  return {
    drawnFieldAt: field,
    visualSolidAt: (x, y) => field(x, y) > 0,
    cutsInRegion: () => [],
  };
}

describe("sharp corners", () => {
  /** Is this point hidden from the eye by the traced silhouette? */
  const hiddenBy = (faces: Occluder[], eyeX: number, eyeY: number, x: number, y: number) =>
    faces.some((face) => {
      const quad = shadowQuad(face, eyeX, eyeY, 300);
      return quad ? inside(quad, x, y) : false;
    });

  // Apexes from a blunt right angle down to a needle. A chord across a corner has its midpoint
  // outside the rock, and the sharper the corner the further outside it sits -- which used to delete
  // the face and open a wedge of light straight through solid ground.
  for (const halfSpan of [10, 5, 2, 1]) {
    it(`casts from an apex ${halfSpan} cells across`, () => {
      const world = wedge([[60, 60], [85, 60 + halfSpan], [85, 60 - halfSpan]]);
      const faces = traceVisualContour(world, 45, 40, 100, 80);
      // Every point straight behind the wedge, along the axis the apex points down.
      for (const x of [70, 80, 90, 110]) {
        expect(hiddenBy(faces, 40, 60, x, 60)).toBe(true);
      }
    });
  }

  it("keeps every face a real crossing produced", () => {
    // Nothing is filtered from a traced contour, so a chain's chords still meet end to end and the
    // quads they cast share edges rather than leaving slivers between them.
    const world = wedge([[60, 60], [85, 61], [85, 59]]);
    const faces = traceVisualContour(world, 45, 40, 100, 80);
    const ends = new Map<string, number>();
    for (const face of faces) {
      for (const key of [`${face.x1.toFixed(4)},${face.y1.toFixed(4)}`, `${face.x2.toFixed(4)},${face.y2.toFixed(4)}`]) {
        ends.set(key, (ends.get(key) ?? 0) + 1);
      }
    }
    // An endpoint shared by exactly one face is a loose end: the run stopped there. On a closed
    // silhouette wholly inside the traced region there should be at most the two the loop was cut at.
    const loose = [...ends.values()].filter((count) => count === 1).length;
    expect(loose).toBeLessThanOrEqual(2);
  });

  it("points every normal out of the wedge, corners included", () => {
    const world = wedge([[60, 60], [85, 62], [85, 58]]);
    for (const face of traceVisualContour(world, 45, 40, 100, 80)) {
      const midX = (face.x1 + face.x2) / 2;
      const midY = (face.y1 + face.y2) / 2;
      // A step along the normal must leave the rock, and a step against it must not.
      expect(world.visualSolidAt(midX + face.nx * 0.5, midY + face.ny * 0.5)).toBe(false);
    }
  });
});

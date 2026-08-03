import { describe, expect, it } from "vitest";
import { WorldModel } from "../src/world";
import type { FrameGeometry } from "../src/types";

describe("continuous-angle claim remeshing", () => {
  it("round-trips arbitrary headings through frame-local space", () => {
    const world = new WorldModel();
    const frame: FrameGeometry = { origin: { x: 24.25, y: 14.4 }, angle: 0.37, width: 11, depth: 11 };
    const point = world.localToWorld(3.2, 7.6, frame);
    const local = world.worldToLocal(point.x, point.y, frame);
    expect(local.x).toBeCloseTo(3.2, 8);
    expect(local.y).toBeCloseTo(7.6, 8);
  });

  it("creates paddle-aligned bricks and persists their exact oriented cuts", () => {
    const world = new WorldModel();
    const frame: FrameGeometry = { origin: { x: 24, y: 14 }, angle: Math.PI / 2 + 0.31, width: 11, depth: 11 };
    const bricks = world.framedBricks(frame);
    expect(bricks.length).toBeGreaterThan(0);
    // Persistent structure is never cut, so an excavation assertion must use a
    // clearable brick. The Landing deliberately contains persistent lander hull.
    const brick = bricks.find((candidate) => !candidate.persistent);
    expect(brick).toBeDefined();
    expect(brick!.footprint.angle).toBe(frame.angle);
    const solidPoint = Array.from({ length: 25 }, (_, index) => {
      const sx = index % 5;
      const sy = Math.floor(index / 5);
      return world.localToWorld(brick!.u + (sx - 2) * 0.2, brick!.v + (sy - 2) * 0.2, frame);
    }).find((point) => world.solidAt(point.x, point.y) && !world.cellAt(point.x, point.y)?.persistent);
    expect(solidPoint).toBeDefined();
    world.removeFootprint(brick!.footprint);
    expect(world.solidAt(solidPoint!.x, solidPoint!.y)).toBe(false);
  });

  it("exhausts the complete rotated frame except persistent landmarks", () => {
    const world = new WorldModel();
    const frame: FrameGeometry = { origin: { x: 24, y: 14 }, angle: Math.PI / 2 + 0.18, width: 11, depth: 11 };
    world.exhaustFrame(frame);
    let checked = 0;
    for (let v = 0.1; v < frame.depth + 0.5; v += 0.2) for (let u = -frame.width / 2 + 0.1; u < frame.width / 2; u += 0.2) {
      const point = world.localToWorld(u, v, frame);
      // Generator contract 7: landmarks survive claim resolution. Everything else
      // must leave no sub-brick terrain shards behind.
      if (world.cellAt(point.x, point.y)?.persistent) continue;
      checked++;
      expect(world.solidAt(point.x, point.y)).toBe(false);
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it("keeps persistent landmarks solid through a full exhaustion", () => {
    const world = new WorldModel();
    const frame: FrameGeometry = { origin: { x: 24, y: 14 }, angle: Math.PI / 2, width: 11, depth: 11 };
    const persistentBefore = world.framedBricks(frame).filter((brick) => brick.persistent).length;
    expect(persistentBefore).toBeGreaterThan(0);
    world.exhaustFrame(frame);
    const stillSolid = world.generated.cells.flat().filter((cell) => cell.persistent && cell.solid).length;
    expect(stillSolid).toBeGreaterThan(0);
  });
});

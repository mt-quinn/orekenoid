import { describe, expect, it } from "vitest";
import { CELL, DEFAULT_SEED } from "../src/config";
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

describe("drone hull", () => {
  // Surveyor: 3.1 cells of paddle plus 13px of nose each side, and 10px of
  // half-thickness. So ~3.7 cells long and ~0.48 across -- a 7.7:1 hull.
  const HALF_LENGTH = 3.1 / 2 + 13 / CELL;
  const HALF_THICKNESS = 10 / CELL;
  const LONG_AXIS_HORIZONTAL = 0;
  const LONG_AXIS_VERTICAL = Math.PI / 2;

  /**
   * A pocket of open rock split by a vertical wall with a horizontal slot in it,
   * `gapRows` cells tall and centred on row 30. Threading it means presenting the
   * hull's thin axis vertically -- long axis horizontal.
   */
  function slotWorld(gapRows: number) {
    const world = new WorldModel(DEFAULT_SEED);
    for (let y = 20; y < 40; y++) {
      for (let x = 60; x < 90; x++) world.cells[y][x].solid = false;
    }
    const top = 30.5 - gapRows / 2;
    const bottom = 30.5 + gapRows / 2;
    for (let y = 20; y < 40; y++) {
      if (y + 0.5 >= top && y + 0.5 <= bottom) continue;
      world.cells[y][75].solid = true;
    }
    return world;
  }

  /** The centre of the slot, in world pixels. */
  const inSlot = { x: 75.5 * CELL, y: 30.5 * CELL };

  it("threads a one-cell slot when the thin axis faces it", () => {
    expect(slotWorld(1).isHullOpen(inSlot.x, inSlot.y, LONG_AXIS_HORIZONTAL, HALF_LENGTH, HALF_THICKNESS)).toBe(true);
  });

  it("refuses the same slot when turned broadside to it", () => {
    // The whole point of an oriented hull: the identical position fails purely
    // because of heading, so turning is a traversal decision rather than a flourish.
    expect(slotWorld(1).isHullOpen(inSlot.x, inSlot.y, LONG_AXIS_VERTICAL, HALF_LENGTH, HALF_THICKNESS)).toBe(false);
  });

  it("fits broadside only once the gap exceeds the hull's length", () => {
    // ~3.7 cells long, so three rows is not enough and six is.
    expect(slotWorld(3).isHullOpen(inSlot.x, inSlot.y, LONG_AXIS_VERTICAL, HALF_LENGTH, HALF_THICKNESS)).toBe(false);
    expect(slotWorld(6).isHullOpen(inSlot.x, inSlot.y, LONG_AXIS_VERTICAL, HALF_LENGTH, HALF_THICKNESS)).toBe(true);
  });

  it("never tunnels a solid one-cell wall, at any heading", () => {
    const world = new WorldModel(DEFAULT_SEED);
    for (let y = 20; y < 40; y++) for (let x = 60; x < 90; x++) world.cells[y][x].solid = false;
    for (let y = 20; y < 40; y++) world.cells[y][75].solid = true;
    // A sampler stepping a full cell or more would slip between samples at some
    // angles and report a straddled wall as clear.
    for (let step = 0; step < 64; step++) {
      const heading = (step / 64) * Math.PI * 2;
      expect(world.isHullOpen(75.5 * CELL, 30.5 * CELL, heading, HALF_LENGTH, HALF_THICKNESS)).toBe(false);
    }
  });

  it("scales with the equipped paddle, so a wider emitter costs mobility", () => {
    const world = slotWorld(5);
    const bastion = 4.8 / 2 + 13 / CELL;
    expect(world.isHullOpen(inSlot.x, inSlot.y, LONG_AXIS_VERTICAL, HALF_LENGTH, HALF_THICKNESS)).toBe(true);
    expect(world.isHullOpen(inSlot.x, inSlot.y, LONG_AXIS_VERTICAL, bastion, HALF_THICKNESS)).toBe(false);
  });
});

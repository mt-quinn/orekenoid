import { describe, expect, it } from "vitest";
import { CELL, DEFAULT_SEED, WORLD_COLS, WORLD_ROWS } from "../src/config";
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

  it("leaves standing bricks as terrain and cuts only what was broken", () => {
    const world = new WorldModel();
    const frame: FrameGeometry = { origin: { x: 24, y: 14 }, angle: Math.PI / 2 + 0.18, width: 11, depth: 11 };
    const bricks = world.framedBricks(frame).filter((brick) => !brick.persistent);
    expect(bricks.length).toBeGreaterThan(20);
    // Half the board broken, half abandoned -- the shape of ending a claim early.
    const broken = bricks.filter((_, index) => index % 2 === 0);
    const standing = bricks.filter((_, index) => index % 2 === 1);
    for (const brick of broken) world.removeFootprint(brick.footprint, false, brick.persistent);
    world.exhaustFrame(frame, standing);

    for (const brick of standing) {
      // Sampled across the footprint rather than at its exact centre. A brick forms on 28% coverage,
      // so its centre point is not necessarily rock even before anything is cut -- the invariant is
      // that a spared brick keeps the rock it had, not that one particular point is solid.
      let solidSamples = 0;
      for (let dy = -0.3; dy <= 0.3; dy += 0.3) for (let dx = -0.3; dx <= 0.3; dx += 0.3) {
        if (world.solidAt(brick.footprint.center.x + dx, brick.footprint.center.y + dy)) solidSamples++;
      }
      expect(solidSamples).toBeGreaterThan(0);
      // Ore under abandoned rock is claimable again, not spent. Only cells still solid at their
      // own centre count: a source cell shared with a broken neighbour was genuinely dug out, and
      // its ore left with the rock.
      for (const cell of brick.sourceCells) {
        if (!world.solidAt(cell.x + 0.5, cell.y + 0.5)) continue;
        expect(cell.exhausted).toBe(false);
      }
    }
    for (const brick of broken) {
      expect(world.solidAt(brick.footprint.center.x, brick.footprint.center.y)).toBe(false);
    }
  });

  it("leaves no shards in a square it broke through, even beside a spared one", () => {
    const world = new WorldModel();
    const frame: FrameGeometry = { origin: { x: 24, y: 14 }, angle: Math.PI / 2, width: 11, depth: 11 };
    const bricks = world.framedBricks(frame);
    // Only the far half is abandoned, so the spared set neighbours cut ground on the lattice.
    const standing = bricks.filter((brick) => brick.v > frame.depth / 2);
    expect(standing.length).toBeGreaterThan(0);
    world.exhaustFrame(frame, standing);

    const spared = new Set(standing.map((brick) => `${Math.round(brick.u + frame.width / 2 - 0.5)},${Math.round(brick.v - 0.5)}`));
    let checked = 0;
    for (let row = 0; row < frame.depth; row++) for (let column = 0; column < frame.width; column++) {
      if (spared.has(`${column},${row}`)) continue;
      // Inside this lattice square only, with a margin so a boundary sample cannot be attributed to
      // the spared neighbour next door.
      for (let dv = 0.15; dv < 1; dv += 0.2) for (let du = 0.15; du < 1; du += 0.2) {
        const point = world.localToWorld(-frame.width / 2 + column + du, row + dv, frame);
        checked++;
        expect(world.solidAt(point.x, point.y)).toBe(false);
      }
    }
    expect(checked).toBeGreaterThan(500);
  });

  it("still clears the whole frame when nothing is left standing", () => {
    const world = new WorldModel();
    const frame: FrameGeometry = { origin: { x: 24, y: 14 }, angle: Math.PI / 2 + 0.18, width: 11, depth: 11 };
    world.exhaustFrame(frame, []);
    for (const brick of world.framedBricks(frame)) {
      if (brick.persistent) continue;
      expect(world.solidAt(brick.footprint.center.x, brick.footprint.center.y)).toBe(false);
    }
  });


});

/**
 * Set a cell's solidity for a hand-built test world.
 *
 * Both flags, and that is the point. `solid` is what the model answers with and `baseSolid` is what
 * the terrain is *drawn* from -- and traversal now follows the drawing, so a fixture that carves only
 * one of them carves a passage the drone cannot see and therefore will not enter.
 */
function carve(world: WorldModel, x: number, y: number, solid: boolean): void {
  const cell = world.cells[y][x];
  cell.solid = solid;
  cell.baseSolid = solid;
}

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
      for (let x = 60; x < 90; x++) carve(world, x, y, false);
    }
    const top = 30.5 - gapRows / 2;
    const bottom = 30.5 + gapRows / 2;
    for (let y = 20; y < 40; y++) {
      if (y + 0.5 >= top && y + 0.5 <= bottom) continue;
      carve(world, 75, y, true);
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
    for (let y = 20; y < 40; y++) for (let x = 60; x < 90; x++) carve(world, x, y, false);
    for (let y = 20; y < 40; y++) carve(world, 75, y, true);
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

describe("claims at the edge of the world", () => {
  // A frame used to be refused outright if any corner left the map, which cost the player every
  // claim along a border. Nothing about the board minds: outside the world there is simply nothing to
  // cut, so the overhanging part is empty space.
  it("samples an overhanging frame without complaint, and yields only the cells that exist", () => {
    const world = new WorldModel();
    // Hard against the right-hand edge, half the frame past it.
    const frame: FrameGeometry = {
      origin: { x: WORLD_COLS - 2, y: WORLD_ROWS / 2 },
      angle: 0,
      width: 11,
      depth: 11,
    };
    const bricks = world.framedBricks(frame);
    // Every brick that came back is a real cell inside the world -- the out-of-bounds half
    // contributed nothing rather than producing phantom material or throwing.
    for (const brick of bricks) {
      expect(brick.cell.x).toBeGreaterThanOrEqual(0);
      expect(brick.cell.x).toBeLessThan(WORLD_COLS);
      expect(brick.cell.y).toBeGreaterThanOrEqual(0);
      expect(brick.cell.y).toBeLessThan(WORLD_ROWS);
    }
  });

  it("reports material by what is in the frame, not by where the frame is", () => {
    const world = new WorldModel();
    // Mostly off the map, but still overlapping solid rock: claimable.
    const overhanging: FrameGeometry = {
      origin: { x: WORLD_COLS - 3, y: WORLD_ROWS / 2 },
      angle: 0,
      width: 11,
      depth: 11,
    };
    expect(world.frameHasMaterial(overhanging)).toBe(true);

    // Entirely outside the world: nothing to cut, and this is the one case that should refuse.
    const beyond: FrameGeometry = {
      origin: { x: WORLD_COLS + 40, y: WORLD_ROWS + 40 },
      angle: 0,
      width: 11,
      depth: 11,
    };
    expect(world.frameHasMaterial(beyond)).toBe(false);
    expect(world.framedBricks(beyond)).toHaveLength(0);
  });
});

describe("the edge of the world is a wall", () => {
  // A frame may hang off the map -- outside it there is simply nothing to cut. The drone may not:
  // digging a hole to the boundary used to let it fly straight out into nothing, because the hull
  // check only ever asked whether a cell was solid and a cell that does not exist is not solid.
  it("refuses a hull pose outside the world even where nothing is solid", () => {
    const world = new WorldModel();
    const halfLength = 2;
    const halfThickness = 0.4;

    // Well outside every boundary. Nothing out here is solid, so before the fix all four fitted.
    const outside: Array<[number, number]> = [
      [-8 * CELL, (WORLD_ROWS / 2) * CELL],
      [(WORLD_COLS + 8) * CELL, (WORLD_ROWS / 2) * CELL],
      [(WORLD_COLS / 2) * CELL, -8 * CELL],
      [(WORLD_COLS / 2) * CELL, (WORLD_ROWS + 8) * CELL],
    ];
    for (const [x, y] of outside) {
      expect(world.isHullOpen(x, y, 0, halfLength, halfThickness)).toBe(false);
    }
  });

  it("refuses a pose that only partly leaves the world", () => {
    const world = new WorldModel();
    // Centre just inside the last column, but long enough that the nose crosses the boundary.
    const x = (WORLD_COLS - 1) * CELL;
    const y = (WORLD_ROWS / 2) * CELL;
    expect(world.isHullOpen(x, y, 0, 3, 0.4)).toBe(false);
  });

  it("still allows ordinary open ground away from the border", () => {
    const world = new WorldModel();
    // The landing is carved open by the generator, so the drone must fit where it spawns.
    const start = world.start;
    expect(world.isHullOpen(start.x * CELL, start.y * CELL, Math.PI / 2, 1.5, 0.4)).toBe(true);
  });

  it("keeps claim sampling unaffected, since a frame may still overhang", () => {
    const world = new WorldModel();
    const frame: FrameGeometry = {
      origin: { x: WORLD_COLS - 3, y: WORLD_ROWS / 2 },
      angle: 0,
      width: 11,
      depth: 11,
    };
    // The border being impassable to the hull must not make it impassable to a survey frame.
    expect(world.frameHasMaterial(frame)).toBe(true);
  });
});

describe("what blocks is what is drawn", () => {
  /**
   * The bug this exists for: slate.
   *
   * Collision was exact per cell while the terrain is drawn from an organic contour that pulls inside
   * the cell grid by up to half a cell. Buried in a rock mass that gap is unreachable and invisible.
   * Excavate around it and it becomes both -- and slate is what is left standing, because it is
   * non-liable and players deliberately leave it as a wall. The result was rock that had vanished but
   * still stopped the drone.
   */
  it("never blocks the drone with rock it has not drawn", () => {
    const world = new WorldModel();
    // A frame with slate in it, cleared of everything else, as a player leaving a slate bank would.
    let chosen: { frame: FrameGeometry; slate: ReturnType<WorldModel["framedBricks"]> } | null = null;
    for (let y = 12; y < 130 && !chosen; y += 3) {
      for (let x = 12; x < 220 && !chosen; x += 3) {
        const frame: FrameGeometry = { origin: { x, y }, angle: Math.PI / 2, width: 7, depth: 15 };
        const bricks = world.framedBricks(frame);
        const slate = bricks.filter((brick) => brick.cell.kind === "slate");
        if (slate.length >= 4 && bricks.length > 20) chosen = { frame, slate };
      }
    }
    expect(chosen, "the world should contain a slate bank").not.toBeNull();
    const { frame, slate } = chosen!;

    for (const brick of world.framedBricks(frame)) {
      if (brick.cell.kind === "slate") continue;
      world.removeFootprint(brick.footprint, false, brick.persistent);
    }
    world.exhaustFrame(frame, slate);

    // Every point in the claim: if it stops the drone, it must be visible.
    let blockedAndUndrawn = 0;
    for (let v = 0.05; v < frame.depth; v += 0.1) {
      for (let u = -frame.width / 2 + 0.05; u < frame.width / 2; u += 0.1) {
        const point = world.localToWorld(u, v, frame);
        if (world.blocksAt(point.x, point.y) && !world.visualSolidAt(point.x, point.y)) blockedAndUndrawn++;
      }
    }
    expect(blockedAndUndrawn).toBe(0);
  });

  it("still blocks the drone with rock it has drawn", () => {
    // The other half, and the reason this cannot be fixed by simply blocking less: a slate bank left
    // standing is a wall, and it has to still be one.
    const world = new WorldModel();
    let solidPoints = 0;
    for (let y = 20; y < 60; y += 0.5) {
      for (let x = 20; x < 60; x += 0.5) {
        if (!world.visualSolidAt(x, y)) continue;
        solidPoints++;
        expect(world.blocksAt(x, y)).toBe(true);
      }
    }
    expect(solidPoints).toBeGreaterThan(200);
  });
});

describe("what the Atlas can see", () => {
  it("counts cut ground as surveyed", () => {
    // The Atlas draws only what has been discovered, and discovery used to come only from where the
    // drone had flown. A claim is staked out in front of the machine, so an excavation could be
    // finished and banked while the map still showed unsurveyed void over the hole.
    const world = new WorldModel("atlas-discovery");
    const at = { x: 120, y: 70 };
    expect(world.isDiscovered(at.x, at.y)).toBe(false);
    world.removeFootprint({ center: { x: at.x + 0.5, y: at.y + 0.5 }, halfWidth: 0.5, halfHeight: 0.5, angle: 0 }, true);
    expect(world.isDiscovered(at.x, at.y)).toBe(true);
  });

  it("reads a cut cell as excavated rather than as natural cave", () => {
    // Excavated is `solidAt` false with `baseSolid` still true, which is the pair the Atlas keys its
    // warmer tone off. If a cut cleared the geology too, mined ground would be indistinguishable from
    // a cavern the player never touched.
    const world = new WorldModel("atlas-excavated");
    let solid: { x: number; y: number } | null = null;
    for (let y = 40; y < 90 && !solid; y++) {
      for (let x = 40; x < 200; x++) {
        if (world.solidAt(x + 0.5, y + 0.5)) { solid = { x, y }; break; }
      }
    }
    expect(solid).not.toBeNull();
    world.removeFootprint({ center: { x: solid!.x + 0.5, y: solid!.y + 0.5 }, halfWidth: 0.5, halfHeight: 0.5, angle: 0 }, true);
    expect(world.solidAt(solid!.x + 0.5, solid!.y + 0.5)).toBe(false);
    expect(world.cells[solid!.y][solid!.x].baseSolid).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { WORLD_COLS, WORLD_ROWS } from "../src/config";
import {
  createFieldBall,
  FIELD,
  pathHitsCircle,
  stepFieldBall,
  type FieldBall,
  type SolidityOracle,
} from "../src/combat/ballField";

/**
 * A hand-drawn cave. `#` is rock, anything else is air, and the map is pinned at an offset well
 * inside the world so the map edge is never the thing under test unless a test asks for it.
 */
function cave(rows: string[], originX = 20, originY = 20): SolidityOracle & { originX: number; originY: number } {
  return {
    originX,
    originY,
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

const speedOf = (ball: FieldBall) => Math.hypot(ball.vx, ball.vy);

/** The invariant every other test leans on: the ball is never left standing inside rock. */
function expectOutsideRock(ball: FieldBall, world: SolidityOracle): void {
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const x = ball.x + Math.cos(angle) * ball.radius * 0.98;
    const y = ball.y + Math.sin(angle) * ball.radius * 0.98;
    expect(world.solidAt(x, y)).toBe(false);
  }
}

describe("world-space ball solver", () => {
  it("travels open ground at a constant speed", () => {
    const ball = createFieldBall(50, 50, 0.7);
    const before = speedOf(ball);
    let distance = 0;
    for (let i = 0; i < 120; i++) distance += stepFieldBall(ball, OPEN, 1 / 60).distance;
    expect(speedOf(ball)).toBeCloseTo(before, 6);
    expect(distance).toBeCloseTo(FIELD.speed * 2, 1);
  });

  it("rebounds off a flat wall without losing pace", () => {
    // A floor at row 3. The ball is dropped onto it at an angle.
    const world = cave([
      "..........",
      "..........",
      "..........",
      "##########",
    ]);
    const ball = createFieldBall(24.5, 21.0, Math.PI / 4);
    const speed = speedOf(ball);
    let bounced = 0;
    for (let i = 0; i < 240 && bounced === 0; i++) bounced += stepFieldBall(ball, world, 1 / 60).bounces.length;
    expect(bounced).toBeGreaterThan(0);
    expect(speedOf(ball)).toBeCloseTo(speed, 4);
    // Travelling away from the floor again.
    expect(ball.vy).toBeLessThan(0);
    expectOutsideRock(ball, world);
  });

  it("refuses the dead-on rebound that never ends", () => {
    const world = cave([
      "..........",
      "..........",
      "..........",
      "##########",
    ]);
    // Straight down: a mirror solver returns this straight up, forever.
    const ball = createFieldBall(24.5, 21.0, Math.PI / 2);
    let bounced = 0;
    for (let i = 0; i < 240 && bounced === 0; i++) bounced += stepFieldBall(ball, world, 1 / 60).bounces.length;
    expect(bounced).toBeGreaterThan(0);
    const offNormal = Math.abs(Math.atan2(ball.vx, -ball.vy));
    expect(offNormal).toBeGreaterThan(FIELD.minOffNormal * 0.99);
  });

  it("walks out of a one-cell slot instead of ping-ponging in it", () => {
    // A vertical slot one cell wide, open at the top, thirty cells deep.
    const rows = ["#.#"];
    const world = cave(Array.from({ length: 30 }, () => rows[0]));
    const ball = createFieldBall(21.5, 45.0, Math.PI / 2 + 0.001);
    const startY = ball.y;
    for (let i = 0; i < 600; i++) stepFieldBall(ball, world, 1 / 60);
    // It has to have gone somewhere along the slot rather than oscillating across it.
    expect(Math.abs(ball.y - startY)).toBeGreaterThan(3);
    expectOutsideRock(ball, world);
  });

  it("cannot tunnel through a thin wall on a long frame", () => {
    const world = cave([
      "....#....",
      "....#....",
      "....#....",
    ]);
    const ball = createFieldBall(20.5, 21.5, 0);
    // A quarter-second frame at field speed is over two cells of travel in one go.
    for (let i = 0; i < 8; i++) stepFieldBall(ball, world, 0.25);
    // The wall is at column 24. The ball started left of it and must still be left of it.
    expect(ball.x).toBeLessThan(24);
    expectOutsideRock(ball, world);
  });

  it("treats the edge of the world as rock", () => {
    // `solidAt` reports off-map as open; the ball must not sail out of the world regardless.
    const ball = createFieldBall(1.0, 40, Math.PI);
    let bounced = 0;
    for (let i = 0; i < 240 && bounced === 0; i++) bounced += stepFieldBall(ball, OPEN, 1 / 60).bounces.length;
    expect(bounced).toBeGreaterThan(0);
    expect(ball.x).toBeGreaterThan(0);

    const far = createFieldBall(WORLD_COLS - 1, WORLD_ROWS - 1, 0.6);
    for (let i = 0; i < 600; i++) stepFieldBall(far, OPEN, 1 / 60);
    expect(far.x).toBeLessThan(WORLD_COLS);
    expect(far.y).toBeLessThan(WORLD_ROWS);
  });

  it("leaves an inside corner cleanly", () => {
    const world = cave([
      "#####",
      "#....",
      "#....",
      "#....",
    ]);
    // Fired into the corner where the two walls meet.
    const ball = createFieldBall(23, 23, Math.PI + Math.PI / 4);
    for (let i = 0; i < 300; i++) {
      stepFieldBall(ball, world, 1 / 60);
      expectOutsideRock(ball, world);
    }
    // It escaped the corner rather than grinding into it.
    expect(ball.x).toBeGreaterThan(21);
    expect(ball.y).toBeGreaterThan(21);
  });

  it("stays out of the rock across a long noisy volley", () => {
    const world = cave([
      "##########",
      "#........#",
      "#..##....#",
      "#....#...#",
      "#.#......#",
      "#....##..#",
      "#........#",
      "##########",
    ]);
    const ball = createFieldBall(24.3, 24.7, 0.37);
    for (let i = 0; i < 3000; i++) {
      const step = stepFieldBall(ball, world, 1 / 60);
      expect(step.buried).toBe(false);
      expectOutsideRock(ball, world);
    }
    // Still moving at pace after three thousand frames of rebounds.
    expect(speedOf(ball)).toBeCloseTo(FIELD.speed, 4);
  });

  it("reports a ball with rock grown around it as buried", () => {
    const solid: SolidityOracle = { solidAt: () => true };
    const ball = createFieldBall(50, 50, 0);
    expect(stepFieldBall(ball, solid, 1 / 60).buried).toBe(true);
  });

  it("pushes a ball out of rock it can escape rather than retiring it", () => {
    const world = cave([
      "#####",
      "#####",
      ".....",
    ]);
    // Sitting just inside the underside of the slab, with open air below.
    const ball = createFieldBall(22.5, 21.9, Math.PI / 2);
    const step = stepFieldBall(ball, world, 1 / 60);
    expect(step.buried).toBe(false);
    expectOutsideRock(ball, world);
  });

  it("is deterministic: the same volley replays identically", () => {
    const world = cave([
      "##########",
      "#........#",
      "#..##....#",
      "#....#...#",
      "##########",
    ]);
    const run = () => {
      const ball = createFieldBall(24.3, 22.1, 0.37);
      for (let i = 0; i < 900; i++) stepFieldBall(ball, world, 1 / 60);
      return [ball.x, ball.y, ball.vx, ball.vy];
    };
    expect(run()).toEqual(run());
  });
});

describe("swept creature hits", () => {
  it("catches a target the ball passed straight through between frames", () => {
    // Endpoint sampling misses this: the ball is left of the target at one end and right at the
    // other, and never inside it on either frame.
    expect(pathHitsCircle(0, 0, 4, 0, 2, 0, 0.5)).toBe(true);
    expect(pathHitsCircle(0, 0, 4, 0, 2, 3, 0.5)).toBe(false);
  });

  it("handles a stationary ball", () => {
    expect(pathHitsCircle(1, 1, 1, 1, 1.2, 1, 0.5)).toBe(true);
    expect(pathHitsCircle(1, 1, 1, 1, 4, 4, 0.5)).toBe(false);
  });
});

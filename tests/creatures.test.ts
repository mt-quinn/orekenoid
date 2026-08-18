import { describe, expect, it } from "vitest";
import type { SolidityOracle } from "../src/combat/ballField";
import {
  BOUNDER,
  bounceCreature,
  createBounder,
  deflectCreature,
  stepCreature,
  type Creature,
} from "../src/combat/creatures";
import { castRay, hasLineOfSight } from "../src/combat/sight";
import { FEEL } from "../src/physics";
import { FIELD } from "../src/combat/ballField";

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

/** Open air with a floor, which is the simplest thing a Bounder can be standing on. */
function floorAt(y: number): SolidityOracle {
  return { solidAt: (_x, sy) => sy >= y };
}

const OPEN: SolidityOracle = { solidAt: () => false };
const DT = 1 / 60;

/** Run the machine forward and report what happened along the way. */
function run(
  creature: Creature,
  world: SolidityOracle,
  seconds: number,
  target: (elapsed: number) => { x: number; y: number } | null,
) {
  let struck = 0;
  let landed = 0;
  let committed = 0;
  let killed = 0;
  const states = new Set<string>();
  for (let elapsed = 0; elapsed < seconds; elapsed += DT) {
    const step = stepCreature(creature, world, target(elapsed), DT);
    if (step.struck) struck++;
    if (step.landed) landed++;
    if (step.committed) committed++;
    if (step.killed) killed++;
    states.add(creature.state);
  }
  return { struck, landed, committed, killed, states };
}

describe("line of sight", () => {
  it("sees across open ground and not through rock", () => {
    const world = cave([
      "..........",
      "....#.....",
      "....#.....",
      "....#.....",
      "..........",
    ]);
    expect(hasLineOfSight(world, 21.5, 24.5, 27.5, 24.5)).toBe(true);
    expect(hasLineOfSight(world, 21.5, 21.5, 27.5, 21.5)).toBe(false);
  });

  it("reports how far a ray got before the wall", () => {
    const hit = castRay(cave([".....#...."]), 20.5, 20.5, 1, 0, 20);
    expect(hit.cellX).toBe(25);
    expect(hit.distance).toBeCloseTo(4.5, 6);
  });
});

describe("a Bounder walking about", () => {
  it("rides the surface it is on rather than sinking into it or floating off", () => {
    const world = floorAt(30);
    const creature = createBounder(40, 30 - BOUNDER.radius - BOUNDER.ride, 0, [], Math.PI / 2);
    run(creature, world, 4, () => null);
    // Still sitting on the floor, at its ride height, having walked along it.
    expect(creature.y).toBeCloseTo(30 - BOUNDER.radius - BOUNDER.ride, 1);
    expect(Math.abs(creature.x - 40)).toBeGreaterThan(3);
    expect(creature.adrift).toBe(false);
  });

  it("circles an island of rock instead of walking off the end of it", () => {
    // A free-standing block. There is no floor and no ceiling: the only thing to hold on to is the
    // block itself, so a Bounder that keeps contact has no choice but to go round it.
    const world = cave([
      "......",
      "..##..",
      "..##..",
      "......",
    ]);
    const creature = createBounder(22.5, 21 - BOUNDER.radius - BOUNDER.ride, 0, [], Math.PI / 2);
    const angles: number[] = [];
    for (let elapsed = 0; elapsed < 30; elapsed += DT) {
      stepCreature(creature, world, null, DT);
      angles.push(Math.atan2(creature.y - 22, creature.x - 23));
    }
    expect(creature.adrift).toBe(false);

    // Total turn about the block's centre. Going round it once is a full turn; walking off it and
    // stopping, or oscillating on one face, is not.
    let swept = 0;
    for (let index = 1; index < angles.length; index++) {
      let delta = angles[index] - angles[index - 1];
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      swept += delta;
    }
    expect(Math.abs(swept)).toBeGreaterThan(Math.PI * 2);
    // And it never left the block: always within a stride of its surface.
    expect(Math.hypot(creature.x - 23, creature.y - 22)).toBeLessThan(4);
  });

  it("holds still when there is nothing to hold on to", () => {
    const creature = createBounder(60, 60, 0, [], Math.PI / 2);
    run(creature, OPEN, 2, () => null);
    expect(creature.adrift).toBe(true);
    expect(Math.hypot(creature.x - 60, creature.y - 60)).toBeLessThan(0.5);
  });

  it("walks a ceiling the same way it walks a floor", () => {
    const world: SolidityOracle = { solidAt: (_x, y) => y <= 30 };
    const creature = createBounder(40, 30 + BOUNDER.radius + BOUNDER.ride, 0, [], -Math.PI / 2);
    run(creature, world, 4, () => null);
    expect(creature.y).toBeCloseTo(30 + BOUNDER.radius + BOUNDER.ride, 1);
    expect(Math.abs(creature.x - 40)).toBeGreaterThan(3);
  });
});

describe("a Bounder getting mad", () => {
  const world = floorAt(30);
  const standing = () => createBounder(40, 30 - BOUNDER.radius - BOUNDER.ride, 0, [], Math.PI / 2);

  it("coils, then hurls itself", () => {
    const creature = standing();
    const result = run(creature, world, 1.4, () => ({ x: 46, y: 29 }));
    expect(result.states.has("coil")).toBe(true);
    expect(result.committed).toBe(1);
    expect(result.states.has("hurl")).toBe(true);
  });

  it("stays asleep when the drone is out of aggro range", () => {
    const creature = standing();
    const result = run(creature, world, 3, () => ({ x: 40 + BOUNDER.aggroRange + 4, y: 29 }));
    expect(result.committed).toBe(0);
    expect(creature.state).toBe("idle");
  });

  it("stays asleep when the drone is close but behind rock", () => {
    // An endless slab, not a wall with ends. A crawling Bounder walks round anything it can walk
    // round, and it re-aggroing after doing so is correct -- so the test has to be about rock it
    // genuinely cannot get past, or it is a test about the fixture.
    const slab: SolidityOracle = { solidAt: (_x, y) => y >= 22 && y < 23 };
    const creature = createBounder(23.5, 22 - BOUNDER.radius - BOUNDER.ride, 0, [], Math.PI / 2);
    const result = run(creature, slab, 3, () => ({ x: 23.5, y: 24 }));
    expect(result.committed).toBe(0);
  });

  it("locks its aim before it commits, so stepping out of the lane dodges", () => {
    const creature = standing();
    const locksAt = BOUNDER.coilSeconds - BOUNDER.lockSeconds;
    run(creature, world, BOUNDER.coilSeconds + 0.3, (elapsed) => (
      elapsed < locksAt ? { x: 47, y: 29 } : { x: 40, y: 20 }
    ));
    // It went along the lane it locked -- east -- not up after the drone.
    expect(creature.x).toBeGreaterThan(41.5);
  });

  it("re-aggros after a hurl only while the drone is still in range", () => {
    const near = standing();
    run(near, world, BOUNDER.coilSeconds + BOUNDER.hurlSeconds + BOUNDER.spentSeconds + 1.2,
      () => ({ x: near.x + 5, y: 29 }));
    // Something happened again: it is not stuck spent forever.
    expect(near.state).not.toBe("spent");

    const gone = standing();
    const result = run(gone, world, BOUNDER.coilSeconds + BOUNDER.hurlSeconds + BOUNDER.spentSeconds + 2,
      (elapsed) => (elapsed < BOUNDER.coilSeconds ? { x: 46, y: 29 } : { x: 200, y: 200 }));
    expect(result.committed).toBe(1);
  });
});

describe("the exchange", () => {
  const world = floorAt(30);

  /** Wind one up and get it into the air. */
  function airborne(): Creature {
    const creature = createBounder(40, 30 - BOUNDER.radius - BOUNDER.ride, 0, ["iron"], Math.PI / 2);
    for (let elapsed = 0; elapsed <= BOUNDER.coilSeconds + DT; elapsed += DT) {
      stepCreature(creature, world, { x: 46, y: 29 }, DT);
    }
    expect(creature.state).toBe("hurl");
    return creature;
  }

  it("sticks to the first rock it touches instead of bouncing off it", () => {
    // A wall east of the launch. It has to stop dead against it, not rebound.
    const walled: SolidityOracle = { solidAt: (x, y) => y >= 30 || x >= 46 };
    const creature = airborne();
    // Measured at the moment it leaves the air. Left running it walks off again, which is correct and
    // would make this a test about the crawl.
    for (let elapsed = 0; elapsed < 2 && creature.state === "hurl"; elapsed += DT) {
      stepCreature(creature, walled, null, DT);
    }
    expect(creature.state).not.toBe("hurl");
    // Stopped, and pressed against the wall rather than somewhere back the way it came.
    expect(Math.hypot(creature.vx, creature.vy)).toBeCloseTo(0, 5);
    expect(creature.x).toBeGreaterThan(44);
  });

  it("takes nothing from a landing the machine never touched", () => {
    // The rock is where it stops, not what hurts it. If every landing cost a hit point, three dodges
    // would kill one on their own and the paddle would be decoration.
    const walled: SolidityOracle = { solidAt: (x, y) => y >= 30 || x >= 46 };
    const creature = airborne();
    const result = run(creature, walled, 2, () => null);
    expect(result.landed).toBe(0);
    expect(creature.hp).toBe(BOUNDER.hp);
  });

  it("takes one hit for a landing the paddle sent it into", () => {
    const walled: SolidityOracle = { solidAt: (x, y) => y >= 30 || x >= 46 };
    const creature = airborne();
    deflectCreature(creature, 0, 0, FEEL.englishCurve, FIELD.minOffNormal);
    expect(creature.deflected).toBe(true);
    const result = run(creature, walled, 2, () => null);
    expect(result.landed).toBe(1);
    expect(creature.hp).toBe(BOUNDER.hp - 1);
  });

  it("holds on to the face it landed against and walks it", () => {
    // Landing on a vertical wall means its idea of down is now sideways, and the crawl has to work
    // from there without anything special-casing a wall.
    const walled: SolidityOracle = { solidAt: (x, y) => y >= 30 || x >= 46 };
    const creature = airborne();
    run(creature, walled, 2, () => null);
    const landedAt = { x: creature.x, y: creature.y };
    // Past the spent beat it crawls off. Which way is up to the geometry and its own circulation --
    // landing at the foot of this wall wedges it in the join with the floor, so turning the corner and
    // walking the floor is the correct outcome, not walking back up the wall. The invariant is that it
    // is still attached and has gone somewhere.
    run(creature, walled, BOUNDER.spentSeconds + 2.5, () => null);
    expect(creature.adrift).toBe(false);
    expect(Math.hypot(creature.x - landedAt.x, creature.y - landedAt.y)).toBeGreaterThan(0.5);
    const reach = creature.radius + BOUNDER.probeDepth;
    expect(walled.solidAt(
      creature.x + Math.cos(creature.surfaceAngle) * reach,
      creature.y + Math.sin(creature.surfaceAngle) * reach,
    )).toBe(true);
  });

  it("dies on the third landing the machine sent it into, and reports it", () => {
    const walled: SolidityOracle = { solidAt: (x, y) => y >= 30 || x >= 46 };
    const creature = airborne();
    let killed = 0;
    for (let launch = 0; launch < BOUNDER.hp; launch++) {
      creature.state = "hurl";
      creature.timer = BOUNDER.hurlSeconds;
      creature.deflected = true;
      creature.x = 40;
      creature.y = 28;
      creature.vx = BOUNDER.hurlSpeed;
      creature.vy = 0;
      for (let elapsed = 0; elapsed < 2; elapsed += DT) {
        const step = stepCreature(creature, walled, null, DT);
        if (step.killed) killed++;
        if (step.landed) break;
      }
    }
    expect(creature.hp).toBeLessThanOrEqual(0);
    expect(creature.state).toBe("dead");
    expect(killed).toBe(1);
  });

  it("is never curled up while off a surface", () => {
    // The two forms mean two different things, so a Bounder in the air is a ball and a Bounder on the
    // ground is an animal -- never a pose in between, and never the animal in flight.
    const walled: SolidityOracle = { solidAt: (x, y) => y >= 30 || x >= 46 };
    const creature = airborne();
    for (let elapsed = 0; elapsed < 3; elapsed += DT) {
      stepCreature(creature, walled, null, DT);
      if (creature.state === "hurl") continue;
      // Off `hurl` it must be attached: its surface direction leads to rock within a stride.
      const reach = creature.radius + BOUNDER.probeDepth;
      const probeX = creature.x + Math.cos(creature.surfaceAngle) * reach;
      const probeY = creature.y + Math.sin(creature.surfaceAngle) * reach;
      expect(walled.solidAt(probeX, probeY) || creature.adrift).toBe(true);
    }
  });

  it("returns off the face with english, so the edge bites and the middle does not", () => {
    const middle = airborne();
    deflectCreature(middle, -Math.PI / 2, 0, FEEL.englishCurve, FIELD.minOffNormal);
    const edge = airborne();
    deflectCreature(edge, -Math.PI / 2, 1, FEEL.englishCurve, FIELD.minOffNormal);
    expect(Math.abs(middle.vx)).toBeLessThan(Math.abs(edge.vx));
    expect(middle.vy).toBeLessThan(0);
  });

  it("cannot be returned when it is not in the air", () => {
    const creature = createBounder(40, 29, 0, [], Math.PI / 2);
    const before = { vx: creature.vx, vy: creature.vy };
    deflectCreature(creature, 0, 0, FEEL.englishCurve, FIELD.minOffNormal);
    expect(creature.vx).toBe(before.vx);
    expect(creature.vy).toBe(before.vy);
  });

  it("bounces off the machine, which is not terrain", () => {
    // Terrain is stuck to; the drone is not. A hit on the hull sends it back out to find rock.
    const creature = airborne();
    creature.vx = -BOUNDER.hurlSpeed;
    creature.vy = 0;
    bounceCreature(creature, 1, 0);
    expect(creature.vx).toBeGreaterThan(0);
    expect(creature.state).toBe("hurl");
  });

  it("only reports contact while it is actually in the air", () => {
    const creature = createBounder(40, 30 - BOUNDER.radius - BOUNDER.ride, 0, [], Math.PI / 2);
    const step = stepCreature(creature, world, { x: creature.x, y: creature.y }, DT);
    expect(step.struck).toBe(false);
  });
});

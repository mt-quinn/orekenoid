import { describe, expect, it } from "vitest";
import type { SolidityOracle } from "../src/combat/ballField";
import {
  createCreature, createGrinder, damageCreature, DOUSER, GRINDER, SPITTER, stepCreature,
  type Creature,
} from "../src/combat/creatures";
import { castRay, hasLineOfSight } from "../src/combat/sight";

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
const DT = 1 / 60;

const drone = (x: number, y: number) => ({ x, y, radius: 0.45 });

/** Run the machine forward, optionally moving the drone, and report what happened along the way. */
function run(
  creature: Creature,
  world: SolidityOracle,
  seconds: number,
  target: (elapsed: number) => { x: number; y: number; radius: number } | null,
) {
  let rammed = 0;
  let slammed = 0;
  let committed = 0;
  const states = new Set<string>();
  for (let elapsed = 0; elapsed < seconds; elapsed += DT) {
    const step = stepCreature(creature, world, target(elapsed), DT);
    if (step.rammed) rammed++;
    if (step.slammed) slammed++;
    if (step.committed) committed++;
    states.add(creature.state);
  }
  return { rammed, slammed, committed, states };
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
    expect(hasLineOfSight(world, 21.5, 21.5, 21.5, 23.5)).toBe(true);
  });

  it("reports how far a ray got before the wall", () => {
    const world = cave([".....#...."]);
    // From the middle of column 0 to the wall at column 5 is five cells.
    const hit = castRay(world, 20.5, 20.5, 1, 0, 20);
    expect(hit.cellX).toBe(25);
    expect(hit.distance).toBeCloseTo(4.5, 6);
  });

  it("stops at the edge of the world", () => {
    const hit = castRay(OPEN, 3.5, 10, -1, 0, 50);
    expect(hit.cellX).toBe(-1);
    expect(hit.distance).toBeCloseTo(3.5, 6);
  });

  it("runs its full length through open air", () => {
    const hit = castRay(OPEN, 50, 50, 1, 0, 7);
    expect(hit.cellX).toBeNull();
    expect(hit.distance).toBeCloseTo(7, 6);
  });
});

describe("the Grinder", () => {
  it("wakes, tells, then commits", () => {
    const creature = createGrinder(30, 30);
    const result = run(creature, OPEN, 0.9, () => drone(34, 30));
    expect(result.states.has("wind")).toBe(true);
    expect(result.committed).toBe(1);
    expect(creature.state === "charge" || creature.state === "recover").toBe(true);
  });

  it("does not wake through a wall", () => {
    const world = cave([
      "..........",
      "..........",
      "####.#####",
      "..........",
    ]);
    const creature = createGrinder(23.5, 21.5);
    // The drone is close, but on the far side of the slab and not in the gap.
    const result = run(creature, world, 2, () => drone(23.5, 23.5));
    expect(result.committed).toBe(0);
    expect(creature.state).not.toBe("charge");
  });

  it("locks its aim before it commits, so stepping out of the lane dodges", () => {
    const creature = createGrinder(30, 30);
    // Standing still until the shot locks, then stepping aside.
    const locksAt = GRINDER.windUp - GRINDER.lockSeconds;
    run(creature, OPEN, GRINDER.windUp + 0.4, (elapsed) => (
      elapsed < locksAt ? drone(36, 30) : drone(36, 36)
    ));
    // It went east, at the pose it locked -- not south after the drone.
    expect(creature.x).toBeGreaterThan(33);
    expect(Math.abs(creature.y - 30)).toBeLessThan(0.5);
  });

  it("rams a drone that stands in the lane", () => {
    const creature = createGrinder(30, 30);
    const result = run(creature, OPEN, 1.2, () => drone(36, 30));
    expect(result.rammed).toBeGreaterThan(0);
  });

  it("slams into rock and hands over the recovery window", () => {
    // Open ground with a wall at x = 34, just past where the drone was standing.
    const walled: SolidityOracle = { solidAt: (x) => x >= 34 };
    const creature = createGrinder(30, 30);
    const locksAt = GRINDER.windUp - GRINDER.lockSeconds;
    // Baited into charging east, then stepped out of the lane, so it runs into the wall.
    const result = run(creature, walled, 1.4, (elapsed) => (
      elapsed < locksAt ? drone(33, 30) : drone(33, 36)
    ));
    expect(result.slammed).toBeGreaterThan(0);
    expect(creature.state).toBe("recover");
  });

  it("takes three ball hits to kill", () => {
    const creature = createGrinder(30, 30);
    expect(damageCreature(creature, 1, 1, 0)).toBe(false);
    expect(damageCreature(creature, 1, 1, 0)).toBe(false);
    expect(damageCreature(creature, 1, 1, 0)).toBe(true);
    expect(creature.state).toBe("dead");
    // A dead creature stops running.
    expect(stepCreature(creature, OPEN, drone(30, 30), DT).rammed).toBe(false);
  });

  it("is shoved by the hit that did not kill it", () => {
    const creature = createGrinder(30, 30);
    damageCreature(creature, 1, 1, 0);
    expect(creature.vx).toBeGreaterThan(0);
    expect(creature.hitFlash).toBeGreaterThan(0);
  });

  it("cannot be stunlocked out of a committed charge", () => {
    const creature = createGrinder(30, 30);
    // Wind up and commit.
    for (let elapsed = 0; elapsed <= GRINDER.windUp + DT; elapsed += DT) {
      stepCreature(creature, OPEN, drone(36, 30), DT);
    }
    expect(creature.state).toBe("charge");
    damageCreature(creature, 1, -1, 0);
    expect(creature.state).toBe("charge");
  });

  it("never ends a frame inside rock", () => {
    const world = cave([
      "##########",
      "#........#",
      "#..##....#",
      "#........#",
      "#....##..#",
      "#........#",
      "##########",
    ]);
    const creature = createGrinder(24.5, 23.5);
    for (let i = 0; i < 1200; i++) {
      stepCreature(creature, world, drone(22.5, 21.5), DT);
      for (let s = 0; s < 8; s++) {
        const angle = (s / 8) * Math.PI * 2;
        expect(world.solidAt(
          creature.x + Math.cos(angle) * creature.radius * 0.98,
          creature.y + Math.sin(angle) * creature.radius * 0.98,
        )).toBe(false);
      }
    }
  });

  it("patrols rather than grinding into the first wall it meets", () => {
    const world = cave([
      "##########",
      "#........#",
      "#........#",
      "#........#",
      "##########",
    ]);
    const creature = createGrinder(22.5, 22.5, 0);
    // No drone anywhere: it should still be moving around the chamber after ten seconds.
    const before = { x: creature.x, y: creature.y };
    run(creature, world, 10, () => null);
    expect(Math.hypot(creature.x - before.x, creature.y - before.y)).toBeGreaterThan(0.5);
    expect(creature.state).toBe("prowl");
  });
});

describe("the Spitter", () => {
  it("holds its range instead of closing", () => {
    const creature = createCreature("spitter", 30, 30);
    // Drone well inside the range it wants: it should back off, not advance.
    run(creature, OPEN, 1.2, () => drone(33, 30));
    expect(Math.hypot(creature.x - 33, creature.y - 30)).toBeGreaterThan(3.5);

    const far = createCreature("spitter", 30, 30);
    run(far, OPEN, 1.2, () => drone(43, 30));
    // And steps in when the drone is beyond it.
    expect(Math.hypot(far.x - 43, far.y - 30)).toBeLessThan(13);
  });

  it("telegraphs, then lets a glob go along its facing", () => {
    const creature = createCreature("spitter", 30, 30);
    let fired: { dirX: number; dirY: number } | null = null;
    for (let elapsed = 0; elapsed < 3; elapsed += DT) {
      const step = stepCreature(creature, OPEN, drone(38, 30), DT);
      if (step.fired) { fired = step.fired; break; }
      // Nothing may be fired without the telegraph having run first.
      if (!fired) expect(creature.state === "wind" || creature.tell === 0 || creature.state === "recover").toBe(true);
    }
    expect(fired).not.toBeNull();
    expect(fired!.dirX).toBeGreaterThan(0.9);
    expect(Math.abs(fired!.dirY)).toBeLessThan(0.2);
  });

  it("waits out its cooldown between shots", () => {
    const creature = createCreature("spitter", 30, 30);
    const shots: number[] = [];
    for (let elapsed = 0; elapsed < 6; elapsed += DT) {
      if (stepCreature(creature, OPEN, drone(38, 30), DT).fired) shots.push(elapsed);
    }
    expect(shots.length).toBeGreaterThan(1);
    for (let index = 1; index < shots.length; index++) {
      expect(shots[index] - shots[index - 1]).toBeGreaterThanOrEqual(SPITTER.cooldownSeconds);
    }
  });

  it("does not shoot through rock", () => {
    const world = cave([
      "..........",
      "..........",
      "##########",
      "..........",
    ]);
    const creature = createCreature("spitter", 23.5, 21.5);
    const result = run(creature, world, 3, () => drone(23.5, 23.5));
    expect(result.committed).toBe(0);
  });
});

describe("the Douser", () => {
  it("closes on the drone and latches on", () => {
    const creature = createCreature("douser", 30, 30);
    let smothered = 0;
    for (let elapsed = 0; elapsed < 4; elapsed += DT) {
      if (stepCreature(creature, OPEN, drone(36, 30), DT).smothering) smothered++;
    }
    expect(creature.state).toBe("latched");
    expect(smothered).toBeGreaterThan(0);
  });

  it("rides the hull, so running does not scrape it off", () => {
    const creature = createCreature("douser", 30, 30);
    for (let elapsed = 0; elapsed < 4; elapsed += DT) stepCreature(creature, OPEN, drone(36, 30), DT);
    expect(creature.state).toBe("latched");
    // The drone bolts. The Douser goes with it.
    for (let elapsed = 0; elapsed < 0.5; elapsed += DT) stepCreature(creature, OPEN, drone(50, 44), DT);
    expect(creature.state).toBe("latched");
    expect(Math.hypot(creature.x - 50, creature.y - 44)).toBeLessThan(0.01);
  });

  it("is shaken off by the ball, which is the whole shot", () => {
    const creature = createCreature("douser", 30, 30);
    for (let elapsed = 0; elapsed < 4; elapsed += DT) stepCreature(creature, OPEN, drone(36, 30), DT);
    expect(creature.state).toBe("latched");
    expect(damageCreature(creature, 1, 1, 0)).toBe(false);
    expect(creature.state).toBe("recover");
    expect(stepCreature(creature, OPEN, drone(36, 30), DT).smothering).toBe(false);
  });

  it("lets go on its own, and the light stays back for a while", () => {
    const creature = createCreature("douser", 30, 30);
    for (let elapsed = 0; elapsed < 4; elapsed += DT) stepCreature(creature, OPEN, drone(36, 30), DT);
    expect(creature.state).toBe("latched");

    // Run to the release rather than sampling at a fixed time: it re-acquires afterwards, so a
    // late sample would catch the *next* latch and read as never having let go at all.
    let held = 0;
    for (let elapsed = 0; elapsed < DOUSER.latchSeconds + 1 && creature.state === "latched"; elapsed += DT) {
      stepCreature(creature, OPEN, drone(36, 30), DT);
      held += DT;
    }
    expect(creature.state).not.toBe("latched");
    expect(held).toBeLessThanOrEqual(DOUSER.latchSeconds + DT * 2);

    // And it cannot simply grab hold again off the same frame -- that is the whole point of the
    // cooldown, and without it the lamp would never come back.
    let smothered = 0;
    for (let elapsed = 0; elapsed < DOUSER.relatchCooldown * 0.8; elapsed += DT) {
      if (stepCreature(creature, OPEN, drone(36, 30), DT).smothering) smothered++;
    }
    expect(smothered).toBe(0);
  });

  it("cannot re-latch off the hull it was just shaken from", () => {
    const creature = createCreature("douser", 30, 30);
    for (let elapsed = 0; elapsed < 4; elapsed += DT) stepCreature(creature, OPEN, drone(36, 30), DT);
    damageCreature(creature, 1, 1, 0);
    let smothered = 0;
    for (let elapsed = 0; elapsed < DOUSER.relatchCooldown * 0.8; elapsed += DT) {
      if (stepCreature(creature, OPEN, drone(36, 30), DT).smothering) smothered++;
    }
    expect(smothered).toBe(0);
  });

  it("glows brighter the closer it gets, so it can never ambush", () => {
    const far = createCreature("douser", 30, 30);
    stepCreature(far, OPEN, drone(44, 30), DT);
    const near = createCreature("douser", 30, 30);
    stepCreature(near, OPEN, drone(34, 30), DT);
    expect(near.tell).toBeGreaterThan(far.tell);
    expect(far.tell).toBeGreaterThan(0);
  });
});

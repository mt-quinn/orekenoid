import { describe, expect, it } from "vitest";
import type { SolidityOracle } from "../src/combat/ballField";
import { COMBAT, FieldCombat, paddleContact, type DronePose } from "../src/combat/fieldCombat";
import { BOUNDER, createBounder, type Creature } from "../src/combat/creatures";

const DT = 1 / 60;

/** Open ground with a floor, so a Bounder has something to stand on. */
const FLOORED: SolidityOracle = { solidAt: (_x, y) => y >= 70 };

/**
 * Broken ground: four-cell blocks in a checker.
 *
 * The spawner will only place a Bounder against rock, so a world with one flat floor in it gives it a
 * hairline band to aim at and the population tests become tests of luck. This has surface everywhere.
 */
const BROKEN: SolidityOracle = {
  solidAt: (x, y) => (Math.floor(x / 4) + Math.floor(y / 4)) % 2 === 0,
};

const pose = (x = 60, y = 69, heading = 0, paddleWidth = 3.1): DronePose => ({ x, y, heading, paddleWidth });

function advance(combat: FieldCombat, seconds: number, drone: DronePose | null) {
  const totals = { strikes: 0, returns: 0, landings: 0, kills: 0, pickups: [] as string[] };
  for (let elapsed = 0; elapsed < seconds; elapsed += DT) {
    const events = combat.update(DT, drone);
    totals.strikes += events.strikes.length;
    totals.returns += events.returns.length;
    totals.landings += events.landings.length;
    totals.kills += events.landings.filter((landing) => landing.killed).length;
    for (const pickup of events.pickups) totals.pickups.push(pickup.resource);
  }
  return totals;
}

/**
 * A Bounder in the air, aimed at a point.
 *
 * Built by hand rather than by waiting out a coil, so a test about contact is about contact.
 */
function hurledAt(combat: FieldCombat, from: { x: number; y: number }, at: { x: number; y: number }): Creature {
  const creature = combat.spawn(from.x, from.y);
  creature.state = "hurl";
  creature.timer = BOUNDER.hurlSeconds;
  const angle = Math.atan2(at.y - from.y, at.x - from.x);
  creature.vx = Math.cos(angle) * BOUNDER.hurlSpeed;
  creature.vy = Math.sin(angle) * BOUNDER.hurlSpeed;
  return creature;
}

describe("which part of the machine was hit", () => {
  const drone = pose(60, 60, 0, 3.1);
  // Heading zero: the hull lies along x, and the face looks along -y.
  const at = (x: number, y: number): Creature => ({ ...createBounder(x, y), state: "hurl" });

  it("calls the forward side of the face a face hit", () => {
    expect(paddleContact(at(60, 60 - BOUNDER.radius), drone)).toBe("face");
    expect(paddleContact(at(61, 60 - BOUNDER.radius), drone)).toBe("face");
  });

  it("calls the back of the paddle a hull hit", () => {
    expect(paddleContact(at(60, 60 + BOUNDER.radius * 0.5), drone)).toBe("hull");
  });

  it("calls the ends a hull hit, so pointing the machine roughly is not enough", () => {
    // Just past the span of the face, on the forward side. Reads as the tip of the machine, not as
    // the face -- which is what makes aim matter rather than mere orientation.
    expect(paddleContact(at(60 + 3.1 / 2 + 0.3, 60 - BOUNDER.radius * 0.6), drone)).toBe("hull");
  });

  it("calls a clean miss nothing at all", () => {
    expect(paddleContact(at(60, 55), drone)).toBeNull();
    expect(paddleContact(at(70, 60), drone)).toBeNull();
  });

  it("follows the heading round", () => {
    const turned = pose(60, 60, Math.PI / 2, 3.1);
    // Heading a quarter turn: the hull lies along y and the face looks along +x.
    expect(paddleContact(at(60 + BOUNDER.radius, 60), turned)).toBe("face");
    expect(paddleContact(at(60 - BOUNDER.radius * 0.5, 60), turned)).toBe("hull");
  });
});

describe("the exchange, end to end", () => {
  it("returns one that meets the face, and costs nothing for it", () => {
    const combat = new FieldCombat(FLOORED, 1);
    const drone = pose(60, 60, 0);
    hurledAt(combat, { x: 60, y: 54 }, { x: 60, y: 60 });
    const totals = advance(combat, 1.2, drone);
    expect(totals.returns).toBeGreaterThan(0);
    expect(totals.strikes).toBe(0);
  });

  it("costs the hull when it arrives at the back instead", () => {
    const combat = new FieldCombat(FLOORED, 2);
    const drone = pose(60, 60, 0);
    // Coming up from below, into the back of the face.
    hurledAt(combat, { x: 60, y: 66 }, { x: 60, y: 60 });
    const totals = advance(combat, 1.2, drone);
    expect(totals.strikes).toBeGreaterThan(0);
    expect(totals.returns).toBe(0);
  });

  it("charges one return per contact, not one per frame", () => {
    const combat = new FieldCombat(FLOORED, 3);
    const drone = pose(60, 60, 0);
    // Started close, so the whole flight fits in the window and a second contact would have to be a
    // repeat of the first rather than a new arrival.
    hurledAt(combat, { x: 60, y: 58 }, { x: 60, y: 60 });
    const totals = advance(combat, 0.6, drone);
    expect(totals.returns).toBe(1);
  });
});

describe("ore", () => {
  it("scatters what the ground was made of, and vacuums it into the hold", () => {
    // Floor immediately below the drone, so the kill -- and therefore the ore -- lands inside the
    // vacuum's reach rather than ten cells down a shaft.
    const shallow: SolidityOracle = { solidAt: (_x, y) => y >= 62 };
    const combat = new FieldCombat(shallow, 4);
    combat.oreTableFor = () => ["iron"];
    const drone = pose(60, 60, 0);
    const creature = combat.spawn(60.5, 60.5);
    // Killed outright: the drops are what is under test, not the fight.
    creature.hp = 0;
    creature.state = "hurl";
    creature.vy = BOUNDER.hurlSpeed;
    const totals = advance(combat, 6, drone);
    expect(totals.pickups.length).toBe(COMBAT.oreDrop);
    expect(new Set(totals.pickups)).toEqual(new Set(["iron"]));
  });

  it("leaves nothing lying about once a fight is abandoned", () => {
    const combat = new FieldCombat(FLOORED, 5);
    combat.oreTableFor = () => ["copper"];
    const creature = combat.spawn(60, 60);
    creature.hp = 0;
    creature.state = "dead";
    (combat as unknown as { scatterOre: (c: Creature) => void }).scatterOre(creature);
    expect(combat.liveOre).toBeGreaterThan(0);
    // Nobody comes to collect it.
    advance(combat, COMBAT.oreLifetime + 1, null);
    expect(combat.liveOre).toBe(0);
  });
});

describe("the cavern population", () => {
  /** Watch the spawner rather than the roster: what it promises is about the moment of spawning. */
  function watchSpawns(combat: FieldCombat, seconds: number, drone: DronePose) {
    const seen = new Set<object>();
    const distances: number[] = [];
    let peak = 0;
    for (let elapsed = 0; elapsed < seconds; elapsed += DT) {
      combat.update(DT, drone);
      for (const creature of combat.roster) {
        if (seen.has(creature)) continue;
        seen.add(creature);
        distances.push(Math.hypot(creature.x - drone.x, creature.y - drone.y));
      }
      peak = Math.max(peak, combat.liveCreatures);
    }
    return { distances, peak, total: seen.size };
  }

  it("fills up to the cap and never past it", () => {
    const combat = new FieldCombat(BROKEN, 8);
    expect(watchSpawns(combat, 30, pose(62, 62)).peak).toBe(COMBAT.population);
  });

  it("never spawns anything inside the viewport", () => {
    const combat = new FieldCombat(BROKEN, 9);
    const watch = watchSpawns(combat, 40, pose(62, 62));
    expect(watch.total).toBeGreaterThan(2);
    for (const distance of watch.distances) {
      expect(distance).toBeGreaterThanOrEqual(COMBAT.spawnMin - 1e-6);
      expect(distance).toBeLessThanOrEqual(COMBAT.spawnMax + 1e-6);
    }
  });

  it("only spawns them onto rock, because a Bounder needs something to walk on", () => {
    // Nothing to hold anywhere: the spawner must decline rather than drop them into the void.
    const empty: SolidityOracle = { solidAt: () => false };
    const combat = new FieldCombat(empty, 10);
    advance(combat, 20, pose(60, 60));
    expect(combat.liveCreatures).toBe(0);
  });

  it("forgets a fight the drone has walked a long way from", () => {
    const combat = new FieldCombat(FLOORED, 11);
    combat.spawn(60, 69);
    expect(combat.liveCreatures).toBe(1);
    advance(combat, 0.2, pose(60 + COMBAT.despawn + 5, 69));
    expect(combat.roster.some((creature) => Math.hypot(creature.x - 60, creature.y - 69) < 5)).toBe(false);
  });
});

describe("simulation time", () => {
  it("keeps game time honest on a machine that cannot hold the frame rate", () => {
    // Clamping a long frame instead of consuming it runs everything in slow motion. Two runs of the
    // same wall-clock length, at different frame rates, must advance a fight by the same amount.
    const fast = new FieldCombat(FLOORED, 20);
    const slow = new FieldCombat(FLOORED, 20);
    const drone = pose(60, 69);
    const a = fast.spawn(70, 69);
    const b = slow.spawn(70, 69);
    for (let frame = 0; frame < 60; frame++) fast.update(1 / 60, drone);
    for (let frame = 0; frame < 13; frame++) slow.update(1 / 13, drone);
    expect(b.timer).toBeCloseTo(a.timer, 1);
  });
});

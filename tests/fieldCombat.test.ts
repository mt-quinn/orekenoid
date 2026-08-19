import { describe, expect, it } from "vitest";
import type { SolidityOracle } from "../src/combat/ballField";
import { COMBAT, FieldCombat, paddleContact, type DronePose } from "../src/combat/fieldCombat";
import { BOUNDER, createBounder, type Creature } from "../src/combat/creatures";

const DT = 1 / 60;

/** Open ground with a floor, so a Bounder has something to stand on. */
const FLOORED: SolidityOracle = { solidAt: (_x, y) => y >= 70 };

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

describe("authored spawns", () => {
  /** A floor at y=70, and a spawn standing on it. */
  const on = (x: number) => ({ x, y: 69.5 });

  function run(combat: FieldCombat, seconds: number, drone: DronePose | null) {
    for (let elapsed = 0; elapsed < seconds; elapsed += DT) combat.update(DT, drone);
  }

  it("wakes a placed spawn once the drone is near enough", () => {
    const combat = new FieldCombat(FLOORED, 40);
    combat.placeSpawns([on(60)]);
    // Too far to wake.
    run(combat, 3, pose(60 + COMBAT.wakeRange + 10, 69));
    expect(combat.liveCreatures).toBe(0);
    // In range.
    run(combat, 3, pose(60 + COMBAT.spawnMin + 2, 69));
    expect(combat.liveCreatures).toBe(1);
  });

  it("never wakes one where the player could watch it appear", () => {
    // Inside the spawn ring is on screen. A placed spawn the drone is standing on top of waits rather
    // than materialising in front of them.
    const combat = new FieldCombat(FLOORED, 41);
    combat.placeSpawns([on(60)]);
    run(combat, 4, pose(61, 69));
    expect(combat.liveCreatures).toBe(0);
  });

  it("spends a spawn forever, so a cleared chamber stays cleared", () => {
    // The whole point of placing them. Under the old spawner a player could walk away from a fight and
    // come back to four strangers, which meant no room could ever be finished.
    const combat = new FieldCombat(FLOORED, 42);
    combat.placeSpawns([on(60)]);
    const drone = pose(60 + COMBAT.spawnMin + 2, 69);
    run(combat, 3, drone);
    expect(combat.liveCreatures).toBe(1);
    // Killed outright: `liveCreatures` counts by state, and hit points alone are not a death.
    for (const creature of combat.roster) { creature.hp = 0; creature.state = "dead"; }
    run(combat, COMBAT.corpseSeconds + 2, drone);
    expect(combat.liveCreatures).toBe(0);
    // Stand here as long as you like.
    run(combat, 30, drone);
    expect(combat.liveCreatures).toBe(0);
    expect(combat.spentSpawns).toEqual([0]);
  });

  it("does not bring back a spawn a save says is spent", () => {
    const combat = new FieldCombat(FLOORED, 43);
    combat.placeSpawns([on(60), on(80)], [0]);
    run(combat, 6, pose(60 + COMBAT.spawnMin + 2, 69));
    // The second one is out of range from here; the first is in range and already spent.
    expect(combat.liveCreatures).toBe(0);
  });

  it("holds a spawn back rather than discarding it when the cap is full", () => {
    // The cap guards against a pathological map, so it must defer and not delete. Asserted as the
    // promise rather than as a headcount: what matters is that the spawns it skipped are still waiting
    // afterwards, not exactly how many fitted on the first pass.
    const combat = new FieldCombat(FLOORED, 44);
    // Spaced a cell apart and stood off so that *every* one of them is inside the wake band. Spread any
    // wider and the ones left over are out of range rather than over the ceiling, which would make this
    // pass for the wrong reason.
    const many = Array.from({ length: COMBAT.population + 5 }, (_unused, index) => on(50 + index));
    combat.placeSpawns(many);
    const drone = pose(50 - COMBAT.spawnMin - 0.5, 69);
    run(combat, 8, drone);
    expect(combat.liveCreatures).toBeLessThanOrEqual(COMBAT.population);
    const firstWave = combat.spentSpawns.length;
    expect(firstWave).toBeGreaterThan(4);
    expect(firstWave).toBeLessThan(many.length);

    // Clear the field and the ones that were held back arrive.
    for (const creature of combat.roster) { creature.hp = 0; creature.state = "dead"; }
    run(combat, COMBAT.corpseSeconds + 6, drone);
    expect(combat.spentSpawns.length).toBeGreaterThan(firstWave);
  });

  it("spends a spawn whose ground has been mined away", () => {
    // Nothing to stand on is a spawn spent by excavation. Left unspent it would be retried every pass
    // for the rest of the expedition.
    const empty: SolidityOracle = { solidAt: () => false };
    const combat = new FieldCombat(empty, 45);
    combat.placeSpawns([on(60)]);
    run(combat, 4, pose(60 + COMBAT.spawnMin + 2, 69));
    expect(combat.liveCreatures).toBe(0);
    expect(combat.spentSpawns).toEqual([0]);
  });

  it("forgets a fight the drone has walked a long way from", () => {
    const combat = new FieldCombat(FLOORED, 46);
    combat.spawn(60, 69);
    expect(combat.liveCreatures).toBe(1);
    run(combat, 0.2, pose(60 + COMBAT.despawn + 5, 69));
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


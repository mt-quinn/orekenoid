import { describe, expect, it } from "vitest";
import type { SolidityOracle } from "../src/combat/ballField";
import { COMBAT, EMITTER_RECHARGE, FieldCombat, rechargeSecondsFor } from "../src/combat/fieldCombat";

const OPEN: SolidityOracle = { solidAt: () => false };
const DT = 1 / 60;

function advance(combat: FieldCombat, seconds: number, drone = { x: 60, y: 60, radius: 0.8 }) {
  const events = { recharged: 0, lost: 0 };
  for (let elapsed = 0; elapsed < seconds; elapsed += DT) {
    const step = combat.update(DT, drone);
    if (step.recharged) events.recharged++;
    events.lost += step.ballsLost.length;
  }
  return events;
}

describe("the emitter charge", () => {
  it("grades the recharge from the fitted emitter, and clamps outside the ladder", () => {
    expect(rechargeSecondsFor(0)).toBe(EMITTER_RECHARGE[0]);
    expect(rechargeSecondsFor(3)).toBe(EMITTER_RECHARGE[3]);
    expect(rechargeSecondsFor(9)).toBe(EMITTER_RECHARGE[EMITTER_RECHARGE.length - 1]);
    expect(rechargeSecondsFor(-2)).toBe(EMITTER_RECHARGE[0]);
    // Every grade is an improvement, or the station is not a progression.
    for (let index = 1; index < EMITTER_RECHARGE.length; index++) {
      expect(EMITTER_RECHARGE[index]).toBeLessThan(EMITTER_RECHARGE[index - 1]);
    }
  });

  it("holds one ball out, and refuses a second until it comes home", () => {
    const combat = new FieldCombat(OPEN, 1);
    expect(combat.canFire()).toBe(true);
    expect(combat.fire(60, 60, 0)).toBe(true);
    expect(combat.liveBalls).toBe(1);
    expect(combat.canFire()).toBe(false);
    expect(combat.fire(60, 60, 0)).toBe(false);
  });

  it("recharges after the ball's life runs out, then arms again", () => {
    const combat = new FieldCombat(OPEN, 2);
    combat.rechargeSeconds = 1.5;
    combat.fire(60, 60, 0);

    const flight = advance(combat, COMBAT.ballLifetime + 0.2);
    expect(flight.lost).toBe(1);
    expect(combat.liveBalls).toBe(0);
    // Reclaimed, not ready: the gap between volleys is the whole point of the stat.
    expect(combat.canFire()).toBe(false);
    expect(combat.chargeProgress).toBeLessThan(1);

    const wait = advance(combat, 1.6);
    expect(wait.recharged).toBe(1);
    expect(combat.canFire()).toBe(true);
    expect(combat.chargeProgress).toBe(1);
  });

  it("charges from empty to full over exactly the graded time", () => {
    const combat = new FieldCombat(OPEN, 3);
    combat.rechargeSeconds = 2;
    combat.fire(60, 60, 0);
    combat.recall();
    expect(combat.chargeProgress).toBe(0);
    advance(combat, 1);
    expect(combat.chargeProgress).toBeGreaterThan(0.4);
    expect(combat.chargeProgress).toBeLessThan(0.6);
    advance(combat, 1.1);
    expect(combat.chargeProgress).toBe(1);
  });

  it("recall costs the same as a lost ball, so taking a bad shot back is a real decision", () => {
    const combat = new FieldCombat(OPEN, 4);
    combat.rechargeSeconds = 1.2;
    combat.fire(60, 60, 0);
    expect(combat.recall()).toBe(1);
    expect(combat.rechargeRemaining).toBeCloseTo(1.2, 5);
  });

  it("recalling nothing does not start a recharge", () => {
    const combat = new FieldCombat(OPEN, 5);
    combat.rechargeSeconds = 1.2;
    expect(combat.recall()).toBe(0);
    expect(combat.rechargeRemaining).toBe(0);
    expect(combat.canFire()).toBe(true);
  });

  it("comes back armed after a death rather than mid-reload", () => {
    const combat = new FieldCombat(OPEN, 6);
    combat.rechargeSeconds = 3;
    combat.fire(60, 60, 0);
    combat.recall();
    expect(combat.canFire()).toBe(false);
    combat.clear();
    expect(combat.canFire()).toBe(true);
    expect(combat.liveCreatures).toBe(0);
  });

  it("refuses to fire a ball that would be born inside rock", () => {
    const solid: SolidityOracle = { solidAt: () => true };
    const combat = new FieldCombat(solid, 7);
    expect(combat.fire(60, 60, 0)).toBe(false);
    // And the refusal costs nothing: the emitter is still armed.
    expect(combat.canFire()).toBe(true);
  });
});

describe("the cavern population", () => {
  /**
   * Watch the spawner rather than the roster.
   *
   * Sampling positions at the end of a run measures where creatures have *walked to*, which is
   * naturally right on top of the drone -- that is the creatures working. The only thing the
   * spawner promises is about the moment of spawning, so that is what this records.
   */
  function watchSpawns(combat: FieldCombat, seconds: number, drone: { x: number; y: number; radius: number }) {
    const seen = new Set<object>();
    const spawnDistances: number[] = [];
    let peak = 0;
    for (let elapsed = 0; elapsed < seconds; elapsed += DT) {
      combat.update(DT, drone);
      for (const creature of combat.roster) {
        if (seen.has(creature)) continue;
        seen.add(creature);
        spawnDistances.push(Math.hypot(creature.x - drone.x, creature.y - drone.y));
      }
      peak = Math.max(peak, combat.liveCreatures);
    }
    return { spawnDistances, peak, total: seen.size };
  }

  it("fills up to the cap and never past it", () => {
    const combat = new FieldCombat(OPEN, 8);
    const drone = { x: 60, y: 60, radius: 0.8 };
    const watch = watchSpawns(combat, 30, drone);
    expect(watch.peak).toBe(COMBAT.population);
  });

  it("never spawns anything inside the viewport, even in wide open ground", () => {
    const combat = new FieldCombat(OPEN, 9);
    const drone = { x: 60, y: 60, radius: 0.8 };
    // Wholly open ground is the case that broke the first version of the spawner: every candidate
    // has line of sight, so insisting on cover meant nothing ever spawned and the biggest chambers
    // in the mine were the safest. The distance floor is what actually guarantees off screen.
    const watch = watchSpawns(combat, 30, drone);
    expect(watch.total).toBeGreaterThan(2);
    for (const distance of watch.spawnDistances) {
      expect(distance).toBeGreaterThanOrEqual(COMBAT.spawnMin - 1e-6);
      expect(distance).toBeLessThanOrEqual(COMBAT.spawnMax + 1e-6);
    }
  });

  it("draws every species in the roster", () => {
    // Pooled across several worlds rather than trusting one. The draw is deterministic per seed, so
    // this is not flaky either way -- but a single short run can honestly miss the two-in-ten
    // species, and a test that passes only because one seed was lucky is not testing the mix.
    const kinds = new Set<string>();
    for (const seed of [8, 9, 11, 12]) {
      const combat = new FieldCombat(OPEN, seed);
      const drone = { x: 60, y: 60, radius: 0.8 };
      for (let elapsed = 0; elapsed < 90; elapsed += DT) {
        combat.update(DT, drone);
        for (const creature of combat.roster) kinds.add(creature.kind);
      }
    }
    expect([...kinds].sort()).toEqual(["douser", "grinder", "spitter"]);
    // And the weights are a real preference, not three equal numbers wearing a table.
    const weights = COMBAT.mix.map((entry) => entry.weight);
    expect(Math.min(...weights)).toBeGreaterThan(0);
    expect(COMBAT.mix[0].kind).toBe("grinder");
    expect(weights[0]).toBe(Math.max(...weights));
  });

  it("forgets a fight the drone has walked a long way from", () => {
    const combat = new FieldCombat(OPEN, 10);
    combat.spawn(60, 60);
    expect(combat.liveCreatures).toBe(1);
    const far = { x: 60 + COMBAT.despawn + 5, y: 60, radius: 0.8 };
    advance(combat, 0.2, far);
    // The abandoned one is gone. Counting the whole roster would not prove it -- the spawner keeps
    // the population topped up around wherever the drone actually is, so a fresh creature will have
    // appeared near the new position in the meantime.
    expect(combat.roster.some((creature) => Math.hypot(creature.x - 60, creature.y - 60) < 5)).toBe(false);
  });
});

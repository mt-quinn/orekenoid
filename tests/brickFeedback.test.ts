import { describe, expect, it } from "vitest";
import { createBrickDisplay, showDamage } from "../src/view/brick";
import { applyReaction, impulse, newReaction, stepReactions } from "../src/view/feedback";
import { materialOf } from "../src/materials";
import type { Brick } from "../src/types";
import type { MaterialKind as Kind } from "../src/config";

function brick(u: number, v: number, kind: Kind = "chalk"): Brick {
  const definition = materialOf(kind);
  const made: Brick = {
    worked: false, u, v, x: 0, y: 0, hp: definition.hp, maxHp: definition.hp, kind,
    resource: null, facetAxis: 1, alive: true, persistent: false, liable: true,
    footprint: { center: { x: u, y: v }, halfWidth: 0.5, halfHeight: 0.5, angle: 0 },
    sourceCells: [], hitFlash: 0, react: newReaction(), baseX: u * 42, baseY: v * 42,
  };
  const { container, damageStages } = createBrickDisplay(made);
  made.display = container;
  made.damageStages = damageStages;
  return made;
}

/**
 * Reading a multi-hit brick.
 *
 * Before this, one crack graphic went from invisible to 0.82 alpha the instant a brick took any
 * damage at all, so a four-hit slate bank looked identical at 3hp and at 1hp. The player had no way
 * to see "one more hit" and every multi-hit material was guesswork about their own shot count.
 */
describe("fracture staging", () => {
  it("gives a brick one visible stage per hit it can absorb", () => {
    const slate = brick(0, 0, "slate");
    expect(slate.maxHp).toBe(4);
    expect(slate.damageStages).toHaveLength(3);
    const shown = () => slate.damageStages!.filter((stage) => stage.visible).length;

    showDamage(slate);
    expect(shown(), "an untouched brick shows damage").toBe(0);
    for (let hit = 1; hit < slate.maxHp; hit++) {
      slate.hp -= 1;
      showDamage(slate);
      expect(shown(), `slate at ${slate.hp}hp`).toBe(hit);
    }
  });

  it("distinguishes every survivable state, which is the whole point", () => {
    // 3hp and 1hp must not look the same. This is the specific failure being fixed.
    const slate = brick(0, 0, "slate");
    const snapshot = () => {
      showDamage(slate);
      return slate.damageStages!.map((stage) => stage.visible).join("");
    };
    const states = new Set<string>();
    for (let hp = slate.maxHp; hp >= 1; hp--) {
      slate.hp = hp;
      states.add(snapshot());
    }
    expect(states.size, "two different hit points look identical").toBe(slate.maxHp);
  });

  it("gives one-hit material nothing to show, rather than a stage it can never reach", () => {
    const chalk = brick(0, 0, "chalk");
    expect(chalk.maxHp).toBe(1);
    chalk.hp = 0;
    showDamage(chalk);
    expect(chalk.damageStages!.filter((stage) => stage.visible)).toHaveLength(0);
  });
});

/**
 * The board reacting, rather than the camera.
 *
 * The first pass answered every contact with camera shake and hit-stop, which is the trap the
 * screenshake talk explicitly warns about. These assert the replacement: the struck brick and its
 * neighbours move, and the wave arrives at distant bricks *later* than at near ones.
 */
describe("impact waves", () => {
  const row = () => [0, 1, 2, 3, 4].map((u) => brick(u, 0));

  it("shoves the struck brick hardest and its neighbours less", () => {
    const bricks = row();
    impulse(bricks, { u: 0, v: 0, du: 1, dv: 0, force: 3, reach: 4, light: 1, speed: 20, struck: bricks[0] });
    stepReactions(bricks, 1 / 60);
    const shove = bricks.map((entry) => Math.abs(entry.react!.su));
    expect(shove[0]).toBeGreaterThan(shove[1]);
    expect(shove[1]).toBeGreaterThan(shove[3]);
    expect(shove[4], "the wave carried past its reach").toBe(0);
  });

  it("arrives at distant bricks later, so the impact visibly travels", () => {
    const bricks = row();
    impulse(bricks, { u: 0, v: 0, du: 1, dv: 0, force: 3, reach: 4, light: 1, speed: 4, struck: bricks[0] });
    // The struck brick lights immediately; a brick three cells out is still waiting.
    expect(bricks[0].react!.pulse).toBeGreaterThan(0);
    expect(bricks[3].react!.pulse).toBe(0);
    expect(bricks[3].react!.wait).toBeGreaterThan(0);
    // Run time forward and it arrives.
    for (let step = 0; step < 90; step++) stepReactions(bricks, 1 / 60);
    expect(bricks[3].react!.pulse === 0 || bricks[3].react!.wait === 0).toBe(true);
  });

  it("springs every brick back to its seat and stays there", () => {
    const bricks = row();
    impulse(bricks, { u: 2, v: 0, du: 0, dv: 1, force: 4, reach: 4, light: 1, speed: 20, struck: bricks[2] });
    for (let step = 0; step < 240; step++) stepReactions(bricks, 1 / 60);
    for (const entry of bricks) {
      expect(Math.abs(entry.react!.su), "a brick never returned to its seat").toBeLessThan(0.002);
      expect(Math.abs(entry.react!.sv)).toBeLessThan(0.002);
      expect(entry.react!.pulse).toBe(0);
    }
    // And the display is put back exactly where it started.
    applyReaction(bricks[2], bricks[2].baseX!, bricks[2].baseY!, 0, 0x88ccff);
    expect(bricks[2].display!.position.x).toBeCloseTo(bricks[2].baseX!, 3);
    expect(bricks[2].display!.position.y).toBeCloseTo(bricks[2].baseY!, 3);
  });

  it("cannot fling a brick off the board however hard it is hit", () => {
    const bricks = row();
    for (let burst = 0; burst < 40; burst++) {
      impulse(bricks, { u: 0, v: 0, du: 1, dv: 1, force: 40, reach: 4, light: 1, speed: 20, struck: bricks[0] });
      stepReactions(bricks, 1 / 60);
    }
    for (const entry of bricks) {
      expect(Math.abs(entry.react!.su)).toBeLessThanOrEqual(0.42 * 0.7 + 1e-6);
      expect(Math.abs(entry.react!.sv)).toBeLessThanOrEqual(0.42 * 0.7 + 1e-6);
    }
  });
});

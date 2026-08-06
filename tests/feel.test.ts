// The two rules the feel layer enforces, tested rather than trusted.
//
// Both exist because of a real failure: the first pass at breakout feedback stacked a camera kick
// and a hit-pause on every contact, which read as far too much precisely because nothing bounded it.
// A comment saying "this saturates" is worth less than a test that fails when it stops.

import { describe, expect, it } from "vitest";
import { Gate, Pulse, Shudder } from "../src/view/feel";

describe("Pulse", () => {
  it("saturates rather than stacking, so a cascade is one flash and not nine", () => {
    const pulse = new Pulse();
    for (let index = 0; index < 9; index++) pulse.hit(0.4);
    // Summed this would be 3.6, and clamping a sum would make the response depend on arrival
    // order -- the second hit would count and the ninth would not.
    expect(pulse.value).toBeCloseTo(0.4, 5);
  });

  it("takes the strongest hit in a frame, whatever order they arrive in", () => {
    const rising = new Pulse();
    rising.hit(0.2);
    rising.hit(0.9);
    const falling = new Pulse();
    falling.hit(0.9);
    falling.hit(0.2);
    expect(rising.value).toBeCloseTo(falling.value, 5);
    expect(rising.value).toBeCloseTo(0.9, 5);
  });

  it("never exceeds one, however hard it is hit", () => {
    const pulse = new Pulse();
    pulse.hit(40);
    expect(pulse.value).toBe(1);
  });

  it("decays to nothing and stops there", () => {
    const pulse = new Pulse(2);
    pulse.hit(1);
    pulse.update(0.4);
    expect(pulse.value).toBeCloseTo(0.2, 5);
    pulse.update(5);
    expect(pulse.value).toBe(0);
  });
});

describe("Gate", () => {
  it("passes once and then refuses until its interval has run", () => {
    const gate = new Gate(0.2);
    expect(gate.tick(0.016)).toBe(true);
    // A held input must not fire an impact every frame -- this is the difference between grinding
    // along a wall being a texture and being a jackhammer.
    expect(gate.tick(0.016)).toBe(false);
    expect(gate.tick(0.016)).toBe(false);
  });

  it("passes again once enough time has actually elapsed", () => {
    const gate = new Gate(0.2);
    gate.tick(0.016);
    let passes = 0;
    for (let frame = 0; frame < 60; frame++) {
      if (gate.tick(0.016)) passes += 1;
    }
    // ~0.96s of frames at a 0.2s interval: four or five, not sixty.
    expect(passes).toBeGreaterThanOrEqual(4);
    expect(passes).toBeLessThanOrEqual(5);
  });

  it("is frame-rate independent", () => {
    const slow = new Gate(0.25);
    const fast = new Gate(0.25);
    let slowPasses = 0;
    let fastPasses = 0;
    for (let frame = 0; frame < 30; frame++) if (slow.tick(1 / 30)) slowPasses += 1;
    for (let frame = 0; frame < 120; frame++) if (fast.tick(1 / 120)) fastPasses += 1;
    expect(slowPasses).toBe(fastPasses);
  });

  it("can be forced open for the first contact of a new state", () => {
    const gate = new Gate(1);
    expect(gate.tick(0.016)).toBe(true);
    expect(gate.tick(0.016)).toBe(false);
    gate.open();
    expect(gate.tick(0.016)).toBe(true);
  });
});

describe("Shudder", () => {
  it("springs back to rest and settles", () => {
    const shudder = new Shudder();
    shudder.kick(1, 0, 30);
    let travelled = 0;
    for (let frame = 0; frame < 12; frame++) {
      shudder.update(1 / 60);
      travelled = Math.max(travelled, Math.abs(shudder.x));
    }
    expect(travelled).toBeGreaterThan(0.1);
    for (let frame = 0; frame < 240; frame++) shudder.update(1 / 60);
    expect(shudder.active).toBe(false);
  });

  it("holds a press in place instead of springing straight back", () => {
    const shudder = new Shudder();
    shudder.press(-1, 0, 6);
    expect(shudder.x).toBeCloseTo(-6, 5);
    // Assigned rather than accumulated: a press is a position, not a series of blows, so pressing
    // twice in a frame must not push twice as far into the rock.
    shudder.press(-1, 0, 6);
    expect(shudder.x).toBeCloseTo(-6, 5);
  });
});

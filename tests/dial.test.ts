import { describe, expect, it } from "vitest";
import { DIAL, DialWheel, detentsCrossed, dialGeometry, onRim, shortestDelta } from "../src/dial";

/** Drag the wheel through a sequence of angles, one every `step` seconds. */
function sweep(wheel: DialWheel, angles: number[], step: number, from = 0): number {
  let now = from;
  wheel.grab(angles[0], now);
  for (const angle of angles.slice(1)) {
    now += step;
    wheel.drag(angle, now);
  }
  return now;
}

describe("angles", () => {
  it("takes the short way round the cut at pi", () => {
    // Without this, a thumb crossing the seam hands the drone most of a full turn in the wrong
    // direction, once per sweep.
    expect(shortestDelta(3.1, -3.1)).toBeCloseTo(Math.PI * 2 - 6.2, 5);
    expect(shortestDelta(-3.1, 3.1)).toBeCloseTo(6.2 - Math.PI * 2, 5);
    expect(shortestDelta(0, 1)).toBeCloseTo(1, 5);
    expect(shortestDelta(1, 0)).toBeCloseTo(-1, 5);
  });

  it("counts the detents a turn passes, in either direction", () => {
    const step = (Math.PI * 2) / DIAL.detents;
    expect(detentsCrossed(0, step * 0.5)).toBe(0);
    expect(detentsCrossed(0, step * 1.5)).toBe(1);
    expect(detentsCrossed(0, step * 4.2)).toBe(4);
    expect(detentsCrossed(0, -step * 2.5)).toBe(3);
  });
});

describe("where the wheel is", () => {
  const geometry = dialGeometry(390, 844);

  it("hangs its hub off the edge, in the thumb's arc", () => {
    // Half off the screen is the whole idea: a big radius for the precision, a small footprint for the
    // screen. The hub is outside the right edge and well up from the bottom.
    expect(geometry.x).toBeGreaterThan(390);
    expect(geometry.y).toBeLessThan(844);
    expect(geometry.y).toBeGreaterThan(844 * 0.5);
  });

  it("answers to the rim and ignores the hub", () => {
    // A millimetre near the centre is an enormous angular delta, so only the rim drives it.
    const onEdge = { x: geometry.x - geometry.radius, y: geometry.y };
    expect(onRim(onEdge.x, onEdge.y, geometry)).toBe(true);
    const nearHub = { x: geometry.x - geometry.radius * 0.2, y: geometry.y };
    expect(onRim(nearHub.x, nearHub.y, geometry)).toBe(false);
    const wellClear = { x: geometry.x - geometry.radius * 2.2, y: geometry.y };
    expect(onRim(wellClear.x, wellClear.y, geometry)).toBe(false);
  });

  it("forgives a thumb that lands a little wide of the rim", () => {
    const wide = { x: geometry.x - geometry.radius - DIAL.grabSlop * 0.6, y: geometry.y };
    expect(onRim(wide.x, wide.y, geometry)).toBe(true);
  });
});

describe("turning it by hand", () => {
  it("is one to one: the heading turns as far as the thumb did", () => {
    const wheel = new DialWheel();
    sweep(wheel, [0, 0.25, 0.5, 0.75, 1], 0.016);
    expect(wheel.take(0.016)).toBeCloseTo(1, 5);
  });

  it("hands over everything it owes exactly once", () => {
    // Several pointer events can land between two frames, and the rotation from all of them has to
    // arrive -- once. Dropping some reads as the game ignoring a fast gesture; repeating them spins the
    // drone twice as far as the thumb asked.
    const wheel = new DialWheel();
    sweep(wheel, [0, 0.3, 0.6], 0.004);
    expect(wheel.take(0.016)).toBeCloseTo(0.6, 5);
    expect(wheel.take(0.016)).toBe(0);
  });

  it("turns the short way when the thumb crosses the seam", () => {
    const wheel = new DialWheel();
    sweep(wheel, [3.0, 3.14, -3.0], 0.016);
    // Continuous motion in one direction, so the total is small and positive rather than a full turn.
    const turned = wheel.take(0.016);
    expect(turned).toBeGreaterThan(0);
    expect(turned).toBeLessThan(0.6);
  });

  it("ignores a drag that never grabbed", () => {
    const wheel = new DialWheel();
    wheel.drag(1, 0.1);
    expect(wheel.take(0.016)).toBe(0);
  });
});

describe("letting go", () => {
  it("stops dead when the thumb was placing it, not throwing it", () => {
    // This is the entire momentum decision and the player makes it with their hand. A slow settle onto a
    // heading must never launch the wheel.
    const wheel = new DialWheel();
    sweep(wheel, [0, 0.01, 0.02], 0.05);
    wheel.release(0.15);
    expect(wheel.spin).toBe(0);
  });

  it("keeps spinning after a flick", () => {
    const wheel = new DialWheel();
    const now = sweep(wheel, [0, 0.2, 0.4, 0.6], 0.016);
    wheel.release(now);
    expect(wheel.spin).toBeGreaterThan(DIAL.flickMin);
  });

  it("spins the way the thumb went", () => {
    const wheel = new DialWheel();
    const now = sweep(wheel, [0, -0.2, -0.4, -0.6], 0.016);
    wheel.release(now);
    expect(wheel.spin).toBeLessThan(-DIAL.flickMin);
  });

  it("refuses to be flung by one stuttered frame", () => {
    // A long gap followed by a jump is a dropped frame, not a throw. Measured across the window rather
    // than from the last delta, which is what made a stutter into a fling.
    const wheel = new DialWheel();
    wheel.grab(0, 0);
    wheel.drag(0.02, 0.2);
    wheel.release(0.21);
    expect(Math.abs(wheel.spin)).toBeLessThan(DIAL.flickMin);
  });

  it("caps a spin so nothing becomes a blur", () => {
    const wheel = new DialWheel();
    const now = sweep(wheel, [0, 2, 4, 6], 0.008);
    wheel.release(now);
    expect(Math.abs(wheel.spin)).toBeLessThanOrEqual(DIAL.spinMax);
  });

  it("reads a release long after the last movement as stationary", () => {
    const wheel = new DialWheel();
    wheel.grab(0, 0);
    wheel.drag(0.5, 0.01);
    // Thumb rested on the rim for a third of a second before lifting.
    wheel.release(0.34);
    expect(wheel.spin).toBe(0);
  });
});

describe("a free spin", () => {
  it("coasts and settles", () => {
    const wheel = new DialWheel();
    const now = sweep(wheel, [0, 0.25, 0.5, 0.75], 0.016);
    wheel.release(now);
    let turned = 0;
    for (let frame = 0; frame < 600; frame++) turned += wheel.take(1 / 60);
    expect(turned).toBeGreaterThan(0.5);
    expect(wheel.spin).toBe(0);
  });

  it("coasts the same distance whatever the frame rate", () => {
    // Decay is per second through an exponential, not per frame. Per-frame decay has bitten this
    // codebase before: the same gesture went further on a fast machine.
    const spinUp = () => {
      const wheel = new DialWheel();
      const now = sweep(wheel, [0, 0.25, 0.5, 0.75], 0.016);
      wheel.release(now);
      return wheel;
    };
    const fast = spinUp();
    const slow = spinUp();
    let fastTurn = 0;
    let slowTurn = 0;
    for (let frame = 0; frame < 240; frame++) fastTurn += fast.take(1 / 60);
    for (let frame = 0; frame < 52; frame++) slowTurn += slow.take(1 / 13);
    expect(slowTurn).toBeCloseTo(fastTurn, 1);
  });

  it("is stopped dead by a touch, and says so", () => {
    // Tap-to-catch, the same as stopping a scrolling list. The caller is told, because a wheel stopped
    // by hand should sound different from one being turned.
    const wheel = new DialWheel();
    const now = sweep(wheel, [0, 0.25, 0.5, 0.75], 0.016);
    wheel.release(now);
    expect(wheel.spin).toBeGreaterThan(0);
    const caught = wheel.grab(1, now + 0.2);
    expect(caught.caught).toBe(true);
    expect(wheel.spin).toBe(0);
  });

  it("does not call an ordinary grab a catch", () => {
    const wheel = new DialWheel();
    expect(wheel.grab(0, 0).caught).toBe(false);
  });

  it("is over when cleared", () => {
    const wheel = new DialWheel();
    const now = sweep(wheel, [0, 0.3, 0.6], 0.016);
    wheel.release(now);
    wheel.clear();
    expect(wheel.spin).toBe(0);
    expect(wheel.take(0.016)).toBe(0);
  });

  it("reports being gripped, for the drawing", () => {
    const wheel = new DialWheel();
    expect(wheel.gripped).toBe(false);
    wheel.grab(0, 0);
    expect(wheel.gripped).toBe(true);
    wheel.release(0.1);
    expect(wheel.gripped).toBe(false);
  });
});

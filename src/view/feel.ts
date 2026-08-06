// The three things every reaction in this game is made of.
//
// The board's bricks already had their own spring state in `feedback.ts`, written for a field of
// hundreds of them. This is the same idea for the handful of *single* actors -- the drone, the
// paddle, a readout -- plus the two pieces of bookkeeping that stop a good effect becoming a bad
// one.
//
// Both of those pieces exist because of a specific failure. The first pass at breakout feedback put
// a camera kick and a hit-pause on every contact, which read as "far too much" precisely because
// nothing bounded it: twenty events in a frame produced twenty times the response, and a held input
// produced one impact per frame forever. So:
//
//   - `Pulse` saturates. Ten hits in one frame are one bright flash, not ten stacked.
//   - `Gate` rate-limits. A sustained state gets a texture rather than a machine gun.
//
// Neither is clever. Both are the difference between an effect that heightens the action and an
// effect that shouts over it.

import { motionScale } from "../viewport";

/**
 * A knock that springs back.
 *
 * Stiff and well damped, like the brick reactions: a shove that returns with a little overshoot
 * reads as a physical object seated in something, where a shove that eases back reads as an
 * animation playing.
 */
export class Shudder {
  x = 0;
  y = 0;
  /** Radians. */
  roll = 0;
  private vx = 0;
  private vy = 0;
  private vroll = 0;

  constructor(
    private readonly stiffness = 380,
    private readonly damping = 16,
  ) {}

  /** True while there is anything worth applying, so callers can skip the write. */
  get active(): boolean {
    return Math.abs(this.x) > 0.01 || Math.abs(this.y) > 0.01 || Math.abs(this.roll) > 0.0005;
  }

  /**
   * Knock it. `dirX`/`dirY` need not be normalised.
   *
   * Scaled by `motionScale` at the source rather than at the point of use, so a reduced-motion
   * player never has a shudder computed that is then thrown away -- and so no caller can forget.
   */
  kick(dirX: number, dirY: number, magnitude: number, spin = 0): void {
    const scale = motionScale();
    if (scale <= 0) return;
    const length = Math.hypot(dirX, dirY) || 1;
    this.vx += (dirX / length) * magnitude * scale;
    this.vy += (dirY / length) * magnitude * scale;
    this.vroll += spin * scale;
  }

  /**
   * Hold it displaced, without springing back.
   *
   * For a sustained press rather than an impact -- a hull leaning on rock it cannot get through.
   * Assigned rather than accumulated, because a press is a position and not a series of blows.
   */
  press(dirX: number, dirY: number, distance: number): void {
    const scale = motionScale();
    const length = Math.hypot(dirX, dirY) || 1;
    this.x = (dirX / length) * distance * scale;
    this.y = (dirY / length) * distance * scale;
  }

  update(dt: number): void {
    const step = Math.min(dt, 1 / 60);
    this.vx += (-this.stiffness * this.x - this.damping * this.vx) * step;
    this.vy += (-this.stiffness * this.y - this.damping * this.vy) * step;
    this.vroll += (-this.stiffness * 0.7 * this.roll - this.damping * 0.8 * this.vroll) * step;
    this.x += this.vx * step;
    this.y += this.vy * step;
    this.roll += this.vroll * step;
  }
}

/**
 * A 0..1 value that decays, and whose hits saturate.
 *
 * `hit` takes a maximum rather than adding, which is the whole point. A cascade that breaks nine
 * bricks in one frame should read as one bright moment; summing would read as a white screen, and
 * clamping a sum still means the ninth brick contributed nothing while the second did — so the
 * response would depend on arrival order.
 */
export class Pulse {
  value = 0;

  constructor(private readonly decayPerSecond = 3.4) {}

  hit(strength = 1): void {
    this.value = Math.max(this.value, Math.min(1, strength));
  }

  update(dt: number): void {
    this.value = Math.max(0, this.value - dt * this.decayPerSecond);
  }
}

/**
 * Permission to do something again yet.
 *
 * Time-based rather than a frame counter, so it behaves the same at 60 and 144 Hz and at every
 * simulation rate the speed-up offers.
 */
export class Gate {
  private left = 0;

  constructor(private readonly interval: number) {}

  /** Consume the gate if it is open. Returns whether it was. */
  tick(dt: number): boolean {
    this.left -= dt;
    if (this.left > 0) return false;
    this.left = this.interval;
    return true;
  }

  /** Let the next call through regardless. For the first contact of a new sustained state. */
  open(): void {
    this.left = 0;
  }
}

// The facing wheel.
//
// A dial, mounted half off the screen's edge so only a crescent of its rim is on the glass. That
// geometry is the point rather than a flourish: angular precision scales with radius, so a large wheel
// showing a small crescent gives fine control from one corner of a phone, and the thumb rests on the
// *rim* and strokes along it instead of reaching across a face.
//
// It drives `player.heading`, which in this game does three jobs at once -- it aims the claim frame, it
// presents the paddle's face to a Bounder, and it points the lamp -- so facing earns a control of its
// own rather than sharing one.
//
// The grammar is the one every phone user already has: drag and release and it stops, flick and it
// carries on spinning, touch it again and it stops dead. That is inertial scrolling, the most practised
// touch interaction there is, and borrowing it wholesale is why this needs no teaching. It also means
// the player chooses precision or sweep per gesture, which is why there is no momentum toggle and no
// snapping: a wheel that lunged toward the nearest enemy would not be a wheel.
//
// Kept as pure state and arithmetic, with no reference to a pointer event or a canvas, so the parts that
// are easy to get quietly wrong -- the angle wrap, the flick estimate, frame-rate-independent decay --
// are testable without a browser.

export const DIAL = {
  /**
   * Rim radius in CSS pixels, and how far the hub sits outside the edge.
   *
   * A hub exactly on the edge shows a true half. A little further out trims the crescent to the part a
   * thumb can actually sweep without crossing the screen's corner.
   */
  radius: 76,
  hubOutset: 14,
  /**
   * How far up from the bottom edge the hub sits.
   *
   * Set by what it must not collide with rather than by taste. An early version swept down through the
   * COMMIT and SERVE buttons -- visually, and worse, in its grab band, so part of the rim was dead where a
   * DOM button sat over it. Placed so the ring's lowest point plus its slop clears the button row, which
   * puts the crescent's middle about three quarters of the way down: squarely in the thumb's arc.
   */
  hubRise: 200,
  /**
   * Nothing inside this fraction of the radius drives the wheel.
   *
   * Angle is unstable near the hub: a millimetre of movement close to the centre is an enormous angular
   * delta, so without a guard a thumb that strays inward makes the drone spin wildly. Only the rim turns
   * it, which is also how a real dial behaves.
   */
  innerGuard: 0.42,
  /**
   * Extra pixels beyond the rim that still count as a grab, since fingers are not precise.
   *
   * Kept proportionate to the rim. On a small wheel a generous slop stops being forgiveness and starts
   * swallowing the drags that were meant to fly the drone.
   */
  grabSlop: 26,
  /** Detents per full turn. Sixteen is a tick every 22.5 degrees -- felt as texture, not as a ratchet. */
  detents: 16,
  /**
   * Radians per second below which a release is a stop rather than a flick.
   *
   * The whole discrimination between "I was aiming" and "I was throwing it" lives here. Generous enough
   * that settling the wheel onto a heading never launches it.
   */
  flickMin: 1.6,
  /** Ceiling on a flick, so a stutter cannot fling the drone into a blur. */
  spinMax: 14,
  /** Exponential decay of a free spin, per second. */
  decay: 2.1,
  /** Spin below this is over, so the wheel settles instead of creeping. */
  spinStop: 0.12,
  /** A touch while spinning faster than this is a catch: the wheel stops under the thumb. */
  catchSpin: 0.5,
  /**
   * Seconds of pointer history a flick is measured over.
   *
   * Measured across a window rather than from the last event: a single stuttered frame at the end of a
   * drag is not a throw, and taking the last delta alone made it one.
   */
  flickWindow: 0.07,
} as const;

/** Where the wheel sits, for a canvas of this size in CSS pixels. */
export function dialGeometry(width: number, height: number): { x: number; y: number; radius: number } {
  return { x: width + DIAL_HUB_OUTSET, y: height - DIAL.hubRise, radius: DIAL.radius };
}

const DIAL_HUB_OUTSET = DIAL.hubOutset;

/** Is this point on the rim's crescent, and therefore a grab? */
export function onRim(x: number, y: number, geometry: { x: number; y: number; radius: number }): boolean {
  const distance = Math.hypot(x - geometry.x, y - geometry.y);
  return distance >= geometry.radius * DIAL.innerGuard && distance <= geometry.radius + DIAL.grabSlop;
}

/**
 * The shortest way round from one angle to another, in radians.
 *
 * Everything downstream depends on this: without it a thumb crossing the cut at pi hands the drone a
 * delta of nearly a full turn in the wrong direction, once per sweep.
 */
export function shortestDelta(from: number, to: number): number {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

/** How many detent lines lie between two headings, and therefore how many ticks to sound. */
export function detentsCrossed(from: number, to: number): number {
  const step = (Math.PI * 2) / DIAL.detents;
  return Math.abs(Math.floor(to / step) - Math.floor(from / step));
}

/**
 * Both ends of every movement are recorded, not just when it arrived.
 *
 * A single delta with only an arrival time cannot be turned into a velocity -- dividing it by the time
 * since it landed is precisely the "last event" estimate this window exists to avoid, and it turned one
 * stuttered frame into a fling. With both ends the span is the real interval the thumb moved over, and a
 * lone sample that took a fifth of a second correctly reads as slow.
 */
interface Sample {
  /** Angular delta, radians. */
  delta: number;
  /** When the movement started, in seconds. */
  from: number;
  /** And when it ended. */
  to: number;
}

/**
 * The wheel's state: whether a thumb is on it, and how fast it is turning on its own.
 *
 * `take` is the seam with the rest of the game. The wheel accumulates the rotation it owes and hands it
 * over once per frame, so a fast drag spread across several pointer events is never dropped between
 * frames and never counted twice.
 */
export class DialWheel {
  private held = false;
  private lastAngle = 0;
  /** When the thumb last moved, so a delta knows the interval it happened over. */
  private lastMoveAt = 0;
  private samples: Sample[] = [];
  private owed = 0;
  /** Radians per second of free spin. Zero while held. */
  spin = 0;
  /** True from the moment of a grab until the release, for drawing the wheel as gripped. */
  get gripped(): boolean {
    return this.held;
  }

  /**
   * A thumb has landed on the rim.
   *
   * Returns whether this counted as a catch, so the caller can tick the sound of a wheel being stopped
   * by hand -- which is a different event from a wheel being turned.
   */
  grab(angle: number, now: number): { caught: boolean } {
    const caught = Math.abs(this.spin) > DIAL.catchSpin;
    this.held = true;
    this.lastAngle = angle;
    this.lastMoveAt = now;
    this.samples = [];
    this.spin = 0;
    return { caught };
  }

  /** The thumb has moved along the rim. */
  drag(angle: number, now: number): void {
    if (!this.held) return;
    const delta = shortestDelta(this.lastAngle, angle);
    this.lastAngle = angle;
    this.owed += delta;
    this.samples.push({ delta, from: this.lastMoveAt, to: now });
    this.lastMoveAt = now;
    this.prune(now);
  }

  /**
   * The thumb has left the rim.
   *
   * A flick becomes a spin and anything slower becomes a stop, which is the entire momentum decision and
   * the player makes it with their hand rather than with a setting.
   */
  release(now: number): void {
    if (!this.held) return;
    this.held = false;
    this.prune(now);
    // The span is the interval the thumb actually moved over, from the start of the oldest kept movement
    // to the end of the newest -- and then extended to the moment of release, so lifting off after a
    // pause reads as stationary rather than as whatever the thumb was doing before it stopped.
    const oldest = this.samples[0];
    const newest = this.samples[this.samples.length - 1];
    const span = oldest ? Math.max(now - oldest.from, newest.to - oldest.from, 1e-3) : 0;
    const travelled = this.samples.reduce((total, sample) => total + sample.delta, 0);
    const velocity = span > 0 ? travelled / span : 0;
    this.samples = [];
    if (Math.abs(velocity) < DIAL.flickMin) {
      this.spin = 0;
      return;
    }
    this.spin = Math.max(-DIAL.spinMax, Math.min(DIAL.spinMax, velocity));
  }

  /** Everything stops. Called when the game pauses or a gesture is abandoned. */
  clear(): void {
    this.held = false;
    this.spin = 0;
    this.owed = 0;
    this.samples = [];
  }

  /**
   * Advance a free spin and hand over the rotation owed since the last call.
   *
   * Decay is per second and applied through an exponential, so the wheel coasts the same distance on a
   * machine holding sixty frames as on one managing thirteen. This codebase has been bitten by
   * per-frame decay before.
   */
  take(dt: number): number {
    if (!this.held && this.spin !== 0) {
      // The closed form of the integral, not a Euler step. Adding `spin * dt` and then decaying
      // overestimates by more the larger the frame, so the same flick coasted visibly further on a fast
      // machine than a slow one -- which is the bug this test-drove out.
      const fade = Math.exp(-DIAL.decay * dt);
      this.owed += (this.spin * (1 - fade)) / DIAL.decay;
      this.spin *= fade;
      if (Math.abs(this.spin) < DIAL.spinStop) this.spin = 0;
    }
    const owed = this.owed;
    this.owed = 0;
    return owed;
  }

  private prune(now: number): void {
    while (this.samples.length && now - this.samples[0].to > DIAL.flickWindow) this.samples.shift();
  }
}

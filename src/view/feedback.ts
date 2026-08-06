// The board reacting.
//
// This exists because the first pass at breakout feedback was camera shake and hit-stop on every
// contact, which is the exact trap the screenshake talk warns about -- shake "gets kind of
// addictive and you get used to it and you put a ton of it in your games and you stop noticing
// it". The effects that actually sell an impact in that talk are the *things in the world*
// reacting: enemies flash white, they knock back a couple of pixels, the props respond when you
// miss. The camera is the last and smallest layer, not the first.
//
// So: a struck brick flashes, squashes, spins and is shoved off its seat, and its neighbours are
// shoved and lit in a wave that visibly travels outward. Nothing here touches the camera.

import { BRICK_HALF, CELL, PALETTE } from "../config";
import type { Brick } from "../types";

/**
 * Transient reaction state per brick. Never saved -- it is entirely about the last half second.
 *
 * A spring rather than a tween, because a shove that returns with a little overshoot reads as a
 * physical object seated in the board, and a shove that eases back to rest reads as an animation.
 */
export interface BrickReaction {
  /** Offset from the brick's seat, in board cells. */
  su: number;
  sv: number;
  vu: number;
  vv: number;
  /** Rotation offset, radians, and its velocity. */
  spin: number;
  spinV: number;
  /** Current brightness, 0..1, decaying. */
  pulse: number;
  /** Seconds until this brick's share of a travelling wave arrives. */
  wait: number;
  /** What the pulse will be worth when the wait runs out. */
  pending: number;
  /** Squash, 0..1, applied along the board axes. */
  squash: number;
}

export const newReaction = (): BrickReaction => ({
  su: 0, sv: 0, vu: 0, vv: 0, spin: 0, spinV: 0, pulse: 0, wait: 0, pending: 0, squash: 0,
});

/** Spring constants. Stiff and well damped: a knock, not a wobble. */
const STIFFNESS = 420;
const DAMPING = 15;
const SPIN_STIFFNESS = 260;
const SPIN_DAMPING = 11;

export interface ImpulseOptions {
  /** Where it came from, in board cells. */
  u: number;
  v: number;
  /** Direction the force travels, normalised-ish. Bricks are shoved along it. */
  du: number;
  dv: number;
  /** Shove given to the brick at the origin, in cells. */
  force: number;
  /** How far the wave carries, in cells. Beyond this nothing moves. */
  reach: number;
  /** Brightness at the origin, 0..1. */
  light: number;
  /** How fast the wave travels outward, cells per second. Lower reads as heavier. */
  speed: number;
  /** The brick that was actually struck, which gets the full treatment rather than the falloff. */
  struck?: Brick;
}

/**
 * Shove and light a neighbourhood.
 *
 * The delay is what makes this read as a wave rather than as everything flinching at once: a brick
 * three cells away lights up three cells' worth of time later, so the eye sees the impact travel.
 * That is the whole difference between "the board reacted" and "some bricks changed colour".
 */
export function impulse(bricks: readonly Brick[], options: ImpulseOptions): void {
  const length = Math.hypot(options.du, options.dv) || 1;
  const dirU = options.du / length;
  const dirV = options.dv / length;
  for (const brick of bricks) {
    if (!brick.alive || !brick.react) continue;
    const offU = brick.u - options.u;
    const offV = brick.v - options.v;
    const distance = Math.hypot(offU, offV);
    if (distance > options.reach) continue;
    // Falls off with the square of distance, which keeps the struck brick and its immediate
    // neighbours clearly the event and everything beyond them clearly the echo.
    const falloff = (1 - distance / options.reach) ** 2;
    const isStruck = brick === options.struck;
    const push = options.force * (isStruck ? 1 : falloff * 0.55);
    brick.react.vu += dirU * push;
    brick.react.vv += dirV * push;
    // Struck bricks spin off the contact; neighbours are only nudged, and alternate sign by
    // position so a row does not all rotate the same way and read as a single sliding sheet.
    const spinSign = ((Math.round(brick.u * 2) + Math.round(brick.v * 2)) % 2 === 0) ? 1 : -1;
    brick.react.spinV += (isStruck ? 5.2 : 1.5 * falloff) * spinSign * Math.sign(push || 1);
    if (isStruck) brick.react.squash = Math.min(1, brick.react.squash + 0.9);
    const light = options.light * (isStruck ? 1 : falloff);
    const wait = isStruck ? 0 : distance / options.speed;
    if (wait <= 0) {
      // Applied on the spot rather than queued. Queuing it with a zero wait meant the countdown
      // branch in `stepReactions` never ran for it, so the brick the player actually hit was the
      // one brick on the board that never lit up.
      brick.react.pulse = Math.max(brick.react.pulse, light);
    } else if (light > brick.react.pending || brick.react.wait <= 0) {
      brick.react.pending = Math.max(brick.react.pending, light);
      brick.react.wait = wait;
    }
  }
}

/** Integrate every brick's reaction. Real seconds. */
export function stepReactions(bricks: readonly Brick[], dt: number): void {
  const step = Math.min(dt, 1 / 60);
  for (const brick of bricks) {
    const react = brick.react;
    if (!react) continue;
    if (react.wait > 0) {
      react.wait -= step;
      if (react.wait <= 0) {
        react.pulse = Math.max(react.pulse, react.pending);
        react.pending = 0;
      }
    }
    // Spring back to the seat.
    react.vu += (-STIFFNESS * react.su - DAMPING * react.vu) * step;
    react.vv += (-STIFFNESS * react.sv - DAMPING * react.vv) * step;
    react.su += react.vu * step;
    react.sv += react.vv * step;
    react.spinV += (-SPIN_STIFFNESS * react.spin - SPIN_DAMPING * react.spinV) * step;
    react.spin += react.spinV * step;
    react.pulse = Math.max(0, react.pulse - step * 3.4);
    react.squash = Math.max(0, react.squash - step * 6);
    // Clamped so a cascade cannot fling a brick across the board.
    const limit = BRICK_HALF * 0.7;
    react.su = Math.max(-limit, Math.min(limit, react.su));
    react.sv = Math.max(-limit, Math.min(limit, react.sv));
  }
}

/**
 * Put a brick where its reaction says it should be.
 *
 * `flash` is the existing white-hot hit flash; the pulse is the travelling colour wave. They are
 * separate on purpose: the flash says "this is the one you hit" and the pulse says "and the board
 * felt it", and collapsing them would lose the distinction.
 */
export function applyReaction(
  brick: Brick, baseX: number, baseY: number, angle: number, accent: number,
): void {
  const display = brick.display;
  const react = brick.react;
  if (!display || !react) return;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // Board-space offset rotated into world space, so a shove pushes along the board's own axes at
  // any claim angle rather than always pushing screen-down.
  display.position.set(
    baseX + (react.su * cos - react.sv * sin) * CELL,
    baseY + (react.su * sin + react.sv * cos) * CELL,
  );
  display.rotation = angle + react.spin * 0.16;
  const flash = brick.hitFlash / 0.14;
  const lift = react.pulse * 0.1 + flash * 0.07;
  display.scale.set(
    (1 + lift) * (1 - react.squash * 0.22),
    (1 + lift) * (1 + react.squash * 0.16),
  );
  // Tinted toward the material's own accent as the wave passes, and toward white at the moment of
  // contact. A pulse in the material's colour keeps the board reading as rock rather than as UI.
  if (react.pulse > 0.01 || flash > 0.01) {
    display.tint = flash > react.pulse ? PALETTE.ink : mix(0xffffff, accent, Math.min(1, react.pulse));
    display.alpha = brick.worked ? 0.72 : 1;
  } else if (display.tint !== 0xffffff) {
    display.tint = brick.worked ? 0x8e9694 : 0xffffff;
  }
}

function mix(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const lerp = (from: number, to: number) => Math.round(from + (to - from) * t);
  return (lerp(ar, br) << 16) | (lerp(ag, bg) << 8) | lerp(ab, bb);
}

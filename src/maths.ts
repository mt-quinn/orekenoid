// Small numeric helpers shared across the game, renderer and HUD.
//
// These live in one place because several of them must agree exactly: `smooth` is
// used for both camera easing and brick reveal, and `nearestAngle` is what keeps
// the arena camera from taking the long way round.

import type { Vec2 } from "./types";

export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** Flatten a point list for Pixi's `poly()`, which takes a bare number array. */
export const flatPoints = (points: Vec2[]) => points.flatMap((point) => [point.x, point.y]);

/** Quintic smoothstep. Zero velocity and zero acceleration at both ends. */
export const smooth = (t: number) => {
  const p = clamp(t, 0, 1);
  return p * p * p * (p * (p * 6 - 15) + 10);
};

export const normalizeAngle = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

/**
 * The representation of `target` closest to `from`.
 *
 * Rotating to an arena's heading must take the short way round: interpolating to a
 * raw angle can spin the whole world 350 degrees to reach a 10 degree turn.
 */
export const nearestAngle = (from: number, target: number) => from + normalizeAngle(target - from);

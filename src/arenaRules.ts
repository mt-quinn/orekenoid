// Province rules that act on a live arena.
//
// Each is bounded and deterministic. The brief flags open-ended regrowth and
// fluid simulation as production risks, so regrowth here runs on an explicit
// cell budget and a fixed tick rather than as a free-running simulation -- it
// can never stall a claim forever.

import { BRICK_HALF } from "./config";
import { materialOf } from "./materials";
import type { Arena, Brick, Membrane } from "./types";

/** How often a regrowth step is considered, in seconds of arena time. */
export const REGROWTH_INTERVAL = 3.2;
export const MEMBRANE_LIFETIME = 4.2;
/** Cascades are depth-limited so a single lattice cannot clear an entire board. */
export const MAX_CASCADE_DEPTH = 3;

/** Regrowth budget for a freshly framed arena: half its living material, capped. */
export function initialRegrowthBudget(bricks: Brick[]): number {
  const living = bricks.filter((brick) => materialOf(brick.kind).regrows).length;
  return Math.min(18, Math.floor(living * 0.5));
}

/**
 * One bounded regrowth step.
 *
 * A dead lattice slot orthogonally adjacent to surviving growth is reclaimed.
 * Iteration order is fixed, so the same arena always regrows the same cells --
 * fast clearing being worse than pruning has to be a learnable rule, not a dice
 * roll.
 */
export function stepRegrowth(arena: Arena, dt: number): Brick[] {
  if (arena.regrowthBudget <= 0) return [];
  arena.regrowthTimer += dt;
  if (arena.regrowthTimer < REGROWTH_INTERVAL) return [];
  arena.regrowthTimer = 0;

  const alive = arena.bricks.filter((brick) => brick.alive && materialOf(brick.kind).regrows);
  if (!alive.length) return [];

  const ordered = [...arena.bricks].sort((a, b) => (a.v - b.v) || (a.u - b.u));
  const revived: Brick[] = [];
  for (const candidate of ordered) {
    if (arena.regrowthBudget <= 0) break;
    if (candidate.alive) continue;
    // Persistent structure is never reclaimed by growth.
    if (candidate.persistent) continue;
    const source = alive.find((brick) =>
      Math.abs(brick.u - candidate.u) + Math.abs(brick.v - candidate.v) <= 1.001);
    if (!source) continue;
    const definition = materialOf(source.kind);
    candidate.alive = true;
    candidate.kind = source.kind;
    candidate.hp = definition.hp;
    candidate.maxHp = definition.hp;
    candidate.liable = definition.liable;
    // Regrown material carries no resource: the seam was already taken.
    candidate.resource = null;
    candidate.hitFlash = 0.2;
    arena.regrowthBudget--;
    revived.push(candidate);
    // One cell per tick keeps the rule readable at a glance.
    break;
  }
  return revived;
}

/** A destroyed spore bulb leaves a short-lived rebound surface where it stood. */
export function spawnMembrane(arena: Arena, brick: Brick): Membrane {
  const membrane: Membrane = {
    u: brick.u,
    v: brick.v,
    halfWidth: BRICK_HALF * 1.55,
    halfHeight: BRICK_HALF * 0.34,
    life: MEMBRANE_LIFETIME,
    maxLife: MEMBRANE_LIFETIME,
  };
  arena.membranes.push(membrane);
  return membrane;
}

export function stepMembranes(arena: Arena, dt: number): Membrane[] {
  const expired: Membrane[] = [];
  for (let index = arena.membranes.length - 1; index >= 0; index--) {
    const membrane = arena.membranes[index];
    membrane.life -= dt;
    if (membrane.life <= 0) {
      expired.push(membrane);
      arena.membranes.splice(index, 1);
    }
  }
  return expired;
}

/**
 * Charged facet cascade.
 *
 * Breaking charged crystal propagates into adjacent crystal, and charged
 * neighbours propagate onward. A claim aligned to the lattice therefore produces
 * a controllable cascade; one aligned against it produces almost nothing. That
 * difference is the entire reason orientation matters in Mirrorreef.
 */
export function collectCascade(arena: Arena, origin: Brick): Brick[] {
  if (!materialOf(origin.kind).chains) return [];
  const affected: Brick[] = [];
  const seen = new Set<Brick>([origin]);
  let frontier: Brick[] = [origin];

  for (let depth = 0; depth < MAX_CASCADE_DEPTH && frontier.length; depth++) {
    const next: Brick[] = [];
    for (const source of frontier) {
      for (const brick of arena.bricks) {
        if (!brick.alive || seen.has(brick) || brick.persistent) continue;
        if (materialOf(brick.kind).reflect !== "facet") continue;
        if (Math.abs(brick.u - source.u) > 1.001 || Math.abs(brick.v - source.v) > 1.001) continue;
        seen.add(brick);
        affected.push(brick);
        if (materialOf(brick.kind).chains) next.push(brick);
      }
    }
    frontier = next;
  }
  return affected;
}

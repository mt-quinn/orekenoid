// The load coming home.
//
// When a claim resolves, everything still standing that counts as load flies at the paddle. Under
// the chassis's armour it sparks off the plating; beyond it, it punches through and strikes the
// machine. The damage figure was already correct -- it was just a number that appeared, and a
// number is the one thing a player cannot feel.
//
// This is the second bookend of a claim. The board forms by rippling out of the rock, and it ends
// by throwing whatever the player left behind at them.

import { Container, Graphics } from "pixi.js";
import { CELL, PALETTE } from "../config";
import type { Arena } from "../types";

/** One piece of load in flight. Positions are arena-local, like everything else on the board. */
interface Slug {
  u: number;
  v: number;
  /** Where it is heading: the paddle. */
  toU: number;
  toV: number;
  colour: number;
  /**
   * True when the hull's armour stops this one.
   *
   * Decided before anything flies, because it is not a per-piece accident: the first `soak` units
   * of load are what the plating is for, and the rest are the damage. Showing the split is the
   * whole point -- the player should be able to count the ones that got through.
   */
  deflected: boolean;
  /** Seconds until it launches, so the volley arrives as a rattle rather than a single thud. */
  delay: number;
  travel: number;
  /** Set once it lands, and counted down so the spark or the wound has a moment on screen. */
  spent: number;
  graphic: Graphics;
}

const FLIGHT = 0.34;

export class LoadStrike {
  readonly container = new Container();
  private slugs: Slug[] = [];
  private done = true;
  /** Impacts that have landed and not yet been reported, so the caller can react per hit. */
  private landed: Array<{ deflected: boolean; u: number; v: number }> = [];

  get finished(): boolean {
    return this.done;
  }

  /**
   * Throw `count` pieces of load, of which `soak` are stopped by the plating.
   *
   * Deliberately capped: forty pieces of load is a rattle, four hundred is a wall of noise that
   * says nothing. Past the cap the volley reads as "a lot" either way, and the HUD carries the
   * exact figure.
   */
  begin(arena: Arena, standing: Array<{ u: number; v: number; colour: number }>, soak: number): void {
    this.clear();
    const cap = 40;
    const shown = standing.slice(0, cap);
    // Deflected first in the *list*, but launch order is shuffled by delay below so the two kinds
    // interleave -- a volley that deflects everything and then wounds everything reads as two
    // events rather than one.
    const deflectedCount = Math.min(shown.length, Math.round(soak / Math.max(1, standing.length) * shown.length));
    shown.forEach((piece, index) => {
      const graphic = new Graphics()
        .roundRect(-CELL * 0.16, -CELL * 0.16, CELL * 0.32, CELL * 0.32, 3)
        .fill(piece.colour)
        .stroke({ width: 1.5, color: PALETTE.exhaust, alpha: 0.8 });
      this.container.addChild(graphic);
      this.slugs.push({
        u: piece.u,
        v: piece.v,
        toU: arena.paddle.u,
        toV: 0.2,
        colour: piece.colour,
        deflected: index < deflectedCount,
        // Staggered by distance so the near ones arrive first: the volley sweeps in rather than
        // teleporting as one.
        delay: 0.06 + (piece.v / Math.max(1, arena.depth)) * 0.5 + (index % 5) * 0.02,
        travel: 0,
        spent: 0,
        graphic,
      });
    });
    // Interleave the two kinds by shuffling delays between them, deterministically.
    this.slugs.sort((a, b) => (a.delay + (a.deflected ? 0.021 : 0)) - (b.delay + (b.deflected ? 0 : 0.021)));
    this.done = this.slugs.length === 0;
  }

  clear(): void {
    for (const slug of this.slugs) slug.graphic.destroy();
    this.slugs = [];
    this.landed = [];
    this.done = true;
  }

  /** Impacts since the last call, for the caller to sound and shake. */
  drainLanded(): Array<{ deflected: boolean; u: number; v: number }> {
    const landed = this.landed;
    this.landed = [];
    return landed;
  }

  update(dt: number, arena: Arena, toWorld: (u: number, v: number) => { x: number; y: number }): void {
    if (this.done) return;
    let live = 0;
    for (const slug of this.slugs) {
      if (slug.spent > 0) {
        slug.spent -= dt;
        continue;
      }
      if (slug.delay > 0) {
        slug.delay -= dt;
        live++;
        slug.graphic.visible = false;
        continue;
      }
      slug.graphic.visible = true;
      live++;
      slug.travel = Math.min(1, slug.travel + dt / FLIGHT);
      // Eased in, so it accelerates toward the hull rather than drifting at constant speed.
      const eased = slug.travel * slug.travel;
      // Deflected load stops at the plating, a little short of the paddle itself, and is thrown
      // back out; load that gets through reaches the machine.
      const stopAt = slug.deflected ? 0.82 : 1;
      const reach = Math.min(eased, stopAt);
      const u = slug.u + (slug.toU - slug.u) * reach;
      const v = slug.v + (slug.toV - slug.v) * reach;
      const point = toWorld(u, v);
      slug.graphic.position.set(point.x * CELL, point.y * CELL);
      slug.graphic.rotation += dt * (slug.deflected ? 14 : 22);
      slug.graphic.scale.set(1 + reach * 0.3);
      if (eased >= stopAt) {
        this.landed.push({ deflected: slug.deflected, u, v });
        slug.spent = 0.001;
        slug.graphic.visible = false;
      }
    }
    if (live === 0) this.done = true;
    void arena;
  }
}

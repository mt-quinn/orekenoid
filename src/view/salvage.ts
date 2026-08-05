// The salvage drone: a bucket that sweeps up what the paddle missed, and eats a share of it.
//
// It replaced an ore-pull radius, which was invisible. A pull that drags drops toward the paddle
// is a number the player can only infer; a small machine that visibly darts under the paddle,
// catches a falling piece and grinds part of it is the same mechanic with the cost shown. The
// player should watch the tax being taken.
//
// Deliberately positioned *below* paddle level so it never competes with the catch the player is
// making themselves: it is a safety net under the working face, not a second paddle.

import { BlurFilter, Container, Graphics } from "pixi.js";
import { CELL, PALETTE, RESOURCES } from "../config";
import { Grinder } from "../salvage";
import type { Arena, Drop } from "../types";

/** How far below the paddle's own plane the bucket rides, in arena cells. */
const BELOW = 0.95;
/** Cells per second it can travel. Fast enough to always arrive, slow enough to be seen trying. */
const SPEED = 15;

interface Grind {
  /** Arena-local position, so the shower stays with the claim's own frame. */
  u: number;
  v: number;
  vu: number;
  vv: number;
  life: number;
  colour: number;
}

export class SalvageDrone {
  readonly container = new Container();
  private readonly body = new Graphics();
  private readonly bucket = new Graphics();
  private readonly jaws = new Graphics();
  private readonly haze = new Graphics();
  private grinds: Grind[] = [];
  /** Arena-local position. Follows the paddle when idle, the next doomed drop when working. */
  private u = 0;
  private phase = 0;
  /** Counts up while the grinder is chewing, so the jaws animate and the hopper glows. */
  private chewing = 0;
  private tax = 0;
  /** Which pieces get eaten. Pure arithmetic, so it lives outside this view -- see `salvage.ts`. */
  private readonly grinder = new Grinder();

  constructor() {
    this.haze.filters = [new BlurFilter({ strength: 8, quality: 2 })];
    this.container.addChild(this.haze, this.body, this.bucket, this.jaws);
    this.container.visible = false;
  }

  /** Fitted grade changed, or a claim began. Zero tax means no drone at all. */
  configure(tax: number): void {
    this.tax = tax;
    this.container.visible = tax > 0;
    this.grinder.configure(tax);
    if (tax <= 0) this.grinds = [];
  }

  /** Park under the paddle at the start of a claim. */
  reset(paddleU: number): void {
    this.u = paddleU;
    this.grinds = [];
    this.chewing = 0;
  }

  /**
   * Does this piece go into the grinder?
   *
   * Called once per rescued drop, and it is the authority on the tax -- the caller banks the ore
   * only when this says no.
   */
  grindsThis(): boolean {
    return this.grinder.grinds();
  }

  /** A drop was rescued here. Throw the grinding shower whether or not this one is eaten. */
  caught(drop: Drop, eaten: boolean): void {
    this.chewing = eaten ? 0.34 : 0.12;
    if (!eaten) return;
    const colour = RESOURCES[drop.resource].colour;
    for (let index = 0; index < 9; index++) {
      const angle = Math.PI + (index / 8 - 0.5) * 2.1;
      const speed = 1.6 + (index % 4) * 0.45;
      this.grinds.push({
        u: drop.u,
        v: -BELOW,
        vu: Math.cos(angle) * speed,
        vv: Math.abs(Math.sin(angle)) * speed * 0.7 + 0.6,
        life: 0.42,
        colour,
      });
    }
  }

  /**
   * Track the paddle, or the next drop the paddle is going to miss.
   *
   * Aiming at the doomed drop rather than at the paddle is what makes the catch read as
   * deliberate: the bucket is already sliding into position before the piece arrives.
   */
  update(dt: number, arena: Arena, paddleU: number): void {
    if (this.tax <= 0) return;
    this.phase += dt;

    let target = paddleU;
    let soonest = Infinity;
    for (const drop of arena.drops) {
      const missing = Math.abs(drop.u - paddleU) > arena.paddle.width / 2 + 0.35;
      if (!missing || drop.v > 5.5 || drop.v >= soonest) continue;
      soonest = drop.v;
      target = drop.u;
    }
    const step = SPEED * dt;
    this.u += Math.max(-step, Math.min(step, target - this.u));
    this.chewing = Math.max(0, this.chewing - dt);

    for (let index = this.grinds.length - 1; index >= 0; index--) {
      const grind = this.grinds[index];
      grind.life -= dt;
      if (grind.life <= 0) {
        this.grinds.splice(index, 1);
        continue;
      }
      grind.u += grind.vu * dt;
      grind.v += grind.vv * dt;
      grind.vv -= 3.2 * dt;
    }
    this.draw();
  }

  /** Arena-local u of the bucket, and the plane it rides on. For the caller's transform. */
  get position(): { u: number; v: number } {
    return { u: this.u, v: -BELOW };
  }

  private draw(): void {
    const chew = this.chewing > 0 ? Math.min(1, this.chewing / 0.34) : 0;
    const bob = Math.sin(this.phase * 7) * 1.4;
    const width = 0.62 * CELL;

    this.body.clear()
      .roundRect(-width / 2, -7 + bob, width, 11, 3).fill(0x141a1b)
      .stroke({ width: 1.6, color: PALETTE.machine, alpha: 0.9 })
      // Two little thrusters, so it reads as flying rather than hanging.
      .circle(-width / 2 + 3, 5 + bob, 2).fill({ color: PALETTE.karstEdge, alpha: 0.5 })
      .circle(width / 2 - 3, 5 + bob, 2).fill({ color: PALETTE.karstEdge, alpha: 0.5 });

    // The hopper: an open bucket on top, which is where a rescued piece lands.
    this.bucket.clear()
      .moveTo(-width * 0.42, -7 + bob).lineTo(-width * 0.3, -13 + bob)
      .lineTo(width * 0.3, -13 + bob).lineTo(width * 0.42, -7 + bob)
      .stroke({ width: 1.8, color: PALETTE.rail, alpha: 0.85 });

    // Jaws, which close while it is chewing.
    const gape = (1 - chew) * 3.2;
    this.jaws.clear()
      .moveTo(-4, -6 + bob).lineTo(-1.2 - gape, -1 + bob)
      .moveTo(4, -6 + bob).lineTo(1.2 + gape, -1 + bob)
      .stroke({ width: 2, color: chew > 0 ? PALETTE.danger : PALETTE.machine, alpha: 0.9 });

    this.haze.clear();
    if (chew > 0) {
      this.haze.circle(0, -4 + bob, 9 + chew * 5).fill({ color: PALETTE.spore, alpha: chew * 0.35 });
    }
    for (const grind of this.grinds) {
      const alpha = Math.min(1, grind.life / 0.2);
      this.haze.rect(
        (grind.u - this.u) * CELL - 1,
        (grind.v + BELOW) * -CELL - 1 + bob,
        2.5, 2.5,
      ).fill({ color: grind.colour, alpha: alpha * 0.9 });
    }
  }
}

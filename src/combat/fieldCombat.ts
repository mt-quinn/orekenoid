// Cavern combat, assembled.
//
// Owns the balls in flight, the creatures in the dark, and the Pixi containers that draw them.
// Everything consequential is reported back as events rather than done here: this module never
// touches the player's health, the audio, or the save, because those belong to the game and it
// should stay possible to run a fight in a test with no renderer attached.

import { Container, Graphics } from "pixi.js";
import { CELL } from "../config";
import { mulberry32 } from "../worldgen/rng";
import {
  createFieldBall,
  pathHitsCircle,
  stepFieldBall,
  FIELD,
  type FieldBall,
  type SolidityOracle,
} from "./ballField";
import {
  createCreature, damageCreature, stepCreature, DOUSER, GRINDER, SPITTER,
  type Creature, type CreatureKind,
} from "./creatures";
import { hasLineOfSight } from "./sight";
import {
  createCreatureDisplay,
  createFieldBallDisplay,
  createFieldTrail,
  createGlobDisplay,
  drawCreatureTell,
  type CreatureDisplay,
} from "../view/field";

export const COMBAT = {
  /**
   * Balls the emitter can hold out at once.
   *
   * One, deliberately. A second simultaneous ball is a real design decision about what the caverns
   * ask of the player's attention, not a number to raise because the code supports it -- and the
   * sequential balls a claim gets are a different idea wearing a similar name.
   */
  maxBalls: 1,
  /** How long a ball lives before the emitter reclaims it. */
  ballLifetime: 9,
  /** Damage one ball hit does to a creature. */
  ballDamage: 1,
  /** Creatures kept alive around the drone. */
  population: 3,
  /**
   * How the population is drawn.
   *
   * Weighted, not uniform. The Grinder is the metronome the other two are read against -- it should
   * be the creature the player meets most and knows best, so that a Spitter holding its range or a
   * Douser closing on the lamp registers as a *different* problem rather than as more of the same.
   */
  mix: [
    { kind: "grinder" as CreatureKind, weight: 5 },
    { kind: "spitter" as CreatureKind, weight: 3 },
    { kind: "douser" as CreatureKind, weight: 2 },
  ],
  /**
   * Ring the spawner works in, in cells.
   *
   * The minimum is not a taste call: at the design framing of 1280x720 with survey zoom at one,
   * the viewport is about 30.5 by 17 cells, so its half-diagonal is a shade under 17.5. Anything
   * spawned past that is off screen whatever direction the player is facing, which is the only
   * guarantee that actually matters -- nothing may ever appear in front of them. Phones zoom out
   * to a *narrower* world view, so desktop is the worst case and this is sized against it.
   */
  spawnMin: 18,
  spawnMax: 30,
  /** Anything beyond this is forgotten, so a fight left behind stays left behind. */
  despawn: 42,
  /** Seconds between spawn attempts. */
  spawnInterval: 1.6,
  /** How long a corpse is drawn while it sinks. */
  corpseSeconds: 0.5,
  /**
   * The drone, as a circle, for contact tests.
   *
   * The hull is really a long thin capsule -- about 3.7 cells by 0.5 -- and a single radius cannot
   * be both. This is deliberately sized between the two: generous enough that a charge across the
   * machine connects, tight enough that one down its length is not a free hit from two cells away.
   * A capsule test is the right answer once the roster is settled and contact is worth that much
   * precision.
   */
  droneHitRadius: 0.8,
  /** Largest simulation bite. Above this a fast ball can step past something it should have hit. */
  maxStep: 0.033,
  /** Most real time one frame may consume, so a stalled tab drops time instead of catching up. */
  maxCatchUp: 0.25,
} as const;

/**
 * How long the emitter takes to build another ball, by the grade fitted at the emitter station.
 *
 * This is the combat progression. Everything else about a fight -- the dodge, the read, the bank
 * shot -- is the player getting better; this is the machine getting better, and it is felt as the
 * blind, unarmed gap between volleys getting shorter. Index is the station grade, zero to three.
 */
export const EMITTER_RECHARGE: readonly number[] = [3.2, 2.6, 2.1, 1.6];

export function rechargeSecondsFor(grade: number): number {
  return EMITTER_RECHARGE[Math.max(0, Math.min(EMITTER_RECHARGE.length - 1, Math.floor(grade)))];
}

export interface CombatEvents {
  bounces: Array<{ x: number; y: number }>;
  ballsLost: Array<{ x: number; y: number }>;
  hits: Array<{ x: number; y: number; killed: boolean }>;
  rams: Array<{ x: number; y: number; damage: number }>;
  slams: Array<{ x: number; y: number }>;
  commits: Array<{ x: number; y: number }>;
  /** The emitter finished building a ball this frame. */
  recharged: boolean;
  /** A glob reached the hull. */
  globHits: Array<{ x: number; y: number; damage: number }>;
  /** A glob was shot down or spent itself on rock. */
  globsSpent: Array<{ x: number; y: number }>;
  /** A Douser is on the lamp right now. Non-zero means the light is being taken. */
  smotherers: number;
}

interface BallEntry {
  ball: FieldBall;
  display: Container;
  trail: Graphics;
  previousX: number;
  previousY: number;
}

interface Glob {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  display: Container;
}

interface CreatureEntry {
  creature: Creature;
  display: CreatureDisplay;
  /** Counts up once dead, so a kill sinks rather than vanishing. */
  fade: number;
}

const noEvents = (): CombatEvents => ({
  bounces: [], ballsLost: [], hits: [], rams: [], slams: [], commits: [], recharged: false,
  globHits: [], globsSpent: [], smotherers: 0,
});

export class FieldCombat {
  readonly container = new Container();
  private readonly balls: BallEntry[] = [];
  private readonly creatures: CreatureEntry[] = [];
  private readonly globs: Glob[] = [];
  private readonly random: () => number;
  private spawnTimer = 0;
  /** Seconds until the emitter can fire again. */
  private recharge = 0;
  /** Set by the host from the emitter station's grade, so a refit is felt on the next volley. */
  rechargeSeconds = EMITTER_RECHARGE[0];

  constructor(private readonly world: SolidityOracle, seed: number) {
    this.random = mulberry32(seed ^ 0x5eed_c0de);
  }

  get liveBalls(): number {
    return this.balls.length;
  }

  get liveCreatures(): number {
    return this.creatures.filter((entry) => entry.creature.state !== "dead").length;
  }

  /** For tests and the HUD: the creatures currently simulated. */
  get roster(): readonly Creature[] {
    return this.creatures.map((entry) => entry.creature);
  }

  canFire(): boolean {
    return this.balls.length < COMBAT.maxBalls && this.recharge <= 0;
  }

  /** Seconds left on the recharge, zero when the emitter is ready. */
  get rechargeRemaining(): number {
    return this.recharge;
  }

  /** 0 the instant a ball is reclaimed, 1 when the emitter is ready. Drives the HUD. */
  get chargeProgress(): number {
    if (this.recharge <= 0) return 1;
    return Math.max(0, Math.min(1, 1 - this.recharge / this.rechargeSeconds));
  }

  /**
   * Send a ball out from the drone's emitter.
   *
   * Refused if it would be born inside rock, because a ball that spawns buried is retired on its
   * first step and reads to the player as the fire button not working.
   */
  fire(x: number, y: number, heading: number): boolean {
    if (!this.canFire()) return false;
    const ball = createFieldBall(x, y, heading);
    const step = stepFieldBall(ball, this.world, 0);
    if (step.buried) return false;
    const display = createFieldBallDisplay();
    const trail = createFieldTrail();
    this.container.addChild(trail, display);
    this.balls.push({ ball, display, trail, previousX: ball.x, previousY: ball.y });
    return true;
  }

  /**
   * Pull every ball home early, and start the clock.
   *
   * This is the whole reason the recharge is a decision rather than a wait: a shot that has gone
   * somewhere useless costs the same as a shot that has finished, so taking it back the moment you
   * know it is wasted is strictly better play than watching it rattle out its nine seconds.
   */
  recall(): number {
    const count = this.balls.length;
    for (const entry of this.balls) this.retire(entry);
    this.balls.length = 0;
    if (count > 0) this.recharge = this.rechargeSeconds;
    return count;
  }

  clear(): void {
    this.recall();
    this.recharge = 0;
    for (const entry of this.creatures) entry.display.container.destroy({ children: true });
    this.creatures.length = 0;
    for (const glob of this.globs) glob.display.destroy({ children: true });
    this.globs.length = 0;
  }

  private retire(entry: BallEntry): void {
    entry.display.destroy({ children: true });
    entry.trail.destroy();
  }

  update(
    dt: number,
    drone: { x: number; y: number; radius: number } | null,
    isLit?: (x: number, y: number) => boolean,
  ): CombatEvents {
    const events = noEvents();
    if (dt <= 0) return events;

    // Substepped, not clamped.
    //
    // A single `min(0.033, dt)` keeps the integration stable and quietly runs the whole simulation
    // in slow motion on any machine that cannot hold 30fps: at 13fps a frame is 77ms, only 33ms of
    // it gets simulated, and everything with a clock -- the recharge above all -- takes twice as
    // long in wall-clock seconds as the number the player was shown. Consuming the full frame in
    // stable-sized bites keeps game time and real time the same thing.
    //
    // The total is capped so returning to a stalled tab catches up by dropping time rather than by
    // teleporting every creature through a second of movement at once.
    let remaining = Math.min(dt, COMBAT.maxCatchUp);
    while (remaining > 1e-6) {
      const step = Math.min(COMBAT.maxStep, remaining);
      remaining -= step;
      if (this.recharge > 0) {
        this.recharge = Math.max(0, this.recharge - step);
        if (this.recharge === 0) events.recharged = true;
      }
      this.updateBalls(step, events);
      this.updateCreatures(step, drone, events, isLit);
      this.updateGlobs(step, drone, events);
      if (drone) this.maintainPopulation(step, drone);
    }
    return events;
  }

  private updateBalls(dt: number, events: CombatEvents): void {
    for (let index = this.balls.length - 1; index >= 0; index--) {
      const entry = this.balls[index];
      const ball = entry.ball;
      entry.previousX = ball.x;
      entry.previousY = ball.y;
      const step = stepFieldBall(ball, this.world, dt);
      for (const bounce of step.bounces) events.bounces.push({ x: bounce.x, y: bounce.y });

      // Creature hits are tested against the path the ball swept, not where it ended up: at field
      // speed the ball crosses a Grinder in a couple of frames and endpoint sampling walks through
      // it about a third of the time.
      for (const target of this.creatures) {
        const creature = target.creature;
        if (creature.state === "dead") continue;
        if (!pathHitsCircle(entry.previousX, entry.previousY, ball.x, ball.y, creature.x, creature.y, creature.radius + ball.radius)) continue;
        const killed = damageCreature(creature, COMBAT.ballDamage, ball.vx, ball.vy);
        events.hits.push({ x: creature.x, y: creature.y, killed });
        // Rebound off the carapace, so a hit reads as a hit and the ball stays in play. Normal is
        // from the creature's centre out to the ball, which is the only sensible surface a circle
        // has to offer.
        const dx = ball.x - creature.x;
        const dy = ball.y - creature.y;
        const distance = Math.hypot(dx, dy) || 1;
        const speed = Math.hypot(ball.vx, ball.vy) || FIELD.speed;
        const nx = dx / distance;
        const ny = dy / distance;
        const dot = ball.vx * nx + ball.vy * ny;
        ball.vx -= 2 * dot * nx;
        ball.vy -= 2 * dot * ny;
        const magnitude = Math.hypot(ball.vx, ball.vy) || speed;
        ball.vx = ball.vx / magnitude * speed;
        ball.vy = ball.vy / magnitude * speed;
        // Lifted clear of the creature it just struck, or the next frame reads as a second hit.
        ball.x = creature.x + nx * (creature.radius + ball.radius + FIELD.contactSkin);
        ball.y = creature.y + ny * (creature.radius + ball.radius + FIELD.contactSkin);
        break;
      }

      if (step.buried || ball.age >= COMBAT.ballLifetime) {
        events.ballsLost.push({ x: ball.x, y: ball.y });
        this.retire(entry);
        this.balls.splice(index, 1);
        this.recharge = this.rechargeSeconds;
        continue;
      }

      entry.display.position.set(ball.x * CELL, ball.y * CELL);
      entry.trail.clear();
      entry.trail
        .moveTo(entry.previousX * CELL, entry.previousY * CELL)
        .lineTo(ball.x * CELL, ball.y * CELL)
        .stroke({ width: FIELD.radius * CELL * 1.5, color: 0xe7dbc0, alpha: 0.3 });
    }
  }

  private updateCreatures(
    dt: number,
    drone: { x: number; y: number; radius: number } | null,
    events: CombatEvents,
    isLit?: (x: number, y: number) => boolean,
  ): void {
    for (let index = this.creatures.length - 1; index >= 0; index--) {
      const entry = this.creatures[index];
      const creature = entry.creature;
      if (creature.state === "dead") {
        entry.fade += dt;
        const remaining = Math.max(0, 1 - entry.fade / COMBAT.corpseSeconds);
        entry.display.container.alpha = remaining;
        entry.display.container.scale.set(0.4 + remaining * 0.6);
        if (entry.fade >= COMBAT.corpseSeconds) {
          entry.display.container.destroy({ children: true });
          this.creatures.splice(index, 1);
        }
        continue;
      }

      const step = stepCreature(creature, this.world, drone, dt);
      if (step.committed) events.commits.push({ x: creature.x, y: creature.y });
      if (step.slammed) events.slams.push({ x: creature.x, y: creature.y });
      if (step.rammed) {
        const damage = creature.kind === "douser" ? DOUSER.latchDamage : GRINDER.ramDamage;
        events.rams.push({ x: creature.x, y: creature.y, damage });
      }
      if (step.smothering) events.smotherers++;
      if (step.fired) {
        const glob = {
          x: step.fired.x,
          y: step.fired.y,
          vx: step.fired.dirX * SPITTER.projectileSpeed,
          vy: step.fired.dirY * SPITTER.projectileSpeed,
          age: 0,
          display: createGlobDisplay(),
        };
        glob.display.position.set(glob.x * CELL, glob.y * CELL);
        this.container.addChild(glob.display);
        this.globs.push(glob);
      }

      if (drone && Math.hypot(creature.x - drone.x, creature.y - drone.y) > COMBAT.despawn) {
        entry.display.container.destroy({ children: true });
        this.creatures.splice(index, 1);
        continue;
      }

      entry.display.container.position.set(creature.x * CELL, creature.y * CELL);
      entry.display.container.rotation = creature.facing;
      // Darkness hides it outright rather than dimming it. A creature at thirty percent brightness
      // is a creature you can still see, which is not darkness, it is a filter. A telling creature
      // lights its own cell, so this is also what makes the tell the thing that reveals it.
      entry.display.container.visible = !isLit || isLit(creature.x, creature.y);
      drawCreatureTell(entry.display, creature);
    }
  }

  /**
   * Keep a few creatures around the drone.
   *
   * Spawned out of sight and at a distance, so nothing ever appears in front of the player -- a
   * creature that pops into an empty room the player is looking at reads as a bug however
   * carefully it was placed.
   */
  private maintainPopulation(dt: number, drone: { x: number; y: number }): void {
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;
    this.spawnTimer = COMBAT.spawnInterval;
    if (this.liveCreatures >= COMBAT.population) return;

    // Two passes. The first insists on broken line of sight, which is the nicer placement: the
    // creature is round a corner rather than merely far off. The second accepts any open ground in
    // the ring, because insisting was a silent failure -- in a wide open chamber every candidate is
    // visible, nothing ever spawned, and the biggest rooms in the mine were the safest places in
    // it. Distance already guarantees off screen, so the fallback is safe on its own.
    let fallback: { x: number; y: number } | null = null;
    for (let attempt = 0; attempt < 24; attempt++) {
      const angle = this.random() * Math.PI * 2;
      const distance = COMBAT.spawnMin + this.random() * (COMBAT.spawnMax - COMBAT.spawnMin);
      const x = drone.x + Math.cos(angle) * distance;
      const y = drone.y + Math.sin(angle) * distance;
      if (!this.roomFor(x, y, GRINDER.radius * 1.6)) continue;
      if (hasLineOfSight(this.world, x, y, drone.x, drone.y)) {
        fallback ??= { x, y };
        continue;
      }
      this.spawn(x, y, this.random() * Math.PI * 2, this.rollKind());
      return;
    }
    if (fallback) this.spawn(fallback.x, fallback.y, this.random() * Math.PI * 2, this.rollKind());
  }

  /** Draw a species from the weighted mix. */
  private rollKind(): CreatureKind {
    const total = COMBAT.mix.reduce((sum, entry) => sum + entry.weight, 0);
    let roll = this.random() * total;
    for (const entry of COMBAT.mix) {
      roll -= entry.weight;
      if (roll <= 0) return entry.kind;
    }
    return COMBAT.mix[0].kind;
  }

  /**
   * Globs in flight.
   *
   * They die on rock, they die to the ball, and they die of old age. All three matter: the first
   * makes cover real, the second makes the ball a defensive tool as well as an offensive one, and
   * the third means an abandoned fight never leaves anything drifting in the dark.
   */
  private updateGlobs(dt: number, drone: { x: number; y: number; radius: number } | null, events: CombatEvents): void {
    for (let index = this.globs.length - 1; index >= 0; index--) {
      const glob = this.globs[index];
      const previousX = glob.x;
      const previousY = glob.y;
      glob.age += dt;
      glob.x += glob.vx * dt;
      glob.y += glob.vy * dt;

      let spent = glob.age >= SPITTER.projectileLife;
      let hitDrone = false;
      if (!spent && this.world.solidAt(glob.x, glob.y)) spent = true;
      if (!spent) {
        for (const entry of this.balls) {
          if (!pathHitsCircle(
            entry.previousX, entry.previousY, entry.ball.x, entry.ball.y,
            glob.x, glob.y, SPITTER.projectileRadius + entry.ball.radius,
          )) continue;
          spent = true;
          break;
        }
      }
      if (!spent && drone && pathHitsCircle(previousX, previousY, glob.x, glob.y, drone.x, drone.y, drone.radius + SPITTER.projectileRadius)) {
        spent = true;
        hitDrone = true;
      }

      if (spent) {
        if (hitDrone) events.globHits.push({ x: glob.x, y: glob.y, damage: SPITTER.projectileDamage });
        else events.globsSpent.push({ x: glob.x, y: glob.y });
        glob.display.destroy({ children: true });
        this.globs.splice(index, 1);
        continue;
      }
      glob.display.position.set(glob.x * CELL, glob.y * CELL);
    }
  }

  /** Is there open ground here, with clearance to move? */
  private roomFor(x: number, y: number, radius: number): boolean {
    if (this.world.solidAt(x, y)) return false;
    for (let index = 0; index < 8; index++) {
      const angle = (index / 8) * Math.PI * 2;
      if (this.world.solidAt(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius)) return false;
    }
    return true;
  }

  spawn(x: number, y: number, facing = 0, kind: CreatureKind = "grinder"): Creature {
    const creature = createCreature(kind, x, y, facing);
    const display = createCreatureDisplay(kind);
    display.container.position.set(x * CELL, y * CELL);
    this.container.addChild(display.container);
    this.creatures.push({ creature, display, fade: 0 });
    return creature;
  }
}

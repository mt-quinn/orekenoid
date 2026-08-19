// Cavern combat, assembled.
//
// Owns the Bounders, the ore they leave behind, and the Pixi containers that draw them. Everything
// consequential is reported back as events rather than done here: this module never touches the
// player's health, their cargo, the audio or the save, because those belong to the game and it should
// stay possible to run a fight in a test with no renderer attached.
//
// The drone has no ball out here any more. The only thing in flight is a creature, and the paddle's
// one job is to meet it with the right face.

import { Container } from "pixi.js";
import { CELL, RESOURCES, type ResourceId } from "../config";
import { mulberry32 } from "../worldgen/rng";
import { FIELD, type SolidityOracle } from "./ballField";
import { FEEL } from "../physics";
import {
  BOUNDER,
  bounceCreature,
  createBounder,
  deflectCreature,
  stepCreature,
  type Creature,
} from "./creatures";

import {
  createBounderDisplay,
  createOreDisplay,
  drawBounder,
  type BounderDisplay,
} from "../view/field";

export const COMBAT = {
  /**
   * Creatures kept alive around the drone.
   *
   * Four was too few to meet. A player crossing several chambers would see one Bounder, kill it, and
   * walk a long way before the spawner offered another -- the cavern read as empty, and the stated
   * challenge of the enemy ("the challenge mainly comes from facing more than one of them at a time")
   * could essentially never happen by chance, because four spread over a 42-cell despawn radius is
   * almost always one at a time.
   */
  population: 11,
  /**
   * Ring the spawner works in, in cells.
   *
   * The minimum is not a taste call: at the design framing of 1280x720 with survey zoom at one, the
   * viewport is about 30.5 by 17 cells, so its half-diagonal is a shade under 17.5. Anything spawned
   * past that is off screen whatever direction the player is facing, which is the only guarantee that
   * matters -- nothing may ever appear in front of them.
   */
  spawnMin: 18,
  spawnMax: 30,
  /** Anything beyond this is forgotten, so a fight left behind stays left behind. */
  despawn: 42,
  /**
   * Groups are authored now, not rolled for.
   *
   * There was a `packChance` here that gave two spawns in five a couple of companions placed by offset.
   * With encounters placed at map creation the same thing is said better by the map: a chamber with three
   * `bounder` markers in it is a chamber with three Bounders in it, every time, and the player can learn
   * that a particular room is dangerous instead of discovering it is dangerous today.
   */
  /** Seconds between checks for authored spawns coming into range. */
  spawnInterval: 0.4,
  /**
   * How far from the drone an authored spawn wakes up, in cells.
   *
   * Wider than the ring the old spawner used, because these are placed and finite: the point is no
   * longer to keep a population topped up near the player but to have what the map says is there be
   * standing there by the time the player arrives. Still outside the viewport's half-diagonal, so
   * nothing is ever seen appearing.
   */
  wakeRange: 34,
  /** How long a corpse is drawn while it sinks. */
  corpseSeconds: 0.45,
  /**
   * The drone's hull, across its short axis, in cells.
   *
   * The machine is a long thin capsule -- roughly 3.7 cells by 0.5 -- so contact is tested against a
   * capsule rather than a circle. It has to be, now that *which part* was touched is the whole
   * mechanic: a single radius cannot tell the front of the paddle from its back.
   */
  hullHalfThickness: 0.28,
  /** Frames of grace after a return, so one contact is one return. */
  deflectGrace: 0.12,
  /** How many pieces of ore a dead Bounder leaves. */
  oreDrop: 3,
  /** Where the vacuum starts pulling, in cells. */
  vacuumRadius: 3.4,
  /** How hard it pulls, in cells per second per second. */
  vacuumPull: 34,
  /** Close enough to be in the hold. */
  vacuumBite: 0.55,
  /** Unclaimed ore gives up after this long, so an abandoned fight leaves nothing lying about. */
  oreLifetime: 40,
} as const;

export interface CombatEvents {
  /** A Bounder reached the hull somewhere that is not the paddle's face. */
  strikes: Array<{ x: number; y: number; damage: number }>;
  /** The paddle returned one. */
  returns: Array<{ x: number; y: number }>;
  /** A returned Bounder landed against rock. */
  landings: Array<{ x: number; y: number; killed: boolean }>;
  /** One curled up and committed to a hurl. */
  commits: Array<{ x: number; y: number }>;
  /** Ore reached the hold. */
  pickups: Array<{ resource: ResourceId; x: number; y: number }>;
}

/** Where the drone is and which way its paddle faces. */
export interface DronePose {
  /** Cell coordinates of the hull's centre. */
  x: number;
  y: number;
  /** The hull's long axis, matching `FrameGeometry.angle`. */
  heading: number;
  /** The paddle face's span, in cells. */
  paddleWidth: number;
}

interface CreatureEntry {
  creature: Creature;
  display: BounderDisplay;
  /** Counts up once dead, so a kill sinks rather than vanishing. */
  fade: number;
  /** Counts down after a return. */
  grace: number;
}

interface OrePiece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  resource: ResourceId;
  display: Container;
}

const noEvents = (): CombatEvents => ({
  strikes: [], returns: [], landings: [], commits: [], pickups: [],
});

export class FieldCombat {
  readonly container = new Container();
  private readonly creatures: CreatureEntry[] = [];
  private readonly ore: OrePiece[] = [];
  private readonly random: () => number;
  private spawnTimer = 0;
  /** Every Bounder the map placed, in world cells. */
  private spawns: ReadonlyArray<{ x: number; y: number }> = [];
  /** Which of them have already fired. Spent is spent: nothing here is ever cleared. */
  private readonly spent = new Set<number>();

  /**
   * Hand the roster of places over, and restore any already spent.
   *
   * `spentIndices` comes from the save. Without it a reload would repopulate every chamber the player
   * had already cleared, which is the exact promise authored spawns exist to make.
   */
  placeSpawns(spawns: ReadonlyArray<{ x: number; y: number }>, spentIndices: readonly number[] = []): void {
    this.spawns = spawns;
    this.spent.clear();
    for (const index of spentIndices) this.spent.add(index);
  }

  /**
   * Hand over every live creature the test accepts, removing them from the caverns for good.
   *
   * Used when a claim is staked over them: they stop being creatures and become balls, so they must not
   * also still be standing in the mine when the claim resolves. Their spawn is spent either way -- a Bounder
   * that has been framed is a Bounder that has been dealt with.
   */
  takeInside(inside: (x: number, y: number) => boolean): Array<{
    x: number;
    y: number;
    vx: number;
    vy: number;
    ores: ResourceId[];
  }> {
    const taken: Array<{ x: number; y: number; vx: number; vy: number; ores: ResourceId[] }> = [];
    for (let index = this.creatures.length - 1; index >= 0; index--) {
      const entry = this.creatures[index];
      const creature = entry.creature;
      if (creature.state === "dead" || !inside(creature.x, creature.y)) continue;
      taken.push({
        x: creature.x,
        y: creature.y,
        vx: creature.vx,
        vy: creature.vy,
        ores: [...creature.ores],
      });
      entry.display.container.destroy({ children: true });
      this.creatures.splice(index, 1);
    }
    return taken;
  }

  /** Which spawns have fired, for the save. */
  get spentSpawns(): number[] {
    return [...this.spent].sort((a, b) => a - b);
  }
  /**
   * Whether the ambient spawner runs.
   *
   * A seam for tests that need the room to themselves: measuring one exchange is impossible while the
   * mine keeps sending its own, and a test that has to assert "nothing at all hit me" is a test about
   * the whole world rather than about the paddle.
   */
  spawning = true;
  /** Filled by the host so a spawn can be paid for in the ore of the ground it happened in. */
  oreTableFor: (x: number, y: number) => ResourceId[] = () => [];

  constructor(private readonly world: SolidityOracle, seed: number) {
    this.random = mulberry32(seed ^ 0x5eed_c0de);
  }

  get liveCreatures(): number {
    return this.creatures.filter((entry) => entry.creature.state !== "dead").length;
  }

  get liveOre(): number {
    return this.ore.length;
  }

  /** For tests and the debug hook: the creatures currently simulated. */
  get roster(): readonly Creature[] {
    return this.creatures.map((entry) => entry.creature);
  }

  clear(): void {
    for (const entry of this.creatures) entry.display.container.destroy({ children: true });
    this.creatures.length = 0;
    for (const piece of this.ore) piece.display.destroy({ children: true });
    this.ore.length = 0;
  }

  update(dt: number, drone: DronePose | null, isLit?: (x: number, y: number) => boolean): CombatEvents {
    const events = noEvents();
    if (dt <= 0) return events;
    // Substepped rather than clamped: clamping a long frame runs the whole simulation in slow motion,
    // so every clock in it lies on a machine that cannot hold the frame rate.
    let remaining = Math.min(dt, 0.25);
    while (remaining > 1e-6) {
      const step = Math.min(0.033, remaining);
      remaining -= step;
      this.updateCreatures(step, drone, events, isLit);
      this.updateOre(step, drone, events);
      if (drone) this.wakeSpawns(step, drone);
    }
    return events;
  }

  private updateCreatures(
    dt: number,
    drone: DronePose | null,
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

      entry.grace = Math.max(0, entry.grace - dt);
      const step = stepCreature(creature, this.world, drone, dt);
      if (step.committed) events.commits.push({ x: creature.x, y: creature.y });
      if (step.landed) events.landings.push({ x: creature.x, y: creature.y, killed: step.killed });
      if (step.killed) this.scatterOre(creature);

      // Contact is resolved here rather than in the creature, because whether the paddle's face was
      // the part that met it is a question about the drone.
      if (step.struck && drone && entry.grace <= 0) {
        const contact = paddleContact(creature, drone);
        if (contact === "face") {
          const along = alongPaddle(creature, drone);
          const english = Math.max(-1, Math.min(1, along / (drone.paddleWidth / 2)));
          deflectCreature(creature, drone.heading - Math.PI / 2, english, FEEL.englishCurve, FIELD.minOffNormal);
          entry.grace = COMBAT.deflectGrace;
          events.returns.push({ x: creature.x, y: creature.y });
        } else if (contact === "hull") {
          // Bounced off just the same, and marked just the same: the rock still gets it. The player
          // has not wasted the exchange, only paid for it.
          const normal = hullNormal(creature, drone);
          bounceCreature(creature, normal.x, normal.y);
          entry.grace = COMBAT.deflectGrace;
          events.strikes.push({ x: creature.x, y: creature.y, damage: BOUNDER.hitDamage });
        }
      }

      if (drone && Math.hypot(creature.x - drone.x, creature.y - drone.y) > COMBAT.despawn) {
        entry.display.container.destroy({ children: true });
        this.creatures.splice(index, 1);
        continue;
      }

      entry.display.container.position.set(creature.x * CELL, creature.y * CELL);
      // Darkness hides it outright rather than dimming it. Terrain survives in shadow at a third
      // brightness; a creature at a third brightness is a creature you can still see.
      entry.display.container.visible = !isLit || isLit(creature.x, creature.y);
      drawBounder(entry.display, creature);
    }
  }

  /**
   * Ore on the floor, and the pull that collects it.
   *
   * A collection radius was tried and removed once before, in the arena, where it was the same
   * mechanic as the paddle catching drops and so did the same job twice. Out here nothing else
   * collects anything, so it is the only mechanic rather than a duplicate one -- and it keeps a kill
   * from becoming an errand.
   */
  private updateOre(dt: number, drone: DronePose | null, events: CombatEvents): void {
    for (let index = this.ore.length - 1; index >= 0; index--) {
      const piece = this.ore[index];
      piece.age += dt;
      if (drone) {
        const dx = drone.x - piece.x;
        const dy = drone.y - piece.y;
        const distance = Math.hypot(dx, dy) || 1;
        if (distance <= COMBAT.vacuumBite) {
          events.pickups.push({ resource: piece.resource, x: piece.x, y: piece.y });
          piece.display.destroy({ children: true });
          this.ore.splice(index, 1);
          continue;
        }
        if (distance <= COMBAT.vacuumRadius) {
          // Pull that strengthens as it closes, so the last of the distance is covered fast and the
          // piece arrives rather than drifting in.
          const pull = COMBAT.vacuumPull * (1 - distance / COMBAT.vacuumRadius) * dt;
          piece.vx += (dx / distance) * pull;
          piece.vy += (dy / distance) * pull;
        }
      }
      if (piece.age >= COMBAT.oreLifetime) {
        piece.display.destroy({ children: true });
        this.ore.splice(index, 1);
        continue;
      }
      piece.vx *= 0.92;
      piece.vy *= 0.92;
      const next = { x: piece.x + piece.vx * dt, y: piece.y + piece.vy * dt };
      // Ore does not pass through rock, but neither does it need a solver: stop it dead at a wall.
      if (!this.world.solidAt(next.x, next.y)) {
        piece.x = next.x;
        piece.y = next.y;
      } else {
        piece.vx = 0;
        piece.vy = 0;
      }
      piece.display.position.set(piece.x * CELL, piece.y * CELL);
      piece.display.rotation += dt * 1.4;
    }
  }

  private scatterOre(creature: Creature): void {
    for (let index = 0; index < COMBAT.oreDrop; index++) {
      const resource = creature.ores[index % Math.max(1, creature.ores.length)];
      if (!resource) continue;
      const angle = this.random() * Math.PI * 2;
      const speed = 1.4 + this.random() * 1.6;
      const piece: OrePiece = {
        x: creature.x,
        y: creature.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        age: 0,
        resource,
        display: createOreDisplay(RESOURCES[resource].colour),
      };
      piece.display.position.set(piece.x * CELL, piece.y * CELL);
      this.container.addChild(piece.display);
      this.ore.push(piece);
    }
  }

  /**
   * Keep a few Bounders around the drone.
   *
   * Spawned out of sight where possible, at a distance in every case, and always attached to rock,
   * because a Bounder that is not on a surface has nothing to walk on and would sit where it was put.
   */
  /**
   * Wake the authored spawns the drone has come near, once each, forever.
   *
   * This replaces a spawner that kept a population of eleven alive in a ring around the drone and
   * replaced anything that died. That made the caverns busy and made them meaningless: a chamber could
   * not be cleared, because walking away and coming back refilled it with strangers who had never been
   * anywhere. What the map places is what exists, and a spawn that has fired is spent for the rest of
   * the expedition.
   */
  private wakeSpawns(dt: number, drone: DronePose): void {
    if (!this.spawning) return;
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;
    this.spawnTimer = COMBAT.spawnInterval;

    for (let index = 0; index < this.spawns.length; index++) {
      if (this.spent.has(index)) continue;
      const spawn = this.spawns[index];
      const range = Math.hypot(spawn.x - drone.x, spawn.y - drone.y);
      // Near enough to matter, far enough never to be seen arriving.
      if (range > COMBAT.wakeRange || range < COMBAT.spawnMin) continue;
      // The cap is a guard against a pathological map, so it defers rather than discards: a spawn held
      // back here is *not* marked spent, and wakes on a later pass once there is room for it.
      if (this.liveCreatures >= COMBAT.population) return;
      const surface = this.surfaceNear(spawn.x, spawn.y);
      // No footing means the player has mined the ground out from under it. That is a spawn spent by
      // excavation rather than by combat, and it does not come back either.
      this.spent.add(index);
      if (surface === null) continue;
      this.spawn(spawn.x, spawn.y, surface);
    }
  }

  private surfaceNear(x: number, y: number): number | null {
    if (this.world.solidAt(x, y)) return null;
    const reach = BOUNDER.radius + BOUNDER.probeDepth;
    for (let index = 0; index < 16; index++) {
      const angle = (index / 16) * Math.PI * 2;
      if (this.world.solidAt(x + Math.cos(angle) * reach, y + Math.sin(angle) * reach)) return angle;
    }
    return null;
  }

  spawn(x: number, y: number, surfaceAngle = Math.PI / 2): Creature {
    const circulation = this.random() < 0.5 ? 1 : -1;
    const creature = createBounder(x, y, surfaceAngle, this.oreTableFor(x, y), surfaceAngle, circulation);
    const display = createBounderDisplay();
    display.container.position.set(x * CELL, y * CELL);
    this.container.addChild(display.container);
    this.creatures.push({ creature, display, fade: 0, grace: 0 });
    return creature;
  }
}

/** Outward direction from the hull's long axis to a creature touching it. */
function hullNormal(creature: Creature, drone: DronePose): { x: number; y: number } {
  const dx = creature.x - drone.x;
  const dy = creature.y - drone.y;
  const along = dx * Math.cos(drone.heading) + dy * Math.sin(drone.heading);
  const halfWidth = drone.paddleWidth / 2;
  const clamped = Math.max(-halfWidth, Math.min(halfWidth, along));
  const nearestX = drone.x + Math.cos(drone.heading) * clamped;
  const nearestY = drone.y + Math.sin(drone.heading) * clamped;
  const outX = creature.x - nearestX;
  const outY = creature.y - nearestY;
  const length = Math.hypot(outX, outY);
  // Dead on the axis has no outward direction; send it back the way it came.
  if (length < 1e-6) return { x: -creature.vx, y: -creature.vy };
  return { x: outX / length, y: outY / length };
}

/** Where along the paddle's face a creature is, in cells from its centre. */
function alongPaddle(creature: Creature, drone: DronePose): number {
  return (creature.x - drone.x) * Math.cos(drone.heading) + (creature.y - drone.y) * Math.sin(drone.heading);
}

/**
 * Which part of the drone a flying Bounder is touching, if any.
 *
 * `face` is the front of the paddle: the forward side, within the span of the face itself. Everything
 * else about the machine -- its back, its ends, its flanks -- is `hull`, and costs the player. Being
 * strict about the span is what makes the ends of the paddle dangerous rather than merely useless,
 * which is the difference between aiming the machine and pointing it roughly.
 */
export function paddleContact(creature: Creature, drone: DronePose): "face" | "hull" | null {
  const dx = creature.x - drone.x;
  const dy = creature.y - drone.y;
  const along = dx * Math.cos(drone.heading) + dy * Math.sin(drone.heading);
  const across = dx * Math.sin(drone.heading) - dy * Math.cos(drone.heading);
  const halfWidth = drone.paddleWidth / 2;

  // Contact first, then which part. Asking "is it on the face" before "is it touching at all" was a
  // real bug: the face band was shallower than the hull capsule, so a Bounder arriving square on
  // passed through a shell where it was close enough to count as a hull hit and not yet close enough
  // to count as the face. Every head-on return came back as a hit on the player instead.
  const clamped = Math.max(-halfWidth, Math.min(halfWidth, along));
  const gap = Math.hypot(along - clamped, across);
  if (gap > creature.radius + COMBAT.hullHalfThickness) return null;
  return across > 0 && Math.abs(along) <= halfWidth ? "face" : "hull";
}

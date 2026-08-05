// The Refit Bay, drawn as the machine itself.
//
// This is the upgrade screen, and it is a picture of the drone with six labelled places on it.
// It replaced a DOM panel of recipe cards, which was a spreadsheet laid over a game: the player
// read names and integers in a browser dialog and the machine those integers described was
// nowhere on screen.
//
// The rules it is built to:
//
//   - The machine is the interface. The drone is drawn large, from the same `createDrone` the
//     world uses, so what you are looking at is exactly what you fly.
//   - Every station is a place, with a leader line to the part it governs. Nothing is a list row.
//   - The next grade is *shown*, not described: selecting a station ghosts the upgraded machine
//     over the real one, so the part you would be buying appears on the drone.
//   - The ladder is visible as pips. That is the whole tech tree, and it is a picture of a
//     machine rather than a graph of nodes.
//   - Costs are secondary. The part is the hero; the price is small type underneath it.
//
// Screen space, not world space: this container hangs off the stage above the camera-transformed
// world root, so it is laid out in the fixed 1280x720 the renderer is initialised at.

import { Container, Graphics, Text } from "pixi.js";
import { CELL, PALETTE, RESOURCES, VIEW_HEIGHT, VIEW_WIDTH, type ResourceId } from "../config";
import type { StationGrades, StationId } from "../economy";
import { createDrone } from "./actors";

export interface GantryCost {
  resource: ResourceId;
  need: number;
  have: number;
}

export interface GantryStation {
  id: StationId;
  name: string;
  mount: string;
  level: number;
  ladder: number;
  /** What is fitted now, or null at grade zero. */
  fitted: string | null;
  /** What it becomes next, or null when fully built. */
  next: { name: string; detail: string; cost: GantryCost[] } | null;
  /** A structural refusal -- a verb the player has not earned. Shortfalls are shown as costs. */
  blocked: string | null;
  affordable: boolean;
}

export interface GantryHull {
  chassisId: string;
  name: string;
  detail: string;
  built: boolean;
  affordable: boolean;
  cost: GantryCost[];
}

export interface GantryModel {
  chassisName: string;
  paddleWidth: number;
  grades: StationGrades;
  stations: GantryStation[];
  hulls: GantryHull[];
  bank: Array<{ resource: ResourceId; count: number }>;
  armor: number;
  integrity: number;
  maxIntegrity: number;
  /** The station whose next grade is being previewed on the machine. */
  selected: StationId | null;
}

export interface GantryHandlers {
  onSelect(station: StationId | null): void;
  onFit(station: StationId): void;
  onFabricate(chassisId: string): void;
}

// --- layout ------------------------------------------------------------------

const DRONE_AT = { x: 640, y: 316 };
/**
 * The drone is scaled to this width on the gantry, whatever its real paddle width.
 *
 * Large on purpose. At half this size the ghosted part -- a truss rib, an extra plate layer --
 * was a couple of pixels and invisible, which defeated the one thing this view exists to do.
 */
const DRONE_TARGET_WIDTH = 440;
const CARD = { width: 342, height: 148 };
const LEFT_X = 44;
const RIGHT_X = VIEW_WIDTH - CARD.width - 44;
const ROW_Y = [96, 258, 420];

/**
 * Where each station lives on the machine, in drone-local pixels, and which side its callout
 * sits on. The leader line runs from the card to this point, so the label is attached to the
 * part rather than merely near it.
 */
const MOUNTS: Record<StationId, { x: (width: number) => number; y: number; side: "left" | "right"; row: number }> = {
  plating: { x: (width) => -width / 2 - 4, y: -9, side: "left", row: 0 },
  frame: { x: (width) => -width * 0.22, y: 15, side: "left", row: 1 },
  salvage: { x: () => 0, y: 13, side: "left", row: 2 },
  mast: { x: () => 0, y: -36, side: "right", row: 0 },
  emitter: { x: (width) => width * 0.2, y: -3, side: "right", row: 1 },
  rack: { x: (width) => width * 0.32, y: 8, side: "right", row: 2 },
};

/**
 * The fitting moment, gathered in one place.
 *
 * Every number here is a feel judgement and not one of them can be verified from a screenshot,
 * so they are collected rather than scattered: tuning this should be editing one block after
 * playing it, not hunting through three files. The shape comes from the Vlambeer screenshake
 * talk in `reference files/`, whose argument is that exactly these things decide whether an
 * action lands -- a short freeze at the moment of impact, a kick away from it, real bass on the
 * sound, and debris that stays afterwards instead of tidying itself away.
 */
export const FIT = {
  /** Arm swings in from its post, carrying the part. */
  reach: 0.34,
  /**
   * Frozen on the seat frame. The talk uses ~0.02s inside a busy firefight; longer here because
   * the bay is otherwise still and there is no other motion to carry the beat.
   */
  hold: 0.07,
  /** Arm returns, shake decays, sparks fall. */
  retract: 0.46,
  /** Peak kick, in pixels, decaying across the retract. */
  shake: 10,
  /**
   * Sparks thrown by the bolt-on. They land on the bay floor and stay there.
   *
   * Tuned so every spark is down before the arm finishes retracting: at 340px/s against 1150
   * gravity the fastest ones were still airborne when the sequence ended, which reads as a
   * fountain rather than as debris off an impact.
   */
  sparks: 18,
  sparkSpeed: 240,
  gravity: 1900,
} as const;

const INK = PALETTE.ink;
const DIM = 0x8a9296;
const FAINT = 0x5d6a6e;
const BRASS = PALETTE.machine;

const text = (value: string, size: number, colour: number, weight: "400" | "600" | "800" = "600", spacing = 0): Text =>
  new Text({ text: value, style: { fill: colour, fontSize: size, fontWeight: weight, letterSpacing: spacing } });

const swatch = (resource: ResourceId): number => RESOURCES[resource].colour;

/** Where the arm is, and whether it still has the part. Read by the frame test. */
interface ArmState {
  travel: number;
  tip: { x: number; y: number };
  mount: { x: number; y: number };
  carrying: boolean;
}

export class Gantry {
  readonly container = new Container();
  private readonly backdrop = new Graphics();
  private readonly structure = new Graphics();
  private readonly leaders = new Graphics();
  private readonly droneHost = new Container();
  private readonly ghostHost = new Container();
  private readonly cards = new Container();
  private readonly chrome = new Container();
  /** Pulses at the selected station's mount, so "here" needs no words. */
  private readonly mountRing = new Graphics();
  /** Pulses the ghost part, so the thing being previewed reads as not-yet-real. */
  private ghostPhase = 0;
  private readonly armLayer = new Graphics();
  private readonly sparkLayer = new Graphics();
  private readonly flashLayer = new Graphics();
  /**
   * Sparks stay for the visit rather than fading out.
   *
   * Permanence, in the talk's sense: come back to the bay after three fits and the floor shows
   * that three things were fitted here. Cleared when the bay closes, not on a timer.
   */
  private sparks: Array<{ x: number; y: number; vx: number; vy: number; colour: number; settled: boolean }> = [];
  private sparksDrawn = false;
  /** Where each station's part sits on the machine, in screen space, from the last render. */
  private mountAt = new Map<StationId, { x: number; y: number }>();
  private fit: {
    station: StationId;
    colour: number;
    /** The machine as it was, held until the part is seated. */
    fromGrades: StationGrades;
    clock: number;
    seated: boolean;
    onSeat: () => void;
    onDone: () => void;
  } | null = null;
  private armState: ArmState | null = null;
  private lastModel: GantryModel | null = null;
  private lastHandlers: GantryHandlers | null = null;

  constructor() {
    this.container.visible = false;
    // Ghost *behind* the machine, so only the geometry the upgrade adds shows past the solid
    // drone in front of it. Drawn over the top it merely brightened the whole silhouette.
    this.container.addChild(
      this.backdrop, this.structure, this.leaders,
      this.ghostHost, this.droneHost, this.mountRing,
      this.sparkLayer, this.armLayer, this.flashLayer,
      this.cards, this.chrome,
    );
  }

  setOpen(open: boolean): void {
    this.container.visible = open;
    if (!open) {
      this.sparks = [];
      this.sparksDrawn = false;
      this.sparkLayer.clear();
      this.fit = null;
      this.armLayer.clear();
      this.flashLayer.clear();
      this.container.position.set(0, 0);
    }
  }

  get fitting(): boolean {
    return this.fit !== null;
  }

  /** The sequence's state, for the frame test. */
  fitDebug(): {
    fitting: boolean; seated: boolean; clock: number; sparks: number; settled: number;
    arm: ArmState | null; kick: { x: number; y: number };
  } {
    return {
      fitting: this.fit !== null,
      seated: this.fit?.seated ?? false,
      clock: this.fit?.clock ?? 0,
      sparks: this.sparks.length,
      settled: this.sparks.filter((spark) => spark.settled).length,
      arm: this.armState,
      kick: { x: this.container.position.x, y: this.container.position.y },
    };
  }

  /**
   * Start the fit. The economy has already changed by the time this runs -- state is the truth
   * and the animation is a reading of it -- so the drone is drawn from `fromGrades` until the
   * part is seated, and skipping simply jumps to the end.
   */
  beginFit(
    station: StationId, colour: number, fromGrades: StationGrades,
    onSeat: () => void, onDone: () => void,
  ): void {
    this.fit = { station, colour, fromGrades, clock: 0, seated: false, onSeat, onDone };
    this.redraw();
  }

  /** Any input during the sequence lands it immediately. Nobody should have to wait twice. */
  skipFit(): void {
    if (!this.fit) return;
    if (!this.fit.seated) this.seat();
    this.finishFit();
  }

  private seat(): void {
    if (!this.fit || this.fit.seated) return;
    this.fit.seated = true;
    const at = this.mountAt.get(this.fit.station) ?? DRONE_AT;
    for (let index = 0; index < FIT.sparks; index++) {
      // Deterministic fan rather than Math.random: the same fit throws the same sparks, which
      // makes the sequence reproducible in a screenshot test.
      const angle = -Math.PI / 2 + (index / (FIT.sparks - 1) - 0.5) * 2.5;
      const speed = FIT.sparkSpeed * (0.45 + ((index * 37) % 11) / 11 * 0.55);
      this.sparks.push({
        x: at.x, y: at.y,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        colour: index % 3 === 0 ? this.fit.colour : PALETTE.rail,
        settled: false,
      });
    }
    this.sparksDrawn = false;
    this.fit.onSeat();
    // The machine now shows the part, and the ghost that was previewing it is gone.
    this.redraw();
  }

  private finishFit(): void {
    const done = this.fit?.onDone;
    this.fit = null;
    this.armState = null;
    this.armLayer.clear();
    this.flashLayer.clear();
    this.container.position.set(0, 0);
    this.redraw();
    done?.();
  }

  /** Re-render from the last model, for the view's own state changes. */
  private redraw(): void {
    if (this.lastModel && this.lastHandlers) this.render(this.lastModel, this.lastHandlers);
  }

  get isOpen(): boolean {
    return this.container.visible;
  }

  /** Breathe the ghost, run the fit, fall the sparks. Real seconds, from the fixed-step loop. */
  update(dt: number): void {
    if (!this.container.visible) return;
    this.ghostPhase += dt;
    // Strong enough to read as a part, unstable enough to read as not yet real.
    this.ghostHost.alpha = 0.72 + Math.sin(this.ghostPhase * 3.4) * 0.24;
    this.mountRing.alpha = 0.5 + Math.sin(this.ghostPhase * 3.4) * 0.3;
    this.advanceFit(dt);
    this.fallSparks(dt);
  }

  private advanceFit(dt: number): void {
    const fit = this.fit;
    if (!fit) return;
    fit.clock += dt;
    const seatAt = FIT.reach;
    const holdUntil = seatAt + FIT.hold;
    const endAt = holdUntil + FIT.retract;

    if (fit.clock >= seatAt && !fit.seated) this.seat();
    if (fit.clock >= endAt) {
      this.finishFit();
      return;
    }

    const at = this.mountAt.get(fit.station) ?? DRONE_AT;
    // Reach eases out into the seat; the hold is a genuine freeze, so the arm does not creep
    // during it; retract eases back. `travel` is 0 at rest and 1 at the mount.
    let travel: number;
    if (fit.clock < seatAt) {
      const t = fit.clock / seatAt;
      travel = 1 - (1 - t) * (1 - t);
    } else if (fit.clock < holdUntil) {
      travel = 1;
    } else {
      const t = (fit.clock - holdUntil) / FIT.retract;
      travel = 1 - t * t;
    }
    this.drawArm(at, travel, fit.colour, fit.seated);

    // Flash at the seat, decaying across the hold and a little past it.
    const sinceSeat = fit.clock - seatAt;
    const flash = fit.seated ? Math.max(0, 1 - sinceSeat / (FIT.hold + 0.14)) : 0;
    this.flashLayer.clear();
    if (flash > 0) {
      this.flashLayer
        .circle(at.x, at.y, 14 + (1 - flash) * 52).fill({ color: PALETTE.rail, alpha: flash * 0.5 })
        .circle(at.x, at.y, 6 + (1 - flash) * 22).fill({ color: 0xffffff, alpha: flash * 0.8 });
    }

    // The kick: away from the impact, decaying. Deterministic jitter rather than Math.random so
    // the same fit shakes the same way and a frame test can rely on it.
    if (fit.seated && sinceSeat < FIT.hold + FIT.retract) {
      const decay = Math.max(0, 1 - sinceSeat / (FIT.hold + FIT.retract));
      const phase = fit.clock * 60;
      const jitter = (offset: number) =>
        Math.sin(phase * 2.3 + offset) * 0.6 + Math.sin(phase * 5.1 + offset * 2.7) * 0.4;
      const kick = FIT.shake * decay * decay;
      this.container.position.set(jitter(0) * kick, jitter(1.7) * kick);
    }
  }

  /** The arm reaching in from its post, with the part in its grip until it is seated. */
  private drawArm(at: { x: number; y: number }, travel: number, colour: number, seated: boolean): void {
    const post = { x: DRONE_AT.x - 250, y: DRONE_AT.y - 30 };
    const rest = { x: post.x, y: post.y + 40 };
    const tip = {
      x: rest.x + (at.x - rest.x) * travel,
      y: rest.y + (at.y - rest.y) * travel,
    };
    // Elbow bowed off the shoulder-to-tip line, so the arm articulates rather than telescoping.
    const midX = (post.x + tip.x) / 2;
    const midY = (post.y + tip.y) / 2;
    const span = Math.hypot(tip.x - post.x, tip.y - post.y);
    const elbow = { x: midX, y: midY - Math.min(70, span * 0.34) };

    // Recorded for the frame test: an animation's correctness is whether the arm arrives, and
    // that is a number, not something to be judged from a screenshot.
    this.armState = { travel, tip, mount: at, carrying: !seated };
    const g = this.armLayer.clear();
    g.moveTo(post.x, post.y).lineTo(elbow.x, elbow.y).lineTo(tip.x, tip.y)
      .stroke({ width: 6, color: BRASS, alpha: 0.85 })
      .circle(post.x, post.y, 7).fill({ color: BRASS, alpha: 0.9 })
      .circle(elbow.x, elbow.y, 5).fill({ color: BRASS, alpha: 0.8 });
    // The grip.
    g.circle(tip.x, tip.y, 9).stroke({ width: 3, color: BRASS, alpha: 0.9 });
    if (!seated) {
      // The part itself: a machined block in the ore it is made from. Generic by design -- a
      // bespoke silhouette per grade would be nineteen pieces of art verifiable only as stills.
      g.roundRect(tip.x - 11, tip.y - 8, 22, 16, 3)
        .fill({ color: colour, alpha: 0.95 }).stroke({ width: 2, color: PALETTE.exhaust, alpha: 0.9 })
        .rect(tip.x - 6, tip.y - 3, 12, 6).fill({ color: PALETTE.exhaust, alpha: 0.55 });
    }
  }

  private fallSparks(dt: number): void {
    if (!this.sparks.length) return;
    const floor = DRONE_AT.y + 130;
    let moving = false;
    for (const spark of this.sparks) {
      if (spark.settled) continue;
      moving = true;
      spark.vy += FIT.gravity * dt;
      spark.x += spark.vx * dt;
      spark.y += spark.vy * dt;
      if (spark.y >= floor) {
        spark.y = floor;
        spark.settled = true;
      }
    }
    // Once everything has landed the drawing is final, so stop redrawing it every frame.
    if (!moving && this.sparksDrawn) return;
    this.sparksDrawn = !moving;
    const g = this.sparkLayer.clear();
    for (const spark of this.sparks) {
      if (spark.settled) g.rect(spark.x - 1.5, spark.y - 1.5, 3, 3).fill({ color: spark.colour, alpha: 0.55 });
      else g.rect(spark.x - 1, spark.y - 1, 2.5, 2.5).fill({ color: spark.colour, alpha: 0.95 });
    }
  }

  render(model: GantryModel, handlers: GantryHandlers): void {
    this.lastModel = model;
    this.lastHandlers = handlers;
    // Oversized so the kick cannot shear a gap at the edge and show the world behind.
    this.backdrop.clear()
      .rect(-24, -24, VIEW_WIDTH + 48, VIEW_HEIGHT + 48).fill({ color: 0x05080a, alpha: 0.93 });

    this.drawStructure();
    this.drawDrone(model);
    this.cards.removeChildren().forEach((child) => child.destroy({ children: true }));
    this.chrome.removeChildren().forEach((child) => child.destroy({ children: true }));
    this.leaders.clear();

    this.drawHeader(model);
    const width = model.paddleWidth * CELL;
    const scale = DRONE_TARGET_WIDTH / Math.max(1, width + 26);
    for (const station of model.stations) {
      const mount = MOUNTS[station.id];
      const cardX = mount.side === "left" ? LEFT_X : RIGHT_X;
      const cardY = ROW_Y[mount.row];
      const anchorX = DRONE_AT.x + mount.x(width) * scale;
      const anchorY = DRONE_AT.y + mount.y * scale;
      this.mountAt.set(station.id, { x: anchorX, y: anchorY });
      if (station.id === model.selected && !this.fit) {
        this.mountRing.clear()
          .circle(anchorX, anchorY, 16).stroke({ width: 2, color: INK, alpha: 0.9 })
          .circle(anchorX, anchorY, 24).stroke({ width: 1, color: INK, alpha: 0.4 });
      }
      this.drawLeader(cardX, cardY, mount.side, anchorX, anchorY, station.id === model.selected);
      this.cards.addChild(this.stationCard(station, cardX, cardY, station.id === model.selected, handlers));
    }
    this.drawBank(model);
    this.drawBerth(model, handlers);
  }

  // --- pieces ----------------------------------------------------------------

  /** The bay: a floor, two gantry arms holding the machine, and a service rail. */
  private drawStructure(): void {
    const g = this.structure.clear();
    g.rect(0, 0, VIEW_WIDTH, 62).fill({ color: 0x0b1113, alpha: 0.9 })
      .moveTo(0, 62).lineTo(VIEW_WIDTH, 62).stroke({ width: 1, color: BRASS, alpha: 0.3 });
    // Floor under the machine.
    g.moveTo(DRONE_AT.x - 300, DRONE_AT.y + 132).lineTo(DRONE_AT.x + 300, DRONE_AT.y + 132)
      .stroke({ width: 3, color: BRASS, alpha: 0.55 });
    for (let tick = -292; tick <= 292; tick += 26) {
      g.moveTo(DRONE_AT.x + tick, DRONE_AT.y + 132).lineTo(DRONE_AT.x + tick - 12, DRONE_AT.y + 148)
        .stroke({ width: 2, color: BRASS, alpha: 0.28 });
    }
    // Two arms reaching in from above, which is what holds the drone off the floor, and a
    // cradle under it. Present enough that the machine reads as docked rather than floating.
    for (const side of [-1, 1]) {
      const at = DRONE_AT.x + side * 250;
      g.moveTo(at, 74).lineTo(at, DRONE_AT.y - 30)
        .stroke({ width: 5, color: BRASS, alpha: 0.5 })
        .moveTo(at, DRONE_AT.y - 30).lineTo(at - side * 62, DRONE_AT.y - 6)
        .stroke({ width: 4, color: BRASS, alpha: 0.45 })
        .circle(at, DRONE_AT.y - 30, 6).fill({ color: BRASS, alpha: 0.6 })
        .circle(at - side * 62, DRONE_AT.y - 6, 4).fill({ color: BRASS, alpha: 0.5 });
      g.moveTo(at - side * 40, DRONE_AT.y + 132).lineTo(at - side * 74, DRONE_AT.y + 62)
        .stroke({ width: 4, color: BRASS, alpha: 0.4 });
    }
    g.rect(0, VIEW_HEIGHT - 118, VIEW_WIDTH, 118).fill({ color: 0x080d0f, alpha: 0.85 })
      .moveTo(0, VIEW_HEIGHT - 118).lineTo(VIEW_WIDTH, VIEW_HEIGHT - 118)
      .stroke({ width: 1, color: BRASS, alpha: 0.28 });
  }

  /**
   * The machine, and a ghost of it one grade further on.
   *
   * The ghost is the whole reason this view exists: the player sees the part appear on their own
   * drone before paying for it, which no amount of "+12% PADDLE SPEED" can do.
   */
  private drawDrone(model: GantryModel): void {
    for (const host of [this.droneHost, this.ghostHost]) {
      host.removeChildren().forEach((child) => child.destroy({ children: true }));
    }
    const width = model.paddleWidth * CELL;
    const scale = DRONE_TARGET_WIDTH / Math.max(1, width + 26);

    const shown = this.fit && !this.fit.seated ? this.fit.fromGrades : model.grades;
    const drone = createDrone(model.paddleWidth, shown);
    drone.scale.set(scale);
    drone.position.set(DRONE_AT.x, DRONE_AT.y);
    this.droneHost.addChild(drone);

    this.mountRing.clear();
    if (this.fit || !model.selected) return;
    const station = model.stations.find((entry) => entry.id === model.selected);
    if (!station?.next) return;
    const ghost = createDrone(model.paddleWidth, {
      ...model.grades,
      [model.selected]: station.level + 1,
    });
    ghost.scale.set(scale);
    ghost.position.set(DRONE_AT.x, DRONE_AT.y);
    ghost.tint = PALETTE.rail;
    this.ghostHost.addChild(ghost);
  }

  private drawHeader(model: GantryModel): void {
    const title = text("REFIT BAY", 22, INK, "800", 5);
    title.position.set(44, 20);
    const chassis = text(model.chassisName.toUpperCase(), 15, BRASS, "800", 3);
    chassis.position.set(44, 44);

    const readouts = new Container();
    const entries: Array<[string, string]> = [
      ["ARMOR", String(model.armor)],
      ["HEALTH", `${model.integrity}/${model.maxIntegrity}`],
    ];
    entries.forEach(([key, value], index) => {
      const at = 380 + index * 150;
      const keyLabel = text(key, 11, FAINT, "800", 3);
      keyLabel.position.set(at, 22);
      const valueLabel = text(value, 22, INK, "800");
      valueLabel.position.set(at, 36);
      readouts.addChild(keyLabel, valueLabel);
    });

    const hint = text("CLICK A STATION, OR PRESS ITS NUMBER  ·  ESC CLOSES", 12, FAINT, "600", 2);
    hint.anchor.set(1, 0);
    hint.position.set(VIEW_WIDTH - 44, 32);
    this.chrome.addChild(title, chassis, readouts, hint);
  }

  /** A dogleg from the card to the part, so the label is attached rather than adjacent. */
  private drawLeader(
    cardX: number, cardY: number, side: "left" | "right",
    anchorX: number, anchorY: number, selected: boolean,
  ): void {
    const from = side === "left" ? cardX + CARD.width : cardX;
    const fromY = cardY + CARD.height / 2;
    const elbow = side === "left" ? from + 34 : from - 34;
    this.leaders
      .moveTo(from, fromY).lineTo(elbow, fromY).lineTo(anchorX, anchorY)
      .stroke({ width: selected ? 2 : 1, color: selected ? INK : BRASS, alpha: selected ? 0.8 : 0.3 })
      .circle(anchorX, anchorY, selected ? 4 : 2.5)
      .fill({ color: selected ? INK : BRASS, alpha: selected ? 0.9 : 0.45 });
  }

  private stationCard(
    station: GantryStation, x: number, y: number, selected: boolean, handlers: GantryHandlers,
  ): Container {
    const card = new Container();
    card.position.set(x, y);
    const ready = station.affordable;

    const plate = new Graphics()
      .roundRect(0, 0, CARD.width, CARD.height, 3)
      .fill({ color: selected ? 0x121b1f : 0x0c1214, alpha: 0.95 })
      .stroke({ width: selected ? 2 : 1, color: ready ? BRASS : 0x232b2e, alpha: selected ? 0.9 : 0.65 });
    card.addChild(plate);

    // The station names the place; the leader line points at it on the machine. The mount label
    // that used to sit under here ("FLANKS", "WORKING FACE") is gone with the rest of the prose --
    // the line already says where, and a word saying it again is a word between the player and
    // what the upgrade does.
    const name = text(station.name, 12, ready ? BRASS : DIM, "800", 3);
    name.position.set(14, 14);
    card.addChild(name);

    // The ladder, as pips. How far this part of the machine is, and how far it can go.
    const pips = new Graphics();
    for (let at = 0; at < station.ladder; at++) {
      const px = CARD.width - 16 - (station.ladder - 1 - at) * 15;
      if (at < station.level) pips.rect(px - 5, 12, 10, 10).fill({ color: BRASS, alpha: 0.95 });
      else pips.rect(px - 5, 12, 10, 10).stroke({ width: 1, color: BRASS, alpha: 0.35 });
    }
    card.addChild(pips);

    if (!station.next) {
      const built = text(station.fitted ?? "", 22, INK, "800");
      built.position.set(14, 52);
      const full = text("FULLY BUILT", 12, FAINT, "800", 3);
      full.position.set(14, 86);
      card.addChild(built, full);
      return card;
    }

    // Two lines and a price: what the part is called, what it does, what it costs.
    //
    // There used to be a third line -- "NOW  Iron Plate" -- and it went because the effect line
    // already carries it: "ARMOR 20 -> 36" states the current value on its left. Saying it twice
    // was the same information competing with itself.
    const headline = text(station.next.name, 22, ready ? INK : DIM, "800");
    headline.position.set(14, 44);
    const detail = text(station.next.detail, 15, ready ? INK : DIM, "800", 1);
    detail.position.set(14, 78);
    card.addChild(headline, detail);

    if (station.blocked) {
      const blocked = text(station.blocked, 11, PALETTE.danger, "800", 2);
      blocked.position.set(14, CARD.height - 26);
      card.addChild(blocked);
    } else {
      card.addChild(this.chipRow(station.next.cost, 14, CARD.height - 30));
    }

    // Hover previews the part on the machine; clicking fits it. Selection is a look, not a
    // commitment, which is what lets the ghost do the explaining.
    card.eventMode = "static";
    card.cursor = ready ? "pointer" : "default";
    card.on("pointerover", () => handlers.onSelect(station.id));
    card.on("pointerdown", () => { if (ready) handlers.onFit(station.id); });
    return card;
  }

  private chipRow(costs: GantryCost[], x: number, y: number): Container {
    const row = new Container();
    row.position.set(x, y);
    let cursor = 0;
    for (const cost of costs) {
      const short = cost.have < cost.need;
      const dot = new Graphics().rect(cursor, 5, 9, 9).fill(swatch(cost.resource));
      // A short chip names what the player actually has, so the gap is a number not a colour.
      const label = text(
        `${cost.need} ${RESOURCES[cost.resource].name}${short ? ` (${cost.have})` : ""}`,
        12, short ? PALETTE.danger : DIM, "600",
      );
      label.position.set(cursor + 14, 2);
      row.addChild(dot, label);
      cursor += 14 + label.width + 16;
    }
    return row;
  }

  private drawBank(model: GantryModel): void {
    const heading = text("BANK", 12, BRASS, "800", 4);
    heading.position.set(44, VIEW_HEIGHT - 100);
    this.chrome.addChild(heading);
    if (!model.bank.length) {
      const empty = text("EMPTY", 13, FAINT, "800", 3);
      empty.position.set(44, VIEW_HEIGHT - 78);
      this.chrome.addChild(empty);
      return;
    }
    // Two rows, so a full bank does not run off the edge.
    model.bank.slice(0, 12).forEach((entry, index) => {
      const column = index % 6;
      const row = Math.floor(index / 6);
      const at = 44 + column * 96;
      const top = VIEW_HEIGHT - 80 + row * 26;
      const dot = new Graphics().rect(at, top + 4, 9, 9).fill(swatch(entry.resource));
      const label = text(`${RESOURCES[entry.resource].name} ${entry.count}`, 12, DIM, "600");
      label.position.set(at + 14, top);
      this.chrome.addChild(dot, label);
    });
  }

  /** The berth builds a different machine, so it sits apart from the machine's own stations. */
  private drawBerth(model: GantryModel, handlers: GantryHandlers): void {
    const heading = text("FABRICATION BERTH", 12, BRASS, "800", 4);
    heading.anchor.set(1, 0);
    heading.position.set(VIEW_WIDTH - 44, VIEW_HEIGHT - 100);
    this.chrome.addChild(heading);

    model.hulls.forEach((hull, index) => {
      const width = 196;
      const x = VIEW_WIDTH - 44 - (model.hulls.length - index) * (width + 10) + 10;
      const y = VIEW_HEIGHT - 78;
      const card = new Container();
      card.position.set(x, y);
      card.addChild(new Graphics()
        .roundRect(0, 0, width, 54, 3)
        .fill({ color: 0x0c1214, alpha: 0.95 })
        .stroke({ width: 1, color: hull.affordable ? BRASS : 0x232b2e, alpha: 0.7 }));
      const name = text(hull.name, 15, hull.built ? FAINT : INK, "800", 1);
      name.position.set(11, 7);
      const detail = text(hull.built ? "BUILT" : hull.detail, 11, FAINT, "600", 1);
      detail.position.set(11, 27);
      card.addChild(name, detail);
      if (!hull.built) {
        const shortfall = hull.cost.filter((cost) => cost.have < cost.need).length;
        const state = text(shortfall ? `${shortfall} SHORT` : "READY", 10,
          shortfall ? PALETTE.danger : BRASS, "800", 2);
        state.anchor.set(1, 0);
        state.position.set(width - 11, 9);
        card.addChild(state);
        card.eventMode = "static";
        card.cursor = hull.affordable ? "pointer" : "default";
        card.on("pointerdown", () => { if (hull.affordable) handlers.onFabricate(hull.chassisId); });
      }
      this.cards.addChild(card);
    });
  }
}

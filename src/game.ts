import {
  Application,
  BlurFilter,
  Container,
  Graphics,
} from "pixi.js";
import {
  BALL_SPEED,
  BASE_ARENA_BALLS,
  BRICK_HALF,
  CELL,
  DRONE_HALF_THICKNESS_PX,
  DRONE_NOSE_PX,
  DEFAULT_SEED,
  PADDLE_CHASSIS,
  PALETTE,
  PHYSICS_STEP,
  PROVINCE_PALETTE,
  RESOURCES,
  VIEW_HEIGHT,
  VIEW_WIDTH,
  type MaterialKind,
  type PaddleChassis,
  type ResourceId,
} from "./config";
import { calculateClaimDamage } from "./claims";
import { collectCascade, initialRegrowthBudget, spawnMembrane, stepMembranes, stepRegrowth } from "./arenaRules";
import { BLAST_CHARGE_BRICKS, Economy, FABRICATIONS, STATIONS_BY_ID, STATION_IDS, type StationId, type VerbId } from "./economy";
import { materialOf } from "./materials";
import { createBall, stepBall, type BallStepEvents } from "./physics";
import { ChunkedTerrain } from "./terrain";
import { collectSound, GameAudio, SOUNDS } from "./audio";
import { Camera, type CameraTransition } from "./camera";
import { Effects } from "./effects";
import { clamp, normalizeAngle, smooth } from "./maths";
import { attachBall, attachMembrane, createDrone, spawnDrop } from "./view/actors";
import { buildArenaDisplay, drawLiabilityGauge, drawTrajectory } from "./view/board";
import { createBrickDisplay } from "./view/brick";
import { buildFarGeology, buildLandmarks, drawFramePreview } from "./view/survey";
import { buildFeatureMarks, updateFeatureMarks, type FeatureMark } from "./view/features";
import { gradeOf, Hud, REGION_RULES, type HudModel } from "./hud";
import { objectiveFor } from "./objectives";
import { Gantry, type GantryModel } from "./view/gantry";
import { SalvageDrone } from "./view/salvage";
import { AtlasView } from "./atlasView";
import { ExpeditionView } from "./expeditionView";
import { DeploymentPreviews } from "./deploymentPreviews";
import type { Arena, Ball, Brick, FrameGeometry, Membrane, TutorialStep, Vec2 } from "./types";
import { WorldModel } from "./world";
import { BANK } from "./worldgen/landmarks";
import type { AtlasSite } from "./atlas";
import {
  clearSave,
  exportSave,
  importSave,
  packDiscovered,
  readSave,
  SAVE_VERSION,
  unpackDiscovered,
  writeSave,
  type MapAnnotation,
  type SaveData,
} from "./persistence";

type Mode = "survey" | "play";

/**
 * Seconds between background autosaves.
 *
 * Every consequential event -- banking, a claim resolving, a craft, a verb, a
 * death -- saves immediately, so this interval only exists to capture the cheap
 * continuous state (position and map discovery) for a player who wanders a long
 * way without doing anything the game considers an event.
 */
const AUTOSAVE_SECONDS = 20;

/** How far the drone reveals the map around itself, in cells. */
const DISCOVERY_RADIUS = 9;

/** Cornerstones grant verbs. Nothing else in the game does. */
const CORNERSTONE_VERBS: Record<string, VerbId> = {
  echoObservatory: "surveyResonance",
  twinEngine: "sequentialBall",
  rootChoir: "railSeed",
};

const CORNERSTONE_TARGETS: Record<string, number> = {
  echoObservatory: 3,
  twinEngine: 2,
  rootChoir: 5,
};

const VERB_NAMES: Record<VerbId, string> = {
  surveyResonance: "SURVEY RESONANCE",
  sequentialBall: "THIRD SEQUENTIAL BALL",
  railSeed: "RAIL SEED",
};


export class OrekenoidGame {
  readonly app = new Application();
  readonly world: WorldModel;
  readonly terrain: ChunkedTerrain;
  readonly economy = new Economy();
  readonly worldRoot = new Container();
  readonly farLayer = new Container();
  readonly terrainLayer = new Container();
  readonly landmarkLayer = new Container();
  readonly featureLayer = new Container();
  readonly effectLayer = new Container();
  readonly actorLayer = new Container();
  readonly framePreview = new Container();
  readonly frameWash = new Graphics();
  readonly frameGrid = new Graphics();
  readonly frameScan = new Graphics();
  readonly frameReturns = new Graphics();
  readonly keys = new Set<string>();
  readonly audio = new GameAudio();
  readonly hud = new Hud();
  readonly gantry = new Gantry();
  readonly salvage = new SalvageDrone();
  /** Which station the bay is previewing on the machine. Selection is a look, not a buy. */
  private forgeSelection: StationId | null = null;
  readonly atlasView = new AtlasView(this);
  readonly expeditionView = new ExpeditionView();
  /**
   * The three live chassis previews. They run the production Arena, terrain raster,
   * brick, paddle, ball and collision code -- never a parallel renderer.
   */
  readonly deploymentPreviews: DeploymentPreviews;
  readonly effects: Effects;

  chassisRoster: PaddleChassis[] = [...PADDLE_CHASSIS];
  readonly chassisIntegrity = new Map<string, number>();
  /** Struck mechanism cells per cornerstone. Progress is persistent and partial. */
  readonly cornerstoneProgress = new Map<string, Set<string>>();
  readonly anchors: Array<{ id: string; x: number; y: number; name: string }> = [];

  chassisIndex = 0;
  selectedChassisIndex: number | null = null;
  hoveredChassisIndex: number | null = null;
  mode: Mode = "survey";
  started = false;
  craftingOpen = false;
  atlasOpen = false;
  /** Player-placed map markers. Nothing in the game writes to this but the player. */
  annotations: MapAnnotation[] = [];
  /** Wall-clock seconds in this expedition, carried across sessions by the save. */
  elapsed = 0;
  /** Counts down to the next autosave; also reset to zero to force one. */
  private saveTimer = AUTOSAVE_SECONDS;
  lastRegionName = "";
  /** Province rules are taught on arrival, once, rather than nagged permanently. */
  readonly regionsSeen = new Set<string>();
  /** Hints disappear once the player has actually performed the action. */
  hasCommitted = false;
  hasServed = false;
  /** Set when a claim resolves at zero health; the exit camera returns to the Landing. */
  private dying = false;
  deaths = 0;
  /**
   * Controls are taught by doing. Each step checks off as the player performs it,
   * and the whole panel retires permanently once every one of them is done.
   */
  /**
   * The opening sequence: one control at a time, and nothing else works yet.
   *
   * This used to be a six-row checklist shown all at once, with every control live from the first
   * frame. A player could serve before they had framed anything, or open the Atlas over a world
   * they had not moved through, and the panel read as a list of things to go and do rather than as
   * being taught. Sequential and exclusive means the game only ever asks for one thing, and the
   * only key that does anything is the one it is asking for -- plus everything already earned.
   *
   * `where` keeps a step from being asked for in a mode it cannot be performed in. `optional`
   * steps are shown and then move on by themselves: the speed controls are worth knowing about
   * and it would be silly to hold the tutorial hostage to them.
   */
  readonly tutorial: TutorialStep[] = [
    { id: "move", keys: "WASD / ARROWS", label: "MOVE", where: "survey", done: false },
    { id: "aim", keys: "Q / E", label: "AIM THE FRAME", where: "survey", done: false },
    { id: "commit", keys: "F", label: "COMMIT THE CLAIM", where: "survey", done: false },
    // Aiming inside a claim comes *before* the serve, because that is the only time it does
    // anything -- the aim steers the ball off the paddle and is fixed once the ball is live.
    // Teaching it after "SERVE" made it unreachable in that claim, which is exactly the kind of
    // thing a sequential tutorial makes obvious and a checklist hides.
    { id: "arenaAim", keys: "Q / E", label: "AIM THE SERVE", where: "play", done: false },
    { id: "serve", keys: "SPACE", label: "SERVE", where: "play", done: false },
    { id: "paddle", keys: "A / D", label: "MOVE THE PADDLE", where: "play", done: false },
    // Shown, not demanded.
    { id: "speed", keys: "W / S", label: "HOLD TO SPEED UP", where: "play", optional: true, done: false },
    // The Atlas is how the mine becomes navigable at all, so it is taught rather
    // than left to be found.
    { id: "atlas", keys: "M", label: "OPEN THE ATLAS", where: "survey", done: false },
  ];
  /**
   * A real pause: the claim's simulation stops, not just the interface.
   *
   * Resuming runs a countdown rather than dropping the player straight back onto a live ball,
   * because the ball does not wait for them to find the paddle again.
   */
  paused = false;
  /** Seconds left of the 3-2-1. Zero means the claim is live. */
  resumeCountdown = 0;
  tutorialComplete = false;
  /** How long the current step has been on screen, for advancing the optional ones. */
  private tutorialShownFor = 0;
  /** Pulses the prompt when a key the player has not been given yet is pressed. */
  private tutorialNudge = 0;
  private tutorialFadeTimer = 0;
  private arrivalTimer = 0;
  private compassTimer = 0;
  player: { x: number; y: number; heading: number };
  arena: Arena | null = null;
  railSeedUsed = false;
  railSeedArmed = false;
  time = 0;
  physicsAccumulator = 0;
  readonly camera: Camera;

  /** Camera state is owned by `camera`; these read through for callers and tests. */
  get cameraFocus(): Vec2 { return this.camera.focus; }
  set cameraFocus(value: Vec2) { this.camera.jumpTo(value); }
  get cameraRotation(): number { return this.camera.rotation; }
  get cameraTransition(): CameraTransition | null { return this.camera.transition; }
  drone: Container;
  /** Drawn world features, kept so the few that animate can be advanced each frame. */
  featureMarks: FeatureMark[] = [];


  constructor(seedLabel: string = DEFAULT_SEED) {
    this.world = new WorldModel(seedLabel);
    this.terrain = new ChunkedTerrain(this.world);
    this.player = { x: this.world.start.x * CELL, y: this.world.start.y * CELL, heading: Math.PI / 2 };
    this.camera = new Camera({ x: this.player.x, y: this.player.y });
    for (const chassis of this.chassisRoster) this.chassisIntegrity.set(chassis.id, chassis.maxHealth);
    // Anchor zero: the Refit Bay in the lander.
    this.anchors.push({ id: "refitBay", x: this.world.start.x, y: this.world.start.y, name: "REFIT BAY" });
    this.effects = new Effects(this.effectLayer);
    this.deploymentPreviews = new DeploymentPreviews(this.world, this.terrain);
    this.drone = createDrone(this.paddleWidth, this.economy.stationGrades(this.chassis.id));
    this.framePreview.addChild(this.frameWash, this.frameGrid, this.frameScan, this.frameReturns);
    this.frameScan.filters = [new BlurFilter({ strength: 5, quality: 2 })];
  }

  get chassis() { return this.chassisRoster[this.chassisIndex]; }
  get moduleUpgrades() { return this.economy.upgrades(this.chassis.id); }
  get soakCapacity() { return this.chassis.soak + this.moduleUpgrades.armor; }
  get maxIntegrity() { return this.chassis.maxHealth + this.moduleUpgrades.maxIntegrity; }
  get paddleSpeed() { return this.chassis.paddleSpeed * (1 + this.moduleUpgrades.paddleSpeedPercent / 100); }
  get paddleWidth() { return this.chassis.paddleWidth + this.moduleUpgrades.paddleWidth; }
  get travelSpeed() { return this.chassis.travelSpeed * (1 + this.moduleUpgrades.travelSpeedPercent / 100); }
  get rotationSpeed() { return this.chassis.rotationSpeed * (1 + this.moduleUpgrades.rotationPercent / 100); }
  /**
   * The drone's hull half-extents, in cells, along its own axes.
   *
   * Derived from the equipped chassis rather than fixed, so fitting a wider emitter
   * makes the machine genuinely harder to thread through tight rock. That is the
   * cost side of a wide paddle, and it was previously free.
   */
  get hullHalfLength() { return this.paddleWidth / 2 + DRONE_NOSE_PX / CELL; }
  get hullHalfThickness() { return DRONE_HALF_THICKNESS_PX / CELL; }

  /**
   * The step the game is currently asking for, or null once the sequence is done.
   *
   * Skipped past any step whose mode the player is not in, so being in a claim never leaves the
   * prompt asking for something only possible outside one.
   */
  private get currentStep(): TutorialStep | null {
    if (this.tutorialComplete) return null;
    return this.tutorial.find((step) => !step.done) ?? null;
  }

  /**
   * Is this control available yet?
   *
   * Everything already taught, plus the one being taught now. Everything the sequence has not
   * reached is refused -- which is the whole point of an exclusive tutorial, and is why the guard
   * lives here rather than being scattered as `if (tutorialComplete)` checks.
   */
  private can(control: TutorialStep["id"]): boolean {
    if (this.tutorialComplete) return true;
    const at = this.tutorial.findIndex((step) => step.id === control);
    if (at < 0) return true;
    // Available if it is done, or if it is the step being asked for right now.
    if (this.tutorial[at].done) return true;
    return this.currentStep?.id === control;
  }

  /** A key was pressed that the sequence has not offered yet. Pulse rather than nag. */
  private refuseControl(): void {
    this.tutorialNudge = 0.6;
  }

  /** Can the hull occupy this pose without intersecting rock? */
  private hullFits(x: number, y: number, heading: number): boolean {
    return this.world.isHullOpen(x, y, heading, this.hullHalfLength, this.hullHalfThickness);
  }

  /** The drone always pulls a little; modules widen it. */
  /**
   * Share the salvage drone keeps of anything it rescues. Zero means there is no drone.
   *
   * There used to be a `vacuumRadius` here that dragged falling drops toward the paddle. It is
   * gone, innate pull included: a pull and a drone that catches what the paddle misses are the
   * same mechanic answering the same complaint twice. Drops fall straight now.
   */
  get salvageTax() { return this.moduleUpgrades.salvageTax; }
  get hasSalvageDrone() { return this.moduleUpgrades.salvageTax > 0; }
  get predictedBounces() { return this.moduleUpgrades.predictBounces; }
  /** Total balls for a claim, including the one on the paddle. */
  get arenaBalls() { return BASE_ARENA_BALLS + (this.economy.verbs.has("sequentialBall") ? 1 : 0); }
  get integrity() { return this.chassisIntegrity.get(this.chassis.id) ?? this.maxIntegrity; }
  set integrity(value: number) { this.chassisIntegrity.set(this.chassis.id, clamp(value, 0, this.maxIntegrity)); }

  async init(host: HTMLElement): Promise<void> {
    await this.app.init({
      width: VIEW_WIDTH,
      height: VIEW_HEIGHT,
      background: PALETTE.void,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(2, window.devicePixelRatio || 1),
      preference: ["webgl", "canvas"],
      powerPreference: "high-performance",
    });
    host.appendChild(this.app.canvas);
    this.app.canvas.classList.add("game-canvas");
    host.dataset.renderer = this.app.renderer.constructor.name;
    this.app.canvas.style.width = "100%";
    this.app.canvas.style.height = "100%";
    this.app.canvas.setAttribute("aria-label", "Orekenoid");
    this.app.stage.addChild(this.worldRoot, this.gantry.container);
    this.worldRoot.addChild(this.farLayer, this.terrainLayer, this.landmarkLayer, this.featureLayer, this.effectLayer, this.actorLayer, this.framePreview);
    this.terrainLayer.addChild(this.terrain.container);
    buildFarGeology(this.farLayer);
    // Build the opening neighbourhood synchronously so the first frame is complete.
    this.terrain.requestAround(this.player.x, this.player.y);
    this.terrain.pump(24);
    buildLandmarks(this.landmarkLayer, this.world);
    this.featureMarks = buildFeatureMarks(this.featureLayer, this.world.generated.rooms.features, this.world);
    this.actorLayer.addChild(this.drone);
    this.bindInput();
    this.bindInterfaceUI();
    await this.deploymentPreviews.build(this.chassisRoster);
    // The world stays hidden until deployment so the previews read cleanly.
    this.worldRoot.visible = false;
    this.app.ticker.add((ticker) => this.update(Math.min(0.25, ticker.deltaMS / 1000)));
    this.updateUI();
    this.exposeDebug();
    await new Promise<void>((resolve) => requestAnimationFrame(() => {
      this.deploymentPreviews.layout();
      requestAnimationFrame(() => resolve());
    }));
    this.expeditionView.markReady();
  }

  private bindInput(): void {
    window.addEventListener("keydown", (event) => {
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) event.preventDefault();
      this.keys.add(event.code);
      if (!this.started) {
        if (!event.repeat && event.code === "Digit1") this.selectChassis(0);
        if (!event.repeat && event.code === "Digit2") this.selectChassis(1);
        if (!event.repeat && event.code === "Digit3") this.selectChassis(2);
        if (!event.repeat && event.code === "Enter" && this.selectedChassisIndex !== null) this.start();
        return;
      }
      // The Atlas is readable at any time, including mid-arena, and swallows every
      // other key while open so the drone and the paddle both hold still.
      if (this.atlasOpen) {
        // Escape backs out one level at a time: the marker being edited first, the
        // map only once nothing is being edited.
        if (event.code === "Escape" && this.atlasView.isEditing) { this.atlasView.closeEditor(); return; }
        if (event.code === "Enter" && this.atlasView.isEditing) { this.atlasView.commitNote(); return; }
        if (event.code === "KeyM" || event.code === "Escape") this.toggleAtlas();
        return;
      }
      if (event.repeat || this.cameraTransition) return;
      // Pause is never gated: whatever else is happening, the player can always stop. Handled
      // before the atlas and forge branches only for Escape when neither of those is open.
      if (event.code === "Escape" && !this.atlasOpen && !this.craftingOpen) { this.togglePause(); return; }
      if (this.paused) {
        // While paused the only key that does anything is the one that unpauses.
        if (event.code === "Escape" || event.code === "KeyP") this.togglePause();
        return;
      }
      if (!event.repeat && event.code === "KeyM") {
        if (!this.can("atlas")) { this.refuseControl(); return; }
        this.toggleAtlas();
        return;
      }
      if (!event.repeat && event.code === "KeyC" && this.mode === "survey") { this.toggleCrafting(); return; }
      if (this.craftingOpen) {
        // Any key lands a running fit rather than queueing behind it.
        if (this.gantry.fitting) {
          this.gantry.skipFit();
          return;
        }
        const digit = Number(event.code.replace("Digit", ""));
        if (event.code.startsWith("Digit") && digit >= 1 && digit <= 9) this.pressForgeKey(digit - 1);
        if (event.code === "Escape") this.toggleCrafting();
        return;
      }
      if (this.mode === "survey") {
        if (event.code === "Enter" || event.code === "KeyF") {
          if (!this.can("commit")) { this.refuseControl(); return; }
          this.establishArena();
        }
      } else if (this.arena) {
        if (event.code === "Space") {
          if (!this.can("serve")) { this.refuseControl(); return; }
          this.serve();
        }
        if (event.code === "KeyR" && this.economy.verbs.has("railSeed") && !this.railSeedUsed) this.placeRailSeed();
        if (event.code === "KeyB" && this.economy.blastCharges > 0) this.useBlastCharge();
      }
    });
    window.addEventListener("keyup", (event) => this.keys.delete(event.code));
    window.addEventListener("blur", () => this.keys.clear());
    window.addEventListener("resize", () => {
      this.deploymentPreviews.layout();
      if (this.atlasOpen) this.atlasView.render();
    });
  }

  start(): void {
    if (this.started || this.selectedChassisIndex === null) return;
    this.started = true;
    this.expeditionView.dismiss();
    this.deploymentPreviews.hide();
    this.worldRoot.visible = true;
    this.hud.markDeployed();
    this.renderTutorial();
    this.audio.start();
    this.showToast(`${this.chassis.name} DEPLOYED · SURVEY LIVE`);
    this.updateUI();
  }

  private selectChassis(index: number): void {
    const chassis = this.chassisRoster[index];
    if (!chassis || this.started) return;
    this.chassisIndex = index;
    this.selectedChassisIndex = index;
    this.drone.destroy({ children: true });
    this.drone = createDrone(this.paddleWidth, this.economy.stationGrades(this.chassis.id));
    this.actorLayer.addChild(this.drone);
    this.renderFramePreview();
    this.expeditionView.showChassisSelected(index);
    this.deploymentPreviews.setSelected(index);
    this.updateUI();
  }

  private showToast(message: string): void {
    this.hud.showToast(message);
  }

  /** Push everything that is not per-frame at the HUD. Cheap; call it freely. */
  private updateUI(): void {
    this.hud.render(this.buildHudModel());
  }

  private renderTutorial(): void {
    if (this.tutorialComplete) return;
    // One rung, not the whole ladder. A list of six invites the player to go and do all six; a
    // single line asks for one thing and is finished with it before the next appears.
    this.hud.renderTutorial(this.currentStep, this.tutorial);
  }

  /**
   * Point the compass at the nearest anchor.
   *
   * The bearing is computed here rather than in the HUD because it needs the same
   * camera transform the renderer uses -- a compass that ignored camera rotation
   * would point the wrong way for the whole of an arena.
   */
  private updateCompass(): void {
    if (this.compassTimer <= 0) {
      this.hud.hideCompass();
      return;
    }
    const anchor = this.anchors
      .map((entry) => ({
        entry,
        distance: Math.hypot(entry.x - this.player.x / CELL, entry.y - this.player.y / CELL),
      }))
      .sort((a, b) => a.distance - b.distance)[0];
    if (!anchor) return;
    const dx = anchor.entry.x * CELL - this.camera.focus.x;
    const dy = anchor.entry.y * CELL - this.camera.focus.y;
    const cos = Math.cos(this.camera.rotation);
    const sin = Math.sin(this.camera.rotation);
    this.hud.showCompass({
      name: anchor.entry.name,
      distanceMetres: anchor.distance * 14,
      bearing: Math.atan2(dx * sin + dy * cos, dx * cos - dy * sin),
    });
  }

  /** Redraw the survey projection for wherever the drone is now pointing. */
  private renderFramePreview(): void {
    drawFramePreview(
      { wash: this.frameWash, grid: this.frameGrid, scan: this.frameScan, returns: this.frameReturns },
      this.world,
      this.frameGeometry(),
      this.time,
    );
  }

  private frameGeometry(): FrameGeometry {
    return {
      origin: { x: this.player.x / CELL, y: this.player.y / CELL },
      angle: this.player.heading,
      width: this.chassis.frame.width,
      depth: this.chassis.frame.depth,
    };
  }

  // --- Crafting -----------------------------------------------------------

  private nearestAnchor(): { name: string; distance: number } | null {
    let best: { name: string; distance: number } | null = null;
    for (const anchor of this.anchors) {
      const distance = Math.hypot(anchor.x - this.player.x / CELL, anchor.y - this.player.y / CELL);
      if (!best || distance < best.distance) best = { name: anchor.name, distance };
    }
    return best;
  }

  /** Latched while the drone is parked at the bank, so the bay opens once per arrival. */
  private arrivedAtBank = false;

  private atAnchor(): boolean {
    const nearest = this.nearestAnchor();
    return !!nearest && nearest.distance <= 9;
  }

  /**
   * Pause and resume.
   *
   * Available at all times and never gated by the tutorial: a player must always be able to stop.
   */
  togglePause(): void {
    if (!this.started) return;
    if (this.paused) {
      this.paused = false;
      // Only a live claim needs the countdown. Out in the mine there is nothing to be caught by.
      this.resumeCountdown = this.arena && !this.arena.resolving ? 3 : 0;
      this.audio.play(SOUNDS.atlasClose);
    } else {
      this.paused = true;
      this.resumeCountdown = 0;
      this.audio.play(SOUNDS.atlasOpen);
    }
    this.updateUI();
  }

  private toggleCrafting(): void {
    if (!this.craftingOpen && !this.atAnchor()) {
      // Point at the nearest forge rather than only reporting its absence.
      this.compassTimer = 4;
      this.updateCompass();
      this.audio.play(SOUNDS.forgeOutOfRange);
      return;
    }
    this.craftingOpen = !this.craftingOpen;
    // Docking selects the least-built station, so the bay always opens pointing at something
    // rather than at nothing. The player is asking "what now"; answering with a blank screen is
    // the failure the old panel made every time it opened.
    this.forgeSelection = this.craftingOpen ? this.leastBuiltStation() : null;
    this.gantry.setOpen(this.craftingOpen);
    this.renderCrafting();
    this.updateUI();
  }

  /** The station with the most room left to grow, as a sensible default selection. */
  private leastBuiltStation(): StationId {
    let best = STATION_IDS[0];
    let bestRemaining = -1;
    for (const station of STATION_IDS) {
      const remaining = STATIONS_BY_ID.get(station)!.grades.length - this.economy.gradeOf(this.chassis.id, station);
      if (remaining > bestRemaining) {
        bestRemaining = remaining;
        best = station;
      }
    }
    return best;
  }

  /**
   * The bay, as a model. The view is handed everything it needs and reads no game state, which
   * is the same contract the HUD works to.
   */
  private gantryModel(): GantryModel {
    const chassisId = this.chassis.id;
    const priced = (cost: Partial<Record<ResourceId, number>>) =>
      (Object.entries(cost) as Array<[ResourceId, number]>)
        .map(([resource, need]) => ({ resource, need, have: this.economy.amount(resource) }));
    return {
      chassisName: this.chassis.name,
      paddleWidth: this.paddleWidth,
      grades: this.economy.stationGrades(chassisId),
      armor: this.soakCapacity,
      integrity: this.integrity,
      maxIntegrity: this.maxIntegrity,
      selected: this.forgeSelection,
      stations: STATION_IDS.map((station) => {
        const definition = STATIONS_BY_ID.get(station)!;
        const next = this.economy.nextGrade(chassisId, station);
        const check = this.economy.canUpgrade(chassisId, station);
        return {
          id: station,
          name: definition.name,
          mount: definition.mount,
          level: this.economy.gradeOf(chassisId, station),
          ladder: definition.grades.length,
          fitted: this.economy.fittedGrade(chassisId, station)?.name ?? null,
          next: next ? { name: next.name, detail: next.detail, cost: priced(next.cost) } : null,
          // Shortfalls are already said by the cost chips, so only structural refusals get text.
          blocked: !check.ok && check.reason !== "INSUFFICIENT MATERIAL" && next ? check.reason ?? null : null,
          affordable: check.ok,
        };
      }),
      hulls: FABRICATIONS.map((hull) => ({
        chassisId: hull.chassisId,
        name: hull.name,
        detail: hull.detail,
        built: this.economy.fabricated.has(hull.chassisId),
        affordable: this.economy.canFabricate(hull.chassisId).ok,
        cost: priced(hull.cost),
      })),
      bank: [...this.economy.banked.entries()]
        .filter(([, count]) => count > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([resource, count]) => ({ resource, count })),
    };
  }

  /** Redraw the bay, which is always rendered against live economy state. */
  private renderCrafting(): void {
    if (!this.craftingOpen) return;
    this.gantry.render(this.gantryModel(), {
      onSelect: (station) => {
        if (station === this.forgeSelection) return;
        this.forgeSelection = station;
        this.renderCrafting();
      },
      onFit: (station) => this.upgradeStation(station),
      onFabricate: (chassisId) => this.fabricateHull(chassisId),
    });
  }

  /**
   * Digits run across the panel: the six stations first, then the berth.
   *
   * One flat index rather than per-section numbering, so the digit printed on a card is always
   * the digit that presses it.
   */
  private pressForgeKey(index: number): void {
    if (index < STATION_IDS.length) {
      const station = STATION_IDS[index];
      this.forgeSelection = station;
      this.upgradeStation(station);
      return;
    }
    const hull = FABRICATIONS[index - STATION_IDS.length];
    if (hull) this.fabricateHull(hull.chassisId);
  }

  /**
   * Raise one station a grade, and show it happening.
   *
   * State changes first and the animation reads it afterwards, never the reverse: the sequence
   * is skippable and interruptible, so it must not be the thing that owns whether the part is
   * fitted. `beginFit` is handed the grades as they were, and holds the old silhouette until the
   * arm seats the part.
   */
  upgradeStation(station: StationId): void {
    // One fit at a time. Pressing a second station mid-sequence lands the first rather than
    // dropping it, which is also the fastest way through for a player who does not want the show.
    if (this.gantry.fitting) {
      this.gantry.skipFit();
      return;
    }
    const before = this.economy.stationGrades(this.chassis.id);
    const result = this.economy.upgrade(this.chassis.id, station);
    if (!result.ok) {
      this.showToast(result.reason ?? "CANNOT FIT");
      this.audio.play(SOUNDS.cannotForge);
      return;
    }
    const grade = result.grade!;
    // The part is the colour of the ore it was made from -- the same colour the plate on the
    // drone takes, and the same chip the cost was listed in.
    const ore = (Object.keys(grade.cost) as ResourceId[])
      .find((resource) => resource !== "coal") ?? "copper";
    this.audio.play(SOUNDS.fitReach);
    this.gantry.beginFit(
      station, RESOURCES[ore].colour, before,
      () => {
        // Seated: the machine now carries the part, everywhere it is drawn.
        this.rebuildDrone();
        this.audio.play(SOUNDS.fitSeat);
        this.audio.play(SOUNDS.fitClick);
      },
      () => {
        this.showToast(`${grade.name.toUpperCase()} FITTED`);
        this.audio.play(SOUNDS.forged);
        this.requestSave();
        this.renderCrafting();
        this.updateUI();
      },
    );
    this.updateUI();
  }

  /** Build a hull at the fabrication berth. A different machine, not a better one. */
  private fabricateHull(chassisId: string): void {
    const result = this.economy.fabricate(chassisId);
    if (!result.ok) {
      this.showToast(result.reason ?? "CANNOT BUILD");
      this.audio.play(SOUNDS.cannotForge);
      return;
    }
    this.chassisRoster = this.economy.availableChassis(PADDLE_CHASSIS);
    const built = this.chassisRoster.find((chassis) => chassis.id === chassisId);
    // A fabricated hull starts at grade zero on every station, so it is visibly bare beside a
    // veteran machine. Fabrication buys a different shape of claim, not a better one.
    if (built && !this.chassisIntegrity.has(built.id)) this.chassisIntegrity.set(built.id, built.maxHealth);
    this.showToast(`${built?.name.toUpperCase() ?? "HULL"} · AVAILABLE AT REFIT`);
    this.audio.play(SOUNDS.forged);
    this.requestSave();
    this.renderCrafting();
    this.updateUI();
  }

  /** Rebuild the drone silhouette from the machine's current grades. */
  rebuildDrone(): void {
    this.drone.destroy({ children: true });
    this.drone = createDrone(this.paddleWidth, this.economy.stationGrades(this.chassis.id));
    this.actorLayer.addChild(this.drone);
  }

  // --- Claims -------------------------------------------------------------

  private establishArena(): void {
    const frame = this.frameGeometry();
    if (!this.world.frameWithinBounds(frame)) { this.showToast("CLAIM CROSSES SURVEY LIMIT"); return; }
    const sampled = this.world.framedBricks(frame);
    if (!sampled.length) { this.showToast("NO MATERIAL IN FRAME"); return; }
    const bricks: Brick[] = [];
    let resources = 0;
    for (const { cell, sourceCells, u, v, footprint, persistent } of sampled) {
      for (const source of sourceCells) source.hidden = false;
      if (cell.resource) resources++;
      const definition = materialOf(cell.kind);
      bricks.push({
        u, v, x: cell.x, y: cell.y, hp: cell.hp, maxHp: cell.maxHp, kind: cell.kind,
        resource: cell.resource, facetAxis: cell.facetAxis,
        // Worked rock is never load again. Regrowth restores the rock, not the debt -- otherwise
        // the Rootwarren's rule charged the player twice for the same cell and punished them for
        // taking their time in a claim they had already cleared.
        alive: true, persistent, worked: cell.worked,
        liable: !persistent && definition.liable && !cell.worked,
        footprint, sourceCells, hitFlash: 0,
      });
    }
    const reading = this.world.readRegion(frame.origin.x, frame.origin.y);
    const container = new Container();
    const board = new Container();
    const actors = new Container();
    container.addChild(board, actors);
    this.actorLayer.addChild(container);
    const arena: Arena = {
      ...frame,
      province: reading.province, ecotone: reading.ecotone, band: reading.band as Arena["band"],
      bricks, balls: [createBall()], drops: [], membranes: [],
      regrowthBudget: initialRegrowthBudget(bricks), regrowthTimer: 0,
      resourceCount: resources, collected: 0, combo: 0,
      splitArmed: false, splitUsed: false, serveAim: 0.08,
      initialLiability: bricks.filter((brick) => brick.liable).length, damageTaken: 0,
      spareBalls: Math.max(0, this.arenaBalls - 1),
      paddle: { u: 0, velocity: 0, width: this.paddleWidth, flash: 0, impact: 0 },
      container, board, actors, resolving: false, visualAge: 0,
    };
    this.arena = arena;
    this.mode = "play";
    this.hasCommitted = true;
    this.markTutorial("commit");
    this.railSeedUsed = false;
    this.railSeedArmed = false;
    this.framePreview.visible = false;
    buildArenaDisplay(arena, (u, v) => this.world.localToWorld(u, v, arena), this.economy.stationGrades(this.chassis.id));
    this.armSalvage(arena);
    const center = this.world.localToWorld(0, arena.depth / 2, arena);
    this.camera.begin({ x: center.x * CELL, y: center.y * CELL }, -arena.angle, false);
    this.showToast(`${arena.initialLiability} LIABLE · ${resources} RETURNS · CLAIM COMMITTED`);
    this.audio.play(SOUNDS.claimCommitted);
    this.updateUI();
  }

  private serve(): void {
    const arena = this.arena;
    if (!arena || arena.balls.some((ball) => ball.served) || this.cameraTransition) return;
    const ball = arena.balls[0];
    ball.vu = arena.serveAim * BALL_SPEED;
    ball.vv = Math.sqrt(BALL_SPEED ** 2 - ball.vu ** 2);
    ball.served = true;
    this.hasServed = true;
    this.markTutorial("serve");
    this.audio.play(SOUNDS.serve);
    this.updateUI();
  }

  /** Rail seed: one temporary bumper placed before the first serve. */
  private placeRailSeed(): void {
    const arena = this.arena;
    if (!arena || arena.balls.some((ball) => ball.served)) {
      this.showToast("RAIL SEED MUST BE PLACED BEFORE THE SERVE");
      return;
    }
    const membrane: Membrane = {
      u: arena.paddle.u,
      v: Math.max(1.5, arena.depth * 0.34),
      halfWidth: BRICK_HALF * 1.9,
      halfHeight: BRICK_HALF * 0.4,
      life: Number.POSITIVE_INFINITY,
      maxLife: Number.POSITIVE_INFINITY,
    };
    arena.membranes.push(membrane);
    attachMembrane(membrane, arena, (u, v) => this.world.localToWorld(u, v, arena));
    this.railSeedUsed = true;
    this.showToast("RAIL SEED PLACED");
    this.audio.play(SOUNDS.railSeedPlaced);
  }

  private useBlastCharge(): void {
    const arena = this.arena;
    if (!arena || arena.resolving) return;
    const survivors = arena.bricks
      .filter((brick) => brick.alive && brick.liable)
      .sort((a, b) => (a.v - b.v) || (a.u - b.u))
      .slice(0, BLAST_CHARGE_BRICKS);
    if (!survivors.length) { this.showToast("NOTHING TO DETONATE"); return; }
    this.economy.blastCharges--;
    for (const brick of survivors) {
      brick.hp = 0;
      brick.alive = false;
      brick.display?.destroy({ children: true });
      this.world.removeFootprint(brick.footprint, false, brick.persistent);
      this.shardsAtBrick(brick, PALETTE.danger, 12);
    }
    this.audio.play(SOUNDS.blastCharge);
    this.showToast(`BLAST CHARGE · ${survivors.length} CLEARED`);
    this.updateUI();
  }

  private handleBallEvents(ball: Ball, events: BallStepEvents): void {
    const arena = this.arena;
    if (!arena) return;
    if (events.paddle) this.audio.play(SOUNDS.paddleHit);
    if (events.rail) this.audio.play(SOUNDS.railHit);
    if (events.faceted) this.audio.play(SOUNDS.facetTurn);
    for (const membrane of events.membranes) {
      this.audio.play(SOUNDS.membraneHit);
      void membrane;
    }
    for (const brick of events.bricks) this.hitBrick(brick, ball);
  }

  private hitBrick(brick: Brick, ball: Ball): void {
    const arena = this.arena;
    if (!arena || !brick.alive) return;
    const definition = materialOf(brick.kind);

    // Persistent structure never breaks. Striking a cornerstone mechanism is the
    // interaction, not an obstruction: each distinct mechanism struck is progress
    // that survives the claim.
    if (definition.persistent) {
      brick.hitFlash = 0.16;
      this.ringAtBrick(brick, definition.edge, 0.7);
      this.registerMechanismStrike(brick);
      this.audio.play(SOUNDS.structureStruck);
      return;
    }

    brick.hp--;
    brick.hitFlash = 0.12;
    arena.combo++;
    this.shardsAtBrick(brick, definition.edge, 10);
    this.audio.play(brick.hp <= 0 ? SOUNDS.brickBreak : SOUNDS.brickChip);
    if (brick.hp > 0) return;

    brick.alive = false;
    brick.display?.destroy({ children: true });
    this.world.removeFootprint(brick.footprint, false, brick.persistent);
    if (brick.resource) spawnDrop(arena, brick.u, brick.v, brick.resource);
    if (definition.spawnsMembrane) {
      const membrane = spawnMembrane(arena, brick);
      attachMembrane(membrane, arena, (u, v) => this.world.localToWorld(u, v, arena));
      this.audio.play(SOUNDS.membraneSpawned);
    }
    // Charged crystal cascades into adjacent crystal. A lattice-aligned claim
    // therefore pays off in a way a misaligned one cannot.
    if (definition.chains) {
      const cascade = collectCascade(arena, brick);
      for (const affected of cascade) {
        affected.hp--;
        affected.hitFlash = 0.16;
        this.shardsAtBrick(affected, materialOf(affected.kind).edge, 8);
        if (affected.hp > 0) continue;
        affected.alive = false;
        affected.display?.destroy({ children: true });
        this.world.removeFootprint(affected.footprint, false, affected.persistent);
        if (affected.resource) spawnDrop(arena, affected.u, affected.v, affected.resource);
      }
      if (cascade.length) {
        this.ringAtBrick(brick, PALETTE.facetHot, 1.4);
        this.showToast(`LATTICE CASCADE · ${cascade.length}`);
        this.audio.play(SOUNDS.cascade);
      }
    }
    void ball;
  }

  /** Shards at a brick. Arena-local `u,v` is the only thing Effects cannot know. */
  private shardsAtBrick(brick: Brick, colour: number, count: number): void {
    const arena = this.arena;
    if (!arena) return;
    const point = this.world.localToWorld(brick.u, brick.v, arena);
    this.effects.spawnShards(point.x * CELL, point.y * CELL, colour, count);
  }

  private ringAtBrick(brick: Brick, colour: number, strength: number): void {
    const arena = this.arena;
    if (!arena) return;
    const point = this.world.localToWorld(brick.u, brick.v, arena);
    this.effects.spawnRing(point.x * CELL, point.y * CELL, colour, strength);
  }

  private registerMechanismStrike(brick: Brick): void {
    const site = this.world.generated.cornerstones
      .map((candidate) => ({ candidate, distance: Math.hypot(candidate.x - brick.x, candidate.y - brick.y) }))
      .sort((a, b) => a.distance - b.distance)[0];
    if (!site || site.distance > 14) return;
    const id = site.candidate.id;
    let struck = this.cornerstoneProgress.get(id);
    if (!struck) {
      struck = new Set<string>();
      this.cornerstoneProgress.set(id, struck);
    }
    const key = `${brick.x},${brick.y}`;
    if (struck.has(key)) return;
    struck.add(key);
    const target = CORNERSTONE_TARGETS[id] ?? 3;
    const verb = CORNERSTONE_VERBS[id];
    if (struck.size < target) {
      this.showToast(`${site.candidate.name} · ${struck.size}/${target}`);
      // Partial cornerstone progress is persistent by design, so it saves as soon
      // as it is made rather than waiting for the claim to resolve.
      this.requestSave();
      return;
    }
    if (verb && this.economy.grantVerb(verb)) {
      this.anchors.push({ id, x: site.candidate.x, y: site.candidate.y, name: `${site.candidate.name} ANCHOR` });
      this.showToast(`${VERB_NAMES[verb]} ACQUIRED`);
      this.audio.play(SOUNDS.verbAcquired);
      this.requestSave();
      this.updateUI();
    }
  }

  private finishArena(reason: "lost" | "clear"): void {
    const arena = this.arena;
    if (!arena || arena.resolving) return;
    arena.resolving = true;
    const remaining = arena.bricks.filter((brick) => brick.alive && brick.liable);
    arena.damageTaken = calculateClaimDamage(remaining.length, this.soakCapacity);
    this.integrity = Math.max(0, this.integrity - arena.damageTaken);
    this.dying = this.integrity <= 0;
    for (const brick of remaining) brick.hitFlash = 0.34;
    this.world.exhaustFrame(arena);
    if (reason === "clear") {
      this.showToast(`CLAIM CLEARED · ${arena.collected} SECURED`);
    } else if (arena.damageTaken > 0) {
      this.showToast(`ARMOR BREACHED · ${arena.damageTaken} HEALTH LOST`);
      this.audio.play(SOUNDS.armorBreached);
      const paddlePoint = this.world.localToWorld(arena.paddle.u, 0.2, arena);
      this.effects.spawnRing(paddlePoint.x * CELL, paddlePoint.y * CELL, PALETTE.danger, 1.7);
    } else {
      this.showToast(`ARMOR HELD · ${remaining.length}/${this.soakCapacity}`);
    }
    // A resolved claim is the single most expensive thing to lose: it consumed
    // excavation, cargo and health at once.
    this.requestSave();
    this.updateUI();
    const focus = this.dying
      ? { x: this.world.start.x * CELL, y: this.world.start.y * CELL }
      : { x: this.player.x, y: this.player.y };
    window.setTimeout(() => this.camera.begin(focus, 0, true), arena.damageTaken > 0 ? 680 : 360);
  }

  private completeArenaExit(): void {
    this.arena?.container.destroy({ children: true });
    this.arena = null;
    this.mode = "survey";
    this.camera.rotation = 0;
    this.drone.visible = true;
    if (this.dying) this.die();
    this.framePreview.visible = true;
    this.renderFramePreview();
    this.updateUI();
  }

  private update(dt: number): void {
    this.time += dt;
    if (this.arena) this.arena.visualAge += dt;
    // Real seconds, not frames: the ghost pulse has to breathe at the same rate on a 30fps
    // machine as on a 144fps one.
    this.gantry.update(dt);
    if (!this.started) {
      // Only the selected and hovered cards run, so three WebGL contexts do not
      // compete for the frame while the player is still choosing.
      const active = new Set<number>();
      if (this.selectedChassisIndex !== null) active.add(this.selectedChassisIndex);
      if (this.hoveredChassisIndex !== null) active.add(this.hoveredChassisIndex);
      this.deploymentPreviews.update(Math.min(0.025, dt), active, this.chassisRoster);
    }
    if (this.started) {
      this.elapsed += dt;
      this.saveTimer -= dt;
      if (this.saveTimer <= 0) this.saveNow();
    }
    if (this.started && !this.craftingOpen && !this.atlasOpen) {
      if (this.mode === "survey") this.updateSurvey(dt);
      if (this.mode === "play") this.updatePlay(dt);
    }
    // Terrain residency follows the camera and is amortized across frames.
    this.terrain.requestAround(this.cameraFocus.x, this.cameraFocus.y);
    this.terrain.pump(1);
    this.effects.update(Math.min(0.033, dt));
    updateFeatureMarks(this.featureMarks, this.time);
    // Chasing is suppressed inside an arena: the camera is pinned to the board.
    const finished = this.camera.update(dt, this.arena ? null : { x: this.player.x, y: this.player.y });
    if (finished) {
      if (finished.exit) this.completeArenaExit();
      else this.showToast("LOCAL PLAYFIELD STABILIZED");
      this.updateUI();
    }
    this.camera.applyTo(this.worldRoot);
    this.updateDisplays(dt);
  }

  private updateSurvey(dt: number): void {
    // Arrows mirror WASD out here. Inside a claim the horizontal pair moves the paddle and the
    // vertical pair drives the simulation speed, so the mirroring is deliberately mode-local.
    const held = (...codes: string[]) => codes.some((code) => this.keys.has(code));
    // Movement and aiming are gated separately rather than behind one early return: they are two
    // steps of the sequence, and one being locked must never silently disable the other.
    const canMove = this.can("move");
    const dx = canMove ? (held("KeyD", "ArrowRight") ? 1 : 0) - (held("KeyA", "ArrowLeft") ? 1 : 0) : 0;
    const dy = canMove ? (held("KeyS", "ArrowDown") ? 1 : 0) - (held("KeyW", "ArrowUp") ? 1 : 0) : 0;
    const length = Math.hypot(dx, dy) || 1;
    const movementDt = Math.min(0.033, dt);
    const vx = dx / length * this.travelSpeed * movementDt;
    const vy = dy / length * this.travelSpeed * movementDt;
    // Axes are resolved separately so the hull slides along a wall rather than
    // stopping dead against it.
    const heading = this.player.heading;
    // An already-intersecting pose has to stay mobile, or a save loaded into rock --
    // or a respawn against a wall -- would be unrecoverable.
    const stuck = !this.hullFits(this.player.x, this.player.y, heading);
    if (stuck || this.hullFits(this.player.x + vx, this.player.y, heading)) this.player.x += vx;
    if (stuck || this.hullFits(this.player.x, this.player.y + vy, heading)) this.player.y += vy;

    const rotation = this.can("aim")
      ? (this.keys.has("KeyE") ? 1 : 0) - (this.keys.has("KeyQ") ? 1 : 0)
      : 0;
    if (rotation) {
      // Rotation is refused when it would drive the hull into rock. Always safe to
      // refuse: the pose the drone arrived in is by definition clear, so turning
      // back the way it came is always available.
      const turned = normalizeAngle(heading + rotation * this.rotationSpeed * dt);
      if (stuck || this.hullFits(this.player.x, this.player.y, turned)) this.player.heading = turned;
    }
    if (dx || dy) this.markTutorial("move");
    if (rotation) this.markTutorial("aim");
    // The map records where the drone has been, not what the generator produced.
    this.world.markDiscovered(this.player.x / CELL, this.player.y / CELL, DISCOVERY_RADIUS);
    this.tryBank();
    this.renderFramePreview();
  }

  private updatePlay(dt: number): void {
    const arena = this.arena;
    if (!arena || arena.resolving || this.cameraTransition) return;
    if (this.paused) return;
    if (this.resumeCountdown > 0) {
      this.resumeCountdown = Math.max(0, this.resumeCountdown - dt);
      // Nothing steps during the count. The accumulator is dropped rather than banked, so the
      // claim does not lurch forward by three seconds of physics the moment it unfreezes.
      this.physicsAccumulator = 0;
      return;
    }
    // Speeding the claim up runs *more fixed steps*, never larger ones: the solver's step size is
    // load-bearing for swept contacts, so scaling dt would change the physics rather than the
    // pace. The cap rises with the multiplier so a x8 frame is allowed to do x8 work.
    const rate = this.simulationRate;
    this.physicsAccumulator = Math.min(PHYSICS_STEP * 5 * rate, this.physicsAccumulator + dt * rate);
    while (this.physicsAccumulator >= PHYSICS_STEP) {
      this.stepArena(arena, PHYSICS_STEP);
      this.physicsAccumulator -= PHYSICS_STEP;
      if (arena.resolving) break;
    }
  }

  /**
   * How fast the claim runs, from the speed keys. Hold only, never latched.
   *
   * Hold rather than toggle so it can never be left on by accident: a claim served at x4 because
   * the player forgot they had pressed something is a loss they did not choose. Both together is
   * x8, which is why the individual keys have to be held too -- a latched x2 and a held x8 would
   * be two different interactions on the same keys.
   */
  private get simulationRate(): number {
    if (!this.can("speed") || this.paused) return 1;
    const up = this.keys.has("KeyW") || this.keys.has("ArrowUp");
    const down = this.keys.has("KeyS") || this.keys.has("ArrowDown");
    if (up && down) return 8;
    if (down) return 4;
    if (up) return 2;
    return 1;
  }

  private stepArena(arena: Arena, dt: number): void {
    if (this.simulationRate > 1) this.markTutorial("speed");
    const canPaddle = this.can("paddle");
    const input = canPaddle
      ? (this.keys.has("KeyD") || this.keys.has("ArrowRight") ? 1 : 0) - (this.keys.has("KeyA") || this.keys.has("ArrowLeft") ? 1 : 0)
      : 0;
    arena.paddle.velocity = input * this.paddleSpeed;
    if (input) this.markTutorial("paddle");
    arena.paddle.u += arena.paddle.velocity * dt;
    arena.paddle.flash = Math.max(0, arena.paddle.flash - dt);
    arena.paddle.impact *= Math.pow(0.0005, dt);
    const limit = arena.width / 2 - arena.paddle.width / 2;
    if (arena.paddle.u < -limit) { arena.paddle.u = -limit; arena.paddle.velocity = Math.max(0, arena.paddle.velocity); }
    if (arena.paddle.u > limit) { arena.paddle.u = limit; arena.paddle.velocity = Math.min(0, arena.paddle.velocity); }
    for (const brick of arena.bricks) brick.hitFlash = Math.max(0, brick.hitFlash - dt);

    if (!arena.balls.some((ball) => ball.served)) {
      const aim = this.can("arenaAim")
        ? (this.keys.has("KeyE") ? 1 : 0) - (this.keys.has("KeyQ") ? 1 : 0)
        : 0;
      if (aim) this.markTutorial("arenaAim");
      arena.serveAim = clamp(arena.serveAim + aim * 1.45 * dt, -0.72, 0.72);
      for (const ball of arena.balls) ball.u = arena.paddle.u;
      return;
    }

    for (const ball of [...arena.balls]) {
      stepBall(ball, arena, dt, (events) => this.handleBallEvents(ball, events));
      const point = this.world.localToWorld(ball.u, ball.v, arena);
      ball.trail.unshift({ x: point.x * CELL, y: point.y * CELL });
      if (ball.trail.length > 13) ball.trail.pop();
    }

    // Bounded province rules.
    for (const revived of stepRegrowth(arena, dt)) {
      revived.display?.destroy({ children: true });
      const regrown = createBrickDisplay(revived);
      revived.display = regrown.container;
      revived.damageDisplay = regrown.damage;
      const position = this.world.localToWorld(revived.u, revived.v, arena);
      regrown.container.position.set(position.x * CELL, position.y * CELL);
      regrown.container.rotation = arena.angle;
      arena.board.addChild(regrown.container);
      this.world.restoreCell(revived.x, revived.y, revived.kind);
      this.audio.play(SOUNDS.regrowth);
    }
    for (const expired of stepMembranes(arena, dt)) expired.display?.destroy();

    for (let index = arena.balls.length - 1; index >= 0; index--) {
      const ball = arena.balls[index];
      if (ball.v >= -0.72) continue;
      ball.display?.destroy({ children: true });
      ball.trailDisplay?.destroy();
      arena.balls.splice(index, 1);
      this.audio.play(SOUNDS.ballLost);
    }

    if (!arena.balls.length) {
      // Sequential balls, from the Twin Engine. A spare is a fresh serve, not a
      // second simultaneous ball.
      if (arena.spareBalls > 0) {
        arena.spareBalls--;
        const replacement = createBall(arena.paddle.u);
        arena.balls.push(replacement);
        attachBall(replacement, arena);
        arena.serveAim = 0.08;
        this.showToast(`SEQUENTIAL BALL · ${arena.spareBalls} REMAINING`);
        this.audio.play(SOUNDS.sequentialBall);
        return;
      }
      this.finishArena("lost");
      return;
    }

    if (this.hasSalvageDrone) this.salvage.update(dt, arena, arena.paddle.u);
    for (let index = arena.drops.length - 1; index >= 0; index--) {
      const drop = arena.drops[index];
      drop.v += drop.vv * dt;
      drop.vv -= 1.4 * dt;
      drop.spin += dt * 5;
      if (drop.v < 0.45) {
        const caught = Math.abs(drop.u - arena.paddle.u) < arena.paddle.width / 2 + 0.35;
        if (caught) {
          arena.collected++;
          this.economy.add(drop.resource, 1);
          this.audio.play(collectSound(arena.collected));
        } else if (this.hasSalvageDrone) {
          // The drone gets everything the paddle missed, and takes its cut in the open where the
          // player can watch it happen. The ore either survives the grinder whole or it does not,
          // so the tax is a piece count rather than a fraction the inventory would have to hold.
          const eaten = this.salvage.grindsThis();
          this.salvage.caught(drop, eaten);
          if (!eaten) {
            arena.collected++;
            this.economy.add(drop.resource, 1);
            this.audio.play(collectSound(arena.collected));
          } else {
            this.audio.play(SOUNDS.salvageGrind);
          }
        }
        drop.display.destroy();
        arena.drops.splice(index, 1);
      }
    }
    if (!arena.bricks.some((brick) => brick.alive && !brick.persistent)) this.finishArena("clear");
  }

  /** Fit the salvage drone to the claim just framed, or hide it if none is fitted. */
  private armSalvage(arena: Arena): void {
    this.salvage.configure(this.salvageTax);
    this.salvage.reset(arena.paddle.u);
    if (this.hasSalvageDrone) arena.actors.addChild(this.salvage.container);
  }

  private updateDisplays(dt: number): void {
    this.drone.position.set(this.player.x, this.player.y);
    this.drone.rotation = this.player.heading;
    this.drone.visible = !this.arena;
    const arena = this.arena;
    if (arena) {
      for (const brick of arena.bricks) if (brick.alive && brick.display) {
        const flash = brick.hitFlash / 0.14;
        const reveal = smooth(clamp((arena.visualAge - 0.05 - brick.v * 0.018) / 0.32, 0, 1));
        brick.display.alpha = reveal;
        brick.display.scale.set((0.72 + reveal * 0.28) * (1 + flash * 0.07), (0.72 + reveal * 0.28) * (1 - flash * 0.05));
        if (brick.damageDisplay) brick.damageDisplay.alpha = brick.hp < brick.maxHp ? 0.82 : 0;
      }
      for (const membrane of arena.membranes) {
        if (!membrane.display) continue;
        membrane.display.alpha = Number.isFinite(membrane.maxLife)
          ? clamp(membrane.life / membrane.maxLife, 0, 1) * 0.9 + 0.1
          : 1;
      }
      if (arena.paddle.display) {
        const position = this.world.localToWorld(arena.paddle.u, 0.2, arena);
        arena.paddle.display.position.set(position.x * CELL, position.y * CELL);
        arena.paddle.display.rotation = arena.angle;
        arena.paddle.display.skew.x = arena.paddle.impact * -0.05;
      }
      const toWorld = (u: number, v: number) => this.world.localToWorld(u, v, arena);
      drawTrajectory(arena, toWorld, this.predictedBounces);
      drawLiabilityGauge(arena, toWorld, this.soakCapacity);
      for (const ball of arena.balls) {
        const position = this.world.localToWorld(ball.u, ball.v, arena);
        ball.display?.position.set(position.x * CELL, position.y * CELL);
        if (ball.trailDisplay) {
          ball.trailDisplay.clear();
          const colour = PROVINCE_PALETTE[arena.province].accent;
          for (let index = ball.trail.length - 1; index > 0; index--) {
            const from = ball.trail[index];
            const to = ball.trail[index - 1];
            const progress = 1 - index / ball.trail.length;
            ball.trailDisplay.moveTo(from.x, from.y).lineTo(to.x, to.y).stroke({
              width: 1.2 + progress * 3.2, color: colour, alpha: 0.06 + progress * 0.34,
            });
          }
        }
      }
      for (const drop of arena.drops) {
        const position = this.world.localToWorld(drop.u, drop.v, arena);
        drop.display.position.set(position.x * CELL, position.y * CELL);
        drop.display.rotation = drop.spin;
      }
      // The bucket rides in the claim's own frame, so it stays under the paddle at any claim
      // angle rather than under a screen-space idea of "below".
      if (this.hasSalvageDrone) {
        const seat = this.salvage.position;
        const at = this.world.localToWorld(seat.u, seat.v, arena);
        this.salvage.container.position.set(at.x * CELL, at.y * CELL);
        this.salvage.container.rotation = arena.angle;
      }
    }

    this.tickHudTimers(dt);
    this.hud.render(this.buildHudModel());
  }

  /**
   * HUD timers: how long a card, a compass or the tutorial panel stays up.
   *
   * Counted in real seconds, clamped per frame. These were previously advanced by a
   * fixed 1/60 per call, which made every message *frame*-paced rather than
   * time-paced: on a machine rendering at 15fps a 1.4-second fade took nearly six
   * seconds. The clamp keeps a single long frame -- a chunk build, a tab regaining
   * focus -- from skipping a message the player has not read yet.
   */
  private tickHudTimers(dt: number): void {
    const step = Math.min(dt, 1 / 20);
    const reading = this.world.readRegion(this.player.x / CELL, this.player.y / CELL);
    // Crossing into a new region teaches its rule once and refreshes the goal.
    if (reading.regionName !== this.lastRegionName) {
      this.lastRegionName = reading.regionName;
      if (this.started && !this.arena) this.showArrival(reading);
      this.updateUI();
    }
    this.advanceTutorial(step);
    if (this.tutorialNudge > 0) {
      this.tutorialNudge = Math.max(0, this.tutorialNudge - step);
      this.hud.setTutorialNudge(this.tutorialNudge > 0);
    }
    if (this.tutorialFadeTimer > 0) {
      this.tutorialFadeTimer = Math.max(0, this.tutorialFadeTimer - step);
      if (this.tutorialFadeTimer === 0) {
        this.tutorialComplete = true;
        this.hud.removeTutorial();
        this.updateUI();
      }
    }
    if (this.compassTimer > 0) {
      this.compassTimer = Math.max(0, this.compassTimer - step);
      this.updateCompass();
    }
    if (this.arrivalTimer > 0) {
      this.arrivalTimer = Math.max(0, this.arrivalTimer - step);
      if (this.arrivalTimer === 0) this.hud.hideArrival();
    }
  }

  /** Assemble everything the HUD shows. The HUD never reads game state itself. */
  private buildHudModel(): HudModel {
    const arena = this.arena;
    const reading = this.world.readRegion(this.player.x / CELL, this.player.y / CELL);
    const remaining = arena?.bricks.filter((brick) => brick.alive && brick.liable).length ?? 0;
    const cornerstone = arena
      ? null
      : this.world.nearestCornerstone(this.player.x / CELL, this.player.y / CELL);
    const showResonance = this.economy.verbs.has("surveyResonance") && this.mode === "survey";
    const grades = this.moduleUpgrades.resonanceGrades;
    return {
      mode: this.craftingOpen ? "forge" : this.mode,
      inArena: !!arena,
      region: { name: reading.regionName, band: reading.band, depthMetres: reading.depthMetres },
      remainingLoad: remaining,
      projectedDamage: calculateClaimDamage(remaining, this.soakCapacity),
      integrity: this.integrity,
      maxIntegrity: this.maxIntegrity,
      soakCapacity: this.soakCapacity,
      liveBalls: arena?.balls.length ?? 0,
      spareBalls: arena?.spareBalls ?? 0,
      cargo: [...this.economy.resources.entries()],
      cargoAtRisk: this.economy.carriedTotal > 0,
      resonance: showResonance
        ? {
          density: gradeOf(reading.dials.density, grades),
          volatility: gradeOf(reading.dials.volatility, grades),
          yield: gradeOf(reading.dials.yield, grades),
        }
        : null,
      nearestCornerstone: cornerstone
        ? { name: cornerstone.name, distanceMetres: cornerstone.distance * 14 }
        : null,
      hints: this.hintText(),
      objective: objectiveFor(this.economy),
    };
  }

  /**
   * Contextual key prompts.
   *
   * Hints are scaffolding: each set disappears once the player has done the thing it
   * describes. While the tutorial panel is up it *is* the controls display, so the
   * strip carries only genuinely contextual prompts.
   */
  private hintText(): string {
    if (!this.tutorialComplete) {
      return this.atAnchor() && this.mode === "survey" ? "<b>C</b> forge" : "";
    }
    if (this.craftingOpen) return "<b>1-9</b> forge <b>ESC</b> close";
    if (this.mode === "survey") {
      return [
        this.hasCommitted ? "" : "<b>WASD</b> move <b>Q / E</b> aim <b>F</b> commit",
        this.atAnchor() ? "<b>C</b> forge" : "",
        "<b>M</b> atlas",
      ].filter(Boolean).join(" ");
    }
    return [
      this.hasServed ? "" : "<b>A / D</b> paddle <b>Q / E</b> aim <b>SPACE</b> serve",
      this.economy.verbs.has("railSeed") && !this.railSeedUsed ? "<b>R</b> rail" : "",
      this.economy.blastCharges > 0 ? `<b>B</b> blast ×${this.economy.blastCharges}` : "",
    ].filter(Boolean).join(" ");
  }

  /** Check off a control the player has just used. */
  private markTutorial(id: TutorialStep["id"]): void {
    if (this.tutorialComplete) return;
    const step = this.tutorial.find((entry) => entry.id === id);
    // Only the step being asked for can be completed. Without this an early press of a key that
    // happens to be bound elsewhere would tick a rung the player has not been shown yet, and the
    // sequence would skip ahead of its own teaching.
    if (!step || step.done || this.currentStep?.id !== id) return;
    step.done = true;
    this.tutorialShownFor = 0;
    this.renderTutorial();
    this.audio.play(SOUNDS.tutorialStep);
    if (this.tutorial.every((entry) => entry.done)) {
      this.tutorialFadeTimer = 1.4;
      this.hud.markTutorialComplete();
    }
  }

  /**
   * Advance the sequence's own clock.
   *
   * Two jobs. An optional step is shown for a few seconds and then ticked off by itself, because
   * the speed controls are worth knowing and not worth blocking on. And a step whose mode the
   * player is not in gets no credit for waiting -- the timer only runs while the step is
   * actually performable, so "hold to speed up" is not quietly dismissed out in the mine.
   */
  private advanceTutorial(dt: number): void {
    const step = this.currentStep;
    if (!step) return;
    const performable = step.where === (this.arena ? "play" : "survey");
    if (!performable) {
      // An optional step whose moment has passed is dismissed rather than left to block the
      // sequence: the speed controls are only demonstrable inside a claim, and a player whose
      // first claim ended quickly should not be stuck being offered them out in the mine.
      if (step.optional && this.tutorialShownFor > 0) {
        step.done = true;
        this.tutorialShownFor = 0;
        this.renderTutorial();
        if (this.tutorial.every((entry) => entry.done)) {
          this.tutorialFadeTimer = 1.4;
          this.hud.markTutorialComplete();
        }
      }
      return;
    }
    this.tutorialShownFor += dt;
    if (step.optional && this.tutorialShownFor > 4.5) {
      step.done = true;
      this.tutorialShownFor = 0;
      this.renderTutorial();
      if (this.tutorial.every((entry) => entry.done)) {
        this.tutorialFadeTimer = 1.4;
        this.hud.markTutorialComplete();
      }
    }
  }

  /**
   * Cargo becomes safe on reaching the bank. Deposit is automatic because there
   * is never a reason to refuse it -- the tension is getting home, not the keypress.
   */
  private tryBank(): void {
    const distance = Math.hypot(BANK.x - this.player.x / CELL, BANK.y - this.player.y / CELL);
    if (distance > 4.5) {
      // Released once the drone is clear of the bank, which is what makes the latch below mean
      // "once per arrival" rather than "once per session".
      this.arrivedAtBank = false;
      return;
    }
    // Coming home services the machine: the rack fills and the hull is repaired, whether or not
    // there was anything to bank.
    //
    // This replaced the Hull Patch recipe, which was the only entry in the old list that was a
    // consumable service rather than a part of the machine -- and pricing it made repair a sum
    // the player had to do before every descent. Free on docking is also what the forgiving
    // expedition model already implies: death costs the hold and the walk back, never capability.
    this.economy.refillCharges(this.chassis.id);
    const wounded = this.maxIntegrity - this.integrity;
    if (wounded > 0) {
      this.integrity = this.maxIntegrity;
      this.showToast(`HULL REPAIRED · +${wounded}`);
    }
    if (this.economy.carriedTotal <= 0) return;
    const stored = this.economy.deposit();
    // The bay presents itself on arrival with a haul, because that is the moment the player is
    // asking what it bought. Opening it here rather than waiting to be asked is the difference
    // between a menu you remember to visit and a beat in the loop. Once per arrival: `arrived`
    // latches until the drone leaves the bank again.
    if (!this.arrivedAtBank && !this.craftingOpen && this.mode === "survey") {
      this.arrivedAtBank = true;
      this.toggleCrafting();
    }
    this.showToast(`${stored} BANKED`);
    this.audio.play(SOUNDS.banked);
    this.hud.showBankNotice(stored);
    this.requestSave();
    this.updateUI();
  }

  /**
   * Death costs the hold and the walk back, never banked material or crafted
   * capacity. That is the forgiving-expedition model the economy assumes.
   */
  private die(): void {
    this.deaths++;
    const lost = this.economy.loseCarried();
    this.player.x = this.world.start.x * CELL;
    this.player.y = this.world.start.y * CELL;
    this.player.heading = Math.PI / 2;
    this.cameraFocus = { x: this.player.x, y: this.player.y };
    this.integrity = this.maxIntegrity;
    this.dying = false;
    this.showToast(lost > 0 ? `DRONE LOST · ${lost} CARGO GONE` : "DRONE LOST");
    this.audio.play(SOUNDS.droneLost);
    this.terrain.requestAround(this.player.x, this.player.y);
    this.requestSave();
    this.updateUI();
  }

  // --- Persistence --------------------------------------------------------

  /**
   * Everything the expedition is, minus the geology.
   *
   * Terrain is deliberately absent: it is a pure function of the seed plus the
   * world's mutation log, both of which are here. That keeps a save file small
   * enough to read and hand-edit, and makes an import verifiable.
   */
  snapshot(): SaveData {
    return {
      version: SAVE_VERSION,
      savedAt: Date.now(),
      seedLabel: this.world.seedLabel,
      elapsed: this.elapsed,
      world: {
        history: this.world.history,
        discovered: packDiscovered(this.world.discovered),
      },
      player: { x: this.player.x, y: this.player.y, heading: this.player.heading },
      economy: this.economy.snapshot(),
      chassisIndex: this.chassisIndex,
      chassisIntegrity: Object.fromEntries(this.chassisIntegrity),
      cornerstoneProgress: Object.fromEntries([...this.cornerstoneProgress].map(([id, struck]) => [id, [...struck]])),
      anchors: this.anchors.map((anchor) => ({ ...anchor })),
      annotations: this.annotations.map((note) => ({ ...note })),
      progress: {
        deaths: this.deaths,
        tutorialComplete: this.tutorialComplete,
        tutorialDone: this.tutorial.filter((step) => step.done).map((step) => step.id),
        regionsSeen: [...this.regionsSeen],
        hasCommitted: this.hasCommitted,
        hasServed: this.hasServed,
      },
    };
  }

  /** Save on the next frame. Cheap to call from anywhere, including hot paths. */
  requestSave(): void {
    this.saveTimer = 0;
  }

  saveNow(): boolean {
    if (!this.started) return false;
    this.saveTimer = AUTOSAVE_SECONDS;
    const result = writeSave(this.snapshot());
    if (!result.ok) {
      this.hud.flashSave(`SAVE FAILED · ${result.reason ?? "UNKNOWN"}`, true);
      return false;
    }
    this.hud.flashSave("SAVED");
    return true;
  }

  /**
   * Apply a validated save over the live game.
   *
   * The seed decides the geology, so a save whose seed differs from the world this
   * instance generated cannot be applied in place; the caller reloads with the
   * saved seed instead. Everything else is overwritten wholesale rather than
   * merged, because a half-applied save is worse than a refused one.
   */
  applySave(data: SaveData): boolean {
    if (data.seedLabel !== this.world.seedLabel) return false;

    this.world.history.length = 0;
    this.world.cuts.length = 0;
    this.world.applyHistory(data.world.history);
    this.world.discoveredCount = unpackDiscovered(data.world.discovered, this.world.discovered);
    // Excavation replayed above never reached the already-rasterized chunks, so
    // the whole terrain is rebuilt from current world state.
    this.terrain.reset();

    this.economy.restore(data.economy);
    this.chassisRoster = this.economy.availableChassis(PADDLE_CHASSIS);
    this.chassisIndex = Math.min(Math.max(0, data.chassisIndex), this.chassisRoster.length - 1);
    this.selectedChassisIndex = this.chassisIndex;

    this.chassisIntegrity.clear();
    for (const chassis of this.chassisRoster) this.chassisIntegrity.set(chassis.id, chassis.maxHealth);
    for (const [id, value] of Object.entries(data.chassisIntegrity)) {
      if (typeof value === "number") this.chassisIntegrity.set(id, value);
    }

    this.cornerstoneProgress.clear();
    for (const [id, struck] of Object.entries(data.cornerstoneProgress)) {
      this.cornerstoneProgress.set(id, new Set(struck));
    }

    // Anchor zero is rebuilt from the world rather than trusted from the file, so
    // a save can never leave the player without a forge to return to.
    this.anchors.length = 0;
    this.anchors.push({ id: "refitBay", x: this.world.start.x, y: this.world.start.y, name: "REFIT BAY" });
    for (const anchor of data.anchors) {
      if (anchor.id === "refitBay") continue;
      this.anchors.push({ ...anchor });
    }

    this.annotations = data.annotations.map((note) => ({ ...note }));
    // So a marker placed after loading cannot reuse a restored marker's id.
    this.atlasView.seedSequence(this.annotations.length);

    this.player.x = data.player.x;
    this.player.y = data.player.y;
    this.player.heading = data.player.heading;
    this.cameraFocus = { x: this.player.x, y: this.player.y };
    this.elapsed = data.elapsed;
    this.deaths = data.progress.deaths;
    // A save means this player has already been taught. Restoring a half-finished sequence left
    // the prompt asking for a control the player had used a hundred times, against a gate that
    // refused everything the old save had not happened to record -- so loading is always
    // "tutorial over", and every control is unlocked.
    this.tutorialComplete = true;
    for (const step of this.tutorial) step.done = true;
    this.hud.removeTutorial();
    this.regionsSeen.clear();
    for (const region of data.progress.regionsSeen) this.regionsSeen.add(region);
    this.hasCommitted = data.progress.hasCommitted;
    this.hasServed = data.progress.hasServed;

    this.drone.destroy({ children: true });
    this.drone = createDrone(this.paddleWidth, this.economy.stationGrades(this.chassis.id));
    this.actorLayer.addChild(this.drone);
    this.terrain.requestAround(this.player.x, this.player.y);
    this.terrain.pump(24);
    this.saveTimer = AUTOSAVE_SECONDS;
    return true;
  }

  private continueExpedition(): void {
    const stored = readSave();
    if (!stored.ok || !stored.data) {
      this.hud.flashSave(stored.reason ?? "COULD NOT LOAD", true);
      return;
    }
    this.resumeFrom(stored.data);
  }

  /**
   * Bring a save into play. A save from a different seed cannot be replayed over
   * this world, so it is handed back to the loader through the URL, which is the
   * one place a different seed can be honoured before generation happens.
   */
  private resumeFrom(data: SaveData): void {
    if (data.seedLabel !== this.world.seedLabel) {
      writeSave(data);
      const url = new URL(window.location.href);
      url.searchParams.set("seed", data.seedLabel);
      window.location.replace(url.toString());
      return;
    }
    if (!this.applySave(data)) {
      this.hud.flashSave("COULD NOT APPLY SAVE", true);
      return;
    }
    if (this.started) {
      this.showToast("EXPEDITION RESTORED");
      this.updateUI();
      return;
    }
    this.selectChassis(this.chassisIndex);
    this.start();
    this.showToast("EXPEDITION RESTORED");
  }

  private async importExpedition(): Promise<void> {
    const result = await importSave();
    if (!result) return;
    if (!result.ok || !result.data) {
      this.hud.flashSave(result.reason ?? "IMPORT FAILED", true);
      return;
    }
    this.resumeFrom(result.data);
    this.expeditionView.refresh();
  }

  private exportExpedition(): void {
    exportSave(this.snapshot());
    this.hud.flashSave("SAVE EXPORTED");
  }

  /**
   * Discard the stored expedition. Destructive and irreversible, so it confirms,
   * and it points at export first: a player who wants a fresh world usually still
   * wants the old one on disk.
   */
  private abandonExpedition(): void {
    const stored = readSave();
    if (stored.ok && stored.data) {
      const proceed = window.confirm(
        "Delete the saved expedition and start a new one?\n\nThis cannot be undone. Cancel and use EXPORT SAVE first if you want to keep it.",
      );
      if (!proceed) return;
    }
    clearSave();
    this.expeditionView.refresh();
  }

  // --- Atlas --------------------------------------------------------------

  toggleAtlas(): void {
    this.atlasOpen = !this.atlasOpen;
    if (this.atlasOpen) {
      this.markTutorial("atlas");
      // The keys were held when the map opened; dropping them stops the drone
      // drifting behind the map while the player reads it.
      this.keys.clear();
    }
    this.atlasView.setOpen(this.atlasOpen);
    this.updateUI();
  }

  // --- AtlasHost ----------------------------------------------------------

  atlasPlayer(): { x: number; y: number; heading: number } {
    return { x: this.player.x / CELL, y: this.player.y / CELL, heading: this.player.heading };
  }

  onAnnotationsChanged(): void {
    this.requestSave();
  }

  private bindInterfaceUI(): void {
    this.atlasView.bind();
    this.expeditionView.bind({
      onContinue: () => this.continueExpedition(),
      onImport: () => void this.importExpedition(),
      onAbandon: () => this.abandonExpedition(),
      onExport: () => this.exportExpedition(),
      onSelectChassis: (index) => this.selectChassis(index),
      onHoverChassis: (index) => { this.hoveredChassisIndex = index; },
      // Guarded: leaving one card while entering another must not clear the hover
      // the new card has already set.
      onUnhoverChassis: (index) => {
        if (this.hoveredChassisIndex === index) this.hoveredChassisIndex = null;
      },
      onDeploy: () => this.start(),
    });
    // A save on the way out costs nothing and covers a closed tab or a refresh.
    window.addEventListener("beforeunload", () => {
      if (this.started) writeSave(this.snapshot());
    });
    this.expeditionView.refresh();
  }

  /** Cornerstones appear on the map only once the player has been near them. */
  atlasSites(): AtlasSite[] {
    const sites: AtlasSite[] = [];
    for (const anchor of this.anchors) {
      sites.push({
        x: anchor.x,
        y: anchor.y,
        name: anchor.name,
        kind: anchor.id === "refitBay" ? "landing" : "anchor",
      });
    }
    for (const site of this.world.generated.cornerstones) {
      if (this.anchors.some((anchor) => anchor.id === site.id)) continue;
      if (!this.world.isDiscovered(site.x, site.y)) continue;
      sites.push({ x: site.x, y: site.y, name: site.name, kind: "cornerstone" });
    }
    return sites;
  }

  /**
   * Pin the compass to the viewport edge along the bearing to the nearest anchor.
   * The arrow sits where the target would leave the screen, so it reads as a
   * direction to travel rather than a floating marker.
   */
  /**
   * Province rules stated once, on arrival, in mechanical terms. A rule the player
   * must re-read every frame is a rule the HUD has failed to teach.
   */
  private showArrival(reading: ReturnType<WorldModel["readRegion"]>): void {
    const key = reading.ecotone ?? reading.province;
    if (this.regionsSeen.has(key)) return;
    this.regionsSeen.add(key);
    this.hud.showArrival(reading.regionName, REGION_RULES[key] ?? "");
    this.arrivalTimer = 4.2;
    this.audio.play(SOUNDS.arrival);
  }

  /**
   * Cargo is the reward readout. An empty hold shows nothing at all rather than
   * the words "NO CARGO", and a gain pulses so the catch registers without a toast.
   */
  /**
   * Survey Resonance. Shows coarse grades for the three dials and never the
   * contents -- direction is discoverable, contents are a wager.
   */
  private exposeDebug(): void {
    const game = this;
    (window as unknown as { __OREKENOID__: unknown }).__OREKENOID__ = {
      game,
      world: this.world,
      economy: this.economy,
      terrain: this.terrain,
      get state() {
        const remaining = game.arena?.bricks.filter((brick) => brick.alive && brick.liable).length ?? 0;
        return {
          mode: game.mode, arena: game.arena, player: game.player, chassis: game.chassis,
          integrity: game.integrity, maxIntegrity: game.maxIntegrity, soakCapacity: game.soakCapacity,
          projectedDamage: calculateClaimDamage(remaining, game.soakCapacity),
          verbs: [...game.economy.verbs], resources: Object.fromEntries(game.economy.resources),
          craftingOpen: game.craftingOpen, cameraTransition: game.cameraTransition,
          region: game.world.readRegion(game.player.x / CELL, game.player.y / CELL),
          chunks: game.terrain.chunkCount, report: game.world.generated.report,
        };
      },
      warpTo(x: number, y: number) {
        game.player.x = x * CELL;
        game.player.y = y * CELL;
        game.cameraFocus = { x: game.player.x, y: game.player.y };
        game.terrain.requestAround(game.player.x, game.player.y);
        game.terrain.pump(30);
        game.renderFramePreview();
        game.updateUI();
      },
      grantVerb(verb: VerbId) {
        game.economy.grantVerb(verb);
        game.updateUI();
      },
      giveResource(resource: ResourceId, count: number) {
        game.economy.add(resource, count);
        game.updateUI();
      },
      bankAll() {
        const stored = game.economy.deposit();
        game.updateUI();
        return stored;
      },
      /** Raise a station, or every station, without paying. For inspecting the machine. */
      fitStation(station: StationId, times = 1) {
        for (let step = 0; step < times; step++) {
          const grades = game.economy.stationGrades(game.chassis.id);
          const ladder = STATIONS_BY_ID.get(station)!.grades.length;
          if ((grades[station] ?? 0) >= ladder) break;
          game.economy.restore({
            ...game.economy.snapshot(),
            grades: {
              ...game.economy.snapshot().grades,
              [game.chassis.id]: { ...grades, [station]: (grades[station] ?? 0) + 1 },
            },
          });
        }
        game.rebuildDrone();
        game.updateUI();
        return game.economy.stationGrades(game.chassis.id);
      },
      /** The bay as the view sees it, so a test can assert the model rather than the pixels. */
      bayModel() {
        return { open: game.gantry.isOpen, ...game.gantryModel() };
      },
      /** Run a real fit, for inspecting the sequence without grinding for material. */
      fitNow(station: StationId) {
        game.upgradeStation(station);
      },
      /**
       * Stop the clock and pose the fit sequence at an exact time.
       *
       * Screenshots take longer than the sequence lasts, so sampling it against the wall clock
       * photographs the aftermath and calls it the middle. Stepping the animation by hand is the
       * only way to actually see frame 0.15 -- and it is the same reason the tuning constants are
       * gathered in one block: this is a thing that has to be inspected deliberately.
       */
      poseFit(station: StationId, seconds: number) {
        game.app.ticker.stop();
        if (!game.gantry.fitting) game.upgradeStation(station);
        const step = 1 / 240;
        for (let elapsed = 0; elapsed < seconds; elapsed += step) game.gantry.update(step);
        // The ticker is what drives the renderer, so stopping it also stops drawing: without this
        // an explicitly posed frame screenshots as whatever was on screen before the clock
        // stopped. Every posed capture was silently stale until this line existed.
        game.app.renderer.render(game.app.stage);
        return { at: seconds, ...game.gantry.fitDebug() };
      },
      resumeClock() {
        game.app.ticker.start();
      },
      selectStation(station: StationId) {
        game.forgeSelection = station;
        game.renderCrafting();
        return station;
      },
      fitEverything() {
        for (const station of STATION_IDS) {
          (this as { fitStation(id: StationId, times: number): unknown }).fitStation(station, 9);
        }
        return game.economy.stationGrades(game.chassis.id);
      },
      kill() {
        game.integrity = 0;
        game.die();
      },
      forceLoss() {
        if (!game.arena) return;
        game.arena.spareBalls = 0;
        for (const ball of game.arena.balls) { ball.served = true; ball.u = game.arena.width / 2 - 0.35; ball.v = -1; ball.vv = -9; }
      },
      materialAt(x: number, y: number): MaterialKind | undefined {
        return game.world.cellAt(x, y)?.kind;
      },
    };
  }
}

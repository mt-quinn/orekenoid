import {
  Application,
  BlurFilter,
  Container,
  Graphics,
} from "pixi.js";
import {
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
  type MaterialKind,
  type PaddleChassis,
  type ResourceId,
} from "./config";
import { calculateClaimDamage } from "./claims";
import { collectCascade, initialRegrowthBudget, spawnMembrane, stepMembranes, stepRegrowth } from "./arenaRules";
import { BLAST_CHARGE_BRICKS, Economy, FABRICATIONS, STATIONS_BY_ID, STATION_IDS, type StationId, type VerbId } from "./economy";
import { materialOf } from "./materials";
import { ballSpeed, createBall, stepBall, type BallStepEvents } from "./physics";
import { ChunkedTerrain } from "./terrain";
import { collectSound, GameAudio, SOUNDS } from "./audio";
import { Camera, boardZoom, surveyZoom, type CameraTransition } from "./camera";
import { Effects } from "./effects";
import { clamp, normalizeAngle } from "./maths";
import { attachBall, attachMembrane, createDrone, spawnDrop } from "./view/actors";
import { buildArenaDisplay, drawLiabilityGauge, drawTrajectory } from "./view/board";
import { createBrickDisplay, showDamage } from "./view/brick";
import { applyReaction, impulse, newReaction, stepReactions } from "./view/feedback";
import { buildFarGeology, buildLandmarks, drawFramePreview } from "./view/survey";
import { buildFeatureMarks, updateFeatureMarks, type FeatureMark } from "./view/features";
import { gradeOf, Hud, REGION_RULES, type HudModel } from "./hud";
import { objectiveFor } from "./objectives";
import { Gantry, type GantryModel } from "./view/gantry";
import { PauseView } from "./pauseView";
import { SalvageDrone } from "./view/salvage";
import { LoadStrike } from "./view/loadStrike";
import { Coach } from "./view/coach";
import { TouchControls } from "./view/touchControls";
import { effectBudget, measure as measureView, motionScale, syncLayout, view } from "./viewport";
import { TouchInput, type TouchState } from "./touch";
import { Holds } from "./holds";
import { ScreenAwake } from "./platform";
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
  /** The opening sequence's prompt, anchored in the world rather than pinned to a corner. */
  readonly coach = new Coach();
  /** Fingers. Answers the same questions the key set does, from a different device. */
  readonly touch = new TouchInput();
  /** And what they look like. Screen furniture: outside the camera, so it never rotates or scales. */
  readonly touchControls = new TouchControls();
  /** Holds the game when the world interrupts it: backgrounded, unfocused, sideways, muted. */
  readonly holds = new Holds();
  /** Stops the screen sleeping under a thumb that is holding still on purpose. */
  private readonly awake = new ScreenAwake();
  /**
   * This frame's touch intent, read once at the top of the frame and shared.
   *
   * Read once rather than per-consumer because `read` drains the accumulated turn: asking twice
   * would hand the rotation to whichever caller got there first and nothing to the other.
   */
  private touchState: TouchState = {
    moveX: 0, moveY: 0, turn: 0, paddle: null, stick: null, turning: null,
  };
  readonly frameWash = new Graphics();
  readonly frameGrid = new Graphics();
  readonly frameScan = new Graphics();
  readonly frameReturns = new Graphics();
  readonly keys = new Set<string>();
  readonly audio = new GameAudio();
  readonly hud = new Hud();
  readonly gantry = new Gantry();
  readonly salvage = new SalvageDrone();
  readonly loadStrike = new LoadStrike();
  /** The bright line of stress travelling ahead of the crumble. */
  private readonly crumbleEdge = new Graphics();
  readonly pauseView = new PauseView();
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
    { id: "move", keys: "WASD / ARROWS", gesture: "DRAG · LEFT HALF", demo: "stick", label: "FLY THE DRONE", why: "Rock worth cutting is everywhere down here.", where: "survey", done: false },
    { id: "aim", keys: "Q / E", gesture: "DRAG · RIGHT HALF", demo: "swipe", label: "TURN THE FRAME", why: "The frame is the rock you will cut.", where: "survey", done: false },
    // The Atlas is how the mine becomes navigable at all, so it is taught rather than left to be
    // found -- and taught out here, before the first claim. It used to come last, which put it
    // after the claim had already started: the sequence asked the player to stop reading a live
    // board and go and open a map, which is a strange thing to do in the middle of a rally.
    { id: "atlas", keys: "M", gesture: "TAP ATLAS, TOP RIGHT", label: "OPEN THE ATLAS", why: "Everywhere you have been.", where: "survey", done: false },
    { id: "commit", keys: "F", gesture: "TAP COMMIT", label: "COMMIT THE CLAIM", why: "The framed rock becomes your board.", where: "survey", done: false },
    // Inside a claim the order is: hold the thing you control, then aim it, then let go. Serving
    // first meant the player's very first act in the new mode was to launch a ball they had no
    // idea how to catch, and then to discover the paddle while it was already falling.
    { id: "paddle", keys: "A / D", gesture: "DRAG ANYWHERE", demo: "swipe", label: "MOVE THE PADDLE", why: "It is the drone, edge on.", where: "play", done: false },
    // Aiming comes before the serve because that is the only time it does anything -- the aim
    // steers the ball off the paddle and is fixed once the ball is live. Teaching it afterwards
    // made it unreachable in that claim, which is the kind of thing a sequential tutorial makes
    // obvious and a checklist hides.
    { id: "arenaAim", keys: "Q / E", gesture: "DRAG WIDE TO ANGLE IT", label: "AIM THE SERVE", why: "The only steering you get.", where: "play", done: false },
    { id: "serve", keys: "SPACE", gesture: "TAP", demo: "tap", label: "SERVE", where: "play", done: false },
    // Shown, not demanded.
    { id: "speed", keys: "W / S", gesture: "HOLD FAST", demo: "hold", label: "HOLD TO SPEED UP", why: "For the long tail of a claim.", where: "play", optional: true, done: false },
  ];
  /**
   * A real pause: the claim's simulation stops, not just the interface.
   *
   * Resuming runs a countdown rather than dropping the player straight back onto a live ball,
   * because the ball does not wait for them to find the paddle again.
   */
  /**
   * Frozen frames after an impact, in seconds.
   *
   * Vlambeer's `sleep`: a few tens of milliseconds of stopped time at the moment of contact, which
   * nobody notices and everybody feels -- the brain uses the extra time to register what happened.
   * Scaled by how hard the material was, so chalk is a tap and runite is a thud.
   */
  private hitPause = 0;
  paused = false;
  /** Seconds left of the 3-2-1. Zero means the claim is live. */
  resumeCountdown = 0;
  tutorialComplete = false;
  /**
   * Gestures already demonstrated, so each is mimed once and then trusted.
   *
   * Keyed by gesture kind rather than by step, because "drag" is one thing to learn even though
   * three different rungs use it -- the paddle drag needs no demonstration once the survey drag has
   * been seen.
   */
  private readonly gesturesShown = new Set<string>();
  /**
   * The demonstration currently running, and how long it has left.
   *
   * Time-based rather than call-based, and that distinction is the whole reason this field exists:
   * `renderTutorial` runs every frame, so marking a gesture "shown" the first time it was asked for
   * meant the animation appeared for exactly one frame and was then suppressed forever.
   */
  private gestureDemo: { kind: string; left: number } | null = null;
  /** How long the current step has been on screen, for advancing the optional ones. */
  private tutorialShownFor = 0;
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
    this.effectLayer.addChild(this.crumbleEdge);
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
    // Answered at the prompt itself. A refusal that flashes a panel on the far side of the screen
    // is a refusal the player does not see, and an unexplained dead key is the worst thing a
    // tutorial can hand someone in their first minute.
    this.coach.refused();
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

  /** The element the stage lives in, kept so a resize can re-measure it. */
  private host: HTMLElement | null = null;
  /** The shell around it, which carries the layout attribute CSS branches on. */
  private shell: HTMLElement | null = null;

  /**
   * Take the shape of the host again.
   *
   * Everything downstream of a resize is expensive -- resizing the renderer reallocates its
   * buffers, and the Refit Bay rebuilds its whole layout -- so nothing runs unless the stage
   * genuinely changed. A resize observer fires for plenty of reasons that are not resizes.
   */
  private reshape(): void {
    if (!this.host) return;
    // Stamp first, measure second. The shell's layout attribute decides the container's size, so
    // measuring before stamping would read the size the previous layout produced.
    if (this.shell) syncLayout(this.shell);
    if (!measureView(this.host)) return;
    this.app.renderer.resize(view.width, view.height);
    this.deploymentPreviews.layout();
    if (this.atlasOpen) this.atlasView.render();
  }

  async init(host: HTMLElement): Promise<void> {
    this.host = host;
    // Measured before the renderer exists, so the very first frame is already the right shape.
    // Creating at a fixed size and resizing afterwards produces one frame at the wrong aspect,
    // which on a phone is a visible flash of letterboxed game.
    this.shell = host.closest<HTMLElement>(".shell");
    if (this.shell) syncLayout(this.shell);
    measureView(host);
    await this.app.init({
      width: view.width,
      height: view.height,
      background: PALETTE.void,
      antialias: view.layout === "desktop",
      autoDensity: true,
      resolution: view.resolution,
      preference: ["webgl", "canvas"],
      powerPreference: "high-performance",
    });
    host.appendChild(this.app.canvas);
    this.app.canvas.classList.add("game-canvas");
    host.dataset.renderer = this.app.renderer.constructor.name;
    this.app.canvas.style.width = "100%";
    this.app.canvas.style.height = "100%";
    this.app.canvas.setAttribute("aria-label", "Orekenoid");
    // Above the world and the bay: these are the player's own hands, and nothing occludes them.
    this.app.stage.addChild(this.worldRoot, this.gantry.container, this.touchControls.container);
    this.worldRoot.addChild(this.farLayer, this.terrainLayer, this.landmarkLayer, this.featureLayer, this.effectLayer, this.actorLayer, this.framePreview, this.coach.container);
    this.terrainLayer.addChild(this.terrain.container);
    buildFarGeology(this.farLayer);
    // Build the opening neighbourhood synchronously so the first frame is complete.
    this.terrain.requestAround(this.player.x, this.player.y);
    this.terrain.pump(24);
    buildLandmarks(this.landmarkLayer, this.world);
    this.featureMarks = buildFeatureMarks(this.featureLayer, this.world.generated.rooms.features, this.world);
    this.actorLayer.addChild(this.drone);
    this.bindInput();
    this.touch.attach(this.app.canvas);
    this.bindTouchActions();
    this.audio.onLost = () => this.holds.audioLost();
    this.awake.attach();
    this.holds.attach({
      onHold: () => {
        // A genuine stop, not a hidden overlay. Every gesture in flight is dropped too, or a finger
        // that was down when the call arrived would still be steering on the way back.
        this.paused = true;
        this.resumeCountdown = 0;
        this.touch.clear();
        this.keys.clear();
      },
      onResume: () => {
        // The tap is the gesture the browser wanted, so spend it on the audio context before
        // anything else -- this is the only moment one is guaranteed to be available.
        this.audio.revive();
        this.paused = false;
        // The same countdown the pause menu uses. A live ball does not wait for a player to find
        // the paddle again, and coming back from a phone call is exactly when they need the beat.
        this.resumeCountdown = this.arena && !this.arena.resolving ? 3 : 0;
      },
      onOrientation: () => this.reshape(),
    });
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

  /**
   * How long FAST has been held, in seconds. Drives the ramp.
   *
   * A single speed would be the wrong answer at both ends: x8 makes the opening of a claim
   * unreadable, and x2 does nothing for the long tail. Holding longer means going faster, which is
   * one control expressing the same three rates W, S and both do on a keyboard.
   */
  private fastHeld = 0;
  private fastDown = false;

  /** The touch rate, or 1 when nothing is held. */
  private get touchRate(): number {
    if (!this.fastDown) return 1;
    if (this.fastHeld > 1.6) return 8;
    if (this.fastHeld > 0.7) return 4;
    return 2;
  }

  private bindTouchActions(): void {
    const panel = document.querySelector<HTMLElement>("#touchActions");
    if (!panel) return;
    for (const button of panel.querySelectorAll<HTMLButtonElement>("button[data-touch]")) {
      const action = button.dataset.touch ?? "";
      if (action === "fast") {
        // Held rather than pressed, so it needs the raw pointer pair rather than a click.
        const press = (down: boolean) => {
          this.fastDown = down;
          if (!down) this.fastHeld = 0;
          button.setAttribute("aria-pressed", String(down));
        };
        button.addEventListener("pointerdown", (event) => { event.preventDefault(); press(true); });
        button.addEventListener("pointerup", () => press(false));
        button.addEventListener("pointercancel", () => press(false));
        button.addEventListener("pointerleave", () => press(false));
        continue;
      }
      button.addEventListener("click", () => this.pressTouchAction(action));
    }
  }

  /**
   * The primary action is whatever the mode makes it.
   *
   * One button rather than three that appear and disappear: a control that comes and goes moves
   * everything around it, and a thumb aiming for where a button was a moment ago presses whatever
   * took its place.
   */
  private pressTouchAction(action: string): void {
    if (action === "pause") { this.togglePause(); return; }
    if (this.paused || this.cameraTransition) return;
    if (action === "atlas") {
      if (!this.can("atlas")) { this.refuseControl(); return; }
      this.toggleAtlas();
      return;
    }
    if (action === "forge") { if (this.mode === "survey") this.toggleCrafting(); return; }
    if (action === "primary") {
      if (this.arena) {
        if (this.arena.balls.some((ball) => ball.served)) return;
        if (!this.can("serve")) { this.refuseControl(); return; }
        this.serve();
      } else {
        if (!this.can("commit")) { this.refuseControl(); return; }
        this.establishArena();
      }
    }
  }

  /** Keep the action panel telling the truth about what it does right now. */
  private renderTouchActions(dt: number): void {
    const panel = document.querySelector<HTMLElement>("#touchActions");
    if (!panel) return;
    const wanted = this.touch.used && this.started;
    if (panel.hidden === wanted) panel.hidden = !wanted;
    if (!wanted) return;
    if (this.fastDown) this.fastHeld += dt;
    const primary = document.querySelector<HTMLButtonElement>("#touchPrimary");
    if (primary) {
      const serving = Boolean(this.arena) && !this.arena?.balls.some((ball) => ball.served);
      const label = this.arena ? "SERVE" : "COMMIT";
      const text = primary.querySelector("b");
      if (text && text.textContent !== label) text.textContent = label;
      // Dimmed rather than removed while a ball is live: the button keeps its place in the layout
      // so nothing shifts under the thumb mid-rally.
      primary.disabled = this.arena ? !serving : !this.can("commit") && !this.tutorialComplete;
    }
    const fast = panel.querySelector<HTMLButtonElement>('[data-touch="fast"]');
    if (fast) fast.hidden = !this.arena;
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
      if (event.repeat) return;
      // Pause is never gated -- not by the tutorial, and not by a camera transition either. It sat
      // below the `cameraTransition` guard at first, which meant the seconds spent flying into a
      // claim were seconds the player could not stop the game, and that is exactly when somebody
      // reaches for Escape.
      if (event.code === "Escape" && !this.atlasOpen && !this.craftingOpen) { this.togglePause(); return; }
      if (this.paused) {
        // While paused the only key that does anything is the one that unpauses.
        if (event.code === "KeyP") this.togglePause();
        return;
      }
      if (this.cameraTransition) return;
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
    window.addEventListener("resize", () => this.reshape());
    // A resize observer catches the cases `resize` does not: a rotating phone settles its layout
    // after the event fires, and the shell's own container can change without the window doing so.
    if (typeof ResizeObserver !== "undefined" && this.host) {
      new ResizeObserver(() => this.reshape()).observe(this.host);
    }
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

  /**
   * Put the prompt on the thing it is about.
   *
   * The step decides its own subject: the drone for flying and framing, the frame's own centre for
   * committing, the paddle for paddling and aiming, the ball for serving. That is the entire idea
   * behind this rewrite -- the player never has to look away from what they are being taught in
   * order to read about it, and there is never any doubt about which object the sentence means.
   *
   * A step whose mode the player is not in shows nothing at all rather than asking for the
   * impossible from a subject that is not on screen.
   */
  private renderTutorial(): void {
    // Nothing while the bay or the Atlas is up. Those cover the world, and a tag pointing at a
    // drone the player cannot currently see is worse than no tag at all.
    if (this.tutorialComplete || this.craftingOpen || this.atlasOpen || this.paused) {
      this.coach.hide();
      return;
    }
    const step = this.currentStep;
    if (!step || step.where !== (this.arena ? "play" : "survey")) {
      this.coach.hide();
      return;
    }
    const anchor = this.tutorialAnchor(step);
    if (!anchor) {
      this.coach.hide();
      return;
    }
    // Gestures replace keys only when the player is actually using fingers. A hybrid laptop stays
    // on keys until somebody touches the screen, at which point the prompt switches over.
    const touching = this.touch.used;
    // Demonstrated once per distinct gesture, for a few loops, then trusted. After the first drag
    // the player knows what a drag is, and a game that keeps miming its own controls is a game that
    // does not trust them.
    if (touching && step.demo && !this.gesturesShown.has(step.demo)) {
      if (this.gestureDemo?.kind !== step.demo) {
        // Three loops of the animation. One is easy to miss while reading the goal line above it.
        this.gestureDemo = { kind: step.demo, left: 7.2 };
      }
    } else if (this.gestureDemo && this.gestureDemo.kind !== step.demo) {
      // The sequence moved on. A demonstration of the previous rung's gesture is not worth
      // finishing, and it stays unshown so it can be offered properly when its own rung arrives.
      this.gestureDemo = null;
    }
    const demo = this.gestureDemo?.kind === step.demo ? step.demo : undefined;
    this.coach.show({
      goal: step.label,
      why: step.why,
      keys: step.keys,
      gesture: touching ? step.gesture : undefined,
      demo,
      ...anchor,
    });
  }

  /** Where the current step's subject is, in world pixels, and how to hang the tag off it. */
  private tutorialAnchor(step: TutorialStep): { x: number; y: number; side?: 1 | -1; ring?: boolean } | null {
    // Staying on screen beats every other placement rule. On a phone the tag is a large fraction of
    // the stage width, so hanging it on the "correct" side of a subject near an edge sent it off the
    // screen and cut the sentence in half. Whichever side has more room gets it.
    const roomier = (worldX: number, worldY: number): 1 | -1 => {
      const at = this.camera.worldToScreen(worldX, worldY);
      return at.x < view.width / 2 ? 1 : -1;
    };
    const arena = this.arena;
    if (arena) {
      // Inside a claim the tag hangs above the paddle and off to the side, out of the ball's
      // working space. The subject is the paddle for everything except the serve, which is about
      // the ball -- and the ball is sitting on the paddle at that moment anyway, so the leader
      // line lands where the player is already watching.
      const target = step.id === "serve" && arena.balls.length
        ? { u: arena.balls[0].u, v: arena.balls[0].v }
        : { u: arena.paddle.u, v: 0 };
      const point = this.world.localToWorld(target.u, target.v, arena);
      // Hung toward the middle of the board, so a paddle at either extreme does not push the tag
      // off the edge of the view.
      const px = point.x * CELL;
      const py = point.y * CELL;
      return { x: px, y: py, side: roomier(px, py), ring: step.id === "serve" };
    }
    // Hung on the side the frame is not, so the prompt never covers the rock it is telling the
    // player to look at. The survey preview is a large bright rectangle out ahead of the drone,
    // and a tag parked on top of it hides the one thing the sequence is building toward.
    const ahead: 1 | -1 = Math.cos(this.player.heading) > 0 ? 1 : -1;
    if (step.id === "commit") {
      // The frame, not the drone: "commit the claim" is about the rectangle of rock out in front,
      // and pointing at the machine instead would be pointing at the wrong noun.
      const frame = this.frameGeometry();
      const reach = (frame.depth / 2 + 1) * CELL;
      const fx = this.player.x + Math.cos(frame.angle) * reach;
      const fy = this.player.y + Math.sin(frame.angle) * reach;
      return {
        x: fx,
        y: fy,
        // The frame's own tag still prefers to hang forward, but not off the screen.
        side: view.layout === "phone" ? roomier(fx, fy) : ahead,
        ring: true,
      };
    }
    return {
      x: this.player.x,
      y: this.player.y,
      side: view.layout === "phone"
        ? roomier(this.player.x, this.player.y)
        : (ahead === 1 ? -1 : 1),
      ring: step.id === "move",
    };
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
      // Backing out of the end-claim confirmation is not the same as resuming: the player asked a
      // question and is entitled to the menu back rather than the ball.
      if (this.pauseView.cancelConfirm()) return;
      this.paused = false;
      this.pauseView.setOpen(false);
      // Only a live claim needs the countdown. Out in the mine there is nothing to be caught by.
      this.resumeCountdown = this.arena && !this.arena.resolving ? 3 : 0;
      this.audio.play(SOUNDS.atlasClose);
    } else {
      this.paused = true;
      this.resumeCountdown = 0;
      this.pauseView.setOpen(true, this.pauseModel());
      this.audio.play(SOUNDS.atlasOpen);
    }
    this.updateUI();
  }

  /** What the pause menu needs to know. Ending a claim is only offered when there is one. */
  private pauseModel() {
    const remaining = this.arena?.bricks.filter((brick) => brick.alive && brick.liable).length ?? 0;
    return {
      inClaim: Boolean(this.arena && !this.arena.resolving),
      endCost: calculateClaimDamage(remaining, this.soakCapacity),
      integrity: this.integrity,
      maxIntegrity: this.maxIntegrity,
      touch: this.touch.used,
    };
  }

  /**
   * End the claim where it stands.
   *
   * Resolved exactly as a loss is, through the same path, so the material still standing loads the
   * hull and the frame is exhausted -- walking away early is a decision with the ordinary price,
   * not an escape from it. The menu has already shown the player that price.
   */
  private endClaimNow(): void {
    if (!this.arena || this.arena.resolving) return;
    this.paused = false;
    this.resumeCountdown = 0;
    this.pauseView.setOpen(false);
    this.finishArena("lost");
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
      paddle: { u: 0, velocity: 0, width: this.paddleWidth, flash: 0, impact: 0, recoil: 0 },
      container, board, actors, resolving: false, visualAge: 0, crumbleFront: 0, railFlash: 0,
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
    // Sweep the previous claim's settled debris. Permanence is per claim: the record of work done
    // belongs to the board it was done on.
    this.effects.clearSettled();
    this.loadStrike.clear();
    const center = this.world.localToWorld(0, arena.depth / 2, arena);
    // Zoom is the third channel of the commit move, so the claim is *framed* in one motion rather
    // than flown to and then scaled. It also fixes a defect that predates any of the mobile work:
    // a 19-deep frame is 798px tall, which never fitted the old 720px stage either.
    this.camera.begin(
      { x: center.x * CELL, y: center.y * CELL },
      -arena.angle,
      false,
      boardZoom(arena.width, arena.depth),
    );
    this.showToast(`${arena.initialLiability} LIABLE · ${resources} RETURNS · CLAIM COMMITTED`);
    this.audio.play(SOUNDS.claimCommitted);
    this.updateUI();
  }

  private serve(): void {
    const arena = this.arena;
    if (!arena || arena.balls.some((ball) => ball.served) || this.cameraTransition) return;
    const ball = arena.balls[0];
    // Served at the claim's current pace, so a re-serve after losing a ball is not slower than the
    // rally it is replacing.
    const speed = ballSpeed(arena);
    ball.vu = arena.serveAim * speed;
    ball.vv = Math.sqrt(Math.max(speed ** 2 - ball.vu ** 2, 1e-6));
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

  /**
   * Every contact the ball makes, answered in several layers.
   *
   * The rule this is built to: a player action should never produce exactly one piece of feedback.
   * A paddle return is a paddle recoil *and* an emitter flare *and* a ball flash *and* a ring *and*
   * a sound whose pitch tracks the rally -- none of which is the camera, because the camera is for
   * things that happen rarely.
   */
  private handleBallEvents(ball: Ball, events: BallStepEvents): void {
    const arena = this.arena;
    if (!arena) return;
    const accent = PROVINCE_PALETTE[arena.province].accent;

    if (events.paddle) {
      this.audio.play(SOUNDS.paddleHit);
      // The paddle is driven into the board and springs back, so a return is something the machine
      // visibly did rather than something that happened to the ball.
      arena.paddle.recoil = 1;
      arena.paddle.flash = 0.16;
      ball.glow = 1;
      const at = this.world.localToWorld(arena.paddle.u, 0.2, arena);
      this.effects.spawnRing(at.x * CELL, at.y * CELL, accent, 0.45);
      this.effects.spawnShards(at.x * CELL, at.y * CELL, accent, 3, 0.5, false);
      // A shove into the board from below: the whole stack feels the serve come back.
      impulse(arena.bricks, {
        u: arena.paddle.u, v: 0.2, du: 0, dv: 1,
        force: 0.5, reach: 6, light: 0.3, speed: 30,
      });
    }

    if (events.rail) {
      this.audio.play(SOUNDS.railHit);
      // The rail lights where it was struck, and the bricks nearest that point twitch.
      arena.railFlash = 1;
      const at = this.world.localToWorld(ball.u, ball.v, arena);
      this.effects.spawnRing(at.x * CELL, at.y * CELL, accent, 0.22);
      impulse(arena.bricks, {
        u: ball.u, v: ball.v, du: ball.vu, dv: ball.vv,
        force: 0.5, reach: 2.4, light: 0.3, speed: 30,
      });
    }

    if (events.faceted) {
      this.audio.play(SOUNDS.facetTurn);
      // A right-angle turn is the Mirrorreef rule paying out, so it gets its own colour and its own
      // wave rather than reading as an ordinary brick contact.
      const at = this.world.localToWorld(ball.u, ball.v, arena);
      this.effects.spawnRing(at.x * CELL, at.y * CELL, PALETTE.facetHot, 0.6);
      ball.glow = 1;
      impulse(arena.bricks, {
        u: ball.u, v: ball.v, du: ball.vu, dv: ball.vv,
        force: 0.9, reach: 3, light: 0.7, speed: 22,
      });
    }

    for (const membrane of events.membranes) {
      this.audio.play(SOUNDS.membraneHit);
      const at = this.world.localToWorld(membrane.u, membrane.v, arena);
      this.effects.spawnRing(at.x * CELL, at.y * CELL, PALETTE.spore, 0.5);
      ball.glow = Math.max(ball.glow, 0.7);
    }

    for (const brick of events.bricks) this.hitBrick(brick, ball);
  }

  /**
   * How far through the claim the player is, 0..1.
   *
   * Drives both the ball's speed and the loudness of every impact, so a claim escalates as one
   * thing: the same brick breaking at ninety per cent cleared hits harder than the first one did. A
   * flat feedback curve across a whole claim is what makes a board feel the same all the way down.
   */
  private get claimHeat(): number {
    const arena = this.arena;
    if (!arena) return 0;
    const total = Math.max(1, arena.initialLiability);
    const standing = arena.bricks.filter((brick) => brick.alive && brick.liable).length;
    return clamp(1 - standing / total, 0, 1);
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
    const heat = 0.75 + this.claimHeat * 0.75;
    // Hardness is the whole scale of an impact: a one-hit chalk chip and a four-hit runite plate
    // should not land the same way.
    const hardness = Math.min(1, definition.hp / 4);
    const broke = brick.hp <= 0;
    showDamage(brick);
    this.shardsAtBrick(brick, definition.edge, Math.round((broke ? 8 : 4) * heat), heat, false);
    this.audio.play(broke ? SOUNDS.brickBreak : SOUNDS.brickChip);
    // Bass layered under the break rather than replacing it: the click says "contact" and the body
    // says "that was heavy". Four-hit stone gets the heavier of the two.
    if (broke) this.audio.play(hardness >= 0.75 ? SOUNDS.brickBreakHeavy : SOUNDS.brickBreakBody);

    // The board takes the hit, not the camera.
    //
    // This replaced a camera kick on every single contact, which was both far too much and the
    // wrong instrument: the screenshake talk's own warning is that shake "gets kind of addictive
    // and you get used to it and you put a ton of it in your games and you stop noticing it". The
    // effects that actually sell an impact there are the things in the world reacting -- so the
    // struck brick is shoved off its seat, squashed, spun and flashed, and a wave of shove and
    // colour travels outward through its neighbours in the material's own accent.
    const along = Math.hypot(ball.vu, ball.vv) || 1;
    impulse(arena.bricks, {
      u: brick.u, v: brick.v,
      du: ball.vu / along, dv: ball.vv / along,
      force: (broke ? 3.4 : 1.5) * (0.6 + hardness) * heat,
      reach: broke ? 3.4 : 2.1,
      light: broke ? 0.95 : 0.5,
      // Slower for a break, so a heavy one visibly rolls outward instead of blinking.
      speed: broke ? 16 : 26,
      struck: brick,
    });
    this.ringAtBrick(brick, definition.edge, broke ? 0.9 * heat : 0.35);
    // The ball answers too: it squashes into the contact and flares.
    ball.glow = Math.max(ball.glow, broke ? 1 : 0.5);

    // Hit-stop only where it is earned. A chip gets none at all: a few frames of stopped time on
    // every contact in a rally is a stutter, not an emphasis.
    if (broke) this.hitPause = Math.max(this.hitPause, 0.022 + hardness * 0.03);
    if (brick.hp > 0) return;

    brick.alive = false;
    brick.display?.destroy({ children: true });
    // Permanence: the pieces settle and the mark stays, so a cleared stretch of board shows the
    // work that was done on it rather than reading as empty space.
    this.shardsAtBrick(brick, definition.edge, Math.round(7 * heat), heat * 1.25, true);
    this.dustAtBrick(brick, definition.base, Math.round(5 * heat), heat);
    this.scorchAtBrick(brick, definition.base);
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
        showDamage(affected);
        this.shardsAtBrick(affected, materialOf(affected.kind).edge, 8);
        if (affected.react) affected.react.squash = 1;
        if (affected.hp > 0) continue;
        affected.alive = false;
        affected.display?.destroy({ children: true });
        this.world.removeFootprint(affected.footprint, false, affected.persistent);
        if (affected.resource) spawnDrop(arena, affected.u, affected.v, affected.resource);
      }
      if (cascade.length) {
        // Rare, board-wide and the province's signature payoff: this one has earned the camera.
        this.kickFrom(brick, 6 + Math.min(10, cascade.length * 1.6));
        this.hitPause = Math.max(this.hitPause, 0.06);
        impulse(arena.bricks, {
          u: brick.u, v: brick.v, du: 0, dv: 1,
          force: 3.6, reach: 5.5, light: 1, speed: 13, struck: brick,
        });
        this.ringAtBrick(brick, PALETTE.facetHot, 1.4);
        this.showToast(`LATTICE CASCADE · ${cascade.length}`);
        this.audio.play(SOUNDS.cascade);
      }
    }
    void ball;
  }

  /** Shards at a brick. Arena-local `u,v` is the only thing Effects cannot know. */
  private shardsAtBrick(brick: Brick, colour: number, count: number, force = 1, settles = false): void {
    const arena = this.arena;
    if (!arena) return;
    const point = this.world.localToWorld(brick.u, brick.v, arena);
    // At least one, always. A burst that rounds to nothing turns "that broke" into silence.
    const budgeted = Math.max(1, Math.round(count * effectBudget()));
    this.effects.spawnShards(point.x * CELL, point.y * CELL, colour, budgeted, force, settles);
  }

  private dustAtBrick(brick: Brick, colour: number, count: number, force = 1): void {
    const arena = this.arena;
    if (!arena) return;
    const point = this.world.localToWorld(brick.u, brick.v, arena);
    this.effects.spawnDust(point.x * CELL, point.y * CELL, colour, Math.max(1, Math.round(count * effectBudget())), force);
  }

  private scorchAtBrick(brick: Brick, colour: number): void {
    const arena = this.arena;
    if (!arena) return;
    const point = this.world.localToWorld(brick.u, brick.v, arena);
    this.effects.scorch(point.x * CELL, point.y * CELL, colour, CELL * 0.62);
  }

  /**
   * Kick the camera away from a brick.
   *
   * Reserved for the rare and the large -- a cascade, the load punching through the plating, a ball
   * lost. Ordinary brick contacts deliberately do not call this: the board's own reaction carries
   * them, and a camera that moves on every hit stops meaning anything by the tenth.
   */
  private kickFrom(brick: Brick, magnitude: number): void {
    const arena = this.arena;
    if (!arena) return;
    const point = this.world.localToWorld(brick.u, brick.v, arena);
    const centre = this.world.localToWorld(0, arena.depth / 2, arena);
    const scaled = magnitude * motionScale();
    if (scaled <= 0) return;
    this.camera.kick((point.x - centre.x) * CELL, (point.y - centre.y) * CELL, scaled);
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
    // Throw the load at the machine. The figure was already right; it was just a number that
    // appeared, and a number is the one thing a player cannot feel. Now they watch the plating stop
    // what it can and watch the rest get through.
    arena.actors.addChild(this.loadStrike.container);
    this.loadStrike.begin(
      arena,
      remaining.map((brick) => ({ u: brick.u, v: brick.v, colour: materialOf(brick.kind).edge })),
      this.soakCapacity,
    );
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
    // The volley needs time to land before the camera pulls out, or the most dramatic beat of a
    // claim plays off screen.
    const volley = remaining.length ? 1050 : 0;
    window.setTimeout(
      () => this.camera.begin(focus, 0, true, surveyZoom()),
      Math.max(volley, arena.damageTaken > 0 ? 680 : 360),
    );
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
    // One read per frame, before anything consumes it. The router is told the mode here rather
    // than inferring it, because a touch has to be assigned a job the instant it lands -- there is
    // no movement yet to infer one from.
    this.touch.mode = this.mode === "play" ? "play" : "survey";
    this.touch.enabled = this.started && !this.craftingOpen && !this.atlasOpen && !this.paused;
    this.touchState = this.touch.read(this.camera);
    this.answerTaps();
    // Only while a claim is actually running. Holding the lock through the deployment screen or a
    // pause would be asking to keep somebody's screen on for a game they are not playing.
    this.awake.set(this.started && !this.paused && this.arena !== null);
    this.renderTouchActions(dt);
    this.touchControls.update(
      dt,
      this.touchState,
      // Drawn only once a finger has actually been used, so a laptop with a touchscreen does not
      // grow a virtual stick for someone playing with a keyboard.
      this.touch.used && this.touch.enabled,
      this.mode === "survey" && !this.touch.active && !this.cameraTransition,
    );
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
    this.updateCrumble(dt);
    this.updateDisplays(dt);
    this.showClaimHeat();
    this.updateLoadStrike(dt);
  }

  /**
   * Animate the load volley and answer each impact.
   *
   * Deflections spark off the plating and kick lightly; the ones that get through hit hard, pause
   * the frame and shake, so "armour held" and "armour breached" are two visibly different events
   * rather than two different toasts.
   */
  private updateLoadStrike(dt: number): void {
    const arena = this.arena;
    if (!arena || this.loadStrike.finished) return;
    this.loadStrike.update(dt, arena, (u, v) => this.world.localToWorld(u, v, arena));
    for (const impact of this.loadStrike.drainLanded()) {
      const point = this.world.localToWorld(impact.u, impact.v, arena);
      const at = { x: point.x * CELL, y: point.y * CELL };
      if (impact.deflected) {
        this.effects.spawnShards(at.x, at.y, PALETTE.rail, 5, 0.9, false);
        this.effects.spawnRing(at.x, at.y, PALETTE.rail, 0.35);
        this.audio.play(SOUNDS.railHit);
      } else {
        this.effects.spawnShards(at.x, at.y, PALETTE.danger, 9, 1.5, false);
        this.effects.spawnDust(at.x, at.y, PALETTE.danger, 4, 1.2);
        this.audio.play(SOUNDS.armorBreached);
        this.hitPause = Math.max(this.hitPause, 0.045);
        const centre = this.world.localToWorld(0, arena.depth / 2, arena);
        this.camera.kick((point.x - centre.x) * CELL, (point.y - centre.y) * CELL, 13);
      }
    }
  }

  /**
   * A tap on the world means the obvious thing for the mode.
   *
   * In a claim it serves; out in the mine it commits. Both are the one action a player reaches for
   * without thinking, and both are already reachable from a labelled button -- this is the
   * shortcut, not the only route, which is why it is safe for a stray tap to trigger either.
   */
  private answerTaps(): void {
    const taps = this.touch.drainTaps();
    if (!taps.length || !this.started || this.paused || this.cameraTransition) return;
    if (this.craftingOpen || this.atlasOpen) return;
    for (const _tap of taps) {
      if (this.arena) {
        if (this.arena.balls.some((ball) => ball.served)) continue;
        if (!this.can("serve")) { this.refuseControl(); continue; }
        this.serve();
      } else {
        if (!this.can("commit")) { this.refuseControl(); continue; }
        this.establishArena();
      }
      return;
    }
  }

  private updateSurvey(dt: number): void {
    // Arrows mirror WASD out here. Inside a claim the horizontal pair moves the paddle and the
    // vertical pair drives the simulation speed, so the mirroring is deliberately mode-local.
    const held = (...codes: string[]) => codes.some((code) => this.keys.has(code));
    // Movement and aiming are gated separately rather than behind one early return: they are two
    // steps of the sequence, and one being locked must never silently disable the other.
    const canMove = this.can("move");
    const keyX = (held("KeyD", "ArrowRight") ? 1 : 0) - (held("KeyA", "ArrowLeft") ? 1 : 0);
    const keyY = (held("KeyS", "ArrowDown") ? 1 : 0) - (held("KeyW", "ArrowUp") ? 1 : 0);
    // The stick wins when it is deflected, and the keys are still read otherwise, so a tablet with
    // a keyboard attached does not have to choose. Movement here is world-absolute rather than
    // heading-relative, which is why a stick vector drops straight in with no conversion.
    const stickX = this.touchState.moveX;
    const stickY = this.touchState.moveY;
    const dx = canMove ? (stickX || stickY ? stickX : keyX) : 0;
    const dy = canMove ? (stickX || stickY ? stickY : keyY) : 0;
    // The stick is already clamped to the unit disc and carries its own magnitude, so normalising
    // it again would throw away every speed between stopped and full.
    const length = Math.max(Math.hypot(dx, dy), 1);
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

    const canAim = this.can("aim");
    const rotation = canAim ? (this.keys.has("KeyE") ? 1 : 0) - (this.keys.has("KeyQ") ? 1 : 0) : 0;
    // The drag is already an angle, so it bypasses the rotation-speed term entirely: the frame
    // follows the thumb at the rate the thumb moves, which is the whole reason a drag feels
    // direct where a held button feels like a request.
    const dragged = canAim ? this.touchState.turn : 0;
    const delta = rotation * this.rotationSpeed * dt + dragged;
    let turnedBy = 0;
    if (delta) {
      // Rotation is refused when it would drive the hull into rock. Always safe to refuse: the
      // pose the drone arrived in is by definition clear, so turning back the way it came is
      // always available.
      //
      // Applied in small steps rather than as one jump, so a large turn rotates as far as it can
      // instead of being refused outright. A held key produces a few hundredths of a radian per
      // frame and never noticed the difference, but a thumb flick arrives as most of a radian at
      // once -- and all-or-nothing meant the fastest gestures were the ones most likely to do
      // nothing at all, which reads as the game ignoring you.
      const STEP = 0.05;
      const steps = Math.max(1, Math.ceil(Math.abs(delta) / STEP));
      const increment = delta / steps;
      for (let step = 0; step < steps; step++) {
        const turned = normalizeAngle(this.player.heading + increment);
        if (!stuck && !this.hullFits(this.player.x, this.player.y, turned)) break;
        this.player.heading = turned;
        turnedBy += increment;
      }
    }
    if (dx || dy) this.markTutorial("move");
    if (turnedBy) this.markTutorial("aim");
    // The map records where the drone has been, not what the generator produced.
    this.world.markDiscovered(this.player.x / CELL, this.player.y / CELL, DISCOVERY_RADIUS);
    this.tryBank();
    this.renderFramePreview();
  }

  private updatePlay(dt: number): void {
    const arena = this.arena;
    if (!arena || arena.resolving || this.cameraTransition) return;
    if (this.paused) return;
    // Held frames. The countdown itself lives in the frame update, not here: `updatePlay` returns
    // early while a claim is resolving, so a pause set by the load volley would never decay and
    // would freeze the *opening* of the next claim.
    if (this.hitPause > 0) return;
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
    // The touch ramp and the keys are the same control from two devices; whichever is asking for
    // more wins, so holding both never means less than holding one.
    const touched = this.touchRate;
    const up = this.keys.has("KeyW") || this.keys.has("ArrowUp");
    const down = this.keys.has("KeyS") || this.keys.has("ArrowDown");
    if (up && down) return Math.max(8, touched);
    if (down) return Math.max(4, touched);
    if (up) return Math.max(2, touched);
    return touched;
  }

  private stepArena(arena: Arena, dt: number): void {
    if (this.simulationRate > 1) this.markTutorial("speed");
    const canPaddle = this.can("paddle");
    const input = canPaddle
      ? (this.keys.has("KeyD") || this.keys.has("ArrowRight") ? 1 : 0) - (this.keys.has("KeyA") || this.keys.has("ArrowLeft") ? 1 : 0)
      : 0;
    const before = arena.paddle.u;
    const touched = canPaddle ? this.touchState.paddle : null;
    if (touched) {
      // Direct drag: the paddle *chases* the finger at up to its own speed rather than being
      // assigned its position. Two reasons, and both matter. A paddle that teleports can cross the
      // ball without touching it. And `paddle.velocity` drives the English the ball takes off the
      // face -- snapping the position and leaving velocity at zero would silently delete a
      // mechanic the physics pass was built around.
      const local = this.world.worldToLocal(touched.x / CELL, touched.y / CELL, arena);
      const reach = this.paddleSpeed * dt;
      const gap = local.x - arena.paddle.u;
      arena.paddle.u += clamp(gap, -reach, reach);
    } else {
      arena.paddle.u += input * this.paddleSpeed * dt;
    }
    // Derived from what actually happened, so it is correct for both sources and stays correct
    // when the paddle is stopped against a wall.
    arena.paddle.velocity = dt > 0 ? (arena.paddle.u - before) / dt : 0;
    if (input || (touched && Math.abs(arena.paddle.velocity) > 1)) this.markTutorial("paddle");
    arena.paddle.flash = Math.max(0, arena.paddle.flash - dt);
    arena.paddle.impact *= Math.pow(0.0005, dt);
    const limit = arena.width / 2 - arena.paddle.width / 2;
    if (arena.paddle.u < -limit) { arena.paddle.u = -limit; arena.paddle.velocity = Math.max(0, arena.paddle.velocity); }
    if (arena.paddle.u > limit) { arena.paddle.u = limit; arena.paddle.velocity = Math.min(0, arena.paddle.velocity); }
    for (const brick of arena.bricks) brick.hitFlash = Math.max(0, brick.hitFlash - dt);

    if (!arena.balls.some((ball) => ball.served)) {
      const canAim = this.can("arenaAim");
      const aim = canAim ? (this.keys.has("KeyE") ? 1 : 0) - (this.keys.has("KeyQ") ? 1 : 0) : 0;
      if (aim) this.markTutorial("arenaAim");
      arena.serveAim = clamp(arena.serveAim + aim * 1.45 * dt, -0.72, 0.72);
      // Before the serve the same one-thumb drag carries a second axis: horizontal still positions
      // the paddle, and how far the finger sits from the paddle's own row sets the launch angle.
      // This is the reason the paddle scheme is absolute rather than relative -- an absolute
      // mapping leaves the vertical axis free to mean something else.
      if (canAim && touched) {
        const local = this.world.worldToLocal(touched.x / CELL, touched.y / CELL, arena);
        // Reading upward from the paddle: a finger held high aims steeply, low aims flat. Scaled
        // against the board's own depth so the gesture means the same thing on every claim size.
        const reach = Math.max(1, arena.depth * 0.45);
        const steer = clamp((local.x - arena.paddle.u) / reach, -1, 1);
        const wanted = clamp(steer * 0.72, -0.72, 0.72);
        // Eased rather than assigned, so the ball does not snap around as the thumb settles.
        arena.serveAim += (wanted - arena.serveAim) * Math.min(1, dt * 9);
        if (Math.abs(wanted - arena.serveAim) > 0.02) this.markTutorial("arenaAim");
      }
      for (const ball of arena.balls) ball.u = arena.paddle.u;
      return;
    }

    for (const ball of [...arena.balls]) {
      stepBall(ball, arena, dt, (events) => this.handleBallEvents(ball, events));
      const point = this.world.localToWorld(ball.u, ball.v, arena);
      ball.trail.unshift({ x: point.x * CELL, y: point.y * CELL });
      // The trail lengthens with the claim's pace, which is how the speed ramp becomes something
      // the player sees rather than only something they cope with.
      const trailLength = Math.round(13 + this.claimHeat * 13);
      while (ball.trail.length > trailLength) ball.trail.pop();
    }

    // Bounded province rules.
    for (const revived of stepRegrowth(arena, dt)) {
      revived.display?.destroy({ children: true });
      const regrown = createBrickDisplay(revived);
      revived.display = regrown.container;
      revived.damageStages = regrown.damageStages;
      revived.react = newReaction();
      showDamage(revived);
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

    // Kept in step with the economy every frame rather than only at the claim's start, so the
    // grinder's rate can never disagree with the station actually fitted -- a disagreement that
    // silently handed the player a drone which caught everything and taxed nothing.
    this.salvage.configure(this.salvageTax);
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

  /**
   * Make the speed ramp visible.
   *
   * The ball runs up to 45% faster as a claim clears, and a player should be able to see that
   * coming rather than only discover it by missing. The ball burns brighter, its trail runs longer,
   * and the rails glow hotter -- three cues on the same number.
   */
  private showClaimHeat(): void {
    const arena = this.arena;
    if (!arena) return;
    // Ball scale and rail glow are both written per frame in `updateDisplays`, where they are
    // combined with the contact reactions -- setting them here as well meant the two fought and the
    // pop on impact was flattened back out on the same frame it appeared.
    void arena;
  }

  /**
   * The board coming apart out of the rock.
   *
   * A wavefront travels along the claim from the paddle end. Behind it the board is uncovered by a
   * mask; ahead of it nothing the board draws is visible at all, so the framed region is still
   * literally the terrain render. The seam between the two states is covered by the crumble itself
   * -- chips thrown out of the gaps between cells as they open -- so the player never sees a board
   * waiting to be uncovered, only stone breaking into squares.
   */
  private updateCrumble(dt: number): void {
    const arena = this.arena;
    if (!arena?.crumbleMask) return;
    const reach = arena.depth + 1.2;
    if (arena.crumbleFront >= reach) {
      // Released once the wave is through. Leaving a mask assigned for the rest of the claim costs
      // a clip every frame and risks trimming anything that later strays past the quad -- the load
      // volley, for one, which flies the length of the board.
      if (arena.board.mask) {
        arena.board.mask = null;
        arena.crumbleMask.destroy();
        arena.crumbleMask = undefined;
        this.crumbleEdge.clear();
      }
      return;
    }

    const previous = arena.crumbleFront;
    // Fast: this is a flourish on the way into play, not a cutscene. The serve still waits for the
    // player, so it can never cost them agency, but it must not feel like a wait either.
    arena.crumbleFront = Math.min(reach, arena.crumbleFront + dt * (arena.depth + 1.2) / 0.55);
    const front = arena.crumbleFront;

    // Mask: the strip of the claim the wave has passed, in world space, because everything the
    // board draws is positioned in world space rather than in a rotated container.
    const half = arena.width / 2;
    const corners = [[-half, -0.2], [half, -0.2], [half, front], [-half, front]]
      .map(([u, v]) => this.world.localToWorld(u, v, arena));
    arena.crumbleMask.clear()
      .poly(corners.flatMap((point) => [point.x * CELL, point.y * CELL]))
      .fill(0xffffff);

    // Crumble every cell row the front crossed this frame. The debris is what hides the boundary.
    for (let row = Math.ceil(previous - 0.5); row <= Math.floor(front - 0.5); row++) {
      this.crumbleRow(arena, row);
    }

    // A line of stress at the wavefront, so there is something to follow.
    const edgeA = this.world.localToWorld(-half, front, arena);
    const edgeB = this.world.localToWorld(half, front, arena);
    this.crumbleEdge.clear();
    if (front < reach) {
      this.crumbleEdge
        .moveTo(edgeA.x * CELL, edgeA.y * CELL).lineTo(edgeB.x * CELL, edgeB.y * CELL)
        .stroke({ width: 3, color: PALETTE.ink, alpha: 0.75 })
        .moveTo(edgeA.x * CELL, edgeA.y * CELL).lineTo(edgeB.x * CELL, edgeB.y * CELL)
        .stroke({ width: 9, color: PROVINCE_PALETTE[arena.province].accent, alpha: 0.22 });
    }
  }

  /**
   * Throw chips out of the seams of one row of cells.
   *
   * Along the gaps rather than at the cell centres: it is the material *between* the squares that
   * is leaving, and debris that came from the middle of a brick would read as the brick breaking
   * rather than as the board separating.
   */
  private crumbleRow(arena: Arena, row: number): void {
    const live = arena.bricks.filter((brick) => brick.alive && Math.abs(brick.v - (row + 0.5)) < 0.5);
    if (!live.length) return;
    for (const brick of live) {
      const definition = materialOf(brick.kind);
      // The four seams around this cell, at the edge of the gap rather than the brick face.
      for (const [du, dv] of [[BRICK_HALF + 0.08, 0], [-BRICK_HALF - 0.08, 0], [0, BRICK_HALF + 0.08], [0, -BRICK_HALF - 0.08]]) {
        const point = this.world.localToWorld(brick.u + du, brick.v + dv, arena);
        this.effects.spawnShards(point.x * CELL, point.y * CELL, definition.edge, 2, 0.55, false);
      }
      const centre = this.world.localToWorld(brick.u, brick.v, arena);
      this.effects.spawnDust(centre.x * CELL, centre.y * CELL, definition.base, 2, 0.5);
    }
    this.audio.play(SOUNDS.brickChip);
    // A shallow kick per row, so the whole sequence has a rolling rumble to it.
    this.camera.kick(0, 1, 1.6);
  }

  private updateDisplays(dt: number): void {
    this.drone.position.set(this.player.x, this.player.y);
    this.drone.rotation = this.player.heading;
    this.drone.visible = !this.arena;
    const arena = this.arena;
    if (arena) {
      // The board reacts: every live brick is shoved, spun, squashed and lit by whatever waves are
      // travelling through it. No reveal ramp and no scale pop -- the bricks are the rock and are
      // drawn in full from the first frame; what changes is whether the crumble mask has uncovered
      // them yet. Fading them in read as a board materialising over the terrain.
      stepReactions(arena.bricks, dt);
      const accent = PROVINCE_PALETTE[arena.province].accent;
      for (const brick of arena.bricks) if (brick.alive && brick.display) {
        applyReaction(brick, brick.baseX ?? 0, brick.baseY ?? 0, arena.angle, accent);
      }
      for (const membrane of arena.membranes) {
        if (!membrane.display) continue;
        membrane.display.alpha = Number.isFinite(membrane.maxLife)
          ? clamp(membrane.life / membrane.maxLife, 0, 1) * 0.9 + 0.1
          : 1;
      }
      if (arena.paddle.display) {
        // Recoil: driven down into the board by a return and springing back, plus a squash across
        // its face. The paddle is the player's own hand on the board and had no reaction at all.
        arena.paddle.recoil = Math.max(0, arena.paddle.recoil - dt * 7);
        const recoil = arena.paddle.recoil ** 2;
        const position = this.world.localToWorld(arena.paddle.u, 0.2 - recoil * 0.24, arena);
        arena.paddle.display.position.set(position.x * CELL, position.y * CELL);
        arena.paddle.display.rotation = arena.angle;
        arena.paddle.display.skew.x = arena.paddle.impact * -0.05;
        arena.paddle.display.scale.set(1 + recoil * 0.1, 1 - recoil * 0.22);
      }
      // The rails answer a rebound too, rather than the frame being inert scenery.
      arena.railFlash = Math.max(0, arena.railFlash - dt * 4.5);
      if (arena.railLight) arena.railLight.alpha = 0.55 + this.claimHeat * 0.45 + arena.railFlash * 0.5;
      const toWorld = (u: number, v: number) => this.world.localToWorld(u, v, arena);
      drawTrajectory(arena, toWorld, this.predictedBounces);
      drawLiabilityGauge(arena, toWorld, this.soakCapacity);
      for (const ball of arena.balls) {
        const position = this.world.localToWorld(ball.u, ball.v, arena);
        ball.display?.position.set(position.x * CELL, position.y * CELL);
        // The ball flashes and swells on contact and settles back. Its glow is set by every event
        // that touches it, so a facet turn and a break and a paddle return all read on the ball
        // itself as well as on whatever it struck.
        ball.glow = Math.max(0, ball.glow - dt * 5);
        if (ball.display) {
          const pop = ball.glow ** 2;
          ball.display.scale.set((1 + this.claimHeat * 0.22) * (1 + pop * 0.55));
          ball.display.alpha = 1;
        }
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
    // Divided by the rate: at x8 the player asked for speed, and stacking full-length freezes on
    // top of that turns a fast-forward into a stutter.
    if (this.hitPause > 0) this.hitPause = Math.max(0, this.hitPause - step * this.simulationRate);
    this.pauseView.showCountdown(this.resumeCountdown);
    this.advanceTutorial(step);
    if (this.gestureDemo) {
      this.gestureDemo.left -= step;
      if (this.gestureDemo.left <= 0) {
        // Seen. Never offered again, for any rung that uses the same gesture.
        this.gesturesShown.add(this.gestureDemo.kind);
        this.gestureDemo = null;
      }
    }
    // Re-anchored every frame, because the subject moves: the tag rides the drone through the
    // rock and the paddle across the board, which is the difference between a prompt that belongs
    // to a thing and one that merely appeared near it once.
    this.renderTutorial();
    this.coach.update(step, this.camera.rotation, this.camera.zoom);
    if (this.tutorialFadeTimer > 0) {
      this.tutorialFadeTimer = Math.max(0, this.tutorialFadeTimer - step);
      if (this.tutorialFadeTimer === 0) {
        this.tutorialComplete = true;
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
    // On a touchscreen the strip stops naming keys. Everything that was a key is either a labelled
    // button in the thumb zone or a gesture with its own on-screen control, so listing "SPACE
    // serve" to somebody holding a phone is worse than saying nothing -- it advertises a control
    // they do not have and hides the one they do.
    const touching = this.touch.used;
    if (!this.tutorialComplete) {
      if (!(this.atAnchor() && this.mode === "survey")) return "";
      return touching ? "FORGE AVAILABLE" : "<b>C</b> forge";
    }
    if (this.craftingOpen) {
      return touching ? "TAP A STATION TO FIT" : "<b>1-9</b> forge <b>ESC</b> close";
    }
    if (this.mode === "survey") {
      if (touching) {
        // Only what is genuinely contextual. The stick, the turn zone and COMMIT all show
        // themselves, so repeating them here would be a manual for controls already on screen.
        return this.atAnchor() ? "AT AN ANCHOR · FORGE OPEN" : "";
      }
      return [
        this.hasCommitted ? "" : "<b>WASD</b> move <b>Q / E</b> aim <b>F</b> commit",
        this.atAnchor() ? "<b>C</b> forge" : "",
        "<b>M</b> atlas",
      ].filter(Boolean).join(" ");
    }
    const rail = this.economy.verbs.has("railSeed") && !this.railSeedUsed;
    const blast = this.economy.blastCharges > 0;
    if (touching) {
      // The two claim verbs have no button of their own yet, so they stay named -- but as the
      // thing they do rather than as the key that does it.
      return [
        rail ? "RAIL READY" : "",
        blast ? `BLAST ×${this.economy.blastCharges}` : "",
      ].filter(Boolean).join(" · ");
    }
    return [
      this.hasServed ? "" : "<b>A / D</b> paddle <b>Q / E</b> aim <b>SPACE</b> serve",
      rail ? "<b>R</b> rail" : "",
      blast ? `<b>B</b> blast ×${this.economy.blastCharges}` : "",
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
    this.coach.hide();
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
    this.pauseView.bind({
      onResume: () => this.togglePause(),
      onSaveNow: () => { this.saveNow(); },
      onExport: () => this.exportExpedition(),
      onImport: () => void this.importExpedition(),
      onEndClaim: () => this.endClaimNow(),
    });
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
      /**
       * Stop the clock and pose the crumble at an exact wavefront position.
       *
       * The sequence lasts 0.55s and a screenshot takes longer than that, so sampling it against
       * the wall clock photographs the finished board and calls it the middle.
       */
      poseCrumble(front: number) {
        game.app.ticker.stop();
        const arena = game.arena;
        if (!arena) return { front: -1 };
        arena.crumbleFront = 0;
        // The live animation has almost certainly finished by the time a test can pose it, and
        // finishing releases the mask -- so rewinding the front alone leaves `updateCrumble`
        // returning immediately and the loop below spinning forever. Rebuild the mask first.
        if (!arena.crumbleMask) {
          const rebuilt = new Graphics();
          arena.container.addChild(rebuilt);
          arena.board.mask = rebuilt;
          arena.crumbleMask = rebuilt;
        }
        const step = 1 / 240;
        // Bounded, so a mistake in here can never hang the page.
        for (let guard = 0; guard < 4000 && arena.crumbleFront < front; guard++) {
          (game as unknown as { updateCrumble(dt: number): void }).updateCrumble(step);
          game.effects.update(step);
          if (!arena.crumbleMask) break;
        }
        game.app.renderer.render(game.app.stage);
        return { front: arena.crumbleFront, effects: game.effects.count };
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

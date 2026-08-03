import {
  Application,
  BlurFilter,
  Container,
  Graphics,
  Sprite,
  Text,
} from "pixi.js";
import {
  BALL_SPEED,
  BASE_ARENA_BALLS,
  BRICK_HALF,
  CELL,
  DEFAULT_SEED,
  PADDLE_CHASSIS,
  PALETTE,
  PHYSICS_STEP,
  PROVINCE_PALETTE,
  RESOURCES,
  VIEW_HEIGHT,
  VIEW_WIDTH,
  WORLD_COLS,
  WORLD_ROWS,
  type MaterialKind,
  type PaddleChassis,
  type ResourceId,
  FABRICATED_CHASSIS,
} from "./config";
import { calculateClaimDamage } from "./claims";
import { collectCascade, initialRegrowthBudget, spawnMembrane, stepMembranes, stepRegrowth } from "./arenaRules";
import { BLAST_CHARGE_BRICKS, Economy, RECIPES, type Recipe, type VerbId } from "./economy";
import { materialOf } from "./materials";
import { createBall, predictPath, stepBall, type BallStepEvents } from "./physics";
import { ChunkedTerrain } from "./terrain";
import type { Arena, Ball, Brick, FrameGeometry, Membrane, Vec2 } from "./types";
import { WorldModel } from "./world";
import { BANK } from "./worldgen/landmarks";

type Mode = "survey" | "play";

interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; maxLife: number; graphic: Graphics;
}

interface Ring {
  x: number; y: number; radius: number; speed: number;
  life: number; maxLife: number; color: number; graphic: Graphics;
}

interface CameraTransition {
  elapsed: number; duration: number;
  fromFocus: Vec2; toFocus: Vec2;
  fromRotation: number; toRotation: number;
  exit: boolean;
}

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

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const flatPoints = (points: Vec2[]) => points.flatMap((point) => [point.x, point.y]);
const smooth = (t: number) => {
  const p = clamp(t, 0, 1);
  return p * p * p * (p * (p * 6 - 15) + 10);
};
const normalizeAngle = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
const nearestAngle = (from: number, target: number) => from + normalizeAngle(target - from);
/** Coarse grades, never exact contents. Resonance adds precision, not identity. */
const gradeOf = (value: number, grades: number): string => {
  const labels = grades >= 1 ? ["VERY LOW", "LOW", "MODERATE", "HIGH", "VERY HIGH"] : ["LOW", "MODERATE", "HIGH"];
  return labels[clamp(Math.floor(value * labels.length), 0, labels.length - 1)];
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
  readonly effectLayer = new Container();
  readonly actorLayer = new Container();
  readonly framePreview = new Container();
  readonly frameWash = new Graphics();
  readonly frameGrid = new Graphics();
  readonly frameScan = new Graphics();
  readonly frameReturns = new Graphics();
  readonly keys = new Set<string>();

  chassisRoster: PaddleChassis[] = [...PADDLE_CHASSIS];
  /**
   * Deployment previews. Each `.field-window` card owns its own Pixi Application
   * whose canvas lives *inside* the card, which is what makes them composite
   * reliably across browsers rather than being hidden under the deployment layer.
   * They run the production Arena, terrain raster, brick, paddle, ball and
   * collision code -- never a parallel renderer.
   */
  readonly deploymentPreviewApps: Application[] = [];
  readonly deploymentPreviewContent: Container[] = [];
  deploymentPreviews: Arena[] = [];
  deploymentPreviewResetTimers: number[] = [];
  deploymentPreviewAITargets: number[] = [];
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
  lastRegionName = "";
  /** Province rules are taught on arrival, once, rather than nagged permanently. */
  readonly regionsSeen = new Set<string>();
  /** Hints disappear once the player has actually performed the action. */
  hasCommitted = false;
  hasServed = false;
  private lastCargo = new Map<ResourceId, number>();
  private cargoSignature = "";
  /** Set when a claim resolves at zero health; the exit camera returns to the Landing. */
  private dying = false;
  deaths = 0;
  /**
   * Controls are taught by doing. Each step checks off as the player performs it,
   * and the whole panel retires permanently once all five are done.
   */
  readonly tutorial = [
    { id: "move", keys: "WASD", label: "MOVE", done: false },
    { id: "aim", keys: "Q / E", label: "AIM FRAME", done: false },
    { id: "commit", keys: "F", label: "COMMIT CLAIM", done: false },
    { id: "serve", keys: "SPACE", label: "SERVE", done: false },
    { id: "paddle", keys: "A / D", label: "MOVE PADDLE", done: false },
  ];
  tutorialComplete = false;
  private tutorialFadeTimer = 0;
  private arrivalTimer = 0;
  private compassTimer = 0;
  player: { x: number; y: number; heading: number };
  arena: Arena | null = null;
  railSeedUsed = false;
  railSeedArmed = false;
  time = 0;
  physicsAccumulator = 0;
  cameraFocus: Vec2;
  cameraRotation = 0;
  cameraTransition: CameraTransition | null = null;
  particles: Particle[] = [];
  rings: Ring[] = [];
  drone: Container;
  audio: AudioContext | null = null;

  private readonly viewport = document.querySelector<HTMLElement>(".viewport");
  private readonly regionLabel = document.querySelector<HTMLElement>("#biomeLabel");
  private readonly bandLabel = document.querySelector<HTMLElement>("#bandLabel");
  private readonly depthLabel = document.querySelector<HTMLElement>("#depthLabel");
  private readonly objectiveTitle = document.querySelector<HTMLElement>("#objectiveTitle");
  private readonly objectiveDetail = document.querySelector<HTMLElement>("#objectiveDetail");
  private readonly claimLabel = document.querySelector<HTMLElement>("#claimValue");
  private readonly claimDetail = document.querySelector<HTMLElement>("#claimDetail");
  private readonly damageStat = document.querySelector<HTMLElement>("#damageStat");
  private readonly damageLabel = document.querySelector<HTMLElement>("#damageValue");
  private readonly integrityStat = document.querySelector<HTMLElement>("#integrityStat");
  private readonly healthLabel = document.querySelector<HTMLElement>("#healthValue");
  private readonly healthBar = document.querySelector<HTMLElement>("#healthBar");
  private readonly ballPips = document.querySelector<HTMLElement>("#ballPips");
  private readonly arrivalCard = document.querySelector<HTMLElement>("#arrival");
  private readonly soakLabel = document.querySelector<HTMLElement>("#soakValue");
  private readonly healthMax = document.querySelector<HTMLElement>("#healthMax");
  private readonly tutorialPanel = document.querySelector<HTMLElement>("#tutorial");
  private readonly tutorialList = document.querySelector<HTMLElement>("#tutorialList");
  private readonly bankNotice = document.querySelector<HTMLElement>("#bankNotice");
  private readonly forgeCompass = document.querySelector<HTMLElement>("#forgeCompass");
  private readonly forgeCompassRange = document.querySelector<HTMLElement>("#forgeCompassRange");
  private readonly telemetry = document.querySelector<HTMLElement>("#telemetry");
  private readonly instructions = document.querySelector<HTMLElement>("#instructions");
  private readonly toast = document.querySelector<HTMLElement>("#toast");
  private readonly briefing = document.querySelector<HTMLElement>("#briefing");
  private readonly beginButton = document.querySelector<HTMLButtonElement>("#beginButton");
  private readonly beginLabel = document.querySelector<HTMLElement>("#beginLabel");
  private readonly resonancePanel = document.querySelector<HTMLElement>("#resonance");
  private readonly cargoStrip = document.querySelector<HTMLElement>("#cargo");
  private readonly craftingPanel = document.querySelector<HTMLElement>("#crafting");
  private readonly craftingList = document.querySelector<HTMLElement>("#craftingList");
  private readonly craftingHint = document.querySelector<HTMLElement>("#craftingHint");
  private readonly forgeStats = document.querySelector<HTMLElement>("#forgeStats");
  private readonly forgeBank = document.querySelector<HTMLElement>("#forgeBank");

  constructor(seedLabel: string = DEFAULT_SEED) {
    this.world = new WorldModel(seedLabel);
    this.terrain = new ChunkedTerrain(this.world);
    this.player = { x: this.world.start.x * CELL, y: this.world.start.y * CELL, heading: Math.PI / 2 };
    this.cameraFocus = { x: this.player.x, y: this.player.y };
    for (const chassis of this.chassisRoster) this.chassisIntegrity.set(chassis.id, chassis.maxHealth);
    // Anchor zero: the Refit Bay in the lander.
    this.anchors.push({ id: "refitBay", x: this.world.start.x, y: this.world.start.y, name: "REFIT BAY" });
    this.drone = this.createDrone();
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
  /** The drone always pulls a little; modules widen it. */
  get vacuumRadius() { return 1.15 + this.moduleUpgrades.vacuum; }
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
    this.app.stage.addChild(this.worldRoot);
    this.worldRoot.addChild(this.farLayer, this.terrainLayer, this.landmarkLayer, this.effectLayer, this.actorLayer, this.framePreview);
    this.terrainLayer.addChild(this.terrain.container);
    this.buildFarGeology();
    // Build the opening neighbourhood synchronously so the first frame is complete.
    this.terrain.requestAround(this.player.x, this.player.y);
    this.terrain.pump(24);
    this.buildLandmarks();
    this.actorLayer.addChild(this.drone);
    this.bindInput();
    await this.buildDeploymentPreviews();
    this.app.ticker.add((ticker) => this.update(Math.min(0.25, ticker.deltaMS / 1000)));
    this.updateUI();
    this.exposeDebug();
    await new Promise<void>((resolve) => requestAnimationFrame(() => {
      this.layoutDeploymentPreviews();
      requestAnimationFrame(() => resolve());
    }));
    this.briefing?.classList.remove("loading");
    this.briefing?.classList.add("ready");
    this.briefing?.setAttribute("aria-busy", "false");
    this.briefing?.setAttribute("data-render-state", "ready");
  }

  private buildFarGeology(): void {
    const shadow = new Graphics();
    shadow.rect(0, 0, WORLD_COLS * CELL, WORLD_ROWS * CELL).fill(PALETTE.void);
    this.farLayer.addChild(shadow);
  }

  /**
   * World-scale telegraphs. Cornerstones announce themselves from a distance with
   * light and structure, because direction must be discoverable even though
   * contents are a wager.
   */
  private buildLandmarks(): void {
    for (const site of this.world.generated.cornerstones) {
      const glow = new Graphics();
      const province = this.world.provinceAt(site.x, site.y);
      const colour = PROVINCE_PALETTE[province].accent;
      glow.circle(site.x * CELL, site.y * CELL, 300).fill({ color: colour, alpha: 0.06 });
      glow.filters = [new BlurFilter({ strength: 34, quality: 3 })];
      this.landmarkLayer.addChild(glow);

      const ribs = new Graphics();
      for (let index = 0; index < 6; index++) {
        const radius = (4.4 + index * 1.15) * CELL;
        ribs.ellipse(site.x * CELL, site.y * CELL, radius, radius * 0.76)
          .stroke({ width: 3, color: colour, alpha: 0.1 });
      }
      ribs.label = `landmark-${site.id}`;
      this.landmarkLayer.addChild(ribs);

      const marker = new Text({
        text: site.name,
        style: { fill: colour, fontSize: 26, fontWeight: "800", letterSpacing: 4 },
      });
      marker.anchor.set(0.5);
      marker.position.set(site.x * CELL, (site.y - 7) * CELL);
      marker.alpha = 0.42;
      this.landmarkLayer.addChild(marker);
    }
  }

  private createDrone(): Container {
    const drone = new Container();
    const width = this.paddleWidth * CELL;
    const beam = new Graphics().poly([-width * 0.32, -14, -116, -286, 116, -286, width * 0.32, -14]).fill({ color: PALETTE.karstEdge, alpha: 0.022 });
    beam.filters = [new BlurFilter({ strength: 16, quality: 2 })];
    const thrusterGlow = new Graphics().ellipse(0, 9, width * 0.56, 18).fill({ color: PALETTE.karstEdge, alpha: 0.18 });
    thrusterGlow.filters = [new BlurFilter({ strength: 10, quality: 2 })];
    const silhouette = new Graphics()
      .poly([-width / 2 - 13, -2, -width / 2, -11, width / 2, -11, width / 2 + 13, -2, width / 2 + 8, 9, -width / 2 - 8, 9])
      .fill(0x111719).stroke({ width: 2.5, color: PALETTE.machine, alpha: 0.9 });
    const armor = new Graphics()
      .roundRect(-width / 2, -8, width, 14, 4).fill(0x2a302f).stroke({ width: 2, color: PALETTE.karstEdge, alpha: 0.95 })
      .roundRect(-width * 0.31, -5, width * 0.62, 8, 2).fill(0x101516).stroke({ width: 1.5, color: PALETTE.machine, alpha: 0.75 })
      .rect(-width * 0.22, -2.5, width * 0.44, 3).fill({ color: PALETTE.ink, alpha: 0.92 });
    const hardware = new Graphics()
      .circle(-width * 0.39, -1, 3).fill(PALETTE.machine)
      .circle(width * 0.39, -1, 3).fill(PALETTE.machine)
      .moveTo(-width * 0.36, 10).lineTo(-width * 0.28, 17).lineTo(-width * 0.18, 10)
      .moveTo(width * 0.36, 10).lineTo(width * 0.28, 17).lineTo(width * 0.18, 10)
      .stroke({ width: 3, color: PALETTE.machine, alpha: 0.8 });
    const mast = new Graphics()
      .moveTo(0, -11).lineTo(0, -28).stroke({ width: 2, color: PALETTE.machine })
      .poly([-7, -29, 0, -37, 7, -29, 0, -21]).fill(0x14191a).stroke({ width: 2, color: PALETTE.ink, alpha: 0.8 })
      .circle(0, -29, 2.2).fill(PALETTE.ink);
    drone.addChild(beam, thrusterGlow, silhouette, armor, hardware, mast);
    return drone;
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
      if (event.repeat || this.cameraTransition) return;
      if (!event.repeat && event.code === "KeyC" && this.mode === "survey") { this.toggleCrafting(); return; }
      if (this.craftingOpen) {
        const digit = Number(event.code.replace("Digit", ""));
        if (event.code.startsWith("Digit") && digit >= 1 && digit <= 9) this.craftByIndex(digit - 1);
        if (event.code === "Escape") this.toggleCrafting();
        return;
      }
      if (this.mode === "survey") {
        if (event.code === "Enter" || event.code === "KeyF") this.establishArena();
      } else if (this.arena) {
        if (event.code === "Space") this.serve();
        if (event.code === "KeyR" && this.economy.verbs.has("railSeed") && !this.railSeedUsed) this.placeRailSeed();
        if (event.code === "KeyB" && this.economy.blastCharges > 0) this.useBlastCharge();
      }
    });
    window.addEventListener("keyup", (event) => this.keys.delete(event.code));
    window.addEventListener("blur", () => this.keys.clear());
    window.addEventListener("resize", () => this.layoutDeploymentPreviews());
    for (const button of document.querySelectorAll<HTMLButtonElement>("[data-chassis]")) {
      button.addEventListener("click", () => this.selectChassis(Number(button.dataset.chassis)));
      button.addEventListener("pointerenter", () => { this.hoveredChassisIndex = Number(button.dataset.chassis); });
      button.addEventListener("pointerleave", () => {
        if (this.hoveredChassisIndex === Number(button.dataset.chassis)) this.hoveredChassisIndex = null;
      });
    }
    this.beginButton?.addEventListener("click", () => this.start());
  }

  /**
   * Build the three live preview arenas.
   *
   * Sampled from the real Landing at `world.start` facing east, so every card
   * shows the actual teaching board -- chalk crossed by slate -- cut to that
   * chassis's own fixed frame. The differences between the three cards are
   * therefore real geometry differences, not illustration.
   */
  private async buildDeploymentPreviews(): Promise<void> {
    const windows = Array.from(document.querySelectorAll<HTMLElement>(".field-window"));
    for (let index = 0; index < this.chassisRoster.length; index++) {
      const chassis = this.chassisRoster[index];
      const sampleFrame: FrameGeometry = {
        origin: { x: this.world.start.x, y: this.world.start.y },
        angle: Math.PI / 2,
        width: chassis.frame.width,
        depth: chassis.frame.depth,
      };
      const sampled = this.world.framedBricks(sampleFrame);
      const bricks: Brick[] = sampled.map(({ cell, sourceCells, u, v, footprint, persistent }) => ({
        u, v, x: cell.x, y: cell.y, hp: cell.hp, maxHp: cell.maxHp, kind: cell.kind,
        resource: cell.resource, facetAxis: cell.facetAxis,
        alive: true, persistent, liable: !persistent && materialOf(cell.kind).liable,
        footprint, sourceCells, hitFlash: 0,
      }));
      const container = new Container();
      const board = new Container();
      const actors = new Container();
      container.addChild(board, actors);
      const reading = this.world.readRegion(sampleFrame.origin.x, sampleFrame.origin.y);
      const arena: Arena = {
        origin: { x: 0, y: 0 }, angle: 0, width: chassis.frame.width, depth: chassis.frame.depth,
        province: reading.province, ecotone: reading.ecotone, band: reading.band as Arena["band"],
        bricks, balls: [createBall(0, 0.72)], drops: [], membranes: [],
        regrowthBudget: 0, regrowthTimer: 0,
        resourceCount: 0, collected: 0, combo: 0,
        splitArmed: false, splitUsed: false, serveAim: 0, initialLiability: bricks.length, damageTaken: 0,
        spareBalls: 0,
        paddle: { u: 0, velocity: 0, width: chassis.paddleWidth, flash: 0, impact: 0 },
        container, board, actors, resolving: false, visualAge: 2,
      };
      this.buildArenaDisplay(arena);
      for (const brick of arena.bricks) {
        brick.display!.alpha = 1;
        brick.display!.scale.set(1);
      }
      arena.liabilityDisplay!.visible = false;

      const scene = new Container();
      // Real world rock behind the board, rasterized by the production terrain
      // renderer so the preview cannot drift from how the world actually looks.
      const span = Math.max(chassis.frame.width, chassis.frame.depth) + 6;
      const regionX = Math.max(0, Math.round(sampleFrame.origin.x - span));
      const regionY = Math.max(0, Math.round(sampleFrame.origin.y - span));
      const regionCols = Math.min(WORLD_COLS - regionX, span * 2);
      const regionRows = Math.min(WORLD_ROWS - regionY, span * 2);
      const regionTexture = this.terrain.regionTexture(regionX, regionY, regionCols, regionRows);
      if (regionTexture) {
        const terrain = new Sprite(regionTexture);
        terrain.width = regionCols * CELL;
        terrain.height = regionRows * CELL;
        terrain.pivot.set((sampleFrame.origin.x - regionX) * CELL, (sampleFrame.origin.y - regionY) * CELL);
        terrain.rotation = -sampleFrame.angle;
        terrain.alpha = 0.72;
        scene.addChild(terrain);
      }
      scene.addChild(container);
      arena.container = scene;

      const ball = arena.balls[0];
      ball.served = true;
      ball.vu = BALL_SPEED * (index === 1 ? -0.32 : 0.24 + index * 0.08);
      ball.vv = Math.sqrt(BALL_SPEED ** 2 - ball.vu ** 2);

      const previewApp = new Application();
      await previewApp.init({
        width: 512,
        height: 640,
        background: PALETTE.void,
        antialias: true,
        autoDensity: true,
        resolution: Math.min(2, window.devicePixelRatio || 1),
        preference: ["webgl"],
        powerPreference: "high-performance",
      });
      previewApp.canvas.classList.add("deployment-preview-canvas");
      previewApp.canvas.setAttribute("aria-hidden", "true");
      windows[index]?.appendChild(previewApp.canvas);
      previewApp.stage.addChild(scene);
      previewApp.ticker.stop();
      this.deploymentPreviewApps.push(previewApp);
      this.deploymentPreviewContent.push(container);
      this.deploymentPreviews.push(arena);
      this.deploymentPreviewResetTimers.push(0);
      this.deploymentPreviewAITargets.push(0);
    }
    // The world stays hidden until deployment so the previews read cleanly.
    this.worldRoot.visible = false;
    this.layoutDeploymentPreviews();
  }

  /**
   * Fit each preview to its card's measured box. Driven by the real DOM rect and
   * the arena's measured local bounds rather than nominal grid dimensions, which
   * is what keeps the three cards aligned at any viewport size or pixel ratio.
   */
  private layoutDeploymentPreviews(): void {
    const windows = document.querySelectorAll<HTMLElement>(".field-window");
    windows.forEach((windowElement, index) => {
      const arena = this.deploymentPreviews[index];
      const previewApp = this.deploymentPreviewApps[index];
      const content = this.deploymentPreviewContent[index];
      if (!arena || !previewApp || !content) return;
      const rect = windowElement.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      previewApp.renderer.resize(width, height);
      const inset = 12;
      const bounds = content.getLocalBounds();
      const sceneScale = Math.min((width - inset * 2) / bounds.width, (height - inset * 2) / bounds.height);
      arena.container.scale.set(sceneScale);
      arena.container.position.set(
        width / 2 - (bounds.x + bounds.width / 2) * sceneScale,
        height - inset - (bounds.y + bounds.height) * sceneScale,
      );
      previewApp.renderer.render(previewApp.stage);
    });
  }

  private updateDeploymentPreviews(dt: number): void {
    const active = new Set<number>();
    if (this.selectedChassisIndex !== null) active.add(this.selectedChassisIndex);
    if (this.hoveredChassisIndex !== null) active.add(this.hoveredChassisIndex);
    for (const index of active) this.updateDeploymentPreview(index, dt);
  }

  /**
   * Run one preview. The paddle is driven by a predictive tracker that reflects
   * the ball's path off the rails, so the demonstration plays competently instead
   * of chasing the ball.
   */
  private updateDeploymentPreview(index: number, dt: number): void {
    const arena = this.deploymentPreviews[index];
    const previewApp = this.deploymentPreviewApps[index];
    const chassis = this.chassisRoster[index];
    const ball = arena?.balls[0];
    if (!arena || !previewApp || !chassis || !ball) return;

    if (this.deploymentPreviewResetTimers[index] > 0) {
      this.deploymentPreviewResetTimers[index] -= dt;
      if (this.deploymentPreviewResetTimers[index] <= 0) this.resetDeploymentPreview(index);
      previewApp.renderer.render(previewApp.stage);
      return;
    }

    const rail = arena.width / 2 - ball.radius;
    let target = ball.u;
    if (ball.vv < -0.01) {
      target += ball.vu * Math.max(0, (ball.v - 0.2) / -ball.vv);
      while (target < -rail || target > rail) {
        if (target > rail) target = rail - (target - rail);
        if (target < -rail) target = -rail + (-rail - target);
      }
    }
    const targetBlend = 1 - Math.exp(-7 * dt);
    this.deploymentPreviewAITargets[index] += (target - this.deploymentPreviewAITargets[index]) * targetBlend;
    const error = this.deploymentPreviewAITargets[index] - arena.paddle.u;
    const movement = Math.abs(error) < 0.065 ? 0 : clamp(error, -chassis.paddleSpeed * dt, chassis.paddleSpeed * dt);
    arena.paddle.velocity = dt > 0 ? movement / dt : 0;
    arena.paddle.u += movement;
    const paddleLimit = arena.width / 2 - arena.paddle.width / 2;
    arena.paddle.u = clamp(arena.paddle.u, -paddleLimit, paddleLimit);
    arena.paddle.flash = Math.max(0, arena.paddle.flash - dt);
    arena.paddle.impact *= Math.pow(0.0005, dt);

    for (const brick of arena.bricks) {
      brick.hitFlash = Math.max(0, brick.hitFlash - dt);
      if (brick.display && brick.alive) {
        const flash = brick.hitFlash / 0.14;
        brick.display.scale.set(1 + flash * 0.07, 1 - flash * 0.05);
      }
    }
    stepBall(ball, arena, dt, (events) => {
      for (const brick of events.bricks) {
        if (!brick.alive) continue;
        // Persistent structure never breaks, in previews as in play.
        if (materialOf(brick.kind).persistent) {
          brick.hitFlash = 0.14;
          continue;
        }
        brick.hp--;
        brick.hitFlash = 0.14;
        if (brick.damageDisplay) brick.damageDisplay.alpha = brick.hp < brick.maxHp ? 0.82 : 0;
        if (brick.hp <= 0) {
          brick.alive = false;
          if (brick.display) brick.display.visible = false;
        }
      }
    });
    if (ball.v < -0.7 || !arena.bricks.some((brick) => brick.alive && !brick.persistent)) {
      this.deploymentPreviewResetTimers[index] = 0.45;
    }
    const position = this.world.localToWorld(ball.u, ball.v, arena);
    ball.display?.position.set(position.x * CELL, position.y * CELL);
    const paddlePosition = this.world.localToWorld(arena.paddle.u, 0.2, arena);
    arena.paddle.display?.position.set(paddlePosition.x * CELL, paddlePosition.y * CELL);
    if (arena.paddle.display) arena.paddle.display.skew.x = arena.paddle.impact * -0.05;
    ball.trail.unshift({ x: position.x * CELL, y: position.y * CELL });
    if (ball.trail.length > 11) ball.trail.pop();
    if (ball.trailDisplay) {
      ball.trailDisplay.clear();
      const colour = PROVINCE_PALETTE[arena.province].accent;
      for (let trailIndex = ball.trail.length - 1; trailIndex > 0; trailIndex--) {
        const from = ball.trail[trailIndex];
        const to = ball.trail[trailIndex - 1];
        const progress = 1 - trailIndex / ball.trail.length;
        ball.trailDisplay.moveTo(from.x, from.y).lineTo(to.x, to.y)
          .stroke({ width: 1.2 + progress * 2.4, color: colour, alpha: 0.08 + progress * 0.3 });
      }
    }
    previewApp.renderer.render(previewApp.stage);
  }

  private resetDeploymentPreview(index: number): void {
    const arena = this.deploymentPreviews[index];
    const ball = arena?.balls[0];
    if (!arena || !ball) return;
    for (const brick of arena.bricks) {
      brick.alive = true;
      brick.hp = brick.maxHp;
      brick.hitFlash = 0;
      if (brick.display) {
        brick.display.visible = true;
        brick.display.scale.set(1);
      }
      if (brick.damageDisplay) brick.damageDisplay.alpha = 0;
    }
    arena.paddle.u = 0;
    arena.paddle.velocity = 0;
    arena.paddle.flash = 0;
    arena.paddle.impact = 0;
    this.deploymentPreviewAITargets[index] = 0;
    ball.u = 0;
    ball.v = 0.72;
    ball.vu = BALL_SPEED * (index === 1 ? -0.32 : 0.24 + index * 0.08);
    ball.vv = Math.sqrt(BALL_SPEED ** 2 - ball.vu ** 2);
    ball.trail.length = 0;
    this.deploymentPreviewResetTimers[index] = 0;
  }

  start(): void {
    if (this.started || this.selectedChassisIndex === null) return;
    this.started = true;
    this.briefing?.classList.add("hidden");
    for (const previewApp of this.deploymentPreviewApps) previewApp.canvas.style.visibility = "hidden";
    this.worldRoot.visible = true;
    this.viewport?.classList.add("deployed");
    this.applyMode();
    this.renderTutorial();
    this.initAudio();
    this.showToast(`${this.chassis.name} DEPLOYED · SURVEY LIVE`);
    this.updateUI();
  }

  private selectChassis(index: number): void {
    const chassis = this.chassisRoster[index];
    if (!chassis || this.started) return;
    this.chassisIndex = index;
    this.selectedChassisIndex = index;
    this.drone.destroy({ children: true });
    this.drone = this.createDrone();
    this.actorLayer.addChild(this.drone);
    this.drawFramePreview();
    for (const button of document.querySelectorAll<HTMLButtonElement>("[data-chassis]")) {
      button.setAttribute("aria-pressed", String(Number(button.dataset.chassis) === index));
    }
    this.deploymentPreviews.forEach((preview, previewIndex) => { preview.container.alpha = previewIndex === index ? 1 : 0.76; });
    this.deploymentPreviewApps.forEach((previewApp) => previewApp.renderer.render(previewApp.stage));
    if (this.beginLabel) this.beginLabel.textContent = "DEPLOY";
    if (this.beginButton) this.beginButton.disabled = false;
    this.updateUI();
  }

  private initAudio(): void {
    if (!this.audio) this.audio = new AudioContext();
    if (this.audio.state === "suspended") void this.audio.resume();
  }

  private tone(frequency: number, duration: number, volume = 0.025, end = frequency): void {
    if (!this.audio) return;
    const now = this.audio.currentTime;
    const oscillator = this.audio.createOscillator();
    const gain = this.audio.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, end), now + duration);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain).connect(this.audio.destination);
    oscillator.start(now);
    oscillator.stop(now + duration);
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

  private atAnchor(): boolean {
    const nearest = this.nearestAnchor();
    return !!nearest && nearest.distance <= 9;
  }

  private toggleCrafting(): void {
    if (!this.craftingOpen && !this.atAnchor()) {
      // Point at the nearest forge rather than only reporting its absence.
      this.compassTimer = 4;
      this.updateCompass();
      this.tone(240, 0.12, 0.03, 180);
      return;
    }
    this.craftingOpen = !this.craftingOpen;
    this.craftingPanel?.classList.toggle("open", this.craftingOpen);
    this.applyMode();
    this.renderCrafting();
    this.updateUI();
  }

  /**
   * Every recipe, always.
   *
   * These were previously hidden until the player had held their materials, which
   * collapsed the panel to four cards on an empty bank and concealed the shape of
   * the whole chain. An upgrade tree you cannot see is not a goal. Maxed items stay
   * listed and say so rather than vanishing.
   */
  private craftableRecipes(): Recipe[] {
    return [...RECIPES];
  }

  /**
   * The payoff leads.
   *
   * A player at the forge is asking "what do I get", not "what is it called".
   * The magnitude and the stat are therefore the largest thing on each card, the
   * name is secondary, and the cost is a row of legible chips that highlight the
   * specific material they are short of.
   */
  private effectHeadline(recipe: Recipe): { value: string; unit: string } {
    const effect = recipe.effect;
    switch (effect.type) {
      case "armor": return { value: `+${effect.amount}`, unit: "ARMOR" };
      case "maxIntegrity": return { value: `+${effect.amount}`, unit: "MAX HEALTH" };
      case "repair": return { value: `+${effect.amount}`, unit: "HEALTH" };
      case "paddleSpeedPercent": return { value: `+${effect.amount}%`, unit: "PADDLE SPEED" };
      case "paddleWidth": return { value: `+${effect.amount}`, unit: "PADDLE WIDTH" };
      case "travelSpeedPercent": return { value: `+${effect.amount}%`, unit: "TRAVEL SPEED" };
      case "rotationPercent": return { value: `+${effect.amount}%`, unit: "ROTATION" };
      case "sharpenResonance": return { value: `+${effect.amount}`, unit: "SURVEY GRADE" };
      case "blastCharges": return { value: `×${effect.amount}`, unit: "BLAST CHARGES" };
      case "vacuum": return { value: `+${effect.amount}`, unit: "ORE PULL" };
      case "predictBounces": return { value: `${effect.amount}`, unit: "PREDICTED BOUNCES" };
      case "fabricate": {
        const chassis = FABRICATED_CHASSIS.find((entry) => entry.id === effect.chassisId);
        return { value: chassis ? `${chassis.frame.width}×${chassis.frame.depth}` : "NEW", unit: "NEW CHASSIS" };
      }
    }
  }

  private renderCrafting(): void {
    if (!this.craftingList) return;
    const recipes = this.craftableRecipes();
    const tiers: Array<{ tier: 1 | 2 | 3; label: string; note: string }> = [
      { tier: 1, label: "FIELD FORGE", note: "Copper, iron and coal" },
      { tier: 2, label: "MACHINED MODULES", note: "Cobalt and gems · fitted to this chassis" },
      { tier: 3, label: "CHASSIS FABRICATION", note: "Adamantite and ecotone reagents" },
    ];

    let keyIndex = 0;
    const sections: string[] = [];
    for (const { tier, label, note } of tiers) {
      const group = recipes.filter((recipe) => recipe.tier === tier);
      if (!group.length) continue;
      const cards = group.map((recipe) => {
        const index = keyIndex++;
        const key = index < 9 ? String(index + 1) : "";
        const check = this.economy.canCraft(this.chassis.id, recipe.id);
        const cost = this.economy.costOf(this.chassis.id, recipe);
        const headline = this.effectHeadline(recipe);
        const owned = this.economy.craftCount(this.chassis.id, recipe.id);
        const chips = (Object.entries(cost) as Array<[ResourceId, number]>)
          .map(([resource, count]) => {
            const definition = RESOURCES[resource];
            const have = this.economy.amount(resource);
            const short = have < count;
            const colour = `#${definition.colour.toString(16).padStart(6, "0")}`;
            return `<span class="chip${short ? " short" : ""}">
              <i style="background:${colour}"></i>${count} ${definition.name}${short ? `<u>${have}</u>` : ""}
            </span>`;
          }).join("");
        const blocked = !check.ok && check.reason !== "INSUFFICIENT MATERIAL" ? check.reason : "";
        const subnote = recipe.replaces || recipe.requiresVerb
          ? recipe.detail
          : owned > 0 && recipe.limit
            ? `OWNED ${owned}/${recipe.limit}`
            : "";
        return `<button class="craft-card${check.ok ? " affordable" : ""}${blocked ? " blocked" : ""}"
            type="button" data-recipe="${recipe.id}" ${check.ok ? "" : "disabled"}>
          ${key ? `<em class="craft-key">${key}</em>` : ""}
          <span class="craft-gain"><b>${headline.value}</b><i>${headline.unit}</i></span>
          <span class="craft-name">${recipe.name}</span>
          ${subnote ? `<span class="craft-note">${subnote}</span>` : ""}
          <span class="craft-cost">${chips}</span>
          ${blocked ? `<span class="craft-block">${blocked}</span>` : ""}
        </button>`;
      }).join("");
      sections.push(`<section class="forge-tier tier-${tier}">
        <h3>${label}<span>${note}</span></h3>
        <div class="craft-grid">${cards}</div>
      </section>`);
    }

    this.craftingList.innerHTML = sections.join("")
      || '<p class="forge-empty">Nothing forgeable yet. Mine copper and coal, then bank it.</p>';
    for (const card of this.craftingList.querySelectorAll<HTMLButtonElement>(".craft-card")) {
      card.addEventListener("click", () => this.craftById(card.dataset.recipe ?? ""));
    }

    // Current chassis values, so the player sees what each card is improving.
    if (this.forgeStats) {
      this.forgeStats.innerHTML = `
        <span><i>ARMOR</i><b>${this.soakCapacity}</b></span>
        <span><i>HEALTH</i><b>${this.integrity}<u>/${this.maxIntegrity}</u></b></span>
        <span><i>CHASSIS</i><b class="chassis">${this.chassis.name}</b></span>`;
    }
    // The bank rail: deciding what to make requires knowing what is in stock.
    if (this.forgeBank) {
      const held = [...this.economy.banked.entries()].filter(([, count]) => count > 0);
      this.forgeBank.innerHTML = held.length
        ? `<b>BANK</b>${held.sort((a, b) => b[1] - a[1]).map(([resource, count]) => {
            const definition = RESOURCES[resource];
            const colour = `#${definition.colour.toString(16).padStart(6, "0")}`;
            return `<span class="bank-item"><i style="background:${colour}"></i>${definition.name}<b>${count}</b></span>`;
          }).join("")}`
        : '<b>BANK</b><span class="bank-empty">EMPTY</span>';
    }
    if (this.craftingHint) {
      this.craftingHint.textContent = recipes.length
        ? "Click or press a number. ESC closes."
        : "Bank material at the chest to forge.";
    }
  }

  private craftById(recipeId: string): void {
    const index = this.craftableRecipes().findIndex((recipe) => recipe.id === recipeId);
    if (index >= 0) this.craftByIndex(index);
  }

  private craftByIndex(index: number): void {
    const recipe = this.craftableRecipes()[index];
    if (!recipe) return;
    const result = this.economy.craft(this.chassis.id, recipe.id);
    if (!result.ok) {
      this.showToast(result.reason ?? "CANNOT FORGE");
      this.tone(88, 0.16, 0.03, 60);
      return;
    }
    if (result.effect?.type === "repair") {
      this.integrity = Math.min(this.maxIntegrity, this.integrity + result.effect.amount);
    }
    if (result.effect?.type === "fabricate") {
      const chassisId = result.effect.chassisId;
      this.chassisRoster = this.economy.availableChassis(PADDLE_CHASSIS);
      const built = this.chassisRoster.find((chassis) => chassis.id === chassisId);
      // A fabricated chassis starts bare: modules do not transfer, so the shape is
      // what was bought, and the modules must be earned again.
      if (built && !this.chassisIntegrity.has(built.id)) this.chassisIntegrity.set(built.id, built.maxHealth);
      this.showToast(`${recipe.name.toUpperCase()} · CHASSIS AVAILABLE AT REFIT`);
    } else {
      this.showToast(`${recipe.name.toUpperCase()} FORGED`);
    }
    // Paddle width changes must reach the drone silhouette immediately.
    if (result.effect?.type === "paddleWidth") {
      this.drone.destroy({ children: true });
      this.drone = this.createDrone();
      this.actorLayer.addChild(this.drone);
    }
    this.tone(320, 0.16, 0.035, 620);
    this.renderCrafting();
    this.updateUI();
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
        alive: true, persistent, liable: !persistent && definition.liable,
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
    this.buildArenaDisplay(arena);
    const center = this.world.localToWorld(0, arena.depth / 2, arena);
    this.beginCamera({ x: center.x * CELL, y: center.y * CELL }, -arena.angle, false);
    this.showToast(`${arena.initialLiability} LIABLE · ${resources} RETURNS · CLAIM COMMITTED`);
    this.tone(94, 0.18, 0.035, 260);
    this.updateUI();
  }

  private buildArenaDisplay(arena: Arena): void {
    const half = arena.width / 2;
    const accent = PROVINCE_PALETTE[arena.province].accent;
    const points = [[-half, -0.15], [half, -0.15], [half, arena.depth + 0.55], [-half, arena.depth + 0.55]]
      .map(([u, v]) => this.world.localToWorld(u, v, arena));
    const polygon = flatPoints(points.map((point) => ({ x: point.x * CELL, y: point.y * CELL })));
    const cutShadow = new Graphics().poly(polygon).fill({ color: 0x020506, alpha: 0.54 }).stroke({ width: 12, color: 0x020405, alpha: 0.52 });
    const section = new Graphics().poly(polygon).fill({ color: 0x0d1011, alpha: 0.28 });
    const lattice = new Graphics();
    for (let column = 1; column < arena.width; column++) {
      const u = -half + column;
      const a = this.world.localToWorld(u, 0, arena);
      const b = this.world.localToWorld(u, arena.depth + 0.5, arena);
      lattice.moveTo(a.x * CELL, a.y * CELL).lineTo(b.x * CELL, b.y * CELL);
    }
    for (let row = 1; row <= arena.depth; row++) {
      const a = this.world.localToWorld(-half, row, arena);
      const b = this.world.localToWorld(half, row, arena);
      lattice.moveTo(a.x * CELL, a.y * CELL).lineTo(b.x * CELL, b.y * CELL);
    }
    lattice.stroke({ width: 1, color: accent, alpha: 0.075 });
    arena.board.addChild(cutShadow, section, lattice);
    for (const brick of arena.bricks) {
      brick.display = this.createBrickDisplay(brick);
      const position = this.world.localToWorld(brick.u, brick.v, arena);
      brick.display.position.set(position.x * CELL, position.y * CELL);
      brick.display.rotation = arena.angle;
      brick.display.alpha = 0;
      brick.display.scale.set(0.72);
      arena.board.addChild(brick.display);
    }
    const rails = new Graphics();
    const railLight = new Graphics();
    const farA = this.world.localToWorld(-half, arena.depth + 0.5, arena);
    const farB = this.world.localToWorld(half, arena.depth + 0.5, arena);
    for (const graphic of [rails, railLight]) {
      for (const u of [-half, half]) {
        const a = this.world.localToWorld(u, 0, arena);
        const b = this.world.localToWorld(u, arena.depth + 0.5, arena);
        graphic.moveTo(a.x * CELL, a.y * CELL).lineTo(b.x * CELL, b.y * CELL);
      }
      graphic.moveTo(farA.x * CELL, farA.y * CELL).lineTo(farB.x * CELL, farB.y * CELL);
    }
    rails.stroke({ width: 11, color: 0x050809, alpha: 0.92 });
    railLight.stroke({ width: 2.5, color: accent, alpha: 0.88 });
    const anchors = new Graphics();
    for (const point of [points[1], points[2], points[3]]) {
      const x = point.x * CELL; const y = point.y * CELL;
      anchors.circle(x, y, 8).fill(0x111718).stroke({ width: 2.5, color: accent });
      anchors.circle(x, y, 2.5).fill(accent);
    }
    arena.actors.addChild(rails, railLight, anchors);
    arena.trajectoryDisplay = new Graphics();
    arena.actors.addChild(arena.trajectoryDisplay);
    arena.liabilityDisplay = new Graphics();
    arena.actors.addChild(arena.liabilityDisplay);
    arena.paddle.display = this.createPaddle(arena);
    arena.actors.addChild(arena.paddle.display);
    for (const ball of arena.balls) this.attachBall(ball, arena);
  }

  /**
   * Brick artwork is driven by the material table, and each rule-active material
   * draws the thing that makes it behave differently. A facet draws its actual
   * diagonal, because a turn the player cannot see coming is not a rule -- it is
   * a surprise.
   */
  private createBrickDisplay(brick: Brick): Container {
    const container = new Container();
    const size = BRICK_HALF * 2 * CELL;
    const definition = materialOf(brick.kind);
    const seed = ((brick.x * 73 + brick.y * 151) % 97) / 97;
    const shadow = new Graphics().roundRect(-size / 2 + 2, -size / 2 + 4, size, size, 6).fill({ color: 0x000000, alpha: 0.55 });
    const rimWidth = definition.hp >= 4 ? 3.4 : definition.hp >= 2 ? 2.8 : 2.2;
    const rim = new Graphics().roundRect(-size / 2, -size / 2, size, size, 6)
      .fill(0x151817).stroke({ width: rimWidth, color: definition.edge, alpha: 0.9 });
    const face = new Graphics().roundRect(-size / 2 + 3, -size / 2 + 3, size - 6, size - 6, 4).fill(definition.base);
    const material = new Graphics();

    if (definition.reflect === "facet") {
      // The facet plane, drawn explicitly along its real axis.
      const extent = size * 0.42;
      const dx = brick.facetAxis === 1 ? extent : -extent;
      material.moveTo(-dx, -extent).lineTo(dx, extent)
        .stroke({ width: 6, color: definition.edge, alpha: 0.45 });
      material.moveTo(-dx, -extent).lineTo(dx, extent)
        .stroke({ width: 2.2, color: 0xffffff, alpha: 0.8 });
      if (definition.chains) {
        material.circle(0, 0, size * 0.17).stroke({ width: 2, color: 0xffffff, alpha: 0.85 });
        material.circle(0, 0, size * 0.07).fill({ color: 0xffffff, alpha: 0.9 });
      }
    } else if (!definition.liable) {
      // Non-liable stone is banded and heavy: it reads as structure you may keep.
      for (const offset of [-0.22, 0, 0.22]) {
        material.moveTo(-size * 0.36, size * offset - 3).lineTo(size * 0.36, size * offset + 3)
          .stroke({ width: 2.4, color: definition.edge, alpha: 0.34 });
      }
      material.moveTo(-size * 0.3, -size * 0.3).lineTo(size * 0.12, size * 0.02)
        .stroke({ width: 2, color: 0xffffff, alpha: 0.22 });
    } else if (definition.regrows) {
      material.circle(-size * 0.16, -size * 0.08, size * 0.2).circle(size * 0.13, size * 0.12, size * 0.24)
        .stroke({ width: 2.3, color: definition.edge, alpha: 0.42 });
      material.moveTo(-size * 0.34, size * 0.14).lineTo(-size * 0.1, 0).lineTo(size * 0.1, size * 0.1).lineTo(size * 0.34, -size * 0.12)
        .stroke({ width: 2, color: definition.edge, alpha: 0.6 });
    } else if (definition.spawnsMembrane) {
      material.circle(0, 0, size * 0.26).fill({ color: definition.edge, alpha: 0.28 })
        .stroke({ width: 2.4, color: definition.edge, alpha: 0.9 });
      material.circle(0, 0, size * 0.1).fill({ color: 0xffffff, alpha: 0.7 });
    } else if (definition.persistent) {
      material.roundRect(-size * 0.3, -size * 0.3, size * 0.6, size * 0.6, 3)
        .fill(0x1b2224).stroke({ width: 2.2, color: definition.edge, alpha: 0.95 });
      material.moveTo(-size * 0.16, 0).lineTo(size * 0.16, 0)
        .moveTo(0, -size * 0.16).lineTo(0, size * 0.16)
        .stroke({ width: 2, color: definition.edge, alpha: 0.8 });
    } else {
      material.moveTo(-size * 0.34, -size * 0.28 + seed * 4).lineTo(-size * 0.08, -size * 0.3).lineTo(size * 0.34, -size * 0.26)
        .stroke({ width: 2, color: definition.edge, alpha: 0.26 });
      material.moveTo(-size * 0.3, size * 0.06).lineTo(size * 0.02, size * 0.02).lineTo(size * 0.3, size * 0.1)
        .stroke({ width: 1.2, color: 0x191b19, alpha: 0.46 });
    }

    // Revealed resource inclusion, in the material's own colour.
    if (brick.resource) {
      const colour = RESOURCES[brick.resource].colour;
      material.poly([-5, 7, -9, -2, -2, -10, 7, -6, 10, 4, 3, 10]).fill({ color: colour, alpha: 0.92 });
      material.poly([-5, 7, -9, -2, -2, -10, 7, -6, 10, 4, 3, 10]).stroke({ width: 1.4, color: 0xffffff, alpha: 0.42 });
    }

    const bevel = new Graphics()
      .moveTo(-size / 2 + 7, -size / 2 + 5).lineTo(size / 2 - 7, -size / 2 + 5).stroke({ width: 1.5, color: 0xffffff, alpha: 0.2 })
      .moveTo(-size / 2 + 5, size / 2 - 7).lineTo(-size / 2 + 5, -size / 2 + 7).stroke({ width: 1, color: 0xffffff, alpha: 0.12 });
    const damage = new Graphics()
      .moveTo(-size * 0.3, -size * 0.1).lineTo(-size * 0.08, 1).lineTo(-size * 0.18, size * 0.28)
      .moveTo(-size * 0.08, 1).lineTo(size * 0.15, -size * 0.18).lineTo(size * 0.32, -size * 0.08)
      .stroke({ width: 2.1, color: PALETTE.ink, alpha: 0.78 });
    damage.alpha = 0;
    brick.damageDisplay = damage;
    container.addChild(shadow, rim, face, material, bevel, damage);
    return container;
  }

  private createPaddle(arena: Arena): Container {
    const container = new Container();
    const width = arena.paddle.width * CELL;
    const energy = PROVINCE_PALETTE[arena.province].accent;
    const glow = new Graphics().roundRect(-width / 2 + 8, -7, width - 16, 14, 7).fill({ color: energy, alpha: 0.3 });
    glow.filters = [new BlurFilter({ strength: 10, quality: 2 })];
    const chassis = new Graphics()
      .poly([-width / 2 - 7, 0, -width / 2 + 1, -11, width / 2 - 1, -11, width / 2 + 7, 0, width / 2 - 2, 10, -width / 2 + 2, 10])
      .fill(0x101617).stroke({ width: 2.2, color: PALETTE.machine });
    const emitter = new Graphics()
      .roundRect(-width / 2 + 7, -7, width - 14, 11, 4).fill(0x242a29).stroke({ width: 2, color: energy, alpha: 0.92 })
      .roundRect(-width / 2 + 13, -5, width - 26, 4, 2).fill({ color: energy, alpha: 0.92 });
    const hardware = new Graphics()
      .circle(-width / 2 + 10, 1, 3).fill(PALETTE.machine)
      .circle(width / 2 - 10, 1, 3).fill(PALETTE.machine)
      .rect(-10, 6, 20, 5).fill(0x303634).stroke({ width: 1.5, color: PALETTE.machine });
    container.addChild(glow, chassis, emitter, hardware);
    return container;
  }

  private attachBall(ball: Ball, arena: Arena): void {
    const display = new Container();
    const color = PROVINCE_PALETTE[arena.province].accent;
    const glow = new Graphics().circle(0, 0, ball.radius * CELL * 1.8).fill({ color, alpha: 0.24 });
    glow.filters = [new BlurFilter({ strength: 7, quality: 2 })];
    const ring = new Graphics().circle(0, 0, ball.radius * CELL + 2).stroke({ width: 1.5, color, alpha: 0.75 });
    const core = new Graphics().circle(0, 0, ball.radius * CELL).fill(PALETTE.ink).stroke({ width: 2, color: 0x282d2b });
    core.circle(-3, -3, 2).fill(0xffffff);
    display.addChild(glow, ring, core);
    ball.display = display;
    ball.trailDisplay = new Graphics();
    arena.actors.addChild(ball.trailDisplay, display);
  }

  private attachMembrane(membrane: Membrane, arena: Arena): void {
    const graphic = new Graphics();
    const position = this.world.localToWorld(membrane.u, membrane.v, arena);
    graphic.roundRect(-membrane.halfWidth * CELL, -membrane.halfHeight * CELL, membrane.halfWidth * 2 * CELL, membrane.halfHeight * 2 * CELL, 6)
      .fill({ color: PALETTE.spore, alpha: 0.34 })
      .stroke({ width: 2.4, color: PALETTE.spore, alpha: 0.92 });
    graphic.position.set(position.x * CELL, position.y * CELL);
    graphic.rotation = arena.angle;
    membrane.display = graphic;
    arena.actors.addChild(graphic);
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
    this.tone(150, 0.07, 0.03, 260);
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
    this.attachMembrane(membrane, arena);
    this.railSeedUsed = true;
    this.showToast("RAIL SEED PLACED");
    this.tone(420, 0.12, 0.03, 700);
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
      this.spawnParticlesAtBrick(brick, PALETTE.danger, 12);
    }
    this.tone(70, 0.4, 0.06, 40);
    this.showToast(`BLAST CHARGE · ${survivors.length} CLEARED`);
    this.updateUI();
  }

  private handleBallEvents(ball: Ball, events: BallStepEvents): void {
    const arena = this.arena;
    if (!arena) return;
    if (events.paddle) this.tone(120, 0.05, 0.025, 220);
    if (events.rail) this.tone(340, 0.025, 0.012, 300);
    if (events.faceted) this.tone(660, 0.05, 0.02, 900);
    for (const membrane of events.membranes) {
      this.tone(500, 0.05, 0.022, 320);
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
      this.spawnRingAtBrick(brick, definition.edge, 0.7);
      this.registerMechanismStrike(brick);
      this.tone(280, 0.12, 0.03, 520);
      return;
    }

    brick.hp--;
    brick.hitFlash = 0.12;
    arena.combo++;
    this.spawnParticlesAtBrick(brick, definition.edge, 10);
    this.tone(brick.hp <= 0 ? 260 : 170, brick.hp <= 0 ? 0.08 : 0.04, 0.025, brick.hp <= 0 ? 110 : 220);
    if (brick.hp > 0) return;

    brick.alive = false;
    brick.display?.destroy({ children: true });
    this.world.removeFootprint(brick.footprint, false, brick.persistent);
    if (brick.resource) this.spawnDrop(brick, brick.resource);
    if (definition.spawnsMembrane) {
      const membrane = spawnMembrane(arena, brick);
      this.attachMembrane(membrane, arena);
      this.tone(360, 0.16, 0.03, 180);
    }
    // Charged crystal cascades into adjacent crystal. A lattice-aligned claim
    // therefore pays off in a way a misaligned one cannot.
    if (definition.chains) {
      const cascade = collectCascade(arena, brick);
      for (const affected of cascade) {
        affected.hp--;
        affected.hitFlash = 0.16;
        this.spawnParticlesAtBrick(affected, materialOf(affected.kind).edge, 8);
        if (affected.hp > 0) continue;
        affected.alive = false;
        affected.display?.destroy({ children: true });
        this.world.removeFootprint(affected.footprint, false, affected.persistent);
        if (affected.resource) this.spawnDrop(affected, affected.resource);
      }
      if (cascade.length) {
        this.spawnRingAtBrick(brick, PALETTE.facetHot, 1.4);
        this.showToast(`LATTICE CASCADE · ${cascade.length}`);
        this.tone(150, 0.3, 0.05, 880);
      }
    }
    void ball;
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
      return;
    }
    if (verb && this.economy.grantVerb(verb)) {
      this.anchors.push({ id, x: site.candidate.x, y: site.candidate.y, name: `${site.candidate.name} ANCHOR` });
      this.showToast(`${VERB_NAMES[verb]} ACQUIRED`);
      this.tone(180, 0.5, 0.06, 900);
      this.updateUI();
    }
  }

  private spawnDrop(brick: Brick, resource: ResourceId): void {
    const arena = this.arena;
    if (!arena) return;
    const colour = RESOURCES[resource].colour;
    const display = new Graphics().poly([0, -7, 7, 0, 0, 7, -7, 0]).fill(colour).stroke({ width: 2, color: 0xffffff, alpha: 0.6 });
    arena.actors.addChild(display);
    arena.drops.push({ u: brick.u, v: brick.v, vv: -2.2, spin: 0, resource, display });
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
      this.tone(92, 0.42, 0.06, 36);
      const paddlePoint = this.world.localToWorld(arena.paddle.u, 0.2, arena);
      this.spawnRing(paddlePoint.x * CELL, paddlePoint.y * CELL, PALETTE.danger, 1.7);
    } else {
      this.showToast(`ARMOR HELD · ${remaining.length}/${this.soakCapacity}`);
    }
    this.updateUI();
    const focus = this.dying
      ? { x: this.world.start.x * CELL, y: this.world.start.y * CELL }
      : { x: this.player.x, y: this.player.y };
    window.setTimeout(() => this.beginCamera(focus, 0, true), arena.damageTaken > 0 ? 680 : 360);
  }

  private beginCamera(target: Vec2, rotation: number, exit: boolean): void {
    const targetRotation = nearestAngle(this.cameraRotation, rotation);
    this.cameraTransition = {
      elapsed: 0,
      duration: Math.abs(targetRotation - this.cameraRotation) > Math.PI * 0.75 ? 0.92 : 0.72,
      fromFocus: { ...this.cameraFocus }, toFocus: target,
      fromRotation: this.cameraRotation, toRotation: targetRotation, exit,
    };
    this.updateUI();
  }

  private updateCamera(dt: number): void {
    if (this.cameraTransition) {
      const transition = this.cameraTransition;
      transition.elapsed += dt;
      const progress = clamp(transition.elapsed / transition.duration, 0, 1);
      const eased = smooth(progress);
      this.cameraFocus.x = transition.fromFocus.x + (transition.toFocus.x - transition.fromFocus.x) * eased;
      this.cameraFocus.y = transition.fromFocus.y + (transition.toFocus.y - transition.fromFocus.y) * eased;
      this.cameraRotation = transition.fromRotation + (transition.toRotation - transition.fromRotation) * eased;
      if (progress >= 1) {
        const exit = transition.exit;
        this.cameraTransition = null;
        if (exit) this.completeArenaExit();
        else this.showToast("LOCAL PLAYFIELD STABILIZED");
        this.updateUI();
      }
    } else if (!this.arena) {
      const response = 1 - Math.pow(0.001, dt);
      this.cameraFocus.x += (this.player.x - this.cameraFocus.x) * response;
      this.cameraFocus.y += (this.player.y - this.cameraFocus.y) * response;
      this.cameraRotation += (0 - this.cameraRotation) * response;
    }
    this.worldRoot.pivot.set(this.cameraFocus.x, this.cameraFocus.y);
    this.worldRoot.position.set(VIEW_WIDTH / 2, VIEW_HEIGHT / 2);
    this.worldRoot.rotation = this.cameraRotation;
  }

  private completeArenaExit(): void {
    this.arena?.container.destroy({ children: true });
    this.arena = null;
    this.mode = "survey";
    this.cameraRotation = 0;
    this.drone.visible = true;
    if (this.dying) this.die();
    this.applyMode();
    this.framePreview.visible = true;
    this.drawFramePreview();
    this.updateUI();
  }

  private update(dt: number): void {
    this.time += dt;
    if (this.arena) this.arena.visualAge += dt;
    if (!this.started) this.updateDeploymentPreviews(Math.min(0.025, dt));
    if (this.started && !this.craftingOpen) {
      if (this.mode === "survey") this.updateSurvey(dt);
      if (this.mode === "play") this.updatePlay(dt);
    }
    // Terrain residency follows the camera and is amortized across frames.
    this.terrain.requestAround(this.cameraFocus.x, this.cameraFocus.y);
    this.terrain.pump(1);
    this.updateEffects(Math.min(0.033, dt));
    this.updateCamera(dt);
    this.updateDisplays();
  }

  private updateSurvey(dt: number): void {
    const dx = (this.keys.has("KeyD") ? 1 : 0) - (this.keys.has("KeyA") ? 1 : 0);
    const dy = (this.keys.has("KeyS") ? 1 : 0) - (this.keys.has("KeyW") ? 1 : 0);
    const length = Math.hypot(dx, dy) || 1;
    const movementDt = Math.min(0.033, dt);
    const vx = dx / length * this.travelSpeed * movementDt;
    const vy = dy / length * this.travelSpeed * movementDt;
    if (this.world.isOpenWorldPixels(this.player.x + vx, this.player.y)) this.player.x += vx;
    if (this.world.isOpenWorldPixels(this.player.x, this.player.y + vy)) this.player.y += vy;
    const rotation = (this.keys.has("KeyE") ? 1 : 0) - (this.keys.has("KeyQ") ? 1 : 0);
    this.player.heading = normalizeAngle(this.player.heading + rotation * this.rotationSpeed * dt);
    if (dx || dy) this.markTutorial("move");
    if (rotation) this.markTutorial("aim");
    this.tryBank();
    this.drawFramePreview();
  }

  private updatePlay(dt: number): void {
    const arena = this.arena;
    if (!arena || arena.resolving || this.cameraTransition) return;
    this.physicsAccumulator = Math.min(PHYSICS_STEP * 5, this.physicsAccumulator + dt);
    while (this.physicsAccumulator >= PHYSICS_STEP) {
      this.stepArena(arena, PHYSICS_STEP);
      this.physicsAccumulator -= PHYSICS_STEP;
      if (arena.resolving) break;
    }
  }

  private stepArena(arena: Arena, dt: number): void {
    const input = (this.keys.has("KeyD") || this.keys.has("ArrowRight") ? 1 : 0) - (this.keys.has("KeyA") || this.keys.has("ArrowLeft") ? 1 : 0);
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
      const aim = (this.keys.has("KeyE") ? 1 : 0) - (this.keys.has("KeyQ") ? 1 : 0);
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
      revived.display = this.createBrickDisplay(revived);
      const position = this.world.localToWorld(revived.u, revived.v, arena);
      revived.display.position.set(position.x * CELL, position.y * CELL);
      revived.display.rotation = arena.angle;
      arena.board.addChild(revived.display);
      this.world.restoreCell(revived.x, revived.y, revived.kind);
      this.tone(210, 0.14, 0.02, 130);
    }
    for (const expired of stepMembranes(arena, dt)) expired.display?.destroy();

    for (let index = arena.balls.length - 1; index >= 0; index--) {
      const ball = arena.balls[index];
      if (ball.v >= -0.72) continue;
      ball.display?.destroy({ children: true });
      ball.trailDisplay?.destroy();
      arena.balls.splice(index, 1);
      this.tone(170, 0.2, 0.03, 48);
    }

    if (!arena.balls.length) {
      // Sequential balls, from the Twin Engine. A spare is a fresh serve, not a
      // second simultaneous ball.
      if (arena.spareBalls > 0) {
        arena.spareBalls--;
        const replacement = createBall(arena.paddle.u);
        arena.balls.push(replacement);
        this.attachBall(replacement, arena);
        arena.serveAim = 0.08;
        this.showToast(`SEQUENTIAL BALL · ${arena.spareBalls} REMAINING`);
        this.tone(300, 0.2, 0.035, 520);
        return;
      }
      this.finishArena("lost");
      return;
    }

    for (let index = arena.drops.length - 1; index >= 0; index--) {
      const drop = arena.drops[index];
      drop.v += drop.vv * dt;
      drop.vv -= 1.4 * dt;
      drop.spin += dt * 5;
      // Ore pull. Falls off with distance so a wide radius still rewards
      // positioning rather than removing the catch entirely.
      const reach = this.vacuumRadius;
      const offset = arena.paddle.u - drop.u;
      if (Math.abs(offset) < reach && drop.v < 4.5) {
        const falloff = 1 - Math.abs(offset) / reach;
        drop.u += Math.sign(offset) * falloff * falloff * 5.4 * dt;
      }
      if (drop.v < 0.45) {
        if (Math.abs(drop.u - arena.paddle.u) < arena.paddle.width / 2 + 0.35) {
          arena.collected++;
          this.economy.add(drop.resource, 1);
          this.tone(540 + arena.collected * 35, 0.1, 0.03, 760);
        }
        drop.display.destroy();
        arena.drops.splice(index, 1);
      }
    }
    if (!arena.bricks.some((brick) => brick.alive && !brick.persistent)) this.finishArena("clear");
  }

  private updateDisplays(): void {
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
      this.drawTrajectory(arena);
      this.drawLiabilityGauge(arena);
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
    }

    const reading = this.world.readRegion(this.player.x / CELL, this.player.y / CELL);
    // Crossing into a new region teaches its rule once and refreshes the goal.
    if (reading.regionName !== this.lastRegionName) {
      this.lastRegionName = reading.regionName;
      if (this.started && !arena) this.showArrival(reading);
      this.updateUI();
    }
    if (this.tutorialFadeTimer > 0) {
      this.tutorialFadeTimer = Math.max(0, this.tutorialFadeTimer - 1 / 60);
      if (this.tutorialFadeTimer === 0) {
        this.tutorialComplete = true;
        this.tutorialPanel?.remove();
        this.updateUI();
      }
    }
    if (this.compassTimer > 0) {
      this.compassTimer = Math.max(0, this.compassTimer - 1 / 60);
      this.updateCompass();
    }
    if (this.arrivalTimer > 0) {
      this.arrivalTimer = Math.max(0, this.arrivalTimer - 1 / 60);
      if (this.arrivalTimer === 0) this.arrivalCard?.classList.remove("show");
    }
    if (this.regionLabel) this.regionLabel.textContent = reading.regionName;
    // Band is a tier, not a sentence. Depth beside it already says "shallow".
    if (this.bandLabel) this.bandLabel.textContent = `B${reading.band}`;
    // Cargo is only safe once banked, so the hold says so while it is at risk.
    this.cargoStrip?.classList.toggle("at-risk", this.economy.carriedTotal > 0);
    if (this.depthLabel) this.depthLabel.textContent = `${Math.round(reading.depthMetres)}m`;
    // Load lives in exactly one place. It was previously stated four times --
    // the board bar, a telemetry line, a claim readout and a detail line -- which
    // is three too many and made none of them authoritative.
    const remaining = arena?.bricks.filter((brick) => brick.alive && brick.liable).length ?? 0;
    const projected = calculateClaimDamage(remaining, this.soakCapacity);
    if (this.claimLabel) this.claimLabel.textContent = String(remaining);
    if (this.claimDetail) this.claimDetail.textContent = "REMAINING";
    // Damage is an alarm, so it is absent at zero rather than reading "00".
    this.damageStat?.classList.toggle("active", projected > 0);
    if (this.damageLabel) this.damageLabel.textContent = String(projected);

    if (this.healthLabel) this.healthLabel.textContent = String(this.integrity);
    if (this.healthMax) this.healthMax.textContent = `/ ${this.maxIntegrity}`;
    if (this.soakLabel) this.soakLabel.textContent = `ARMOR ${this.soakCapacity}`;
    const healthFraction = this.maxIntegrity ? this.integrity / this.maxIntegrity : 0;
    if (this.healthBar) this.healthBar.style.setProperty("--v", `${Math.round(healthFraction * 100)}%`);
    this.integrityStat?.style.setProperty("--max", String(this.maxIntegrity));
    if (this.integrityStat) {
      this.integrityStat.dataset.state = healthFraction <= 0.25 ? "critical" : healthFraction <= 0.5 ? "warn" : "ok";
    }
    if (this.ballPips) {
      const live = arena?.balls.length ?? 0;
      const spare = arena?.spareBalls ?? 0;
      this.ballPips.innerHTML = `${"<i></i>".repeat(live)}${'<i class="spare"></i>'.repeat(spare)}`;
      // Only hide the row once a single ball with no spare is all that remains.
      const ballsStat = this.ballPips.parentElement;
      if (ballsStat) ballsStat.dataset.trivial = String(!arena || (live <= 1 && spare === 0));
    }

    this.updateCargo();
    this.updateResonance(reading);
    if (this.telemetry) {
      // Survey only, and only the one fact the player cannot read off the world:
      // which cornerstone is nearest, and how far.
      const cornerstone = arena ? null : this.world.nearestCornerstone(this.player.x / CELL, this.player.y / CELL);
      this.telemetry.textContent = cornerstone ? `${cornerstone.name}  ${Math.round(cornerstone.distance * 14)}m` : "";
    }
  }

  /** Check off a control the player has just used. */
  private markTutorial(id: string): void {
    if (this.tutorialComplete) return;
    const step = this.tutorial.find((entry) => entry.id === id);
    if (!step || step.done) return;
    step.done = true;
    this.renderTutorial();
    this.tone(520, 0.08, 0.022, 720);
    if (this.tutorial.every((entry) => entry.done)) {
      this.tutorialFadeTimer = 1.4;
      this.tutorialPanel?.classList.add("done");
    }
  }

  private renderTutorial(): void {
    if (!this.tutorialList || this.tutorialComplete) return;
    this.tutorialList.innerHTML = this.tutorial
      .map((step) => `<li class="${step.done ? "done" : ""}"><b>${step.keys}</b><span>${step.label}</span><i></i></li>`)
      .join("");
  }

  /**
   * Cargo becomes safe on reaching the bank. Deposit is automatic because there
   * is never a reason to refuse it -- the tension is getting home, not the keypress.
   */
  private tryBank(): void {
    if (this.economy.carriedTotal <= 0) return;
    const distance = Math.hypot(BANK.x - this.player.x / CELL, BANK.y - this.player.y / CELL);
    if (distance > 4.5) return;
    const stored = this.economy.deposit();
    this.showToast(`${stored} BANKED`);
    this.tone(300, 0.22, 0.04, 780);
    if (this.bankNotice) {
      this.bankNotice.textContent = `+${stored} BANKED`;
      this.bankNotice.classList.remove("show");
      requestAnimationFrame(() => this.bankNotice?.classList.add("show"));
      window.setTimeout(() => this.bankNotice?.classList.remove("show"), 1400);
    }
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
    this.tone(70, 0.8, 0.07, 32);
    this.terrain.requestAround(this.player.x, this.player.y);
    this.updateUI();
  }

  /**
   * Pin the compass to the viewport edge along the bearing to the nearest anchor.
   * The arrow sits where the target would leave the screen, so it reads as a
   * direction to travel rather than a floating marker.
   */
  private updateCompass(): void {
    if (!this.forgeCompass) return;
    if (this.compassTimer <= 0) {
      this.forgeCompass.classList.remove("show");
      return;
    }
    const anchor = this.anchors
      .map((entry) => ({ entry, distance: Math.hypot(entry.x - this.player.x / CELL, entry.y - this.player.y / CELL) }))
      .sort((a, b) => a.distance - b.distance)[0];
    if (!anchor) return;

    const host = this.app.canvas.getBoundingClientRect();
    const viewportRect = this.viewport?.getBoundingClientRect();
    if (!viewportRect || host.width < 1) return;

    // World -> screen through the same camera transform the renderer uses.
    const scale = host.width / VIEW_WIDTH;
    const dx = anchor.entry.x * CELL - this.cameraFocus.x;
    const dy = anchor.entry.y * CELL - this.cameraFocus.y;
    const cos = Math.cos(this.cameraRotation);
    const sin = Math.sin(this.cameraRotation);
    const screenX = (dx * cos - dy * sin) * scale;
    const screenY = (dx * sin + dy * cos) * scale;
    const bearing = Math.atan2(screenY, screenX);

    const inset = 64;
    const halfW = Math.max(40, viewportRect.width / 2 - inset);
    const halfH = Math.max(40, viewportRect.height / 2 - inset);
    // Intersect the bearing with the inset rectangle.
    const scaleToEdge = Math.min(
      halfW / Math.max(1e-3, Math.abs(Math.cos(bearing))),
      halfH / Math.max(1e-3, Math.abs(Math.sin(bearing))),
    );
    const edgeX = viewportRect.width / 2 + Math.cos(bearing) * scaleToEdge;
    const edgeY = viewportRect.height / 2 + Math.sin(bearing) * scaleToEdge;

    this.forgeCompass.style.transform = `translate(${edgeX}px, ${edgeY}px) translate(-50%, -50%)`;
    // The triangle points up by default, so rotate a quarter turn past the bearing.
    this.forgeCompass.style.setProperty("--point", `${bearing + Math.PI / 2}rad`);
    if (this.forgeCompassRange) {
      this.forgeCompassRange.textContent = `${anchor.entry.name} ${Math.round(anchor.distance * 14)}m`;
    }
    this.forgeCompass.classList.add("show");
  }

  /** Mode drives which half of the HUD is present. */
  private applyMode(): void {
    if (!this.viewport) return;
    this.viewport.dataset.mode = this.craftingOpen ? "forge" : this.mode;
  }

  /**
   * Province rules stated once, on arrival, in mechanical terms. A rule the player
   * must re-read every frame is a rule the HUD has failed to teach.
   */
  private showArrival(reading: ReturnType<WorldModel["readRegion"]>): void {
    const key = reading.ecotone ?? reading.province;
    if (this.regionsSeen.has(key) || !this.arrivalCard) return;
    this.regionsSeen.add(key);
    const rules: Record<string, string> = {
      karst: "CHALK 1 HIT · SLATE 4 HITS, NO LOAD",
      mirrorreef: "FACETS TURN THE BALL 90° · CHARGED CRYSTAL CHAINS",
      rootwarren: "LIVING ROCK REGROWS · SPORE BULBS LEAVE A BUMPER",
      brightFault: "MIRROR SLATE TURNS AND HOLDS · DIAMOND ONLY HERE",
      chalkWarren: "GROWTH EATS CHALK, NOT SLATE · SALTPETER ONLY HERE",
      bloomShelf: "GROWTH COVERS CRYSTAL · VITRIOL ONLY HERE",
    };
    this.arrivalCard.innerHTML = `<b>${reading.regionName}</b><i>${rules[key] ?? ""}</i>`;
    this.arrivalCard.classList.add("show");
    this.arrivalTimer = 4.2;
    this.tone(210, 0.3, 0.028, 320);
  }

  /**
   * Cargo is the reward readout. An empty hold shows nothing at all rather than
   * the words "NO CARGO", and a gain pulses so the catch registers without a toast.
   */
  private updateCargo(): void {
    if (!this.cargoStrip) return;
    const held = [...this.economy.resources.entries()].filter(([, count]) => count > 0);
    const signature = held.map(([resource, count]) => `${resource}${count}`).join("|");
    if (signature === this.cargoSignature) return;
    this.cargoSignature = signature;
    this.cargoStrip.innerHTML = held
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([resource, count]) => {
        const definition = RESOURCES[resource];
        const colour = `#${definition.colour.toString(16).padStart(6, "0")}`;
        const gained = (this.lastCargo.get(resource) ?? 0) < count ? " gained" : "";
        return `<span class="cargo-item${gained}"><i style="background:${colour}"></i>${definition.name}<b>${count}</b></span>`;
      })
      .join("");
    this.lastCargo = new Map(held);
  }

  /**
   * Survey Resonance. Shows coarse grades for the three dials and never the
   * contents -- direction is discoverable, contents are a wager.
   */
  private updateResonance(reading: ReturnType<WorldModel["readRegion"]>): void {
    if (!this.resonancePanel) return;
    if (!this.economy.verbs.has("surveyResonance") || this.mode !== "survey") {
      this.resonancePanel.classList.remove("open");
      return;
    }
    this.resonancePanel.classList.add("open");
    const grades = this.economy.resonanceGrades;
    this.resonancePanel.innerHTML = `
      <b>SURVEY RESONANCE</b>
      <span>DENSITY<i>${gradeOf(reading.dials.density, grades)}</i></span>
      <span>VOLATILITY<i>${gradeOf(reading.dials.volatility, grades)}</i></span>
      <span>YIELD<i>${gradeOf(reading.dials.yield, grades)}</i></span>`;
  }

  /**
   * Dotted forward trajectory. Unupgraded it shows only the current leg, which
   * is an aiming aid rather than a solution; optics extend it through rebounds.
   */
  private drawTrajectory(arena: Arena): void {
    const graphic = arena.trajectoryDisplay;
    if (!graphic) return;
    graphic.clear();
    const ball = arena.balls[0];
    if (!ball || arena.resolving) return;

    // Before the serve the line follows the aim, so it doubles as the aim preview.
    const preview = ball.served
      ? ball
      : { ...ball, vu: arena.serveAim * BALL_SPEED, vv: Math.sqrt(Math.max(1, BALL_SPEED ** 2 - (arena.serveAim * BALL_SPEED) ** 2)) };
    const path = predictPath(arena, preview as Ball, this.predictedBounces);
    if (path.length < 2) return;

    const colour = PROVINCE_PALETTE[arena.province].accent;
    const DASH = 0.34;
    const GAP = 0.26;
    let carry = 0;
    for (let index = 0; index < path.length - 1; index++) {
      const from = path[index];
      const to = path[index + 1];
      const span = Math.hypot(to.x - from.x, to.y - from.y);
      if (span < 1e-4) continue;
      const stepX = (to.x - from.x) / span;
      const stepY = (to.y - from.y) / span;
      let cursor = carry;
      while (cursor < span) {
        const end = Math.min(span, cursor + DASH);
        const a = this.world.localToWorld(from.x + stepX * cursor, from.y + stepY * cursor, arena);
        const b = this.world.localToWorld(from.x + stepX * end, from.y + stepY * end, arena);
        graphic.moveTo(a.x * CELL, a.y * CELL).lineTo(b.x * CELL, b.y * CELL);
        cursor = end + GAP;
      }
      carry = Math.max(0, cursor - span);
      // Mark each predicted rebound so the bounce reads as a deliberate result.
      if (index < path.length - 2) {
        const point = this.world.localToWorld(to.x, to.y, arena);
        graphic.circle(point.x * CELL, point.y * CELL, 3.4);
      }
      // Later legs fade, so the certain part of the prediction reads strongest.
      graphic.stroke({ width: 2.4, color: colour, alpha: Math.max(0.14, 0.55 - index * 0.12) });
    }
  }

  private drawLiabilityGauge(arena: Arena): void {
    const graphic = arena.liabilityDisplay;
    if (!graphic) return;
    const remaining = arena.bricks.filter((brick) => brick.alive && brick.liable).length;
    const damage = calculateClaimDamage(remaining, this.soakCapacity);
    const total = Math.max(1, arena.initialLiability, this.soakCapacity);
    const width = Math.min(arena.width * CELL * 0.72, 330);
    const height = 9;
    const point = this.world.localToWorld(0, -0.32, arena);
    const safeWidth = width * Math.min(remaining, this.soakCapacity) / total;
    const dangerWidth = width * damage / total;
    graphic.clear();
    graphic.roundRect(-width / 2, -height / 2, width, height, 4).fill({ color: 0x080b0c, alpha: 0.9 })
      .stroke({ width: 1.5, color: damage ? PALETTE.danger : PROVINCE_PALETTE[arena.province].accent, alpha: 0.9 });
    if (safeWidth > 0) graphic.roundRect(-width / 2 + 2, -height / 2 + 2, Math.max(1, safeWidth - 4), height - 4, 2)
      .fill({ color: PROVINCE_PALETTE[arena.province].accent, alpha: 0.8 });
    if (dangerWidth > 0) graphic.roundRect(-width / 2 + safeWidth, -height / 2 + 2, Math.max(1, dangerWidth), height - 4, 2)
      .fill({ color: PALETTE.danger, alpha: 0.95 });
    const thresholdX = -width / 2 + width * this.soakCapacity / total;
    graphic.moveTo(thresholdX, -height).lineTo(thresholdX, height).stroke({ width: 2, color: PALETTE.ink, alpha: 0.9 });
    graphic.position.set(point.x * CELL, point.y * CELL);
    graphic.rotation = arena.angle;
  }

  private drawFramePreview(): void {
    const frame = this.frameGeometry();
    const half = frame.width / 2;
    const points = [[-half, 0], [half, 0], [half, frame.depth + 0.5], [-half, frame.depth + 0.5]]
      .map(([u, v]) => this.world.localToWorld(u, v, frame));
    const valid = this.world.frameWithinBounds(frame);
    const province = this.world.provinceAt(frame.origin.x, frame.origin.y);
    const signal = valid ? PROVINCE_PALETTE[province].accent : PALETTE.danger;
    const polygon = flatPoints(points.map((point) => ({ x: point.x * CELL, y: point.y * CELL })));
    this.frameWash.clear().poly(polygon).fill({ color: 0x090d0d, alpha: 0.18 }).stroke({ width: 10, color: 0x020405, alpha: 0.38 });
    this.frameGrid.clear().poly(polygon).stroke({ width: 2.2, color: signal, alpha: 0.78 });
    for (let column = 1; column < frame.width; column++) {
      const u = -half + column;
      const a = this.world.localToWorld(u, 0, frame);
      const b = this.world.localToWorld(u, frame.depth + 0.5, frame);
      this.frameGrid.moveTo(a.x * CELL, a.y * CELL).lineTo(b.x * CELL, b.y * CELL);
    }
    for (let row = 1; row <= frame.depth; row++) {
      const a = this.world.localToWorld(-half, row, frame);
      const b = this.world.localToWorld(half, row, frame);
      this.frameGrid.moveTo(a.x * CELL, a.y * CELL).lineTo(b.x * CELL, b.y * CELL);
    }
    this.frameGrid.stroke({ width: 0.7, color: signal, alpha: 0.085 });
    const bracket = 0.46;
    for (const [u, v, sx, sy] of [[-half, 0, 1, 1], [half, 0, -1, 1], [half, frame.depth + 0.5, -1, -1], [-half, frame.depth + 0.5, 1, -1]] as const) {
      const corner = this.world.localToWorld(u, v, frame);
      const along = this.world.localToWorld(u + sx * bracket, v, frame);
      const inward = this.world.localToWorld(u, v + sy * bracket, frame);
      this.frameGrid.moveTo(along.x * CELL, along.y * CELL).lineTo(corner.x * CELL, corner.y * CELL).lineTo(inward.x * CELL, inward.y * CELL);
    }
    this.frameGrid.stroke({ width: 4, color: signal, alpha: 0.96 });
    const scanV = (this.time * 3.1) % (frame.depth + 0.5);
    const scanA = this.world.localToWorld(-half, scanV, frame);
    const scanB = this.world.localToWorld(half, scanV, frame);
    this.frameScan.clear().moveTo(scanA.x * CELL, scanA.y * CELL).lineTo(scanB.x * CELL, scanB.y * CELL)
      .stroke({ width: 9, color: signal, alpha: 0.11 });
    this.frameReturns.clear();
    for (const cell of this.world.surveyedItems(frame)) {
      const x = (cell.x + 0.5) * CELL;
      const y = (cell.y + 0.5) * CELL;
      const pulse = 0.62 + Math.sin(this.time * 4.2 + cell.x * 0.7) * 0.2;
      this.frameReturns.circle(x, y, 9).stroke({ width: 1, color: PALETTE.ink, alpha: pulse * 0.35 });
      this.frameReturns.poly([x, y - 6, x + 6, y, x, y + 6, x - 6, y]).stroke({ width: 2, color: PALETTE.ink, alpha: pulse }).circle(x, y, 1.8).fill(PALETTE.ink);
    }
    for (const point of points) {
      this.frameReturns.circle(point.x * CELL, point.y * CELL, 4).fill(signal)
        .circle(point.x * CELL, point.y * CELL, 9).stroke({ width: 1, color: signal, alpha: 0.3 });
    }
  }

  private spawnParticlesAtBrick(brick: Brick, color: number, count: number): void {
    const arena = this.arena;
    if (!arena) return;
    const position = this.world.localToWorld(brick.u, brick.v, arena);
    for (let index = 0; index < count; index++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 70 + Math.random() * 140;
      const shard = 2 + Math.random() * 4;
      const graphic = new Graphics().poly([-shard, -1, shard * 0.7, -shard * 0.55, shard, 1.2, -shard * 0.3, shard * 0.65]).fill(color);
      graphic.position.set(position.x * CELL, position.y * CELL);
      this.effectLayer.addChild(graphic);
      this.particles.push({ x: graphic.x, y: graphic.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 0.35 + Math.random() * 0.35, maxLife: 0.7, graphic });
    }
  }

  private spawnRingAtBrick(brick: Brick, color: number, strength: number): void {
    const arena = this.arena;
    if (!arena) return;
    const point = this.world.localToWorld(brick.u, brick.v, arena);
    this.spawnRing(point.x * CELL, point.y * CELL, color, strength);
  }

  private spawnRing(x: number, y: number, color: number, strength: number): void {
    const graphic = new Graphics();
    graphic.position.set(x, y);
    this.effectLayer.addChild(graphic);
    this.rings.push({ x, y, radius: 4, speed: 90 + strength * 70, life: 0.3 + strength * 0.16, maxLife: 0.48, color, graphic });
  }

  private updateEffects(dt: number): void {
    for (let index = this.particles.length - 1; index >= 0; index--) {
      const particle = this.particles[index];
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vx *= Math.pow(0.1, dt);
      particle.vy = particle.vy * Math.pow(0.12, dt) + 44 * dt;
      particle.life -= dt;
      particle.graphic.position.set(particle.x, particle.y);
      particle.graphic.alpha = Math.max(0, particle.life / particle.maxLife);
      if (particle.life <= 0) { particle.graphic.destroy(); this.particles.splice(index, 1); }
    }
    for (let index = this.rings.length - 1; index >= 0; index--) {
      const ring = this.rings[index];
      ring.radius += ring.speed * dt;
      ring.life -= dt;
      ring.graphic.clear().circle(0, 0, ring.radius).stroke({ width: 2.5, color: ring.color, alpha: Math.max(0, ring.life / ring.maxLife) });
      if (ring.life <= 0) { ring.graphic.destroy(); this.rings.splice(index, 1); }
    }
  }

  private showToast(message: string): void {
    if (!this.toast) return;
    this.toast.textContent = message;
    this.toast.classList.remove("show");
    requestAnimationFrame(() => this.toast?.classList.add("show"));
    window.setTimeout(() => this.toast?.classList.remove("show"), 1800);
  }

  private updateUI(): void {
    this.applyMode();

    // Hints are scaffolding. Each set disappears once the player has done the
    // thing it describes; only genuinely contextual prompts persist.
    // While the tutorial panel is up it is the controls display; the small hint
    // strip only carries genuinely contextual prompts.
    if (this.instructions && !this.tutorialComplete) {
      this.instructions.innerHTML = this.atAnchor() && this.mode === "survey" ? "<b>C</b> forge" : "";
    } else if (this.instructions) {
      if (this.craftingOpen) {
        this.instructions.innerHTML = "<b>1-9</b> forge <b>ESC</b> close";
      } else if (this.mode === "survey") {
        const core = this.hasCommitted ? "" : "<b>WASD</b> move <b>Q / E</b> aim <b>F</b> commit";
        const forge = this.atAnchor() ? "<b>C</b> forge" : "";
        this.instructions.innerHTML = [core, forge].filter(Boolean).join(" ");
      } else {
        const core = this.hasServed ? "" : "<b>A / D</b> paddle <b>Q / E</b> aim <b>SPACE</b> serve";
        const rail = this.economy.verbs.has("railSeed") && !this.railSeedUsed ? "<b>R</b> rail" : "";
        const blast = this.economy.blastCharges > 0 ? `<b>B</b> blast ×${this.economy.blastCharges}` : "";
        this.instructions.innerHTML = [core, rail, blast].filter(Boolean).join(" ");
      }
    }

    // Objectives are goals in mechanical language: an imperative and a number.
    // No metaphor, no narration, nothing the player cannot act on.
    if (this.objectiveTitle && this.objectiveDetail) {
      const verbs = this.economy.verbs.size;
      let title: string;
      let detail: string;
      if (verbs >= 2) {
        title = "DESCEND PAST 900m";
        detail = "Adamantite and runite below.";
      } else if (verbs === 1) {
        title = "SECOND CORNERSTONE";
        detail = "2 of 3 required.";
      } else if (this.economy.amount("copper") >= 10 && this.economy.amount("coal") >= 4) {
        title = "FORGE ARMOR";
        detail = "Refit Bay · 10 copper + 4 coal.";
      } else if (this.economy.totalSecured > 0) {
        title = "SECURE ORE";
        detail = `Copper ${this.economy.amount("copper")}/10 · Coal ${this.economy.amount("coal")}/4.`;
      } else {
        title = "SECURE ORE";
        detail = "Break resource bricks. Catch the drops.";
      }
      this.objectiveTitle.textContent = title;
      this.objectiveDetail.textContent = detail;
    }
    this.updateCargo();
  }

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
        game.drawFramePreview();
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

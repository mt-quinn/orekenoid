// The three live chassis previews on the deployment screen.
//
// **These run the production code, and must never regress to a stub or to a second
// renderer.** Each card samples the real Landing through `world.framedBricks`,
// builds its board with the same `buildArenaDisplay` live play uses, rasterizes real
// world rock behind it through the production terrain renderer, and steps the ball
// with the real `stepBall` solver. The differences between the three cards are
// therefore genuine geometry differences rather than illustration — which is the
// whole point, because this screen is where the player commits to a frame shape for
// the entire deployment.
//
// Each card owns its own Pixi Application whose canvas lives *inside* the card.
// That is what makes them composite reliably across browsers rather than being
// hidden under the deployment layer.

import { Application, Container, Sprite } from "pixi.js";
import {
  BALL_SPEED,
  CELL,
  PALETTE,
  PROVINCE_PALETTE,
  WORLD_COLS,
  WORLD_ROWS,
  type PaddleChassis,
} from "./config";
import { clamp } from "./maths";
import { materialOf } from "./materials";
import { createBall, stepBall } from "./physics";
import type { ChunkedTerrain } from "./terrain";
import type { Arena, Brick, FrameGeometry } from "./types";
import { buildArenaDisplay } from "./view/board";
import { showDamage } from "./view/brick";
import type { WorldModel } from "./world";

/** One card's rig. */
interface Preview {
  arena: Arena;
  app: Application;
  /** The arena content, measured to fit the card. Excludes the terrain backdrop. */
  content: Container;
  /** Counts down after a loss or a clear, then resets the board. */
  resetTimer: number;
  /** Smoothed paddle target, so the demonstration does not twitch. */
  aiTarget: number;
}

export class DeploymentPreviews {
  private readonly previews: Preview[] = [];

  constructor(
    private readonly world: WorldModel,
    private readonly terrain: ChunkedTerrain,
  ) {}

  get count(): number {
    return this.previews.length;
  }

  /** The live arenas, for tests and for selection highlighting. */
  get arenas(): Arena[] {
    return this.previews.map((preview) => preview.arena);
  }

  get apps(): Application[] {
    return this.previews.map((preview) => preview.app);
  }

  /**
   * The measured arena content of each card, excluding the terrain backdrop.
   *
   * Exposed so the browser test can assert the previews really are centred and
   * bottom-aligned inside their cards at the live viewport size, rather than
   * trusting the layout maths that produced them.
   */
  get contents(): Container[] {
    return this.previews.map((preview) => preview.content);
  }

  /**
   * Build one preview per chassis.
   *
   * Sampled from the real Landing at `world.start` facing east, so every card shows
   * the actual teaching board — chalk crossed by slate — cut to that chassis's own
   * fixed frame.
   */
  async build(roster: readonly PaddleChassis[]): Promise<void> {
    const windows = Array.from(document.querySelectorAll<HTMLElement>(".field-window"));
    for (let index = 0; index < roster.length; index++) {
      const chassis = roster[index];
      const sampleFrame: FrameGeometry = {
        origin: { x: this.world.start.x, y: this.world.start.y },
        angle: Math.PI / 2,
        width: chassis.frame.width,
        depth: chassis.frame.depth,
      };
      const bricks: Brick[] = this.world.framedBricks(sampleFrame)
        .map(({ cell, sourceCells, u, v, footprint, persistent }) => ({
          u, v, x: cell.x, y: cell.y, hp: cell.hp, maxHp: cell.maxHp, kind: cell.kind,
          resource: cell.resource, facetAxis: cell.facetAxis,
          alive: true, persistent, worked: cell.worked,
          liable: !persistent && materialOf(cell.kind).liable && !cell.worked,
          footprint, sourceCells, hitFlash: 0,
        }));

      const content = new Container();
      const board = new Container();
      const actors = new Container();
      content.addChild(board, actors);
      const reading = this.world.readRegion(sampleFrame.origin.x, sampleFrame.origin.y);
      const arena: Arena = {
        origin: { x: 0, y: 0 }, angle: 0, width: chassis.frame.width, depth: chassis.frame.depth,
        province: reading.province, ecotone: reading.ecotone, band: reading.band as Arena["band"],
        bricks, balls: [createBall(0, 0.72)], drops: [], membranes: [],
        regrowthBudget: 0, regrowthTimer: 0,
        resourceCount: 0, collected: 0, combo: 0,
        splitArmed: false, splitUsed: false, serveAim: 0, initialLiability: bricks.length, damageTaken: 0,
        spareBalls: 0,
        paddle: { u: 0, velocity: 0, width: chassis.paddleWidth, flash: 0, impact: 0, recoil: 0 },
        container: content, board, actors, resolving: false, visualAge: 2, crumbleFront: 999, railFlash: 0,
      };
      // The production board builder. Not a preview-specific path.
      // No crumble: a preview is a still life of a board, and nothing here runs the loop that
      // would open the mask.
      buildArenaDisplay(arena, (u, v) => this.world.localToWorld(u, v, arena), {}, false);
      // Bricks normally arrive through the commit scan; a preview is already open.
      for (const brick of arena.bricks) {
        brick.display!.alpha = 1;
        brick.display!.scale.set(1);
      }
      // Liability is a decision the player has not made yet on this screen.
      arena.liabilityDisplay!.visible = false;

      const scene = new Container();
      this.addTerrainBackdrop(scene, sampleFrame, chassis);
      scene.addChild(content);
      arena.container = scene;

      this.serve(arena, index);

      const app = new Application();
      await app.init({
        width: 512,
        height: 640,
        background: PALETTE.void,
        antialias: true,
        autoDensity: true,
        resolution: Math.min(2, window.devicePixelRatio || 1),
        preference: ["webgl"],
        powerPreference: "high-performance",
      });
      app.canvas.classList.add("deployment-preview-canvas");
      app.canvas.setAttribute("aria-hidden", "true");
      windows[index]?.appendChild(app.canvas);
      app.stage.addChild(scene);
      // Driven from the main loop, so only the cards the player is looking at run.
      app.ticker.stop();

      this.previews.push({ arena, app, content, resetTimer: 0, aiTarget: 0 });
    }
    this.layout();
  }

  /**
   * Real world rock behind the board, rasterized by the production terrain
   * renderer so the preview cannot drift from how the world actually looks.
   */
  private addTerrainBackdrop(scene: Container, frame: FrameGeometry, chassis: PaddleChassis): void {
    const span = Math.max(chassis.frame.width, chassis.frame.depth) + 6;
    const regionX = Math.max(0, Math.round(frame.origin.x - span));
    const regionY = Math.max(0, Math.round(frame.origin.y - span));
    const regionCols = Math.min(WORLD_COLS - regionX, span * 2);
    const regionRows = Math.min(WORLD_ROWS - regionY, span * 2);
    const texture = this.terrain.regionTexture(regionX, regionY, regionCols, regionRows);
    if (!texture) return;
    const terrain = new Sprite(texture);
    terrain.width = regionCols * CELL;
    terrain.height = regionRows * CELL;
    terrain.pivot.set((frame.origin.x - regionX) * CELL, (frame.origin.y - regionY) * CELL);
    terrain.rotation = -frame.angle;
    terrain.alpha = 0.72;
    scene.addChild(terrain);
  }

  /** Each card serves at a different angle so the three do not move in lockstep. */
  private serve(arena: Arena, index: number): void {
    const ball = arena.balls[0];
    ball.served = true;
    ball.vu = BALL_SPEED * (index === 1 ? -0.32 : 0.24 + index * 0.08);
    ball.vv = Math.sqrt(BALL_SPEED ** 2 - ball.vu ** 2);
  }

  /**
   * Fit each preview to its card's measured box.
   *
   * Driven by the real DOM rect and the arena's measured local bounds rather than
   * nominal grid dimensions, which is what keeps the three cards aligned at any
   * viewport size or pixel ratio.
   */
  layout(): void {
    const windows = document.querySelectorAll<HTMLElement>(".field-window");
    windows.forEach((windowElement, index) => {
      const preview = this.previews[index];
      if (!preview) return;
      const rect = windowElement.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      preview.app.renderer.resize(width, height);
      const inset = 12;
      const bounds = preview.content.getLocalBounds();
      const scale = Math.min((width - inset * 2) / bounds.width, (height - inset * 2) / bounds.height);
      preview.arena.container.scale.set(scale);
      // Bottom-aligned: the paddle sits on the card's lower edge, which is where it
      // will be during play.
      preview.arena.container.position.set(
        width / 2 - (bounds.x + bounds.width / 2) * scale,
        height - inset - (bounds.y + bounds.height) * scale,
      );
      preview.app.renderer.render(preview.app.stage);
    });
  }

  /** Dim the cards that are not selected or hovered. */
  setSelected(index: number): void {
    this.previews.forEach((preview, previewIndex) => {
      preview.arena.container.alpha = previewIndex === index ? 1 : 0.76;
      preview.app.renderer.render(preview.app.stage);
    });
  }

  hide(): void {
    for (const preview of this.previews) preview.app.canvas.style.visibility = "hidden";
  }

  /** Step only the cards the player is actually looking at. */
  update(dt: number, active: Iterable<number>, roster: readonly PaddleChassis[]): void {
    for (const index of active) this.step(index, dt, roster[index]);
  }

  /**
   * Run one preview.
   *
   * The paddle is driven by a predictive tracker that reflects the ball's path off
   * the rails, so the demonstration plays competently instead of chasing the ball —
   * a card that visibly fumbles reads as the chassis being bad rather than the
   * autopilot being bad.
   */
  private step(index: number, dt: number, chassis: PaddleChassis | undefined): void {
    const preview = this.previews[index];
    const ball = preview?.arena.balls[0];
    if (!preview || !ball || !chassis) return;
    const { arena, app } = preview;

    if (preview.resetTimer > 0) {
      preview.resetTimer -= dt;
      if (preview.resetTimer <= 0) this.reset(index);
      app.renderer.render(app.stage);
      return;
    }

    // Predict where the ball will cross the paddle line, folding rail reflections
    // back into range.
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
    preview.aiTarget += (target - preview.aiTarget) * targetBlend;
    const error = preview.aiTarget - arena.paddle.u;
    // A small dead zone, so a settled paddle stops rather than jittering.
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

    // The production solver.
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
        showDamage(brick);
        if (brick.hp <= 0) {
          brick.alive = false;
          if (brick.display) brick.display.visible = false;
        }
      }
    });
    if (ball.v < -0.7 || !arena.bricks.some((brick) => brick.alive && !brick.persistent)) {
      preview.resetTimer = 0.45;
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
    app.renderer.render(app.stage);
  }

  private reset(index: number): void {
    const preview = this.previews[index];
    const ball = preview?.arena.balls[0];
    if (!preview || !ball) return;
    for (const brick of preview.arena.bricks) {
      brick.alive = true;
      brick.hp = brick.maxHp;
      brick.hitFlash = 0;
      if (brick.display) {
        brick.display.visible = true;
        brick.display.scale.set(1);
      }
      brick.hp = brick.maxHp;
      showDamage(brick);
    }
    preview.arena.paddle.u = 0;
    preview.arena.paddle.velocity = 0;
    preview.arena.paddle.flash = 0;
    preview.arena.paddle.impact = 0;
    preview.aiTarget = 0;
    ball.u = 0;
    ball.v = 0.72;
    ball.trail.length = 0;
    this.serve(preview.arena, index);
    preview.resetTimer = 0;
  }
}

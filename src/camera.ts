// The camera.
//
// Two behaviours, and the distinction matters: while roaming, the camera *chases*
// the drone with exponential smoothing and unwinds any rotation; committing or
// resolving a claim runs a *scripted transition* to an exact focus and rotation.
// Chasing must never fight a transition, so a transition owns the camera outright
// until it finishes.

import { CELL } from "./config";
import { DESIGN_WIDTH, view } from "./viewport";
import { nearestAngle, smooth } from "./maths";
import type { Vec2 } from "./types";
import type { Container } from "pixi.js";

/**
 * How much of the mine to show while roaming.
 *
 * A phone is narrow, and at the authored scale a portrait stage shows a slot of rock barely wider
 * than the drone -- which makes threading a corridor a guessing game, because the rock you are
 * about to hit is off-screen. Pulling back restores roughly the horizontal span the desktop has.
 *
 * Referenced against the *design* width rather than a fixed number so this stays correct if the
 * desktop framing is ever re-authored.
 */
export function surveyZoom(): number {
  if (view.layout === "desktop") return 1;
  // Never zoom in past the authored scale: on a tablet, wider than the design width, the world
  // should look the way it was drawn rather than magnified.
  return Math.min(1, view.width / DESIGN_WIDTH * 1.55);
}

/**
 * The zoom that fits a board of `width` x `depth` cells inside the stage.
 *
 * The margins are not symmetric on a phone, and deliberately so. The bottom of the play area has
 * to clear the thumb arc: the paddle lives there, and a board drawn down to the edge of the screen
 * puts the contact point -- the one thing the player must watch -- underneath their own hand.
 */
export function boardZoom(width: number, depth: number): number {
  // The board draws a little beyond its brick field -- a heavy backdrop stroke, the rails along
  // the far edge, the corner anchors -- and the far rail sits a further half cell past the last
  // row. Measured at about 0.4 cells across the width and 1.1 down the depth, so a cell of
  // allowance on each axis covers it without throwing away screen.
  const boardWidth = (width + 1) * CELL;
  const boardDepth = (depth + 1.2) * CELL;
  const sideMargin = view.layout === "phone" ? 18 : 90;
  const topMargin = (view.layout === "phone" ? 96 : 70) + view.safe.top;
  // Room for the paddle, the drag hand and the home indicator underneath it.
  const bottomMargin = (view.layout === "phone" ? 210 : 80) + view.safe.bottom;
  const usableWidth = Math.max(1, view.width - sideMargin * 2 - view.safe.left - view.safe.right);
  const usableHeight = Math.max(1, view.height - topMargin - bottomMargin);
  // Never magnify a small board past the authored scale -- a 7-wide claim on a big screen should
  // look like a small claim, not fill the display.
  return Math.min(1, usableWidth / boardWidth, usableHeight / boardDepth);
}

export interface CameraTransition {
  elapsed: number;
  duration: number;
  fromFocus: Vec2;
  toFocus: Vec2;
  fromRotation: number;
  toRotation: number;
  fromZoom: number;
  toZoom: number;
  /** True when this transition is leaving an arena, which the caller acts on. */
  exit: boolean;
}

export class Camera {
  focus: Vec2;
  rotation = 0;
  /**
   * World pixels per screen pixel, inverted: 1 is the authored scale, below 1 pulls back.
   *
   * There was no zoom at all before, which was survivable only because the stage was always
   * 1280x720 -- and not even reliably then. A board is drawn at `CELL = 42`, so a 19-deep frame is
   * 798px tall and already overflowed a 720px stage. On a portrait phone every board overflows.
   */
  zoom = 1;
  transition: CameraTransition | null = null;

  private kickX = 0;
  private kickY = 0;

  constructor(focus: Vec2) {
    this.focus = { ...focus };
  }

  get inTransition(): boolean {
    return this.transition !== null;
  }

  /**
   * Start a scripted move.
   *
   * The target rotation is resolved to whichever representation is nearest the
   * current one, so a claim committed at a small angle never sends the whole world
   * spinning the long way round. A move of more than three quarters of a turn is
   * given longer, because at the same duration it reads as a lurch.
   */
  begin(target: Vec2, rotation: number, exit: boolean, zoom = 1): void {
    const targetRotation = nearestAngle(this.rotation, rotation);
    this.transition = {
      elapsed: 0,
      duration: Math.abs(targetRotation - this.rotation) > Math.PI * 0.75 ? 0.92 : 0.72,
      fromFocus: { ...this.focus },
      toFocus: target,
      fromRotation: this.rotation,
      toRotation: targetRotation,
      fromZoom: this.zoom,
      toZoom: zoom,
      exit,
    };
  }

  /** Snap to a position, abandoning any transition. Used on death and on load. */
  jumpTo(focus: Vec2): void {
    this.focus = { ...focus };
    this.zoom = surveyZoom();
    this.transition = null;
  }

  /**
   * Advance the camera. Returns the transition that just completed, or null.
   *
   * Returning it rather than firing a callback keeps the "arena exit finished"
   * decision with the caller, where the arena lifecycle already lives.
   */
  update(dt: number, chase: Vec2 | null): CameraTransition | null {
    this.settleKick(dt);
    if (this.transition) {
      const transition = this.transition;
      transition.elapsed += dt;
      const progress = Math.min(1, transition.elapsed / transition.duration);
      const eased = smooth(progress);
      this.focus.x = transition.fromFocus.x + (transition.toFocus.x - transition.fromFocus.x) * eased;
      this.focus.y = transition.fromFocus.y + (transition.toFocus.y - transition.fromFocus.y) * eased;
      this.rotation = transition.fromRotation + (transition.toRotation - transition.fromRotation) * eased;
      // Zoom rides the same eased curve as focus and rotation, so committing a claim *frames* the
      // board in one movement rather than flying to it and then separately scaling to fit.
      this.zoom = transition.fromZoom + (transition.toZoom - transition.fromZoom) * eased;
      if (progress < 1) return null;
      this.transition = null;
      return transition;
    }
    if (chase) {
      // Frame-rate independent exponential approach: 99.9% of the gap closed per
      // second, so the chase feels identical at 60 and 144 Hz.
      const response = 1 - Math.pow(0.001, dt);
      this.focus.x += (chase.x - this.focus.x) * response;
      this.focus.y += (chase.y - this.focus.y) * response;
      this.rotation += (0 - this.rotation) * response;
      this.zoom += (surveyZoom() - this.zoom) * response;
    }
    return null;
  }

  /** Write the camera onto the world container. */
  /**
   * A directed kick, away from an impact.
   *
   * Directed rather than random, which is the refinement the screenshake talk arrives at last:
   * random shake says "something happened", a kick away from the contact says "something hit you
   * *there*". The camera moves opposite the blow, the way a recoiling gun pushes the view back.
   */
  kick(dirX: number, dirY: number, magnitude: number): void {
    const length = Math.hypot(dirX, dirY) || 1;
    this.kickX -= dirX / length * magnitude;
    this.kickY -= dirY / length * magnitude;
  }

  /**
   * Undo the camera transform: a point on the canvas, in world pixels.
   *
   * Deliberately ignores the kick. The kick is a few pixels of transient shake, and including it
   * would make a finger held perfectly still read as a moving touch -- the paddle would jitter in
   * sympathy with every brick it broke, which is the exact opposite of what the shake is for.
   */
  screenToWorld(screenX: number, screenY: number): Vec2 {
    const dx = (screenX - view.width / 2) / this.zoom;
    const dy = (screenY - view.height / 2) / this.zoom;
    const cos = Math.cos(-this.rotation);
    const sin = Math.sin(-this.rotation);
    return {
      x: this.focus.x + dx * cos - dy * sin,
      y: this.focus.y + dx * sin + dy * cos,
    };
  }

  /** Decay the kick. Real seconds, so it feels the same at any frame rate. */
  private settleKick(dt: number): void {
    // Critically-damped-ish: fast enough to be a snap rather than a wobble.
    const decay = Math.pow(0.0009, dt);
    this.kickX *= decay;
    this.kickY *= decay;
    if (Math.abs(this.kickX) < 0.01) this.kickX = 0;
    if (Math.abs(this.kickY) < 0.01) this.kickY = 0;
  }

  applyTo(worldRoot: Container): void {
    worldRoot.pivot.set(this.focus.x, this.focus.y);
    // Centred on the live stage rather than on a constant: the stage takes the shape of whatever
    // is holding it, and a camera that centred on 1280x720 would put the focus off-screen the
    // moment that stopped being true.
    worldRoot.position.set(view.width / 2 + this.kickX, view.height / 2 + this.kickY);
    worldRoot.rotation = this.rotation;
    worldRoot.scale.set(this.zoom);
  }
}

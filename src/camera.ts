// The camera.
//
// Two behaviours, and the distinction matters: while roaming, the camera *chases*
// the drone with exponential smoothing and unwinds any rotation; committing or
// resolving a claim runs a *scripted transition* to an exact focus and rotation.
// Chasing must never fight a transition, so a transition owns the camera outright
// until it finishes.

import { VIEW_HEIGHT, VIEW_WIDTH } from "./config";
import { nearestAngle, smooth } from "./maths";
import type { Vec2 } from "./types";
import type { Container } from "pixi.js";

export interface CameraTransition {
  elapsed: number;
  duration: number;
  fromFocus: Vec2;
  toFocus: Vec2;
  fromRotation: number;
  toRotation: number;
  /** True when this transition is leaving an arena, which the caller acts on. */
  exit: boolean;
}

export class Camera {
  focus: Vec2;
  rotation = 0;
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
  begin(target: Vec2, rotation: number, exit: boolean): void {
    const targetRotation = nearestAngle(this.rotation, rotation);
    this.transition = {
      elapsed: 0,
      duration: Math.abs(targetRotation - this.rotation) > Math.PI * 0.75 ? 0.92 : 0.72,
      fromFocus: { ...this.focus },
      toFocus: target,
      fromRotation: this.rotation,
      toRotation: targetRotation,
      exit,
    };
  }

  /** Snap to a position, abandoning any transition. Used on death and on load. */
  jumpTo(focus: Vec2): void {
    this.focus = { ...focus };
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
    worldRoot.position.set(VIEW_WIDTH / 2 + this.kickX, VIEW_HEIGHT / 2 + this.kickY);
    worldRoot.rotation = this.rotation;
  }
}

// Fingers.
//
// The game was built entirely around a key set: `keys: Set<string>` polled every frame for
// continuous input, plus keydown handlers for discrete actions. That is a fine model, and this
// does not replace it -- it produces the same *intents* the polling code already asks for, so
// `updateSurvey` keeps asking "which way is the player moving" rather than learning about
// pointers. The keyboard and the touchscreen are two sources answering one question.
//
// Three continuous gestures, assigned by where the touch starts and what mode the game is in:
//
//   survey, left half   a floating stick. Appears where the thumb lands rather than sitting at a
//                       fixed spot, so the player never looks down to find it.
//   survey, right half  a relative drag that turns the survey frame. Invisible until touched.
//   play, anywhere      the paddle, tracked directly in X with an upward offset so the thumb
//                       never covers the paddle or the contact point. Before the serve the same
//                       drag carries the serve angle on its vertical axis, and a tap -- down and
//                       up with no travel -- serves.
//
// Discrete actions are DOM buttons rather than anything in here, because the HUD is already DOM
// and a real button gets 44px targets, focus, and a pressed state for free.

import type { Camera } from "./camera";
import { DialWheel, dialGeometry, onRim } from "./dial";

/** How far a touch may travel and still count as a tap rather than a drag, in CSS pixels. */
const TAP_SLOP = 12;
/** And how long. Beyond this it is a hold, whatever the distance. */
const TAP_MS = 320;

/**
 * Dead zone at the centre of the stick, as a fraction of its radius.
 *
 * Without one, a thumb resting on the screen drifts the drone continuously, and the player cannot
 * tell whether they are stopped. With one, "not moving" is a real, reachable state.
 */
const STICK_DEAD = 0.16;
/** Distance from the stick's origin at which the drone is at full travel speed. */
export const STICK_RADIUS = 62;



/**
 * How far above the finger the paddle sits, in world pixels.
 *
 * The single most important number in this file. Without it the thumb covers the paddle and the
 * point where the ball meets it -- which is the one thing the player must watch, and the reason
 * "direct drag" and "direct drag with an offset" are different control schemes rather than the
 * same one tuned differently.
 */
const PADDLE_LIFT = 96;

export type Gesture = "stick" | "dial" | "paddle";

interface LivePointer {
  id: number;
  gesture: Gesture;
  /** Where it went down, in CSS pixels relative to the canvas. */
  originX: number;
  originY: number;
  x: number;
  y: number;
  startedAt: number;
  /** Set once it travels beyond the tap slop, and never cleared: a drag cannot become a tap. */
  dragged: boolean;
}

export interface TouchState {
  /** Stick vector, already dead-zoned and clamped to the unit disc. */
  moveX: number;
  moveY: number;
  /** Frame rotation this frame, in radians, from the turn drag. Consumed by reading it. */
  turn: number;
  /** Where the paddle wants to be, in world pixels, or null when nothing is dragging it. */
  paddle: { x: number; y: number } | null;
  /** The live stick, for drawing. Screen pixels. */
  stick: { originX: number; originY: number; x: number; y: number } | null;
  /**
   * The facing wheel, for drawing.
   *
   * Always present, unlike the stick: the wheel is a permanent instrument on the panel rather than
   * something that appears under a thumb, so the view needs its geometry every frame whether or not
   * anybody is touching it.
   */
  dial: {
    x: number;
    y: number;
    radius: number;
    /** Radians per second of free spin, for drawing the coast. */
    spin: number;
    gripped: boolean;
    /** True on the one frame a touch stopped a spinning wheel. */
    caught: boolean;
  };
}

export class TouchInput {
  /** True once anything has actually been touched, so the controls stay hidden on a hybrid laptop. */
  used = false;

  private readonly pointers = new Map<number, LivePointer>();
  private canvas: HTMLCanvasElement | null = null;
  /** The facing wheel: one to one under the thumb, and coasting after a flick. */
  private readonly wheel = new DialWheel();
  /** Set when a touch stopped a spinning wheel, so the view and the audio can answer it once. */
  private caught = false;
  /** Accumulated rotation since the last read, so a fast drag is never dropped between frames. */
  private turnAccumulator = 0;
  /** Taps waiting to be answered. */
  private taps: Array<{ x: number; y: number }> = [];

  /**
   * What the game is currently doing, so a touch can be routed the moment it lands.
   *
   * Set by the caller rather than inferred, because the routing question -- is this a stick or a
   * paddle -- has to be answered on pointerdown, before there is any movement to infer from.
   */
  mode: "survey" | "play" = "survey";
  /** Turned off while the atlas, the bay or a menu is up, so gameplay does not read stray touches. */
  enabled = true;

  attach(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    // Pointer events rather than touch events: one code path covers finger, pen and mouse, and
    // `setPointerCapture` keeps a drag alive when the finger leaves the element, which happens
    // constantly when the paddle is dragged toward the edge of the screen.
    canvas.addEventListener("pointerdown", (event) => this.down(event));
    canvas.addEventListener("pointermove", (event) => this.move(event));
    canvas.addEventListener("pointerup", (event) => this.up(event));
    canvas.addEventListener("pointercancel", (event) => this.up(event));
    // A second finger arriving must not scroll, zoom or select anything.
    canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  }

  /** Drop everything. Called when the game pauses or loses focus, so no gesture survives the gap. */
  clear(): void {
    this.wheel.clear();
    this.pointers.clear();
    this.turnAccumulator = 0;
    this.taps = [];
  }

  private local(event: PointerEvent): { x: number; y: number } {
    const rect = this.canvas?.getBoundingClientRect();
    if (!rect) return { x: event.clientX, y: event.clientY };
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private down(event: PointerEvent): void {
    if (event.pointerType === "mouse") return;
    this.used = true;
    if (!this.enabled) return;
    event.preventDefault();
    const point = this.local(event);
    const rect = this.canvas?.getBoundingClientRect();
    const width = rect?.width ?? 1;
    // In a claim every touch on the board is the paddle. Out in the mine the screen is split:
    // the left thumb flies, the right thumb aims. Splitting by where the touch *starts* rather
    // than by where it travels means a drag that crosses the midline keeps doing what it began.
    // In a claim every touch on the board is the paddle. Out in the mine, a touch on the facing wheel's
    // rim turns the drone and everything else flies it.
    //
    // Chosen by where the wheel *is* rather than by a midline. The old split cut the screen in half and
    // meant the stick only worked on the left, which is both invisible and needlessly restrictive: the
    // wheel occupies one corner, so the rest of the glass -- including most of the right -- can fly.
    const geometry = dialGeometry(width, rect?.height ?? 1);
    const gesture: Gesture = this.mode === "play"
      ? "paddle"
      : (onRim(point.x, point.y, geometry) ? "dial" : "stick");
    // Only one of each gesture at a time: a second finger on the same job would fight the first.
    for (const live of this.pointers.values()) {
      if (live.gesture === gesture) return;
    }
    // Capture keeps a drag alive once the finger leaves the canvas, which happens constantly when
    // the paddle is dragged toward the edge of the screen. It is an optimisation, not a
    // requirement: it throws for a pointer the browser does not consider active, and losing the
    // gesture entirely because the nice-to-have failed would be the wrong trade.
    try {
      this.canvas?.setPointerCapture(event.pointerId);
    } catch {
      // Not capturable. The gesture still works; it just ends early if the finger leaves.
    }
    if (gesture === "dial") {
      const caught = this.wheel.grab(
        Math.atan2(point.y - geometry.y, point.x - geometry.x),
        performance.now() / 1000,
      );
      if (caught.caught) this.caught = true;
    }
    this.pointers.set(event.pointerId, {
      id: event.pointerId,
      gesture,
      originX: point.x,
      originY: point.y,
      x: point.x,
      y: point.y,
      startedAt: performance.now(),
      dragged: false,
    });
  }

  private move(event: PointerEvent): void {
    const live = this.pointers.get(event.pointerId);
    if (!live) return;
    event.preventDefault();
    const point = this.local(event);
    if (live.gesture === "dial") {
      // The wheel is turned by the thumb's *angle* around its hub, one to one, so the drone turns exactly
      // as far as the rim was stroked. The old scheme mapped horizontal pixels to radians, which meant a
      // vertical stroke along a rim did nothing and there was no home position to return to.
      const rect = this.canvas?.getBoundingClientRect();
      const geometry = dialGeometry(rect?.width ?? 1, rect?.height ?? 1);
      this.wheel.drag(
        Math.atan2(point.y - geometry.y, point.x - geometry.x),
        performance.now() / 1000,
      );
    }
    if (Math.hypot(point.x - live.originX, point.y - live.originY) > TAP_SLOP) live.dragged = true;
    live.x = point.x;
    live.y = point.y;
  }

  private up(event: PointerEvent): void {
    const live = this.pointers.get(event.pointerId);
    if (!live) return;
    this.pointers.delete(event.pointerId);
    try {
      if (this.canvas?.hasPointerCapture(event.pointerId)) {
        this.canvas.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Already released, or never captured. Either way the gesture is over.
    }
    if (live.gesture === "dial") this.wheel.release(performance.now() / 1000);
    const quick = performance.now() - live.startedAt < TAP_MS;
    // A touch on the wheel is never a world tap.
    //
    // Stopping a coasting wheel is a tap by every measure -- brief, and it never travels -- and a tap out
    // in the mine commits a claim. So catching the wheel staked a claim, which is a spectacular thing for
    // a control to do by accident.
    if (!live.dragged && quick && live.gesture !== "dial") this.taps.push({ x: live.x, y: live.y });
  }

  /** Taps since the last call. Draining rather than peeking, so one tap fires one action. */
  drainTaps(): Array<{ x: number; y: number }> {
    const taps = this.taps;
    this.taps = [];
    return taps;
  }

  /** True while any finger is down, which is what tells the paddle it is being steered. */
  get active(): boolean {
    return this.pointers.size > 0;
  }

  /**
   * Read this frame's intent.
   *
   * `camera` converts the paddle touch into world space, which is where the arena's own maths
   * lives -- the board can be framed at any angle, so a screen X means nothing until it has been
   * through the camera and the claim's rotation.
   */
  read(camera: Camera, dt: number): TouchState {
    // The wheel is asked for its rotation every frame whether or not a thumb is on it, because a flicked
    // wheel keeps turning after the finger has gone. `take` also hands over anything a drag accumulated
    // between frames, so a fast stroke is neither dropped nor counted twice.
    this.turnAccumulator += this.wheel.take(dt);
    const rect = this.canvas?.getBoundingClientRect();
    const state: TouchState = {
      moveX: 0,
      moveY: 0,
      turn: this.turnAccumulator,
      paddle: null,
      stick: null,
      dial: {
        ...dialGeometry(rect?.width ?? 1, rect?.height ?? 1),
        spin: this.wheel.spin,
        gripped: this.wheel.gripped,
        caught: this.caught,
      },
    };
    this.turnAccumulator = 0;
    this.caught = false;
    if (!this.enabled) return state;

    for (const live of this.pointers.values()) {
      if (live.gesture === "stick") {
        const dx = live.x - live.originX;
        const dy = live.y - live.originY;
        const distance = Math.hypot(dx, dy);
        if (distance > STICK_RADIUS * STICK_DEAD) {
          // Clamped to the unit disc rather than to each axis: a diagonal push must not be faster
          // than a straight one, which is exactly what squaring the input would do.
          const strength = Math.min(1, distance / STICK_RADIUS);
          state.moveX = dx / distance * strength;
          state.moveY = dy / distance * strength;
        }
        state.stick = { originX: live.originX, originY: live.originY, x: live.x, y: live.y };
      } else if (live.gesture !== "dial") {
        // Lifted, so the paddle rides above the thumb rather than under it.
        state.paddle = camera.screenToWorld(live.x, live.y - PADDLE_LIFT);
      }
    }
    return state;
  }
}

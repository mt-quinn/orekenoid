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

/** Screen pixels of drag that turn the frame one radian. Tuned so a thumb-sweep is about a turn. */
const TURN_PER_PIXEL = 0.011;

/**
 * How far above the finger the paddle sits, in world pixels.
 *
 * The single most important number in this file. Without it the thumb covers the paddle and the
 * point where the ball meets it -- which is the one thing the player must watch, and the reason
 * "direct drag" and "direct drag with an offset" are different control schemes rather than the
 * same one tuned differently.
 */
const PADDLE_LIFT = 96;

export type Gesture = "stick" | "turn" | "paddle";

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
  /** The live turn drag, for drawing. */
  turning: { x: number; y: number; amount: number } | null;
}

export class TouchInput {
  /** True once anything has actually been touched, so the controls stay hidden on a hybrid laptop. */
  used = false;

  private readonly pointers = new Map<number, LivePointer>();
  private canvas: HTMLCanvasElement | null = null;
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
    const gesture: Gesture = this.mode === "play"
      ? "paddle"
      : (point.x < width / 2 ? "stick" : "turn");
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
    if (live.gesture === "turn") {
      // Relative: the frame turns by how far the finger moved this event, not by where it is.
      // Absolute would mean picking a screen position that "means" a heading, which is arbitrary,
      // and would snap the frame the instant a finger landed.
      this.turnAccumulator += (point.x - live.x) * TURN_PER_PIXEL;
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
    const quick = performance.now() - live.startedAt < TAP_MS;
    if (!live.dragged && quick) this.taps.push({ x: live.x, y: live.y });
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
  read(camera: Camera): TouchState {
    const state: TouchState = {
      moveX: 0,
      moveY: 0,
      turn: this.turnAccumulator,
      paddle: null,
      stick: null,
      turning: null,
    };
    this.turnAccumulator = 0;
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
      } else if (live.gesture === "turn") {
        state.turning = { x: live.x, y: live.y, amount: state.turn };
      } else {
        // Lifted, so the paddle rides above the thumb rather than under it.
        state.paddle = camera.screenToWorld(live.x, live.y - PADDLE_LIFT);
      }
    }
    return state;
  }
}

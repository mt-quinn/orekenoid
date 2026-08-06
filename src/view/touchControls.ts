// Drawing the fingers.
//
// A gesture the player cannot see is a gesture they have to be told about, and a control they have
// to be told about is a control that failed. So the stick draws itself the instant a thumb lands,
// showing where it thinks its centre is and how far it is deflected -- which answers, without a
// word, the two questions a player actually has: "is it listening" and "how fast am I going".
//
// Deliberately *not* a fixed pad in a corner. A floating stick appears where the thumb already is,
// so the player never looks away from the world to find it, and never has to hold their hand in a
// particular place to keep it. The cost is that it is invisible until touched, which is why the
// resting hint exists.
//
// This layer sits on the stage rather than inside the camera transform: it is screen furniture,
// and it must not rotate with a claim or scale with the zoom.

import { Container, Graphics } from "pixi.js";
import { PALETTE } from "../config";
import { STICK_RADIUS, type TouchState } from "../touch";
import { view } from "../viewport";

const BRASS = PALETTE.machine;

export class TouchControls {
  readonly container = new Container();
  private readonly stick = new Graphics();
  private readonly turn = new Graphics();
  private readonly hint = new Graphics();
  /** Eased visibility per control, so they arrive and leave rather than blinking. */
  private stickAlpha = 0;
  private turnAlpha = 0;
  private hintAlpha = 0;
  private phase = 0;

  constructor() {
    this.container.addChild(this.hint, this.stick, this.turn);
    this.container.visible = false;
  }

  /**
   * @param state    this frame's touch intent
   * @param show     whether touch controls apply at all right now
   * @param resting  true when the player is in the survey and not touching, which is when the
   *                 hint is worth showing -- it is the only moment they might not know the stick
   *                 is there.
   */
  update(dt: number, state: TouchState, show: boolean, resting: boolean): void {
    this.container.visible = show;
    if (!show) return;
    this.phase += dt;

    const approach = (from: number, to: number, rate: number) => from + (to - from) * Math.min(1, dt * rate);
    // Appearing is fast and leaving is slow: a control that lags its own touch feels broken, and
    // one that vanishes the instant a thumb lifts flickers during the small gaps in a drag.
    this.stickAlpha = approach(this.stickAlpha, state.stick ? 1 : 0, state.stick ? 26 : 7);
    this.turnAlpha = approach(this.turnAlpha, state.turning ? 1 : 0, state.turning ? 26 : 7);
    this.hintAlpha = approach(this.hintAlpha, resting ? 1 : 0, resting ? 2.2 : 9);

    this.drawStick(state);
    this.drawTurn(state);
    this.drawHint();
  }

  private drawStick(state: TouchState): void {
    this.stick.clear();
    if (this.stickAlpha < 0.01) return;
    const live = state.stick;
    // Kept at its last position while fading out, so lifting a thumb does not teleport the ghost
    // to the origin on its way out.
    if (!live) { this.stick.alpha = this.stickAlpha; return; }
    this.stick.alpha = this.stickAlpha;

    const dx = live.x - live.originX;
    const dy = live.y - live.originY;
    const distance = Math.hypot(dx, dy);
    // The knob is held inside the ring even when the thumb travels past it, so the ring keeps
    // meaning "full speed" instead of the knob wandering off with no way to read the maximum.
    const clamped = Math.min(1, distance / STICK_RADIUS);
    const knobX = distance > 0 ? live.originX + dx / distance * clamped * STICK_RADIUS : live.originX;
    const knobY = distance > 0 ? live.originY + dy / distance * clamped * STICK_RADIUS : live.originY;

    this.stick
      // The gate: where the thumb went down, and the reach that means full travel.
      .circle(live.originX, live.originY, STICK_RADIUS)
      .stroke({ width: 2, color: BRASS, alpha: 0.3 })
      .circle(live.originX, live.originY, STICK_RADIUS * 0.16)
      .stroke({ width: 1.5, color: BRASS, alpha: 0.35 });

    // A line from origin to knob, so deflection reads at a glance rather than by comparing two
    // circles -- direction and magnitude in one mark.
    if (distance > 1) {
      this.stick.moveTo(live.originX, live.originY).lineTo(knobX, knobY)
        .stroke({ width: 2, color: BRASS, alpha: 0.4 });
    }
    this.stick
      .circle(knobX, knobY, 26)
      .fill({ color: 0x0b1013, alpha: 0.55 })
      .stroke({ width: 2, color: BRASS, alpha: 0.85 })
      // Brightening with deflection, so "full speed" is legible without a number.
      .circle(knobX, knobY, 26 * (0.3 + clamped * 0.34))
      .fill({ color: BRASS, alpha: 0.25 + clamped * 0.5 });
  }

  private drawTurn(state: TouchState): void {
    this.turn.clear();
    if (this.turnAlpha < 0.01) return;
    this.turn.alpha = this.turnAlpha;
    const live = state.turning;
    if (!live) return;

    // An arc under the thumb, leaning the way the frame is turning. The turn drag is relative, so
    // there is no absolute position to draw -- what the player needs to see is direction and that
    // it registered.
    const lean = Math.max(-1, Math.min(1, live.amount * 26));
    const radius = 44;
    const from = -Math.PI * 0.62 + lean * 0.5;
    const to = Math.PI * 0.62 + lean * 0.5;
    this.turn
      .arc(live.x, live.y, radius, from, to)
      .stroke({ width: 3, color: BRASS, alpha: 0.32 + Math.abs(lean) * 0.4 })
      .circle(live.x, live.y, 7)
      .fill({ color: BRASS, alpha: 0.5 });
    // A tick at the leading end, so which way it is going is unambiguous even at a small lean.
    const tip = lean >= 0 ? to : from;
    this.turn
      .circle(live.x + Math.cos(tip) * radius, live.y + Math.sin(tip) * radius, 5)
      .fill({ color: BRASS, alpha: 0.55 + Math.abs(lean) * 0.4 });
  }

  /**
   * The resting hint: two faint marks showing which half does what.
   *
   * Shown only while the player is in the survey with nothing touched, and it fades in slowly --
   * so it reads as an offer rather than an interruption, and never competes with the world while
   * they are actually flying.
   */
  private drawHint(): void {
    this.hint.clear();
    if (this.hintAlpha < 0.01) return;
    const pulse = 0.55 + Math.sin(this.phase * 1.6) * 0.2;
    this.hint.alpha = this.hintAlpha * pulse;
    const y = view.height - 132 - view.safe.bottom;
    const left = view.width * 0.25;
    const right = view.width * 0.75;

    // Left: a ring, which is what a thumb landing there will produce.
    this.hint
      .circle(left, y, 30)
      .stroke({ width: 2, color: BRASS, alpha: 0.3 })
      .circle(left, y, 5)
      .fill({ color: BRASS, alpha: 0.3 });
    // Right: a short arc, which is what a drag there does.
    this.hint
      .arc(right, y, 30, -Math.PI * 0.55, Math.PI * 0.55)
      .stroke({ width: 2, color: BRASS, alpha: 0.3 });
    for (const direction of [-1, 1]) {
      this.hint
        .circle(right + direction * 40, y, 3.5)
        .fill({ color: BRASS, alpha: 0.28 });
    }
  }
}

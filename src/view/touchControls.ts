import { DIAL } from "../dial";
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
/** The bright rail tone, for the parts of the wheel that have to read as lit metal. */
const RAIL = PALETTE.rail;
/** The wheel's body and hub: dark machined metal, so it reads as solid rather than as an overlay. */
const BODY = 0x1b1f21;
const HUB = 0x111517;

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
    // The wheel is either mounted or it is not. It does not fade to a ghost when idle: an opaque machine
    // part that goes half-transparent when unused stops reading as a part and starts reading as a hint.
    // Being used is answered by the rim brightening instead, inside `drawTurn`.
    const wanted = this.wheelVisible ? 1 : 0;
    this.turnAlpha = approach(this.turnAlpha, wanted, wanted ? 26 : 7);
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

  /**
   * The facing wheel, mounted half off the screen's edge.
   *
   * Drawn as a machine part rather than as a hint: it is always on the panel, it is gripped and released,
   * and it coasts. The rim's teeth passing a fixed index mark are what carry the tactility -- Safari on
   * iPhone gives a web game no vibration at all, so the detents have to be seen and heard rather than
   * felt, and this is the seen half.
   */
  private drawTurn(state: TouchState): void {
    this.turn.clear();
    if (this.turnAlpha < 0.01) return;
    this.turn.alpha = this.turnAlpha;
    const dial = state.dial;
    if (dial.radius <= 0 || !this.wheelVisible) return;

    const busy = dial.gripped || Math.abs(dial.spin) > 0.2;
    // Opaque, because it is a part of the machine rather than an overlay on the world. A translucent dial
    // reads as a HUD hint that happens to be round; a solid one reads as something bolted to the drone,
    // which is what makes turning it feel like turning something.
    this.turn
      .circle(dial.x, dial.y, dial.radius)
      .fill({ color: BODY, alpha: 1 })
      .circle(dial.x, dial.y, dial.radius)
      .stroke({ width: 2, color: busy ? RAIL : BRASS, alpha: 1 })
      .circle(dial.x, dial.y, dial.radius - 7)
      .stroke({ width: 1, color: BRASS, alpha: 0.45 })
      .circle(dial.x, dial.y, dial.radius * DIAL.innerGuard)
      .fill({ color: HUB, alpha: 1 })
      .circle(dial.x, dial.y, dial.radius * DIAL.innerGuard)
      .stroke({ width: 1, color: BRASS, alpha: 0.5 });

    // Teeth at world angles, so they turn with the heading. Only the ones on the visible crescent are
    // drawn, which is most of the work skipped for free.
    const step = (Math.PI * 2) / DIAL.detents;
    for (let index = 0; index < DIAL.detents; index++) {
      const angle = this.heading + index * step;
      const x1 = dial.x + Math.cos(angle) * (dial.radius - 11);
      const y1 = dial.y + Math.sin(angle) * (dial.radius - 11);
      const x2 = dial.x + Math.cos(angle) * dial.radius;
      const y2 = dial.y + Math.sin(angle) * dial.radius;
      if (x1 > dial.x) continue;
      this.turn.moveTo(x1, y1).lineTo(x2, y2);
    }
    this.turn.stroke({ width: 2, color: busy ? RAIL : BRASS, alpha: busy ? 1 : 0.75 });

    // The index mark: a fixed pointer the teeth pass, which is what makes a rotation legible. Without it a
    // smooth ring gives no sense of having moved at all.
    const markX = dial.x - dial.radius;
    this.turn
      .moveTo(markX - 11, dial.y)
      .lineTo(markX + 7, dial.y - 7)
      .lineTo(markX + 7, dial.y + 7)
      .fill({ color: RAIL, alpha: 1 });

    // A short arc showing which way it is coasting, so a spinning wheel looks spun.
    if (Math.abs(dial.spin) > 0.2) {
      const sweep = Math.min(1.1, Math.abs(dial.spin) * 0.12) * Math.sign(dial.spin);
      this.turn
        .arc(dial.x, dial.y, dial.radius + 5, Math.PI - Math.max(0, sweep), Math.PI - Math.min(0, sweep))
        .stroke({ width: 2, color: RAIL, alpha: 0.8 });
    }
  }

  /** The heading the wheel is showing, kept here so the teeth can be drawn turned. */
  private heading = 0;

  /** Told the drone's heading each frame, since the teeth are drawn in world angles. */
  setHeading(heading: number): void {
    this.heading = heading;
  }

  /**
   * Whether the wheel belongs on screen at all.
   *
   * False inside a claim. The paddle is dragged directly there and facing means nothing, so leaving the
   * wheel up would be an instrument that does not answer -- worse than no instrument.
   */
  wheelVisible = true;

  private drawHint(): void {
    this.hint.clear();
    if (this.hintAlpha < 0.01) return;
    const pulse = 0.55 + Math.sin(this.phase * 1.6) * 0.2;
    this.hint.alpha = this.hintAlpha * pulse;
    const y = view.height - 132 - view.safe.bottom;
    // Inset horizontally as well: on a phone held sideways the island eats a side, and on a rounded
    // display the corners are not usable even in portrait.
    const usable = view.width - view.safe.left - view.safe.right;
    const left = view.safe.left + usable * 0.25;
    const right = view.safe.left + usable * 0.75;

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

// The opening sequence's prompt, anchored to whatever it is talking about.
//
// This replaced a fixed panel pinned to the left edge of the screen, headed with the word
// "CONTROLS", carrying a row of progress pips. Three things were wrong with it, and all three are
// well-covered ground in onboarding design:
//
//   - A prompt should surface *contextually*, next to the thing it concerns, the way a button
//     prompt appears because of where the player is standing or facing. A box in the corner is a
//     manual, and a manual is read once and then ignored.
//   - It led with a category label. The most prominent line on screen said "CONTROLS", which is
//     the one piece of text on it carrying no information at all.
//   - The pips announced that there were eight steps before the player had completed one, which is
//     the front-loading anti-pattern precisely: information shown before it is actionable is
//     easier to skip, ignore and forget, and a progress bar through a tutorial nobody opted into
//     is the player's least useful fact.
//
// So this is a tag in the world, on a leader line, pointing at its subject: the drone, the survey
// frame, the paddle, the ball. It leads with the *goal* rather than the key, because "commit a
// claim" is a thing a player can want and "press F" is a thing they can only obey. The key sits
// underneath in small type, where it belongs once the goal is understood.

import { Container, Graphics, Text } from "pixi.js";
import { PALETTE } from "../config";

const BRASS = PALETTE.machine;
const DIM = 0x9aa3a6;

export interface CoachPrompt {
  /** The imperative. Large, and the first thing read. */
  goal: string;
  /** One short line on why it is worth doing. Omitted where the goal speaks for itself. */
  why?: string;
  /** The keys, small, under the goal. Replaced by `gesture` on a touchscreen. */
  keys: string;
  /** What to do with a finger, shown instead of `keys` when the player is using one. */
  gesture?: string;
  /** A thumb performing the gesture, drawn once per distinct gesture. */
  demo?: "stick" | "swipe" | "tap" | "hold";
  /** World pixel position of the thing being talked about. */
  x: number;
  y: number;
  /** Which side of the subject to hang the tag on, so it never sits off the near edge of the view. */
  side?: 1 | -1;
  /** Ring the subject as well as pointing at it. For steps where *which thing* is the question. */
  ring?: boolean;
}

/**
 * A world-space callout.
 *
 * Lives inside the camera transform so the tag travels with its subject, which is the whole point:
 * it stays beside the drone as the drone flies, rather than the player having to look away from
 * the drone to a box in order to find out what to do with it. The container itself is counter-
 * rotated against the camera, because a claim can be framed at any angle and text on its side is
 * not text.
 */
export class Coach {
  readonly container = new Container();
  private readonly leader = new Graphics();
  private readonly plate = new Graphics();
  private readonly ring = new Graphics();
  /** The demonstrating thumb. Separate so it can animate on its own loop. */
  private readonly ghost = new Graphics();
  private readonly goalText: Text;
  private readonly whyText: Text;
  private readonly keysText: Text;
  private phase = 0;
  /** Rises when a locked control is pressed, so the refusal is answered where the player is looking. */
  private refuse = 0;
  /** Eased 0..1, so a prompt arrives and leaves rather than blinking. */
  private opacity = 0;
  private wanted = 0;
  private shown: CoachPrompt | null = null;

  constructor() {
    const font = { fontFamily: "monospace" as const };
    this.goalText = new Text({ text: "", style: { ...font, fill: 0xffffff, fontSize: 17, fontWeight: "800", letterSpacing: 2 } });
    this.whyText = new Text({ text: "", style: { ...font, fill: DIM, fontSize: 12 } });
    this.keysText = new Text({ text: "", style: { ...font, fill: BRASS, fontSize: 12, fontWeight: "800", letterSpacing: 2 } });
    this.container.addChild(this.ring, this.ghost, this.leader, this.plate, this.goalText, this.whyText, this.keysText);
    this.container.visible = false;
  }

  /**
   * What is being asked for right now, for tests and debug poses.
   *
   * Keyed to what the prompt *wants*, not to whether pixels are still on screen: a tag that has
   * been dismissed spends the next few frames fading, and during those frames the sequence is
   * asking for nothing. Reading visibility instead meant a freshly loaded save reported that it
   * was still teaching the player to fly.
   */
  get prompt(): CoachPrompt | null {
    return this.wanted > 0 ? this.shown : null;
  }

  /** Nothing to teach right now. Fades rather than cutting. */
  hide(): void {
    this.wanted = 0;
  }

  /** A locked control was pressed. Answer it at the prompt rather than somewhere else. */
  refused(): void {
    this.refuse = 1;
  }

  show(prompt: CoachPrompt): void {
    this.shown = prompt;
    this.wanted = 1;
    this.container.visible = true;
  }

  /**
   * `cameraRotation` and `cameraZoom` are the world's, and this cancels both.
   *
   * Rotation because a claim can be framed at any angle and text on its side is not text. Zoom
   * because the tag is an annotation, not scenery: it is anchored *at* a world point but should be
   * the same size on screen however far the camera has pulled back. Without this it shrinks with
   * the board, and on a phone -- where the zoom does the most work -- it shrinks to illegible.
   */
  update(dt: number, cameraRotation: number, cameraZoom = 1): void {
    this.opacity += (this.wanted - this.opacity) * Math.min(1, dt * 7);
    if (this.opacity < 0.01 && this.wanted === 0) {
      this.container.visible = false;
      this.shown = null;
      return;
    }
    const prompt = this.shown;
    if (!prompt) return;
    this.phase += dt;
    this.refuse = Math.max(0, this.refuse - dt * 2.2);

    // The whole tag is laid out about the origin and then placed on the subject, so following a
    // moving thing costs one assignment and the geometry never has to know where it is.
    this.container.position.set(prompt.x, prompt.y);
    this.container.rotation = -cameraRotation;
    this.container.scale.set(1 / Math.max(0.01, cameraZoom));
    this.container.alpha = this.opacity;

    this.goalText.text = prompt.goal;
    this.whyText.text = prompt.why ?? "";
    // The gesture wins when there is one, because there is only ever one player and they are
    // holding exactly one kind of device.
    this.keysText.text = prompt.gesture ?? prompt.keys;

    const side = prompt.side ?? 1;
    const padding = 11;
    const width = Math.max(this.goalText.width, this.whyText.width, this.keysText.width) + padding * 2;
    const height = padding * 2 + 20 + (prompt.why ? 17 : 0) + 16;
    // Breathing very slightly, and sliding the last few pixels into place as it appears, so the
    // prompt is alive on screen without demanding to be watched.
    const breathe = Math.sin(this.phase * 2.2) * 1.5;
    // A refusal shoves the plate and reddens its edge: the answer to "that key does nothing yet"
    // arrives where the player is already looking, not in a corner where they are not.
    const shove = this.refuse > 0 ? Math.sin(this.refuse * 30) * 6 * this.refuse : 0;
    const left = side > 0 ? 66 : -66 - width;
    const x = left + shove * side + (1 - this.opacity) * 14 * side;
    const y = -74 + breathe;
    const edge = this.refuse > 0.02 ? PALETTE.danger : BRASS;

    this.goalText.position.set(x + padding, y + padding);
    this.whyText.position.set(x + padding, y + padding + 22);
    this.keysText.position.set(x + padding, y + height - padding - 12);

    this.plate.clear()
      .roundRect(x, y, width, height, 2)
      .fill({ color: 0x0a0e10, alpha: 0.92 })
      .stroke({ width: 1, color: edge, alpha: 0.7 })
      // A heavier rule down the leading edge, borrowing the machine vocabulary the bay and the HUD
      // already use, so the prompt reads as part of the drone rather than as an overlay.
      .rect(side > 0 ? x : x + width - 2, y, 2, height)
      .fill({ color: edge, alpha: 0.95 });

    // An elbowed leader down to the subject, so the tag is attached to the thing rather than
    // merely near it.
    const elbowX = side > 0 ? x : x + width;
    this.leader.clear()
      .moveTo(elbowX, y + height - 9)
      .lineTo(elbowX - 20 * side, y + height - 9)
      .lineTo(0, 0)
      .stroke({ width: 1.5, color: edge, alpha: 0.5 })
      .circle(0, 0, 3)
      .fill({ color: edge, alpha: 0.9 });

    this.drawGhost(prompt, side);

    this.ring.clear();
    if (prompt.ring) {
      const pulse = (Math.sin(this.phase * 3) + 1) / 2;
      this.ring
        .circle(0, 0, 26 + pulse * 12)
        .stroke({ width: 2, color: BRASS, alpha: 0.45 - pulse * 0.3 })
        .circle(0, 0, 18)
        .stroke({ width: 1.5, color: BRASS, alpha: 0.3 });
    }
  }

  /**
   * A thumb performing the gesture, on a loop.
   *
   * "Drag on the left half" is a description of a gesture; a thumb visibly doing it is an
   * instruction. This is the part of touch onboarding that words genuinely cannot replace -- there
   * is no phrasing of "push the stick to move" that teaches as fast as watching it happen once.
   *
   * Drawn below the subject rather than over it, so the demonstration never hides the thing being
   * demonstrated on.
   */
  private drawGhost(prompt: CoachPrompt, side: 1 | -1): void {
    this.ghost.clear();
    if (!prompt.demo) return;
    // A slow loop with a pause at the end, so each repetition reads as a separate demonstration
    // rather than as continuous motion.
    const CYCLE = 2.4;
    const t = (this.phase % CYCLE) / CYCLE;
    // Eased out and back, held at the extremes.
    const travel = t < 0.55 ? Math.min(1, t / 0.4) : Math.max(0, 1 - (t - 0.55) / 0.2);
    const eased = travel * travel * (3 - 2 * travel);
    const baseY = 58;
    const reach = 46;

    if (prompt.demo === "tap" || prompt.demo === "hold") {
      // A pad with expanding rings. A hold shows two rings still going out at the end of the cycle,
      // which is the only visual difference that reads as "keep it down".
      const held = prompt.demo === "hold";
      const pressed = held ? Math.min(1, t / 0.25) : (t < 0.3 ? t / 0.3 : 0);
      for (const ring of held ? [0, 0.45, 0.9] : [0]) {
        const wave = (t + ring) % 1;
        this.ghost
          .circle(0, baseY, 14 + wave * 26)
          .stroke({ width: 2, color: BRASS, alpha: Math.max(0, 0.4 * (1 - wave)) });
      }
      this.ghost
        .circle(0, baseY, 15 - pressed * 3)
        .fill({ color: BRASS, alpha: 0.18 + pressed * 0.24 })
        .stroke({ width: 2, color: BRASS, alpha: 0.6 });
      return;
    }

    // A drag. The stick demo shows its gate as well as the thumb, because the gate is the thing
    // that makes a floating stick legible; a swipe has no gate to show.
    const from = -reach * side;
    const at = from + reach * 2 * eased * side;
    if (prompt.demo === "stick") {
      this.ghost
        .circle(from, baseY, 34)
        .stroke({ width: 2, color: BRASS, alpha: 0.22 })
        .moveTo(from, baseY)
        .lineTo(at, baseY)
        .stroke({ width: 2, color: BRASS, alpha: 0.3 });
    } else {
      // A dotted track, so the path is visible before the thumb has travelled it.
      for (let step = 0; step <= 6; step++) {
        this.ghost
          .circle(from + (reach * 2 * (step / 6)) * side, baseY, 2)
          .fill({ color: BRASS, alpha: 0.22 });
      }
    }
    // A short trail behind the thumb, which is what makes the direction unambiguous at a glance.
    for (const lag of [0.16, 0.3]) {
      const back = Math.max(0, eased - lag);
      this.ghost
        .circle(from + reach * 2 * back * side, baseY, 13 - lag * 18)
        .fill({ color: BRASS, alpha: 0.12 });
    }
    this.ghost
      .circle(at, baseY, 15)
      .fill({ color: BRASS, alpha: 0.26 })
      .stroke({ width: 2, color: BRASS, alpha: 0.66 });
  }
}

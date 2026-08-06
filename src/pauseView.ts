// The pause menu, and the countdown that gives the claim back.
//
// DOM rather than drawn in the world, deliberately, and the opposite call from the refit bay. The
// bay had to *be* the machine, because its whole subject is a thing with parts on it. A pause menu
// is a list of words and a set of buttons about the session rather than about the drone, and
// making it a picture would be decoration standing between the player and a save button.
//
// It owns three jobs: say what every control does, offer the things you do to a session, and --
// when there is a live claim -- offer to end it, with the cost stated before it is paid.

export interface PauseActions {
  onResume(): void;
  onSaveNow(): void;
  onExport(): void;
  onImport(): void;
  onEndClaim(): void;
}

export interface PauseModel {
  /** A live claim is what makes ending one possible, and what makes resuming need a countdown. */
  inClaim: boolean;
  /**
   * Damage ending the claim right now would cost, from the liable material still standing.
   *
   * Stated as a number rather than a warning, because "you will take 14 damage" is a decision and
   * "are you sure?" is a speed bump.
   */
  endCost: number;
  integrity: number;
  maxIntegrity: number;
  /** True when the player is using fingers, which decides which control reference is shown. */
  touch: boolean;
}

/**
 * Every control, always. This is the reference the tutorial's one-rung prompt is not.
 *
 * Grouped by where they work, because "which of these can I press right now" is the question
 * somebody opens this menu to answer.
 */
const CONTROLS: ReadonlyArray<{ group: string; rows: ReadonlyArray<[string, string]> }> = [
  {
    group: "IN THE MINE",
    rows: [
      ["WASD / ARROWS", "Move"],
      ["Q / E", "Aim the survey frame"],
      ["F", "Commit the claim"],
      ["M", "Open the Atlas"],
      ["C", "Refit bay, at an anchor"],
    ],
  },
  {
    group: "IN A CLAIM",
    rows: [
      ["Q / E", "Aim the serve"],
      ["SPACE", "Serve"],
      ["A / D  ·  ← / →", "Move the paddle"],
      ["W / S  ·  ↑ / ↓", "Hold to run at ×2 / ×4"],
      ["BOTH", "Hold both to run at ×8"],
      ["B", "Detonate a blast charge"],
      ["R", "Place the rail seed"],
    ],
  },
  {
    group: "ANY TIME",
    rows: [["ESC", "Pause"]],
  },
];

/**
 * The same reference for fingers.
 *
 * Kept as a separate table rather than generated from the keyboard one, because the two control
 * schemes are not a translation of each other: the keyboard has a key per action and touch has
 * three gestures plus four buttons, so several rows collapse and one -- holding both speed keys --
 * has no touch equivalent at all.
 */
const TOUCH_CONTROLS: ReadonlyArray<{ group: string; rows: ReadonlyArray<[string, string]> }> = [
  {
    group: "IN THE MINE",
    rows: [
      ["DRAG · LEFT HALF", "Fly the drone"],
      ["DRAG · RIGHT HALF", "Turn the survey frame"],
      ["COMMIT", "Claim the framed rock"],
      ["TAP THE WORLD", "Also commits"],
      ["ATLAS · FORGE", "Top right. Forge needs an anchor"],
    ],
  },
  {
    group: "IN A CLAIM",
    rows: [
      ["DRAG", "Slide the paddle. It rides above your thumb"],
      ["DRAG WIDE", "Before serving, angles the launch"],
      ["TAP  ·  SERVE", "Launch the ball"],
      ["HOLD FAST", "Runs at ×2, then ×4, then ×8"],
    ],
  },
  {
    group: "ANY TIME",
    rows: [["PAUSE", "Top right"]],
  },
];

export class PauseView {
  private readonly panel = document.querySelector<HTMLElement>("#pause");
  private readonly body = document.querySelector<HTMLElement>("#pauseBody");
  private readonly countdown = document.querySelector<HTMLElement>("#countdown");
  private actions: PauseActions | null = null;
  /** True once the player has been shown the cost and is being asked to confirm. */
  private confirmingEnd = false;
  private model: PauseModel | null = null;

  bind(actions: PauseActions): void {
    this.actions = actions;
  }

  setOpen(open: boolean, model?: PauseModel): void {
    this.panel?.classList.toggle("open", open);
    if (!open) {
      this.confirmingEnd = false;
      return;
    }
    if (model) this.render(model);
  }

  get isConfirming(): boolean {
    return this.confirmingEnd;
  }

  /** Back out of the confirmation without ending the claim. Returns true if it did anything. */
  cancelConfirm(): boolean {
    if (!this.confirmingEnd) return false;
    this.confirmingEnd = false;
    if (this.model) this.render(this.model);
    return true;
  }

  /**
   * The 3-2-1.
   *
   * Drawn from the remaining seconds rather than from a step counter, so it stays honest at any
   * frame rate and cannot show "1" for two seconds on a slow machine.
   */
  showCountdown(secondsLeft: number): void {
    if (!this.countdown) return;
    if (secondsLeft <= 0) {
      this.countdown.classList.remove("show");
      this.countdown.textContent = "";
      return;
    }
    const count = Math.ceil(secondsLeft);
    if (this.countdown.textContent !== String(count)) {
      this.countdown.textContent = String(count);
      // Restart the pop by reflowing, so each number lands rather than the animation running once.
      this.countdown.classList.remove("show");
      void this.countdown.offsetWidth;
      this.countdown.classList.add("show");
    }
  }

  render(model: PauseModel): void {
    if (!this.body) return;
    this.model = model;

    // Whichever device the player is actually holding. Listing keys to somebody on a phone
    // describes hardware they do not have, and hides the controls they do.
    const table = model.touch ? TOUCH_CONTROLS : CONTROLS;
    const controls = table.map((section) => `<section class="pause-group">
      <h3>${section.group}</h3>
      <dl>${section.rows.map(([keys, what]) =>
        `<dt>${keys}</dt><dd>${what}</dd>`).join("")}</dl>
    </section>`).join("");

    // Ending a claim is offered only when there is one, and the cost is stated before the button
    // that charges it -- so the confirmation is informative rather than merely obstructive.
    let claimBlock = "";
    if (model.inClaim) {
      claimBlock = this.confirmingEnd
        ? `<div class="pause-confirm">
            <b>END THE CLAIM NOW?</b>
            <p>${model.endCost > 0
              ? `Material still standing will load the hull for <b>${model.endCost}</b> damage. Health ${model.integrity} → ${Math.max(0, model.integrity - model.endCost)}.`
              : "Nothing is still standing that would load the hull. This costs nothing."}</p>
            <div class="pause-row">
              <button type="button" data-act="endConfirm" class="danger">END CLAIM</button>
              <button type="button" data-act="endCancel">KEEP PLAYING</button>
            </div>
          </div>`
        : `<div class="pause-row">
            <button type="button" data-act="end">END CLAIM${model.endCost > 0 ? ` · ${model.endCost} DAMAGE` : " · FREE"}</button>
          </div>`;
    }

    this.body.innerHTML = `
      <div class="pause-controls">${controls}</div>
      <div class="pause-actions">
        ${claimBlock}
        <div class="pause-row">
          <button type="button" data-act="save">SAVE NOW</button>
          <button type="button" data-act="export">EXPORT SAVE</button>
          <button type="button" data-act="import">IMPORT SAVE</button>
        </div>
        <div class="pause-row">
          <button type="button" data-act="resume" class="primary">RESUME</button>
        </div>
      </div>`;

    for (const button of this.body.querySelectorAll<HTMLButtonElement>("button[data-act]")) {
      button.addEventListener("click", () => this.press(button.dataset.act ?? ""));
    }
  }

  private press(action: string): void {
    const actions = this.actions;
    if (!actions || !this.model) return;
    switch (action) {
      case "resume": actions.onResume(); break;
      case "save": actions.onSaveNow(); break;
      case "export": actions.onExport(); break;
      case "import": actions.onImport(); break;
      case "end":
        this.confirmingEnd = true;
        this.render(this.model);
        break;
      case "endCancel":
        this.confirmingEnd = false;
        this.render(this.model);
        break;
      case "endConfirm":
        this.confirmingEnd = false;
        actions.onEndClaim();
        break;
    }
  }
}

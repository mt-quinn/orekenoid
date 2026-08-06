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
      ["WASD / \u2191\u2190\u2193\u2192", "Move"],
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
      ["A / D  ·  ←→", "Move the paddle"],
      ["W / S  ·  ↑↓", "Hold to run at ×2 / ×4"],
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
      ["TAP THE BOARD", "Before serving, aims where the ball goes"],
      ["SERVE", "Launch it"],
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
    // Each key gets its own cap rather than sitting in a run of bold text. "WASD / ARROWS  Move"
    // read as one undifferentiated line; a capped key and a plain description read as two things,
    // which is the whole job of this table.
    const caps = (keys: string) => keys
      .split(/\s*·\s*/)
      .map((group) => group
        .split(/\s*\/\s*/)
        .map((key) => `<kbd>${key}</kbd>`)
        .join('<span class="pause-or">/</span>'))
      .join('<span class="pause-dot">·</span>');
    const controls = table.map((section) => `<section class="pause-group">
      <h3><span>${section.group}</span></h3>
      <dl>${section.rows.map(([keys, what]) =>
        `<dt>${model.touch ? `<kbd class="wide">${keys}</kbd>` : caps(keys)}</dt><dd>${what}</dd>`).join("")}</dl>
    </section>`).join("");

    // Ending a claim is offered only when there is one, and the cost is stated before the button
    // that charges it -- so the confirmation is informative rather than merely obstructive.
    // Ending a claim is destructive and irreversible, so it is drawn as a hazard panel rather than
    // as one more button in a row of identical slabs -- the old layout gave it exactly the same
    // weight as EXPORT SAVE, which is the wrong thing to do with the only button here that can cost
    // the player their run.
    let claimBlock = "";
    if (model.inClaim) {
      const after = Math.max(0, model.integrity - model.endCost);
      claimBlock = this.confirmingEnd
        ? `<div class="pause-hazard pause-confirm">
            <div class="pause-hazard-head"><b>END THE CLAIM NOW?</b></div>
            <p>${model.endCost > 0
              ? `Material still standing loads the hull for <b>${model.endCost}</b> damage.`
              : "Nothing still standing would load the hull. This costs nothing."}</p>
            ${model.endCost > 0 ? `<div class="pause-toll">
              <span>HEALTH</span><b>${model.integrity}</b><i>→</i><b class="after">${after}</b>
            </div>` : ""}
            <div class="pause-hazard-row">
              <button type="button" data-act="endConfirm" class="danger">END IT</button>
              <button type="button" data-act="endCancel" class="quiet">KEEP PLAYING</button>
            </div>
          </div>`
        : `<div class="pause-hazard">
            <div class="pause-hazard-head"><b>ABANDON THE CLAIM</b></div>
            <p>${model.endCost > 0
              ? `Everything still standing comes home at you. <b>${model.endCost}</b> damage.`
              : "Nothing is left standing. Walking away is free."}</p>
            <button type="button" data-act="end" class="hazard">
              END CLAIM<i>${model.endCost > 0 ? `${model.endCost} DAMAGE` : "FREE"}</i>
            </button>
          </div>`;
    }

    // Ordered by what the player came here to do. Resuming is the overwhelmingly common answer, so
    // it is the largest and the first thing under the hand; the save utilities are rare and quiet.
    this.body.innerHTML = `
      <div class="pause-controls">${controls}</div>
      <div class="pause-actions">
        <button type="button" data-act="resume" class="pause-resume">
          <span>RESUME</span><i>${model.inClaim ? "COUNTS BACK IN FROM 3" : "BACK TO THE SURVEY"}</i>
        </button>
        ${claimBlock}
        <div class="pause-utils">
          <button type="button" data-act="save">SAVE NOW</button>
          <button type="button" data-act="export">EXPORT</button>
          <button type="button" data-act="import">IMPORT</button>
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

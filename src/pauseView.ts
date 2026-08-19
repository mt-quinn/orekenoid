import { ACTION_LABEL, keyName, type Action, type Bindings } from "./bindings";
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
  /** Bind a key to an action. Returns why it was refused, if it was. */
  onBind(action: Action, code: string): { ok: boolean; reason?: string };
  onResetBindings(): void;
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
  /** The live bindings, so the panel lists what the keys actually do rather than what they used to. */
  bindings: Bindings;
  /** True when the player is using fingers, which decides which control reference is shown. */
  touch: boolean;
}

/**
 * Every control, always. This is the reference the tutorial's one-rung prompt is not.
 *
 * Grouped by where they work, because "which of these can I press right now" is the question
 * somebody opens this menu to answer.
 */
/**
 * The keyboard reference, naming actions rather than keys.
 *
 * It used to spell the keycaps out -- `["F", "Commit the claim"]` -- which was fine while they could not
 * change and became a lie the moment they could. A row carries the actions it is about and the caps are
 * composed from the live bindings, so this panel and the rebinding list below it cannot disagree.
 *
 * `text` is for the rows that are not a binding at all: holding both speed keys, and Escape.
 */
interface ControlRow {
  actions?: Action[];
  text?: string;
  label: string;
}

const CONTROLS: ReadonlyArray<{ group: string; rows: readonly ControlRow[] }> = [
  {
    group: "In the mine",
    rows: [
      { actions: ["moveUp", "moveLeft", "moveDown", "moveRight"], label: "Move" },
      { actions: ["aimLeft", "aimRight"], label: "Aim the survey frame" },
      { actions: ["commit"], label: "Commit the claim" },
      { actions: ["atlas"], label: "Open the Atlas" },
      { actions: ["forge"], label: "Refit bay, at an anchor" },
    ],
  },
  {
    group: "In a claim",
    rows: [
      { actions: ["aimLeft", "aimRight"], label: "Aim the serve" },
      { actions: ["serve"], label: "Serve" },
      { actions: ["paddleLeft", "paddleRight"], label: "Move the paddle" },
      { actions: ["fast", "slow"], label: "Hold to run at \u00d72 / \u00d74" },
      { text: "BOTH", label: "Hold both to run at \u00d78" },
      { actions: ["blast"], label: "Detonate a blast charge" },
      { actions: ["railSeed"], label: "Place the rail seed" },
    ],
  },
  {
    group: "Any time",
    rows: [{ text: "ESC", label: "Pause" }],
  },
];

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


/**
 * Actions the rebinding list leaves out.
 *
 * The paired halves of a control are hidden rather than removed: flying left and sliding the paddle left
 * are one key to the player, so the list shows the survey row and binding it moves both. The diagnostic
 * probe is a developer key and not part of the game's vocabulary.
 */
const HIDDEN_FROM_REBIND: readonly Action[] = ["paddleLeft", "paddleRight", "fast", "slow", "probe"];

export class PauseView {
  private readonly panel = document.querySelector<HTMLElement>("#pause");
  private readonly body = document.querySelector<HTMLElement>("#pauseBody");
  private readonly countdown = document.querySelector<HTMLElement>("#countdown");
  private actions: PauseActions | null = null;
  /** True once the player has been shown the cost and is being asked to confirm. */
  private confirmingEnd = false;
  private model: PauseModel | null = null;
  /** The action waiting for a keystroke, or null. */
  private listening: Action | null = null;

  bind(actions: PauseActions): void {
    this.actions = actions;
    // Captured here rather than in the game's own handler, and at capture phase, so the keystroke that
    // is *becoming* a binding never also fires whatever it is currently bound to.
    window.addEventListener("keydown", (event) => {
      if (!this.listening) return;
      event.preventDefault();
      event.stopPropagation();
      const action = this.listening;
      this.listening = null;
      if (event.code === "Escape") {
        // Escape backs out of the rebind rather than becoming one -- it is reserved.
        if (this.model) this.render(this.model);
        return;
      }
      const result = this.actions?.onBind(action, event.code);
      this.refusal = result && !result.ok ? (result.reason ?? "that key is taken") : null;
      if (this.model) this.render(this.model);
    }, { capture: true });
  }

  /** Why the last rebind was refused, shown under the list. */
  private refusal: string | null = null;

  /** Is the panel waiting for a keystroke? The game asks, so it can hold its own input off. */
  get isRebinding(): boolean {
    return this.listening !== null;
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
    // Touch rows still spell their gestures out: a gesture is not a binding and there is nothing to look
    // up. Keyboard rows resolve their actions through the live bindings.
    const rows = model.touch
      ? TOUCH_CONTROLS.map((section) => ({
        group: section.group,
        rows: section.rows.map(([keys, label]) => ({ keys, label })),
      }))
      : CONTROLS.map((section) => ({
        group: section.group,
        rows: section.rows.map((row) => ({
          keys: row.text ?? (row.actions ?? [])
            // One cap per distinct key, in the order the row names them, without repeating a key that two
            // actions share.
            .flatMap((action) => model.bindings.codesFor(action))
            .filter((code, index, all) => all.indexOf(code) === index)
            .map(keyName)
            .join(" / "),
          label: row.label,
        })),
      }));
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
    const controls = rows.map((section) => `<section class="pause-group">
      <h3><span>${section.group}</span></h3>
      <dl>${section.rows.map((row) =>
        `<dt>${model.touch ? `<kbd class="wide">${row.keys}</kbd>` : caps(row.keys)}</dt><dd>${row.label}</dd>`).join("")}</dl>
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
    // Rebinding lives here because this is the only screen the player can reach mid-expedition, and a
    // control they cannot reach is a control they cannot fix.
    const rebinds = model.touch ? "" : `
      <div class="pause-rebind">
        <h4>KEYS<button type="button" data-act="resetKeys">RESET</button></h4>
        <ul>
          ${model.bindings.actions
            .filter((action) => !HIDDEN_FROM_REBIND.includes(action))
            .map((action) => `
              <li>
                <span>${ACTION_LABEL[action]}</span>
                <button type="button" data-bind="${action}" class="${this.listening === action ? "listening" : ""}">
                  ${this.listening === action ? "PRESS A KEY" : model.bindings.label(action)}
                </button>
              </li>`).join("")}
        </ul>
        ${this.refusal ? `<em class="pause-refusal">${this.refusal}</em>` : ""}
      </div>`;

    this.body.innerHTML = `
      <div class="pause-controls">${controls}</div>
      ${rebinds}
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
    for (const button of this.body.querySelectorAll<HTMLButtonElement>("button[data-bind]")) {
      button.addEventListener("click", () => {
        this.refusal = null;
        this.listening = button.dataset.bind as Action;
        if (this.model) this.render(this.model);
      });
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
      case "resetKeys":
        this.listening = null;
        this.refusal = null;
        actions.onResetBindings();
        this.render(this.model);
        break;
      case "endConfirm":
        this.confirmingEnd = false;
        actions.onEndClaim();
        break;
    }
  }
}

import type { Bindings } from "./bindings";
import type { AudioSettings } from "./audioSettings";
import { audioPanelHtml, touchControlsHtml, wireAudioPanel, type KeyRebinder } from "./settingsView";
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
export class PauseView {
  private readonly panel = document.querySelector<HTMLElement>("#pause");
  private readonly body = document.querySelector<HTMLElement>("#pauseBody");
  private readonly countdown = document.querySelector<HTMLElement>("#countdown");
  private actions: PauseActions | null = null;
  /** True once the player has been shown the cost and is being asked to confirm. */
  private confirmingEnd = false;
  private model: PauseModel | null = null;

  /**
   * The key list and the audio panel are the title screen's, shown here as well.
   *
   * Handed in rather than built here because the rebinder owns a capture-phase key listener that has to
   * outlive any one panel, and because two copies of the audio state would be two answers to what the volume
   * is.
   */
  constructor(
    private readonly settings: AudioSettings,
    private readonly rebinder: KeyRebinder,
  ) {}

  bind(actions: PauseActions): void {
    this.actions = actions;
  }

  /** Is the panel waiting for a keystroke? The game asks, so it can hold its own input off. */
  get isRebinding(): boolean {
    return this.rebinder.isRebinding;
  }

  setOpen(open: boolean, model?: PauseModel): void {
    this.panel?.classList.toggle("open", open);
    if (!open) {
      this.confirmingEnd = false;
      this.rebinder.cancel();
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

    // The keyboard reference is gone; the rebinding list below *is* the reference.
    //
    // It listed every key beside its meaning, which is exactly what the KEYS list does, so the panel said
    // everything twice -- and the copy that could not be edited was the one drawn as keycaps, which had
    // started overlapping its own labels as rows wrapped.
    //
    // The gesture reference stays, and only on a touchscreen. A gesture is not a binding: there is nothing
    // to rebind and therefore nothing in the list below, so removing this as well would leave a phone with
    // no control reference at all.
    const controls = model.touch ? touchControlsHtml() : "";

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
    const rebinds = model.touch ? "" : this.rebinder.html(model.bindings);

    this.body.innerHTML = `
      ${controls}
      ${audioPanelHtml(this.settings.current)}
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
    wireAudioPanel(this.body, this.settings, () => {
      if (this.model) this.render(this.model);
    });
    if (!model.touch) {
      this.rebinder.wire(this.body, () => {
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
      case "endConfirm":
        this.confirmingEnd = false;
        actions.onEndClaim();
        break;
    }
  }
}

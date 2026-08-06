// The two things that stop the game without the player asking.
//
// **Context loss.** A phone takes a call, the player switches apps, the browser suspends the audio
// context. The game must already be stopped by the time they look back, because the alternative is
// returning to a claim that carried on without them -- and on a phone that is not an edge case, it
// is Tuesday. The way back is one plate and one tap: deliberately *not* the pause menu, because the
// player never asked to pause and should not be handed a menu of decisions on the way in.
//
// **Orientation.** The rig is portrait. Landscape gets a designed gate in the game's own voice
// rather than a browser default, and nothing behind it is lost -- the expedition is exactly where
// it was, held, until the device comes back upright.
//
// Both are separated from `pauseView` on purpose. That is a menu the player opened; these are
// states the world put them in, and conflating the two would mean answering "why is this here?"
// with the same interface in both cases.

/** Why the game is being held, which decides what the plate says. */
export type HoldReason = "hidden" | "audio" | "blur";

export interface HoldsCallbacks {
  /** Stop the simulation. Called once per hold, not per frame. */
  onHold: (reason: HoldReason) => void;
  /** The player tapped through. Runs the countdown, not an instant unpause. */
  onResume: () => void;
  /** Landscape arrived or left. */
  onOrientation: (portrait: boolean) => void;
}

const REASONS: Record<HoldReason, { title: string; detail: string }> = {
  hidden: {
    title: "SURVEY HELD",
    detail: "The rig stopped when you looked away.",
  },
  audio: {
    // The honest explanation. A browser that suspends audio has effectively pulled the game's sound
    // out from under it, and saying so is better than resuming silently into a mute game.
    title: "AUDIO CUT",
    detail: "The device dropped the sound channel. Tap to bring it back up.",
  },
  blur: {
    title: "SURVEY HELD",
    detail: "The rig stopped when the window lost focus.",
  },
};

export class Holds {
  /**
   * Whether this device is finger-driven, which decides how strongly to read a lost focus.
   *
   * Read live rather than captured, because the classifier depends on a media query that can change
   * -- a tablet with a keyboard attached and detached is the same page.
   */
  private touchDevice(): boolean {
    return window.matchMedia?.("(pointer: coarse)").matches === true;
  }

  private plate: HTMLElement | null = null;
  private button: HTMLElement | null = null;
  private reasonText: HTMLElement | null = null;
  private titleText: HTMLElement | null = null;
  private gate: HTMLElement | null = null;
  private held: HoldReason | null = null;
  private callbacks: HoldsCallbacks | null = null;

  /** True while the game is stopped by a hold, so callers can refuse to simulate. */
  get holding(): boolean {
    return this.held !== null;
  }

  /** True while the device is sideways and the gate is up. */
  landscape = false;

  attach(callbacks: HoldsCallbacks): void {
    this.callbacks = callbacks;
    this.plate = document.querySelector<HTMLElement>("#resumePlate");
    this.button = document.querySelector<HTMLElement>("#resumeButton");
    this.reasonText = document.querySelector<HTMLElement>("#resumeReason");
    this.titleText = this.button?.querySelector("b") ?? null;
    this.gate = document.querySelector<HTMLElement>("#rotateGate");

    this.button?.addEventListener("click", () => this.release());

    // `visibilitychange` is the reliable one on mobile -- `blur` does not fire consistently when an
    // app is backgrounded, and `pagehide` is too late to do anything useful with.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") this.hold("hidden");
    });
    // Blur is deliberately *not* a hold on a desktop. Alt-tabbing away from a game is ordinary
    // there, and answering it with a full-cover plate that needs a click to dismiss would be a
    // regression for the keyboard player -- clearing held keys, which the game already did, is the
    // right response. On a touch device losing focus is a much stronger signal: there is no
    // alt-tab, so it means something took over the screen.
    window.addEventListener("blur", () => {
      if (this.touchDevice()) this.hold("blur");
    });
    // Deliberately no auto-release on `visibilitychange: visible`. Coming back to a live ball
    // without warning is the thing the plate exists to prevent, so returning to the tab is not
    // consent to resume -- the tap is.

    const orientation = () => {
      // Phones only. A desktop window is landscape by definition, and gating the game behind "hold
      // the rig upright" on a monitor is absurd -- but that is exactly what this did on the first
      // call, because `attach` runs `orientation()` immediately to catch a device already sideways.
      // Tablets are left alone too: a landscape tablet is a perfectly good way to play.
      const landscape = this.touchDevice()
        && Math.min(window.innerWidth, window.innerHeight) < 600
        && window.innerWidth > window.innerHeight;
      if (landscape === this.landscape) return;
      this.landscape = landscape;
      if (this.gate) this.gate.hidden = !landscape;
      // Turning sideways holds the game too. Otherwise the gate would cover a claim that was still
      // being played behind it, which is the worst of both.
      if (landscape) this.hold("hidden");
      this.callbacks?.onOrientation(!landscape);
    };
    window.addEventListener("resize", orientation);
    window.addEventListener("orientationchange", orientation);
    orientation();
  }

  /**
   * An audio context that has stopped. Reported by the audio layer rather than polled.
   *
   * Mobile browsers suspend audio for reasons that have nothing to do with this game, and the
   * suspension outlives whatever caused it -- so the recovery has to be a gesture, and the honest
   * place to ask for one is a plate that stops everything.
   */
  audioLost(): void {
    this.hold("audio");
  }

  private hold(reason: HoldReason): void {
    // First reason wins. A backgrounded tab fires several of these, and letting the last one
    // through would relabel the plate with whichever event happened to arrive last.
    if (this.held) return;
    if (!this.callbacks) return;
    this.held = reason;
    const copy = REASONS[reason];
    if (this.titleText) this.titleText.textContent = copy.title;
    if (this.reasonText) this.reasonText.textContent = copy.detail;
    if (this.plate) this.plate.hidden = false;
    this.callbacks.onHold(reason);
  }

  private release(): void {
    if (!this.held) return;
    // Still sideways: the tap dismissed the plate, but the gate is the real blocker and the game
    // stays held behind it.
    if (this.landscape) return;
    this.held = null;
    if (this.plate) this.plate.hidden = true;
    this.callbacks?.onResume();
  }
}

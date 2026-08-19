// When the sound does not work, say so.
//
// Audio is the one subsystem in this game that can fail completely and leave no trace on the screen. A renderer
// that will not start is a black rectangle; a save that will not load is an empty menu; a sound channel that
// never opens looks exactly like a game you have muted on purpose. Every failure below has actually happened on
// a real browser, and every one of them was diagnosed from a console rather than from the game -- which is to
// say, not diagnosed at all by the person playing it.
//
// So the rule is the same one the context-loss plate already follows: a state the world put the player in gets
// a plate that explains it in the game's voice, and a way out. The difference is that this one does not stop
// the game. Silent audio is not dangerous the way a claim running unattended is, and a modal over the title
// screen would be a worse first impression than a quiet one -- so it states the fault, offers the fix, and
// takes "carry on silent" for an answer.

/** Everything the gate needs to know about the state of the sound. */
export interface AudioReport {
  /**
   * Whether opening the sound has been attempted yet.
   *
   * Without this, "no context" cannot be told apart from "nobody has clicked", and the gate announced NO SOUND
   * CHANNEL over the title screen of a game whose audio was working perfectly and simply had not been asked for
   * -- the same mistake the status line made in orange, in a louder place.
   */
  attempted: boolean;
  /** A context exists at all. */
  started: boolean;
  /** And it is running rather than suspended. */
  running: boolean;
  /** The format the score opened, or null if it has not opened one. */
  format: string | null;
  /** Why no format could be chosen, if that is what happened. */
  refusal: string | null;
  /** Whether the score has been asked for yet -- it loads at deployment, not on the title screen. */
  musicRequested: boolean;
  musicPlaying: boolean;
  /** Whether the player wants music at all. A muted channel that is not playing is not a fault. */
  musicWanted: boolean;
  samplesLoaded: number;
  samplesExpected: number;
}

export interface AudioFault {
  /** Stable identifier, so a fault can be recognised without matching prose. */
  code: "nostart" | "suspended" | "unsupported" | "samples" | "score";
  title: string;
  detail: string;
  /** Label for the button that tries to fix it, or null when nothing can be done from here. */
  action: string | null;
}

/**
 * What is wrong with the sound, or null.
 *
 * Ordered by cause rather than by severity, because these are not independent: a suspended context makes
 * everything downstream of it look broken too, and reporting "the score is not playing" when the real answer is
 * "the browser has not allowed any audio yet" sends the player after the wrong thing.
 *
 * Pure, so the whole decision table is testable without a browser -- which matters more here than usual, since
 * the states being described are ones this machine cannot reproduce.
 */
export function audioFault(report: AudioReport): AudioFault | null {
  // Nothing has asked for sound yet, so nothing is wrong. This is the state the title screen is in until the
  // player's first click.
  if (!report.attempted) return null;
  if (!report.started) {
    return {
      code: "nostart",
      title: "NO SOUND CHANNEL",
      detail: "The rig could not open an audio channel. Nothing else is affected.",
      action: "TRY AGAIN",
    };
  }
  if (!report.running) {
    return {
      code: "suspended",
      title: "SOUND IS HELD",
      detail: "The browser has not let the sound through yet. One click opens it.",
      action: "TURN THE SOUND ON",
    };
  }
  if (report.refusal) {
    // Nothing to retry: the browser has told us it cannot play anything we ship, and asking it twice will not
    // change its mind. Saying which browser it is would be guessing; saying what happened is not.
    return {
      code: "unsupported",
      title: "AUDIO UNSUPPORTED",
      detail: `This browser cannot play any format the game ships (${report.refusal}).`,
      action: null,
    };
  }
  if (report.samplesExpected > 0 && report.samplesLoaded === 0) {
    return {
      code: "samples",
      title: "SOUND EFFECTS MISSING",
      detail: "None of the impact recordings loaded. The game falls back to its synthesised set.",
      action: "TRY AGAIN",
    };
  }
  if (report.samplesLoaded < report.samplesExpected) {
    return {
      code: "samples",
      title: "SOME SOUNDS MISSING",
      detail: `${report.samplesLoaded} of ${report.samplesExpected} impact recordings loaded.`,
      action: "TRY AGAIN",
    };
  }
  // Only once the score has actually been asked for, and only if the player wants it. On the title screen it
  // has deliberately not been requested, and a muted channel that is not playing is doing as it was told.
  if (report.musicRequested && report.musicWanted && !report.musicPlaying) {
    return {
      code: "score",
      title: "THE SCORE IS NOT PLAYING",
      detail: report.format
        ? `The music loaded as ${report.format.toUpperCase()} but the browser refused to start it.`
        : "The music did not load.",
      action: "TRY AGAIN",
    };
  }
  return null;
}

export interface AudioGateActions {
  /** Open or reopen everything: resume the context, refetch the recordings, restart the score. */
  onRetry(): void;
}

/**
 * The plate itself.
 *
 * Shows at most one fault, and never the same one twice after it has been dismissed: a notice that keeps coming
 * back is a notice the player learns to close without reading.
 */
export class AudioGate {
  private readonly plate = document.querySelector<HTMLElement>("#audioGate");
  private readonly titleText = document.querySelector<HTMLElement>("#audioGateTitle");
  private readonly detailText = document.querySelector<HTMLElement>("#audioGateDetail");
  private readonly action = document.querySelector<HTMLButtonElement>("#audioGateAction");
  private readonly dismiss = document.querySelector<HTMLButtonElement>("#audioGateDismiss");
  private actions: AudioGateActions | null = null;
  private showing: AudioFault["code"] | null = null;
  private silenced = new Set<AudioFault["code"]>();

  attach(actions: AudioGateActions): void {
    this.actions = actions;
    this.action?.addEventListener("click", () => {
      this.hide();
      this.actions?.onRetry();
    });
    this.dismiss?.addEventListener("click", () => {
      // Dismissing is a decision about this fault, not about sound in general.
      if (this.showing) this.silenced.add(this.showing);
      this.hide();
    });
  }

  /** Give the gate the current state. Idempotent: called whenever something might have changed. */
  check(report: AudioReport): void {
    const fault = audioFault(report);
    if (!fault || this.silenced.has(fault.code)) {
      if (this.showing) this.hide();
      return;
    }
    if (fault.code === this.showing) return;
    this.showing = fault.code;
    if (this.titleText) this.titleText.textContent = fault.title;
    if (this.detailText) this.detailText.textContent = fault.detail;
    if (this.action) {
      this.action.hidden = fault.action === null;
      this.action.textContent = fault.action ?? "";
    }
    if (this.plate) {
      this.plate.hidden = false;
      this.plate.classList.add("open");
    }
  }

  private hide(): void {
    this.showing = null;
    if (!this.plate) return;
    this.plate.hidden = true;
    this.plate.classList.remove("open");
  }
}

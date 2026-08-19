// The settings, and the two places they are shown.
//
// The same two sections appear on the title screen behind a gear and in the pause menu, which is the reason
// this file exists rather than the markup living in both: audio and keys are the settings whether or not there
// is an expedition running, and a panel that disagreed with itself about what a control is called depending on
// where you opened it would be a bug nobody would think to look for.
//
// Written as HTML strings plus a wiring pass, matching the pause menu it grew out of. Both panels re-render
// wholesale on every change, which is affordable at this size and removes the entire class of bug where the
// screen and the state disagree.

import { ACTION_LABEL, type Action, type Bindings } from "./bindings";
import { VOLUME_STEP, type AudioPrefs, type AudioSettings } from "./audioSettings";

/**
 * Actions the rebinding list leaves out.
 *
 * The paired halves of a control are hidden rather than removed: flying left and sliding the paddle left are
 * one key to the player, so the list shows the survey row and binding it moves both. The diagnostic probe is a
 * developer key and not part of the game's vocabulary.
 */
export const HIDDEN_FROM_REBIND: readonly Action[] = ["paddleLeft", "paddleRight", "fast", "slow", "probe"];

interface Channel {
  key: "music" | "sfx";
  label: string;
  /** What this channel is for, because "music" and "effects" are only obvious until one of them is off. */
  detail: string;
  on: keyof AudioPrefs;
  level: keyof AudioPrefs;
}

const CHANNELS: readonly Channel[] = [
  { key: "music", label: "MUSIC", detail: "The score", on: "music", level: "musicVolume" },
  { key: "sfx", label: "EFFECTS", detail: "Impacts, drops, the interface", on: "sfx", level: "sfxVolume" },
];

/**
 * A switch and a level per channel.
 *
 * Both, rather than a level alone with zero standing in for off: turning the score off and turning it down are
 * different intentions, and folding them together means a player who muted the music loses the level they had
 * chosen the moment they want it back.
 */
/**
 * What the audio is actually doing, under the sliders.
 *
 * Here because "I cannot hear anything" is otherwise unanswerable without a console. Two things go wrong in
 * practice and neither is visible from the game: a browser that cannot decode the format the files are in, and
 * a score that was refused permission to start. Both now say so on the screen the player is already looking at
 * when they go hunting for a volume control.
 */
export function audioStatusHtml(status: AudioStatus | null): string {
  if (!status) return "";
  // Before deployment there is nothing to report and nothing wrong. A browser will not let audio start until
  // the player has done something, so the title screen's honest reading is "not yet" -- which the first version
  // of this rendered as a warning, and a panel that cries fault at its own normal state is worse than no panel.
  if (!status.started) return `<p class="audio-status">Sound opens on your first click</p>`;
  const score = status.musicFormat
    ? `SCORE · ${status.musicFormat.toUpperCase()}${status.musicPlaying ? "" : " · not playing"}`
    // Before deployment the score has not been asked for, which is not the same as having failed.
    : `SCORE · ${status.musicRefusal ?? (status.musicRequested ? "did not load" : "plays on deployment")}`;
  const impacts = `IMPACTS · ${status.samplesLoaded} of ${status.samplesExpected}`;
  const bad = status.samplesLoaded < status.samplesExpected
    || Boolean(status.musicRefusal)
    || (status.musicRequested && !status.musicPlaying);
  return `<p class="audio-status${bad ? " warn" : ""}">${score}<i>·</i>${impacts}</p>`;
}

export interface AudioStatus {
  /** Whether a context exists at all, which needs one gesture from the player. */
  started: boolean;
  /** Whether the score has been asked for. It loads at deployment, not on the title screen. */
  musicRequested: boolean;
  musicFormat: string | null;
  musicRefusal: string | null;
  musicPlaying: boolean;
  samplesLoaded: number;
  samplesExpected: number;
}

export function audioPanelHtml(prefs: AudioPrefs, status: AudioStatus | null = null): string {
  return `
    <div class="settings-block audio-settings">
      <h4>AUDIO</h4>
      <ul>
        ${CHANNELS.map((channel) => {
          const on = prefs[channel.on] as boolean;
          const level = prefs[channel.level] as number;
          return `<li class="${on ? "" : "muted"}">
            <div class="audio-name"><span>${channel.label}</span><small>${channel.detail}</small></div>
            <input type="range" data-audio-level="${channel.key}"
              min="0" max="1" step="${VOLUME_STEP}" value="${level}"
              aria-label="${channel.label} volume" />
            <b class="audio-read">${on ? `${Math.round(level * 100)}%` : "OFF"}</b>
            <button type="button" data-audio-toggle="${channel.key}"
              role="switch" aria-checked="${on}" class="${on ? "on" : "off"}">${on ? "ON" : "OFF"}</button>
          </li>`;
        }).join("")}
      </ul>
      ${audioStatusHtml(status)}
    </div>`;
}

/** Wire the sliders and switches inside `root`. `rerender` redraws whichever panel this is. */
export function wireAudioPanel(root: HTMLElement, settings: AudioSettings, rerender: () => void): void {
  for (const slider of root.querySelectorAll<HTMLInputElement>("input[data-audio-level]")) {
    const key = slider.dataset.audioLevel === "music" ? "musicVolume" : "sfxVolume";
    // `input` rather than `change`, so the level follows the finger and the player hears what they are
    // choosing while they choose it. That is the whole reason the gain ramps instead of being assigned.
    slider.addEventListener("input", () => {
      settings.set({ [key]: Number(slider.value) } as Partial<AudioPrefs>);
      rerender();
      // Re-rendering replaced the element the finger is on, so the drag would otherwise end here.
      const fresh = root.querySelector<HTMLInputElement>(`input[data-audio-level="${slider.dataset.audioLevel}"]`);
      fresh?.focus();
    });
  }
  for (const button of root.querySelectorAll<HTMLButtonElement>("button[data-audio-toggle]")) {
    const key = button.dataset.audioToggle === "music" ? "music" : "sfx";
    button.addEventListener("click", () => {
      settings.set({ [key]: !settings.current[key] } as Partial<AudioPrefs>);
      rerender();
    });
  }
}

/**
 * The key list, and the state of waiting for a keystroke.
 *
 * A class rather than a function because the waiting is the hard part: the keystroke that is *becoming* a
 * binding must not also fire whatever it is currently bound to, which needs a capture-phase listener that
 * outlives any one render, and two panels can offer this so the listener cannot belong to either of them.
 */
export class KeyRebinder {
  private listening: Action | null = null;
  private refusal: string | null = null;
  /** Redraw whichever panel is currently showing the list. Set by whoever opens it. */
  onRedraw: (() => void) | null = null;

  constructor(
    private readonly bind: (action: Action, code: string) => { ok: boolean; reason?: string },
    private readonly resetAll: () => void,
  ) {
    window.addEventListener("keydown", (event) => {
      if (!this.listening) return;
      event.preventDefault();
      event.stopPropagation();
      const action = this.listening;
      this.listening = null;
      // Escape backs out of the rebind rather than becoming one -- it is reserved.
      if (event.code !== "Escape") {
        const result = this.bind(action, event.code);
        this.refusal = result.ok ? null : (result.reason ?? "that key is taken");
      }
      this.onRedraw?.();
    }, { capture: true });
  }

  /** Is the panel waiting for a keystroke? The game asks, so it can hold its own input off. */
  get isRebinding(): boolean {
    return this.listening !== null;
  }

  /** Stop waiting, without binding anything. Called when a panel closes under it. */
  cancel(): void {
    this.listening = null;
    this.refusal = null;
  }

  html(bindings: Bindings): string {
    return `
      <div class="settings-block pause-rebind">
        <h4>KEYS<button type="button" data-act="resetKeys">RESET</button></h4>
        <ul>
          ${bindings.actions
            .filter((action) => !HIDDEN_FROM_REBIND.includes(action))
            .map((action) => `
              <li>
                <span>${ACTION_LABEL[action]}</span>
                <button type="button" data-bind="${action}" class="${this.listening === action ? "listening" : ""}">
                  ${this.listening === action ? "PRESS A KEY" : bindings.label(action)}
                </button>
              </li>`).join("")}
        </ul>
        ${this.refusal ? `<em class="pause-refusal">${this.refusal}</em>` : ""}
      </div>`;
  }

  wire(root: HTMLElement, redraw: () => void): void {
    this.onRedraw = redraw;
    for (const button of root.querySelectorAll<HTMLButtonElement>("button[data-bind]")) {
      button.addEventListener("click", () => {
        this.refusal = null;
        this.listening = button.dataset.bind as Action;
        redraw();
      });
    }
    const reset = root.querySelector<HTMLButtonElement>('button[data-act="resetKeys"]');
    reset?.addEventListener("click", () => {
      this.cancel();
      this.resetAll();
      redraw();
    });
  }
}

/**
 * Every control, always, for a player who has no keys to rebind.
 *
 * A gesture is not a binding: there is nothing to change and therefore nothing in the list above, so a
 * touchscreen with only the key panel would have no control reference at all.
 */
export const TOUCH_CONTROLS: ReadonlyArray<{ group: string; rows: ReadonlyArray<[string, string]> }> = [
  {
    group: "IN THE MINE",
    rows: [
      ["DRAG ANYWHERE", "Fly the drone"],
      ["TURN THE WHEEL", "Face the drone, and aim the frame"],
      ["FLICK THE WHEEL", "Keep turning. Touch it to stop"],
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

export function touchControlsHtml(): string {
  return `<div class="pause-controls">${TOUCH_CONTROLS.map((section) => `
    <section class="pause-group">
      <h3><span>${section.group}</span></h3>
      <dl>${section.rows.map(([keys, label]) =>
        `<dt><kbd class="wide">${keys}</kbd></dt><dd>${label}</dd>`).join("")}</dl>
    </section>`).join("")}</div>`;
}

/**
 * The title screen's settings sheet: the same audio and control sections, before there is a game to pause.
 *
 * Reachable from the menu because both of these are things a player wants set *before* they start rather than
 * after they have been surprised by them, and on a phone the pause menu is several taps into an expedition.
 */
export class SettingsSheet {
  private readonly sheet = document.querySelector<HTMLElement>("#settingsSheet");
  private readonly body = document.querySelector<HTMLElement>("#settingsBody");
  private readonly open = document.querySelector<HTMLButtonElement>("#settingsButton");
  private readonly close = document.querySelector<HTMLButtonElement>("#settingsClose");
  private shown = false;

  constructor(
    private readonly settings: AudioSettings,
    private readonly rebinder: KeyRebinder,
    private readonly bindings: Bindings,
    private readonly touch: () => boolean,
    private readonly status: () => AudioStatus | null,
  ) {
    this.open?.addEventListener("click", () => this.setOpen(true));
    this.close?.addEventListener("click", () => this.setOpen(false));
    // The backdrop is the sheet itself, so a tap outside the frame closes it -- which is what every sheet on a
    // phone does, and the only way out that does not need a 44px target to be found.
    this.sheet?.addEventListener("click", (event) => {
      if (event.target === this.sheet) this.setOpen(false);
    });
    window.addEventListener("keydown", (event) => {
      if (!this.shown || event.code !== "Escape") return;
      // Only when nothing is waiting for a keystroke: there, Escape belongs to backing out of the rebind.
      if (this.rebinder.isRebinding) return;
      this.setOpen(false);
    });
  }

  /**
   * Called when the sheet opens, so whoever owns the audio can re-examine it.
   *
   * Examining is asynchronous -- a context resume and a fetch -- so it cannot finish before this draws, which
   * is what `refresh` is for.
   */
  onOpen: (() => void) | null = null;

  /** Redraw, if this is open. Called when something the panel reports on has finished changing. */
  refresh(): void {
    if (this.shown) this.render();
  }

  get isOpen(): boolean {
    return this.shown;
  }

  setOpen(open: boolean): void {
    this.shown = open;
    if (!this.sheet) return;
    this.sheet.hidden = !open;
    this.sheet.classList.toggle("open", open);
    if (!open) {
      this.rebinder.cancel();
      return;
    }
    this.onOpen?.();
    this.render();
  }

  private render(): void {
    if (!this.body) return;
    this.body.innerHTML = audioPanelHtml(this.settings.current, this.status())
      + (this.touch() ? touchControlsHtml() : this.rebinder.html(this.bindings));
    wireAudioPanel(this.body, this.settings, () => this.render());
    if (!this.touch()) this.rebinder.wire(this.body, () => this.render());
  }
}

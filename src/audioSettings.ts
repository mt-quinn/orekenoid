// What the player has decided about the sound.
//
// Two channels, each with a switch and a level, because they answer different questions: the score is the one
// thing here somebody turns off to listen to their own music, and the effects are the one thing they turn *up*
// to hear a rally with the screen ignored. A single master volume can express neither.
//
// Stored rather than held for the session. A player who turns the music off has told us something about how
// they play, and asking again every visit would be forgetting it on purpose.

const STORAGE_KEY = "orekenoid.audio.v1";

export interface AudioPrefs {
  music: boolean;
  /** 0..1, independent of the switch, so turning the score back on restores the level it was at. */
  musicVolume: number;
  sfx: boolean;
  sfxVolume: number;
}

export const DEFAULT_AUDIO_PREFS: AudioPrefs = {
  music: true,
  // Not 1. The mix was built with the score at 0.34 of full scale and the effects carrying the information, so
  // the default has to be the middle of the range rather than the top of it -- otherwise every slider in the
  // panel starts pinned and the only direction available is down.
  musicVolume: 0.8,
  sfx: true,
  sfxVolume: 0.9,
};

/** Steps a slider moves in, so a level is always a value somebody could return to. */
export const VOLUME_STEP = 0.05;

/**
 * The gain a channel actually plays at.
 *
 * The switch wins, and the level survives it. Kept as a function rather than folded into the setter so the
 * distinction is stated once and testable: a muted channel is at zero *and* remembers where it was.
 */
export function effectiveVolume(on: boolean, volume: number): number {
  return on ? clampVolume(volume) : 0;
}

export function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) return 1;
  return Math.min(1, Math.max(0, volume));
}

/**
 * Read stored preferences, keeping whatever is valid and defaulting the rest.
 *
 * Per field rather than wholesale, the same rule the key bindings use: a stored blob from an older build is
 * missing whatever has been added since, and the right answer for those is the default, not a reset of
 * everything the player has set.
 */
export function readPrefs(raw: unknown): AudioPrefs {
  const prefs = { ...DEFAULT_AUDIO_PREFS };
  if (!raw || typeof raw !== "object") return prefs;
  const source = raw as Partial<Record<keyof AudioPrefs, unknown>>;
  if (typeof source.music === "boolean") prefs.music = source.music;
  if (typeof source.sfx === "boolean") prefs.sfx = source.sfx;
  if (typeof source.musicVolume === "number") prefs.musicVolume = clampVolume(source.musicVolume);
  if (typeof source.sfxVolume === "number") prefs.sfxVolume = clampVolume(source.sfxVolume);
  return prefs;
}

/** The preferences, the place they are kept, and whoever needs telling when they change. */
export class AudioSettings {
  private prefs: AudioPrefs = { ...DEFAULT_AUDIO_PREFS };
  /** Called after every change, with the levels already resolved. */
  onChange: ((music: number, sfx: number) => void) | null = null;

  constructor() {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch {
      return;
    }
    if (!raw) return;
    try {
      this.prefs = readPrefs(JSON.parse(raw));
    } catch {
      // Unreadable. The defaults are already in place.
    }
  }

  get current(): AudioPrefs {
    return { ...this.prefs };
  }

  get musicGain(): number {
    return effectiveVolume(this.prefs.music, this.prefs.musicVolume);
  }

  get sfxGain(): number {
    return effectiveVolume(this.prefs.sfx, this.prefs.sfxVolume);
  }

  /**
   * Change one or more preferences.
   *
   * Setting a level on a channel that is switched off switches it back on, because dragging a slider is
   * unambiguously a request to hear something and leaving it silent would read as a broken control.
   */
  set(patch: Partial<AudioPrefs>): void {
    const next = { ...this.prefs, ...patch };
    if (patch.musicVolume !== undefined) next.music = patch.musicVolume > 0;
    if (patch.sfxVolume !== undefined) next.sfx = patch.sfxVolume > 0;
    next.musicVolume = clampVolume(next.musicVolume);
    next.sfxVolume = clampVolume(next.sfxVolume);
    this.prefs = next;
    this.save();
    this.apply();
  }

  /** Push the current levels at whoever is listening. Called once at startup as well as on every change. */
  apply(): void {
    this.onChange?.(this.musicGain, this.sfxGain);
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.prefs));
    } catch {
      // A browser refusing storage is not a reason to refuse the change for this session.
    }
  }
}

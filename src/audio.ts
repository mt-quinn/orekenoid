// Procedural audio.
//
// Every sound in the game is currently one shaped oscillator sweep. That is a
// deliberate placeholder, not a design: it gives every event a distinct, readable
// pitch contour without shipping an asset library, and it keeps all of it behind
// one call so replacing it with a real sample bank later touches this file only.

/** A named sound. Adding one here rather than at the call site keeps the sonic
 *  vocabulary reviewable in a single list. */
export interface ToneSpec {
  /** Starting frequency, Hz. */
  frequency: number;
  /** Duration in seconds. */
  duration: number;
  /** Peak gain. Kept low: these are stacked several at a time during a cascade. */
  volume?: number;
  /** Frequency to sweep to. Defaults to no sweep. */
  end?: number;
}

export class GameAudio {
  private context: AudioContext | null = null;

  /**
   * Browsers refuse to start audio before a gesture, so this is called from
   * deployment rather than from construction, and resumes a context that an
   * earlier page state may have suspended.
   */
  start(): void {
    if (!this.context) this.context = new AudioContext();
    if (this.context.state === "suspended") void this.context.resume();
  }

  get started(): boolean {
    return this.context !== null;
  }

  /**
   * Play one shaped sweep. Silently does nothing before `start()`, so callers in
   * the pre-deployment UI never have to check.
   */
  play(spec: ToneSpec): void {
    const context = this.context;
    if (!context) return;
    const { frequency, duration, volume = 0.025, end = frequency } = spec;
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, end), now + duration);
    gain.gain.setValueAtTime(volume, now);
    // Exponential rather than linear: a linear tail reads as a click at these
    // durations, and several of these fire per second during a cascade.
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + duration);
  }
}

/**
 * The game's sound vocabulary, in one place.
 *
 * Grouped by what the player is being told rather than by pitch, so the set can be
 * read as a design: impacts descend, acquisitions rise, failures fall a long way.
 */
export const SOUNDS = {
  // --- Ball contact. Short, quiet, and pitched apart so a rally is readable
  //     with the screen ignored. ------------------------------------------------
  paddleHit: { frequency: 120, duration: 0.05, volume: 0.025, end: 220 },
  railHit: { frequency: 340, duration: 0.025, volume: 0.012, end: 300 },
  facetTurn: { frequency: 660, duration: 0.05, volume: 0.02, end: 900 },
  membraneHit: { frequency: 500, duration: 0.05, volume: 0.022, end: 320 },
  brickChip: { frequency: 170, duration: 0.04, volume: 0.025, end: 220 },
  brickBreak: { frequency: 260, duration: 0.08, volume: 0.025, end: 110 },
  // Striking structure rings upward rather than breaking: the sound says
  // "this is a mechanism", not "you failed to break it".
  structureStruck: { frequency: 280, duration: 0.12, volume: 0.03, end: 520 },
  cascade: { frequency: 150, duration: 0.3, volume: 0.05, end: 880 },
  membraneSpawned: { frequency: 360, duration: 0.16, volume: 0.03, end: 180 },
  regrowth: { frequency: 210, duration: 0.14, volume: 0.02, end: 130 },

  // --- Claim lifecycle -------------------------------------------------------
  claimCommitted: { frequency: 94, duration: 0.18, volume: 0.035, end: 260 },
  serve: { frequency: 150, duration: 0.07, volume: 0.03, end: 260 },
  ballLost: { frequency: 170, duration: 0.2, volume: 0.03, end: 48 },
  sequentialBall: { frequency: 300, duration: 0.2, volume: 0.035, end: 520 },
  railSeedPlaced: { frequency: 420, duration: 0.12, volume: 0.03, end: 700 },
  blastCharge: { frequency: 70, duration: 0.4, volume: 0.06, end: 40 },

  // --- Progress. These rise, without exception. ------------------------------
  banked: { frequency: 300, duration: 0.22, volume: 0.04, end: 780 },
  forged: { frequency: 320, duration: 0.16, volume: 0.035, end: 620 },
  // The bolt-on, layered: a low falling thump for weight and a metallic click on top of it so
  // the contact is legible. Two tones because this vocabulary has no noise source, and a single
  // sine has no body -- the Vlambeer talk's "+12dB of bass fixed the gun" is the whole idea.
  // Written but never heard: unverifiable from a screenshot, and due a hand pass with the rest.
  fitSeat: { frequency: 150, duration: 0.22, volume: 0.075, end: 48 },
  fitClick: { frequency: 940, duration: 0.05, volume: 0.02, end: 1500 },
  fitReach: { frequency: 90, duration: 0.3, volume: 0.018, end: 155 },
  // The grinder taking its cut. Falling and gritty, so losing half a piece sounds like a cost
  // rather than a collection. Written but never heard, like the rest of the fit vocabulary.
  salvageGrind: { frequency: 210, duration: 0.13, volume: 0.03, end: 70 },
  verbAcquired: { frequency: 180, duration: 0.5, volume: 0.06, end: 900 },
  tutorialStep: { frequency: 520, duration: 0.08, volume: 0.022, end: 720 },
  arrival: { frequency: 210, duration: 0.3, volume: 0.028, end: 320 },

  // --- Interface -------------------------------------------------------------
  atlasOpen: { frequency: 420, duration: 0.14, volume: 0.03, end: 620 },
  atlasClose: { frequency: 300, duration: 0.12, volume: 0.03, end: 200 },
  markPlaced: { frequency: 520, duration: 0.1, volume: 0.03, end: 700 },
  markRefused: { frequency: 180, duration: 0.12, volume: 0.03, end: 120 },
  forgeOutOfRange: { frequency: 240, duration: 0.12, volume: 0.03, end: 180 },
  cannotForge: { frequency: 88, duration: 0.16, volume: 0.03, end: 60 },

  // --- Loss. These fall, and fall further than anything else rises. ----------
  armorBreached: { frequency: 92, duration: 0.42, volume: 0.06, end: 36 },
  droneLost: { frequency: 70, duration: 0.8, volume: 0.07, end: 32 },
} as const satisfies Record<string, ToneSpec>;

export type SoundId = keyof typeof SOUNDS;

/**
 * A caught drop, pitched by combo.
 *
 * The one sound that is a function rather than a constant: rising pitch across a
 * collection run is the only feedback that says "you are stringing this together",
 * and it has to be computed.
 */
export const collectSound = (collected: number): ToneSpec => ({
  frequency: 540 + collected * 35,
  duration: 0.1,
  volume: 0.03,
  end: 760,
});

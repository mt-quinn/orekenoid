// The game's sound, in two sections.
//
// Most of it is still one shaped oscillator sweep per event: a deliberate placeholder that gives every event a
// distinct, readable pitch contour without an asset library, and keeps all of it behind one call. The three
// contacts the player hears most -- paddle or rail, brick struck, brick broken -- are now recordings instead,
// held in `src/sfx.ts` and reached through `impact`. Each of those declares the tone it stands in for, so a
// file that does not load costs fidelity rather than feedback.

import { SAMPLES, SampleBank, type SampleId } from "./sfx";

/** A named sound. Adding one here rather than at the call site keeps the sonic
 *  vocabulary reviewable in a single list. */
export interface ToneSpec {
  /** Starting frequency, Hz. */
  frequency: number;
  /** Duration in seconds. */
  duration: number;
  /**
   * How far the per-play pitch jitter may wander, as a fraction. Defaults to 3%.
   *
   * Narrowed for sounds whose exact pitch carries meaning, and widened for the ones that repeat
   * most, where sameness is the thing to avoid.
   */
  spread?: number;
  /** Peak gain. Kept low: these are stacked several at a time during a cascade. */
  volume?: number;
  /** Frequency to sweep to. Defaults to no sweep. */
  end?: number;
}

export class GameAudio {
  private context: AudioContext | null = null;
  /**
   * The recorded impacts, which are the three sounds the player hears most.
   *
   * Owned here rather than beside the game so every caller already has it: the tone vocabulary and the sample
   * bank are one instrument with two sections, and a call site should not have to know which section answered.
   */
  private samples = new SampleBank();
  /**
   * The player's effects level, applied to the tones and the recordings alike.
   *
   * One node for both because they are one instrument: a slider that quietened the recorded impacts and left
   * the synthesised bank at full would be a volume control that makes the mix worse as it goes down.
   */
  private master: GainNode | null = null;
  private sfxScale = 1;
  /**
   * Told when the context stops on its own.
   *
   * Mobile browsers suspend audio for reasons that have nothing to do with this game -- a call, a
   * route change, another app taking the output -- and the suspension outlives whatever caused it.
   * Recovering needs a fresh gesture, so somebody has to ask the player for one, and the game
   * would rather stop and say so than carry on silently muted.
   */
  onLost: (() => void) | null = null;
  /**
   * Whether the context has ever actually been running.
   *
   * A context can be *born* suspended -- a browser with no output device, or one that has not yet
   * accepted the gesture -- and that is not a loss, it is a context that has not started. Reporting
   * it as a loss held the whole game behind an "audio cut" plate the moment the page loaded, which
   * is both wrong and impossible for the player to interpret.
   */
  private everRan = false;

  /**
   * Browsers refuse to start audio before a gesture, so this is called from
   * deployment rather than from construction, and resumes a context that an
   * earlier page state may have suspended.
   */
  start(): void {
    if (!this.context) {
      this.context = new AudioContext();
      // `statechange` is the only honest signal here: polling would either miss a brief suspension
      // or spend a timer on a question the browser is willing to answer by event.
      this.context.addEventListener("statechange", () => {
        const state = this.context?.state;
        if (state === "running") this.everRan = true;
        // Only a context that had been running can be lost.
        else if (state === "suspended" && this.everRan) this.onLost?.();
      });
    }
    if (this.context.state === "suspended") void this.context.resume();
    else if (this.context.state === "running") this.everRan = true;
    // Not awaited: three short files, fetched and decoded well before the drone reaches a face, and a slow
    // network costs the first few hits their fidelity rather than holding up the deployment.
    void this.samples.arm(this.context);
  }

  /**
   * Play a recorded impact, falling back to its synthesised stand-in if the file never arrived.
   *
   * `gain` and `rate` are situational multipliers on top of the sample's own balance -- material, escalation,
   * and telling a rail apart from a paddle -- so the recording stays one recording and the expression lives at
   * the call site.
   */
  impact(id: SampleId, options: { gain?: number; rate?: number; fallback?: ToneSpec | null } = {}): void {
    const context = this.context;
    if (!context) return;
    if (this.samples.play(context, this.bus(context), id, options)) return;
    const fallback = options.fallback === undefined ? SOUNDS[SAMPLES[id].fallback] : options.fallback;
    if (fallback) this.play(fallback);
  }

  /**
   * Set the effects level, 0..1.
   *
   * Ramped over a few milliseconds rather than assigned. A gain stepped instantaneously while something is
   * sounding is a click, and this is dragged by a finger, so it is stepped many times a second.
   */
  setVolume(scale: number): void {
    this.sfxScale = Math.min(1, Math.max(0, scale));
    const context = this.context;
    if (!context || !this.master) return;
    const now = context.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(this.sfxScale, now + 0.02);
  }

  private bus(context: AudioContext): AudioNode {
    if (!this.master) {
      this.master = context.createGain();
      this.master.gain.value = this.sfxScale;
      this.master.connect(context.destination);
    }
    return this.master;
  }

  /** Which recordings are in memory, for the diagnostics overlay. */
  get loadedSamples(): SampleId[] {
    return this.samples.loaded;
  }

  /** Bring the context back after a hold. Safe to call when it never stopped. */
  revive(): void {
    if (!this.context) return;
    // Voices scheduled before the suspension are not sounding any more, whatever their end times say, and a
    // bank that thinks it is crowded comes back quiet.
    this.samples.reset();
    if (this.context.state === "suspended") void this.context.resume();
  }

  get started(): boolean {
    return this.context !== null;
  }

  /**
   * Settle: the context resumed, the recordings fetched.
   *
   * Exists because `start` cannot be awaited -- it has to return inside the gesture that called it -- so
   * anything that wants to *judge* whether the sound works has to wait for the work `start` set going. Judging
   * immediately after it reported a suspended context and no recordings, which was true for about eighty
   * milliseconds and is not a fault.
   */
  async ready(): Promise<void> {
    const context = this.context;
    if (!context) return;
    if (context.state === "suspended") {
      try {
        await context.resume();
      } catch {
        // Refused. The gate will say so.
      }
    }
    await this.samples.arm(context);
  }

  /** A context that exists and is actually running, which is a different question. */
  get running(): boolean {
    return this.context?.state === "running";
  }

  /** Refetch the recordings. The context is resumed separately, by `start`. */
  async retrySamples(): Promise<void> {
    if (!this.context) return;
    await this.samples.retry(this.context);
  }

  /**
   * The live context, for anything that needs to build its own graph.
   *
   * Shared rather than handed a context of its own, because the browser's rules about gestures and suspension
   * apply per context: a second one would need its own gesture to start and its own recovery when the phone
   * takes the output away, and would then be a second thing that can be silently muted.
   */
  get audioContext(): AudioContext | null {
    return this.context;
  }

  /**
   * Play one shaped sweep. Silently does nothing before `start()`, so callers in
   * the pre-deployment UI never have to check.
   */
  /**
   * Play one shaped sweep, detuned slightly.
   *
   * The jitter is the talk's sound-variation point and it is not decoration: an identical waveform
   * fired repeatedly phase-locks into a single buzzing pitch, which is what turns a rally into a
   * synthesiser. A few percent is inaudible as pitch and completely changes the texture of a run of
   * hits. It is applied as a *ratio* to both ends of the sweep so the contour is preserved -- a
   * sound that rises still rises by the same interval.
   *
   * `spread` is per-sound so the deliberately-pitched ones can narrow it: the combo ladder means
   * something by its exact pitch, and wide jitter there would blur one rung into the next.
   */
  play(spec: ToneSpec): void {
    const context = this.context;
    if (!context) return;
    const { duration, volume = 0.025 } = spec;
    const spread = spec.spread ?? 0.03;
    const detune = 1 + (Math.random() * 2 - 1) * spread;
    const frequency = spec.frequency * detune;
    const end = (spec.end ?? spec.frequency) * detune;
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
    oscillator.connect(gain).connect(this.bus(context));
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
  paddleHit: { frequency: 120, duration: 0.05, volume: 0.025, end: 220, spread: 0.05 },
  railHit: { frequency: 340, duration: 0.025, volume: 0.012, end: 300, spread: 0.07 },
  facetTurn: { frequency: 660, duration: 0.05, volume: 0.02, end: 900 },
  membraneHit: { frequency: 500, duration: 0.05, volume: 0.022, end: 320 },
  brickChip: { frequency: 170, duration: 0.04, volume: 0.025, end: 220, spread: 0.07 },
  brickBreak: { frequency: 260, duration: 0.08, volume: 0.025, end: 110, spread: 0.06 },
  // The low end of a break, layered under `brickBreak`. "Add more bass to your sound effects" is
  // the talk's cheapest trick and the one its own anecdote turns on -- a gun nobody liked became a
  // favourite on twelve decibels of bass and nothing else. Written, never heard.
  brickBreakBody: { frequency: 96, duration: 0.17, volume: 0.055, end: 44, spread: 0.05 },
  brickBreakHeavy: { frequency: 62, duration: 0.26, volume: 0.075, end: 30, spread: 0.04 },
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
  salvageGrind: { frequency: 210, duration: 0.13, volume: 0.03, end: 70, spread: 0.06 },
  verbAcquired: { frequency: 180, duration: 0.5, volume: 0.06, end: 900 },
  /**
   * One tooth of the facing wheel passing the index mark.
   *
   * Short, dry and quiet, because it fires up to a dozen times a second during a spin. This is carrying
   * the wheel's tactility on its own on an iPhone: Safari has never supported the Vibration API, so a web
   * game gets no haptic there, and a detent nobody can feel has to be one they can hear.
   */
  dialDetent: { frequency: 1400, duration: 0.018, volume: 0.014, end: 1150, spread: 0.06 },
  /** The wheel stopped by a thumb, which is a different event from the wheel being turned. */
  dialCatch: { frequency: 320, duration: 0.05, volume: 0.02, end: 190 },
  tutorialStep: { frequency: 520, duration: 0.08, volume: 0.022, end: 720 },
  arrival: { frequency: 210, duration: 0.3, volume: 0.028, end: 320 },

  // --- Interface -------------------------------------------------------------
  atlasOpen: { frequency: 420, duration: 0.14, volume: 0.03, end: 620 },
  atlasClose: { frequency: 300, duration: 0.12, volume: 0.03, end: 200 },
  markPlaced: { frequency: 520, duration: 0.1, volume: 0.03, end: 700 },
  markRefused: { frequency: 180, duration: 0.12, volume: 0.03, end: 120 },
  forgeOutOfRange: { frequency: 240, duration: 0.12, volume: 0.03, end: 180 },
  cannotForge: { frequency: 88, duration: 0.16, volume: 0.03, end: 60 },

  // --- Cavern combat. -------------------------------------------------------
  // Untuned: written against the existing vocabulary and never listened to, like the fitting
  // sequence's three tones, and flagged here for the hand-applied audio pass.
  //
  // The tell rises where every other threat in the game falls, because it is the one sound that is
  // a warning rather than a consequence -- it has to pull the head up, not push it down.
  // `creatureHit` is a returned Bounder meeting rock; `creatureKilled` is the third of those.
  creatureHit: { frequency: 200, duration: 0.05, volume: 0.028, end: 130, spread: 0.07 },
  creatureKilled: { frequency: 130, duration: 0.22, volume: 0.045, end: 52, spread: 0.04 },
  creatureTell: { frequency: 220, duration: 0.26, volume: 0.03, end: 470 },
  /** A Bounder reaching the hull. Falls hard: it is the one outcome of the exchange that costs. */
  creatureStrike: { frequency: 104, duration: 0.24, volume: 0.055, end: 44 },
  // The lamp going under. Falls further and slower than anything else in this block, because it is
  // the only one of these events the player cannot answer by moving.

  // --- The hull against rock. -----------------------------------------------
  // Both fall, because both are the machine being stopped rather than doing something. The knock
  // carries body; the scrape is deliberately thin and quiet, since it repeats for as long as the
  // player leans on the wall and must never become the loudest thing in the mine.
  hullKnock: { frequency: 118, duration: 0.09, volume: 0.032, end: 62, spread: 0.06 },
  hullScrape: { frequency: 240, duration: 0.06, volume: 0.011, end: 170, spread: 0.1 },
  // A piece of ore hitting the floor instead of the paddle. Dull and short: it is a small loss and
  // should register without being scolded for.
  dropMissed: { frequency: 130, duration: 0.07, volume: 0.016, end: 84, spread: 0.07 },
  // Arriving home. The bright tone already existed; this is the body underneath it, which is what
  // the talk means by bass -- the part you feel rather than hear, and the reason a deposit lands
  // like a weight going down instead of a number going up.
  bankedBody: { frequency: 76, duration: 0.3, volume: 0.062, end: 40, spread: 0.02 },
  hullRepaired: { frequency: 380, duration: 0.34, volume: 0.03, end: 720, spread: 0.02 },

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
  // Barely detuned. Each rung of this ladder is meant to be heard as a step up from the last, and
  // wide jitter would blur one rung into the next -- which is the one thing this sound must not do.
  spread: 0.008,
  volume: 0.03,
  end: 760,
});

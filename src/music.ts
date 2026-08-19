// One track, two energies.
//
// The score is two mixes of the same music at the same length: a quieter one for the mine and a louder one
// for a live claim. Moving between them is meant to sound like the same piece changing intensity rather than
// like one song stopping and another starting.
//
// The obvious way to build that is to note where the playhead is, switch source, and seek the new one to the
// same timestamp. Do not do that. Seeking costs latency you cannot predict, `currentTime` is only as precise
// as the browser feels like being, and every switch is a fresh chance to land a few milliseconds out -- which
// on two mixes of the same recording is not a subtle error, it is a flam on every drum hit.
//
// So neither track ever stops. Both start on the same instant, both loop on the same boundary, and both run
// for the whole session. The only thing that moves is gain. There is no timestamp to get right because the
// two playheads are never allowed to differ in the first place.
//
// The crossfade is linear, which is the opposite of the usual advice, and the reason is that the usual advice
// is about uncorrelated material. Two mixes of one track share most of their content, so their amplitudes add
// rather than their powers: holding `a + b = 1` keeps the level flat, while the equal-power `a² + b² = 1`
// would put a bulge in the middle of every transition.
//
// **There is no Web Audio graph here, deliberately.** The first version routed both elements through
// `createMediaElementSource` into gain nodes, which is the textbook shape and works perfectly in Chromium. On
// WebKit it played to nowhere: the elements reported themselves unpaused, the format was right, the gains were
// right, and no sound came out -- while the sound effects, which are buffer sources and never touch a media
// element, were audible in the same context through the same destination. That asymmetry is the whole clue, and
// it is a long-standing WebKit behaviour rather than anything this code can hold correctly.
//
// So the score is two plain `<audio>` elements playing to the output, and the crossfade, the duck and the
// player's level are all multiplied into `element.volume`. That loses nothing -- the score never wanted an
// effect, a filter or an analyser -- and it removes the graph, the context, and an entire class of failure that
// cannot be seen from inside the game. `volume` has no automation, so a small stepper moves it toward its
// target; that stepper runs on a timer of its own rather than on the game's frame loop, because the music now
// starts on the title screen where the frame loop is not running.

/** What the music is playing for. */
export type MusicLayer = "survey" | "framed";

export const MUSIC = {
  /** Peak gain of the score. Well under the sound effects, which carry the game's information. */
  volume: 0.34,
  /**
   * Seconds a crossfade takes.
   *
   * Long enough to read as the music leaning into the claim rather than as a switch being thrown, short
   * enough that it has finished by the time the player has finished looking at the board.
   */
  fade: 1.1,
  /** How far the score drops while the game is held. */
  duckTo: 0.22,
  /** And how quickly, which is faster than a crossfade because pausing should feel immediate. */
  duckFade: 0.18,
  /**
   * Seconds of lead before the two sources start.
   *
   * Both are scheduled against one explicit instant slightly in the future rather than "now". Starting them
   * with two separate `start()` calls at whatever time each one is reached would put them a scheduling
   * hiccup apart, permanently.
   */
  lead: 0.08,
  /**
   * How far apart the two files' durations may be before it is worth complaining, in seconds.
   *
   * A few samples of difference is an encoder's rounding. A tenth of a second is a mistake that will read as
   * the mixes drifting apart, and nobody would guess the cause from the symptom.
   */
  lengthTolerance: 0.05,
  /** Seconds between drift checks. Cheap, and drift accumulates far slower than this. */
  syncCheck: 0.5,
  /**
   * Drift past this gets a gentle correction, in seconds.
   *
   * Twelve milliseconds is under the threshold where two copies of one recording read as a flam, and the two
   * are only ever audible together during a crossfade -- so this is about being in step at the moment it
   * matters rather than being sample-locked at every instant.
   */
  syncNudge: 0.012,
  /** Drift past this is not drift, it is a jump: a backgrounded tab, or one track wrapping first. */
  syncSnap: 0.25,
  /**
   * How hard to nudge, as a fraction of playback rate.
   *
   * Three parts in a thousand is about five cents of pitch -- inaudible on music, and it closes twelve
   * milliseconds in four seconds. Correcting harder would be audible as a wobble, which is a worse artefact
   * than the drift it is fixing.
   */
  syncRate: 0.003,
} as const;

/** Which layer the score should be playing, or null for silence. */
export function layerFor(state: { started: boolean; mode: "survey" | "play" | "forge"; dying: boolean }): MusicLayer | null {
  // The drone going down is the only thing that stops the music. Not being deployed yet is not: the exploration
  // mix is the game's music and the title screen is part of the game, so it comes up as soon as it can rather
  // than waiting for a menu to be dismissed. `started` stays in the signature because the caller has it and a
  // future state may want it, not because it gates anything today.
  if (state.dying) return null;
  // The forge is a menu over the mine rather than a place of its own, so it keeps the mine's music.
  return state.mode === "play" ? "framed" : "survey";
}

/**
 * The two gains for a crossfade `mix` of the way across, where 0 is all survey and 1 is all framed.
 *
 * Linear on purpose -- see the note at the top of the file. Kept as its own function so the reasoning has
 * somewhere to be tested rather than being three characters buried in a ramp call.
 */
export function crossfadeGains(mix: number): { survey: number; framed: number } {
  const clamped = Math.max(0, Math.min(1, mix));
  return { survey: 1 - clamped, framed: clamped };
}

/**
 * The loop both tracks share.
 *
 * The shorter of the two, so a file that is a few samples longer than its partner cannot walk them apart one
 * loop at a time. If the two are meaningfully different lengths that is a content problem and worth saying
 * out loud, but the playback still has to do something defensible.
 */
export function sharedLoopLength(surveySeconds: number, framedSeconds: number): number {
  return Math.min(surveySeconds, framedSeconds);
}

/** Do the two files agree about how long they are? */
export function durationsAgree(surveySeconds: number, framedSeconds: number): boolean {
  return Math.abs(surveySeconds - framedSeconds) <= MUSIC.lengthTolerance;
}

/**
 * What to do about the follower being `drift` seconds away from the reference.
 *
 * Positive drift means the follower is ahead. Kept as arithmetic so the thresholds can be tested without a
 * browser, an audio device, and eight and a half minutes of patience.
 */
export function driftCorrection(drift: number): { rate: number; snap: boolean } {
  if (Math.abs(drift) > MUSIC.syncSnap) return { rate: 1, snap: true };
  if (drift > MUSIC.syncNudge) return { rate: 1 - MUSIC.syncRate, snap: false };
  if (drift < -MUSIC.syncNudge) return { rate: 1 + MUSIC.syncRate, snap: false };
  return { rate: 1, snap: false };
}

/**
 * The basenames the score is loaded from, under `public/music/`.
 *
 * Extensions are tried in turn and the first one that both fetches and decodes wins, so whichever format the
 * files arrive in works without anything here changing. Ogg leads because it is the smallest at a given
 * quality; Safari refuses it, which is what the fallbacks are for.
 */
export const MUSIC_SOURCES = {
  survey: "music/bgm-explore",
  framed: "music/bgm-framed",
} as const;

/**
 * The formats to try, best first, each with the MIME type that asks a browser whether it can play it.
 *
 * The type strings are the point. `canPlayType` answers synchronously and without touching the network, which
 * is what lets the score choose a format and start playing inside the click that started the expedition --
 * see `load`. Guessing from the user agent instead would be both less accurate and a thing to maintain.
 */
const FORMATS: ReadonlyArray<{ extension: string; type: string }> = [
  { extension: "opus", type: 'audio/ogg; codecs="opus"' },
  { extension: "m4a", type: 'audio/mp4; codecs="mp4a.40.2"' },
  { extension: "ogg", type: 'audio/ogg; codecs="vorbis"' },
  { extension: "mp3", type: "audio/mpeg" },
  { extension: "wav", type: "audio/wav" },
];

/**
 * The first format this browser admits it can play, or null.
 *
 * `canPlayType` returns "probably", "maybe" or the empty string, and anything non-empty is worth attempting --
 * "maybe" is what Safari says about plenty of things it plays perfectly.
 */
export function playableExtension(probe: (type: string) => string): string | null {
  for (const format of FORMATS) {
    if (probe(format.type) !== "") return format.extension;
  }
  return null;
}

interface Voice {
  element: HTMLAudioElement;
  /** Where this voice's level is now, as a fraction of the score's own volume. Stepped toward `target`. */
  level: number;
  target: number;
}

/**
 * Streamed rather than decoded into memory, which the length of the score decides for us.
 *
 * `decodeAudioData` holds float32 PCM: measured on the real files, eight and a half minutes at 48kHz came to
 * 195MB for the stereo mix and 98MB for the mono one, with the heap at 342MB after decoding both, and about
 * two seconds of decoding at deployment. That is survivable on a desktop and a good way to have a phone kill
 * the tab. A media element streams instead, so memory is a buffer rather than the whole piece and playback
 * starts immediately.
 *
 * The cost is that two media elements keep their own clocks and will drift, where two buffer sources could not.
 * That is worth paying here because the two mixes are only ever audible together during a crossfade -- the rest
 * of the time one of them is at zero gain -- so what has to be true is that they are in step at the moment of a
 * transition, not that they are sample-locked for eight minutes. `syncTick` keeps them there.
 */
export class Music {
  private voices: { survey: Voice; framed: Voice } | null = null;
  private layer: MusicLayer | null = null;
  private ducked = false;
  /** Where the duck is now, and where it is going. Stepped like the voices, for the same reason. */
  private duckLevel = 1;
  private stepper: number | null = null;
  private lastStep = 0;
  /** The player's level, 0..1, multiplying the score's own. Zero is the switch turned off. */
  private scale = 1;
  private started = false;
  private tried = false;
  /** Which format was chosen, or why nothing was. Read by the settings panel and the audio gate. */
  format: string | null = null;
  refusal: string | null = null;

  /** Whether anybody has asked for the score yet. It loads at deployment, not on the title screen. */
  get requested(): boolean {
    return this.tried;
  }
  private sinceSync = 0;

  /**
   * Takes nothing.
   *
   * It used to be handed the game's `AudioContext`, because the score was a Web Audio graph. It is two media
   * elements now, so it needs neither a context nor the gesture rules that come with one.
   */
  constructor() {}

  /** True when there is a score to play. False is a normal state: the game runs silent. */
  get available(): boolean {
    return this.voices !== null;
  }

  /** How far the framed mix is from the exploration mix right now, in seconds. Diagnostic. */
  get drift(): number {
    if (!this.voices) return 0;
    return this.voices.framed.element.currentTime - this.voices.survey.element.currentTime;
  }

  /**
   * What the score is doing, for a diagnostic or a test.
   *
   * The gains are the interesting part: a crossfade is the one behaviour here that cannot be checked by ear in
   * a headless browser, and it is the whole feature.
   */
  get diagnostics(): {
    layer: MusicLayer | null;
    surveyGain: number;
    framedGain: number;
    drift: number;
    playing: boolean;
    at: number;
  } {
    return {
      layer: this.layer,
      surveyGain: this.voices ? this.voices.survey.element.volume : 0,
      framedGain: this.voices ? this.voices.framed.element.volume : 0,
      drift: this.drift,
      playing: Boolean(this.voices && !this.voices.survey.element.paused),
      at: this.voices ? this.voices.survey.element.currentTime : 0,
    };
  }

  /**
   * Build both streams and start them together.
   *
   * Failure is not an error: the files may not be there yet, and a game that refused to start without music
   * would be worse than a quiet one.
   */
  async load(): Promise<void> {
    if (this.tried) return;
    this.tried = true;
    // Everything up to and including `play()` runs synchronously, inside the gesture that called this.
    //
    // The previous version set a source, awaited `loadedmetadata` over the network, and only then called
    // `play()`. Chromium allows that once an AudioContext is running, and Safari does not: it requires the play
    // to happen within the user gesture, so the score was silent on every WebKit browser while the sound
    // effects -- which are buffer sources on an already-running context -- worked fine. A format chosen by
    // `canPlayType` rather than by trying downloads is what makes the synchronous path possible, and it also
    // stops a browser that cannot play Ogg from fetching four megabytes of it to find that out.
    const extension = playableExtension((type) => document.createElement("audio").canPlayType(type));
    if (!extension) {
      this.refusal = "no playable format";
      console.warn("[music] this browser reports no playable audio format. The game runs silent.");
      return;
    }
    this.format = extension;
    const survey = openStream(MUSIC_SOURCES.survey, extension);
    const framed = openStream(MUSIC_SOURCES.framed, extension);
    // Silent to begin with, whichever layer is wanted, so a fade in is a fade rather than a cut.
    survey.volume = 0;
    framed.volume = 0;
    this.voices = {
      survey: { element: survey, level: 0, target: 0 },
      framed: { element: framed, level: 0, target: 0 },
    };
    // Both told to play in the same turn, so they begin within a frame of each other and the sync only ever has
    // milliseconds to correct rather than seconds.
    const playing = Promise.all([tryPlay(survey), tryPlay(framed)]);
    // Only now is it safe to wait for anything. The metadata is wanted for the length check, which is a
    // diagnostic rather than a precondition -- if a file turns out to be missing the element errors and stays
    // silent, which is the same outcome as before and does not need its own branch.
    await Promise.all([whenReady(survey), whenReady(framed)]);
    await playing;
    if (!durationsAgree(survey.duration, framed.duration)) {
      // Said out loud because the symptom -- two mixes gradually pulling apart -- looks like a playback bug and
      // is actually a content one.
      console.warn(
        `[music] the two mixes are different lengths (${survey.duration.toFixed(3)}s and `
        + `${framed.duration.toFixed(3)}s). They will pull apart, and the sync will keep snapping them back.`,
      );
    }
    this.started = true;
    this.beginStepping();
    // Whatever the game asked for before the files arrived, now that there is something to play it with -- and
    // the exploration mix if nothing has asked at all, which is the case on the title screen, where the frame
    // loop that normally decides this is not running. The score's resting state is the mine.
    const wanted = this.layer ?? "survey";
    this.layer = null;
    this.setLayer(wanted);
  }

  /**
   * Move the levels toward their targets, on a timer of this object's own.
   *
   * Not the game's frame loop, which does not run on the title screen -- and the score plays there now. Also
   * called from `syncTick` when the loop *is* running, which is harmless: the step is driven by elapsed time
   * rather than by a passed delta, so two callers in one frame split the same interval between them instead of
   * advancing it twice.
   */
  private beginStepping(): void {
    if (this.stepper !== null) return;
    this.lastStep = performance.now();
    this.stepper = window.setInterval(() => this.step(), 33);
  }

  private step(): void {
    const now = performance.now();
    const dt = Math.max(0, Math.min(0.5, (now - this.lastStep) / 1000));
    this.lastStep = now;
    if (!this.voices || dt === 0) return;
    this.sinceSync += dt;
    if (this.sinceSync >= MUSIC.syncCheck) {
      this.sinceSync = 0;
      this.correctDrift();
    }
    // Per second, so the fade takes `MUSIC.fade` however often this is called.
    const towards = (from: number, to: number, seconds: number): number => {
      const room = to - from;
      if (Math.abs(room) < 0.001) return to;
      const stepSize = dt / Math.max(0.001, seconds);
      return Math.abs(room) <= stepSize ? to : from + Math.sign(room) * stepSize;
    };
    this.duckLevel = towards(this.duckLevel, this.ducked ? MUSIC.duckTo : 1, MUSIC.duckFade);
    for (const voice of [this.voices.survey, this.voices.framed]) {
      voice.level = towards(voice.level, voice.target, MUSIC.fade);
      // Clamped because `volume` throws on anything outside 0..1, and a rounding error is not worth a crash.
      const wanted = MUSIC.volume * this.scale * this.duckLevel * voice.level;
      voice.element.volume = Math.max(0, Math.min(1, wanted));
    }
  }

  /**
   * Play this layer, crossfading from whatever is playing now.
   *
   * Idempotent: called every frame with the game's current state, and does nothing unless the answer changed.
   */
  setLayer(layer: MusicLayer | null): void {
    if (layer === this.layer) return;
    this.layer = layer;
    if (!this.voices) return;
    const gains = layer === null ? { survey: 0, framed: 0 } : crossfadeGains(layer === "framed" ? 1 : 0);
    this.voices.survey.target = gains.survey;
    this.voices.framed.target = gains.framed;
  }

  /**
   * Try again from nothing.
   *
   * Tears the old elements out rather than reusing them: an element that failed has an error state a browser
   * will happily keep, and the point of a retry is to stop believing anything the last attempt reported.
   */
  retry(): Promise<void> {
    // Synchronous down to the `load` call, and `load` is synchronous down to its `play`. Anything awaited on the
    // way there spends the click that asked for the retry, and the browser refuses the play -- which is the exact
    // bug this button exists to recover from, reintroduced inside the recovery. Not `async`, for the same reason:
    // an `async` method's body resumes in a microtask and this should not depend on that being generous.
    for (const voice of this.voices ? [this.voices.survey, this.voices.framed] : []) {
      voice.element.pause();
      voice.element.removeAttribute("src");
      voice.element.remove();
    }
    this.voices = null;
    this.started = false;
    this.tried = false;
    this.format = null;
    this.refusal = null;
    const wanted = this.layer;
    this.layer = null;
    const loading = this.load();
    return loading.then(() => {
      if (wanted) this.setLayer(wanted);
    });
  }

  /** Drop the score while the game is held, and bring it back afterwards. */
  duck(on: boolean): void {
    this.ducked = on;
  }

  /**
   * Set the player's level, 0..1. Zero is the score switched off.
   *
   * Multiplies the mix's own gain rather than replacing it, so the balance the score was mastered against
   * survives the slider, and it goes through the same node as ducking -- two things writing the same gain
   * independently is how a pause leaves the music quiet after it resumes.
   */
  setVolume(scale: number): void {
    this.scale = Math.min(1, Math.max(0, scale));
    // Applied on the next step rather than ramped. A slider under a finger is already stepping many times a
    // second, and `volume` takes an immediate write without clicking the way a raw gain node would.
    this.step();
  }

  /**
   * Keep the two streams in step. Called every frame; does its work a couple of times a second.
   *
   * The exploration mix is the reference and the framed one follows it, chosen arbitrarily but fixed -- two
   * tracks each correcting toward the other is a control loop that hunts.
   */
  syncTick(dt: number): void {
    // Only the fade, at frame rate rather than at 30Hz. The drift correction moved into `step` so it also runs
    // on the title screen, where this is not called and where the two streams can now be restarted by the
    // retry button -- leaving them tens of milliseconds apart with nothing to close the gap before the first
    // transition, which is the one moment being in step actually matters.
    void dt;
    this.step();
  }

  private correctDrift(): void {
    if (!this.voices || !this.started) return;
    const reference = this.voices.survey.element;
    const follower = this.voices.framed.element;
    if (reference.paused || follower.paused) return;
    const correction = driftCorrection(follower.currentTime - reference.currentTime);
    if (correction.snap) {
      follower.currentTime = reference.currentTime;
      follower.playbackRate = 1;
      return;
    }
    if (follower.playbackRate !== correction.rate) follower.playbackRate = correction.rate;
  }
}


/** Play, tolerating a browser that refuses. A refused stream is silence, not a crash. */
async function tryPlay(element: HTMLAudioElement): Promise<void> {
  try {
    await element.play();
  } catch {
    // Autoplay policy, or no output. The score stays silent and the game does not care.
  }
}

/**
 * A looping media element for this basename, built and returned without waiting for anything.
 *
 * Synchronous on purpose: the caller has to be able to reach `play()` inside a user gesture, and any await on
 * the way there spends it.
 */
function openStream(base: string, extension: string): HTMLAudioElement {
  const element = document.createElement("audio");
  element.preload = "auto";
  element.loop = true;
  element.hidden = true;
  // Attached because some mobile browsers will not play a detached element, and hidden because it has no
  // business being a visible control.
  element.src = `${base}.${extension}`;
  document.body.appendChild(element);
  return element;
}

/** Settle when the element knows its own length, or when it has given up. Never rejects. */
function whenReady(element: HTMLAudioElement): Promise<void> {
  if (Number.isFinite(element.duration) && element.duration > 0) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      element.removeEventListener("loadedmetadata", done);
      element.removeEventListener("error", done);
      resolve();
    };
    element.addEventListener("loadedmetadata", done);
    element.addEventListener("error", done);
    // A file that neither loads nor errors must not hold the score's setup open forever.
    setTimeout(done, 15000);
  });
}

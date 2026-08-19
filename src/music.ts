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
} as const;

/** Which layer the score should be playing, or null for silence. */
export function layerFor(state: { started: boolean; mode: "survey" | "play" | "forge"; dying: boolean }): MusicLayer | null {
  if (!state.started || state.dying) return null;
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
 * The basenames the score is loaded from, under `public/music/`.
 *
 * Extensions are tried in turn and the first one that both fetches and decodes wins, so whichever format the
 * files arrive in works without anything here changing. Ogg leads because it is the smallest at a given
 * quality; Safari refuses it, which is what the fallbacks are for.
 */
export const MUSIC_SOURCES = {
  survey: "music/exploration",
  framed: "music/framed",
} as const;

const EXTENSIONS = ["ogg", "mp3", "m4a", "wav"] as const;

interface Voice {
  source: AudioBufferSourceNode;
  gain: GainNode;
}

export class Music {
  private buffers: { survey: AudioBuffer; framed: AudioBuffer } | null = null;
  private voices: { survey: Voice; framed: Voice } | null = null;
  private master: GainNode | null = null;
  private layer: MusicLayer | null = null;
  private ducked = false;
  /** Set once loading has been attempted, so a missing score is not re-fetched every frame. */
  private tried = false;

  constructor(private readonly context: () => AudioContext | null) {}

  /** True when there is a score to play. False is a normal state: the game runs silent. */
  get available(): boolean {
    return this.buffers !== null;
  }

  /**
   * Fetch and decode both mixes.
   *
   * Failure is not an error. The files may simply not be there yet, and a game that refuses to start because
   * it has no music would be a worse game than a quiet one, so this reports and returns.
   */
  async load(): Promise<void> {
    if (this.tried) return;
    this.tried = true;
    const context = this.context();
    if (!context) return;
    const [survey, framed] = await Promise.all([
      decodeFirst(context, MUSIC_SOURCES.survey),
      decodeFirst(context, MUSIC_SOURCES.framed),
    ]);
    if (!survey || !framed) return;
    if (!durationsAgree(survey.duration, framed.duration)) {
      // Said out loud because the symptom -- two mixes gradually pulling apart -- looks like a playback bug
      // and is actually a content one.
      console.warn(
        `[music] the two mixes are different lengths (${survey.duration.toFixed(3)}s and `
        + `${framed.duration.toFixed(3)}s). They will be looped on the shorter one to stay in step.`,
      );
    }
    this.buffers = { survey, framed };
  }

  /**
   * Start both mixes, silent, and hold them there.
   *
   * Called once. `AudioBufferSourceNode` cannot be restarted, and it does not need to be: the sources loop
   * for the life of the page and the layers are chosen by gain alone.
   */
  private begin(): void {
    const context = this.context();
    if (!context || !this.buffers || this.voices) return;
    const loopEnd = sharedLoopLength(this.buffers.survey.duration, this.buffers.framed.duration);
    this.master = context.createGain();
    this.master.gain.value = MUSIC.volume;
    this.master.connect(context.destination);
    const startAt = context.currentTime + MUSIC.lead;
    const voice = (buffer: AudioBuffer): Voice => {
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.loopStart = 0;
      source.loopEnd = loopEnd;
      const gain = context.createGain();
      gain.gain.value = 0;
      source.connect(gain).connect(this.master!);
      source.start(startAt);
      return { source, gain };
    };
    this.voices = { survey: voice(this.buffers.survey), framed: voice(this.buffers.framed) };
  }

  /**
   * Play this layer, crossfading from whatever is playing now.
   *
   * Idempotent: called every frame with the game's current state, and does nothing at all unless the answer
   * has changed.
   */
  setLayer(layer: MusicLayer | null): void {
    if (layer === this.layer) return;
    this.layer = layer;
    if (!this.buffers) return;
    this.begin();
    const context = this.context();
    if (!context || !this.voices) return;
    const gains = layer === null ? { survey: 0, framed: 0 } : crossfadeGains(layer === "framed" ? 1 : 0);
    ramp(context, this.voices.survey.gain.gain, gains.survey, MUSIC.fade);
    ramp(context, this.voices.framed.gain.gain, gains.framed, MUSIC.fade);
  }

  /** Drop the score while the game is held, and bring it back afterwards. */
  duck(on: boolean): void {
    if (on === this.ducked) return;
    this.ducked = on;
    const context = this.context();
    if (!context || !this.master) return;
    ramp(context, this.master.gain, on ? MUSIC.volume * MUSIC.duckTo : MUSIC.volume, MUSIC.duckFade);
  }
}

/**
 * Ramp a gain, from wherever it actually is right now.
 *
 * `cancelAndHoldAtTime` then a ramp from the held value, rather than a bare `linearRampToValueAtTime`: a ramp
 * scheduled while an earlier one is still running interpolates from the *earlier* ramp's start, which makes a
 * transition interrupted halfway jump backwards before setting off again.
 */
function ramp(context: AudioContext, param: AudioParam, to: number, seconds: number): void {
  const now = context.currentTime;
  if (typeof param.cancelAndHoldAtTime === "function") param.cancelAndHoldAtTime(now);
  else param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  param.linearRampToValueAtTime(to, now + seconds);
}

/** The first extension of this basename that both fetches and decodes, or null. */
async function decodeFirst(context: AudioContext, base: string): Promise<AudioBuffer | null> {
  for (const extension of EXTENSIONS) {
    try {
      const response = await fetch(`${base}.${extension}`);
      if (!response.ok) continue;
      return await context.decodeAudioData(await response.arrayBuffer());
    } catch {
      // Wrong format for this browser, or not there. Try the next one.
    }
  }
  return null;
}

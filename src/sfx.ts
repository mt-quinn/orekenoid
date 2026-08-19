// Recorded impacts.
//
// The rest of the game's sound is one shaped oscillator sweep per event (`src/audio.ts`), which was always a
// placeholder that kept every sound behind one call so a real sample bank could replace it here. This is that
// bank, for the three contacts that happen most: the ball against the paddle or an arena rail, the ball against
// a brick, and a brick giving way.
//
// Decoded into memory rather than streamed, which is the opposite of what the score does and for the opposite
// reason. Two of these are 73ms and one is 1.19s, so all three together are under half a megabyte of float32
// PCM -- nothing to weigh -- and they need two things a media element cannot give: a start with no scheduling
// latency, and several copies of one sound overlapping. A cascade is a dozen bricks in a second. An
// `AudioBufferSourceNode` per hit is the only shape that does that.
//
// What has to be engineered here is not playback, it is repetition. An identical waveform fired over and over
// phase-locks into a buzz -- the same problem the tone vocabulary's pitch jitter exists to solve, and worse
// with a recording, because two copies of one sample started a few milliseconds apart comb-filter into a
// flange. So every voice is detuned a few percent, simultaneous copies of one sound are counted and made to
// step back from each other, and the long one refuses to start twice inside the same frame.

// Type-only, and that matters: `audio.ts` imports this file back, so a runtime reference to `SOUNDS` here
// would be a cycle whose symptom is a temporal-dead-zone crash at import depending on which module the
// bundler reaches first. Fallbacks are named and looked up when one is needed.
import type { SoundId } from "./audio";

/** The three recorded contacts. */
export type SampleId = "paddleOrRail" | "brickHit" | "brickBroken";

export const SFX = {
  /**
   * How much each already-sounding copy of the same sample takes off the next one.
   *
   * Six bricks breaking in one frame is six correlated copies of one recording, and summed flat that is both
   * clipping and mud. Each further voice comes in quieter, so a cascade reads as one large event with detail
   * inside it rather than as distortion. This is the level half of the fix; the detune below is the other half.
   */
  crowdFalloff: 0.45,
  /** However crowded it gets, a voice never falls below this fraction, or the tail of a cascade vanishes. */
  crowdFloor: 0.3,
  /**
   * Resolution of the soft-clip curve. 1024 points is far finer than the ear, and it is built once.
   */
  clipPoints: 1024,
  /** How far past full scale the curve is defined, so a summed cascade has somewhere to be squashed into. */
  clipRange: 4,
} as const;

/**
 * The sample bus soft-clips instead of letting a cascade hit the wall.
 *
 * Counting voices and stepping them back keeps a crowd *clear*, but it cannot keep it *safe*: five brick hits
 * and four paddle returns and three breaks in the same instant are worth more than full scale however carefully
 * each one is balanced, and Web Audio's destination clips hard, which is the ugliest sound a game can make.
 * Working out a headroom budget that survives every combination means making every ordinary impact too quiet
 * for the one moment that never happens.
 *
 * So the peak is bounded by shape rather than by arithmetic. `tanh` has unit slope at zero -- an ordinary
 * impact at 0.2 loses about one per cent, which is nothing -- and can never exceed one however much is summed
 * into it, so a cascade compresses where it used to distort. No attack or release, so unlike a compressor there
 * is nothing to pump and nothing to dull a transient with.
 */
export function softClip(x: number): number {
  return Math.tanh(x);
}

/** The curve, sampled for a `WaveShaperNode`. */
export function clipCurve(): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(new ArrayBuffer(SFX.clipPoints * 4));
  for (let i = 0; i < SFX.clipPoints; i++) {
    const x = (i / (SFX.clipPoints - 1)) * 2 * SFX.clipRange - SFX.clipRange;
    curve[i] = softClip(x);
  }
  return curve;
}

interface SampleSpec {
  /** Basename under `public/`, without an extension. */
  path: string;
  /**
   * Peak amplitude measured in the file that is actually here, and the peak this sound should play at.
   *
   * Stated as a pair rather than as one gain because the pair is the part worth reading: the gain is just
   * their ratio, and the target is the only number anybody should be editing. The three files are not
   * level-matched to each other -- `ballhitbrick` peaks 6.7dB below `ballhitwallpaddle` -- so without this the
   * relative balance of the game's most frequent sounds would be an accident of mastering rather than a
   * decision.
   */
  peak: number;
  target: number;
  /** Simultaneous copies allowed. Beyond it a play is dropped rather than queued. */
  voices: number;
  /**
   * Seconds before the same sample may start again.
   *
   * Zero for the short ones, where distinct hits are the information. Non-zero for the long one, where two
   * copies a frame apart are not two breaks, they are one break with a comb filter on it.
   */
  minGap: number;
  /** Playback-rate jitter, as a fraction. This is the pitch variation, and on 73ms it is inaudible as speed. */
  spread: number;
  /** The synthesised sound to fall back to if the file never loads. The game must not go quiet over a 404. */
  fallback: SoundId;
}

/**
 * Where the recordings live and how they are balanced.
 *
 * The files sit under `public/music/` because that is where they were put; nothing about them is music, and
 * `path` is the one line to change if they ever move.
 */
export const SAMPLES: Record<SampleId, SampleSpec> = {
  // Every rally, so it is the sound most at risk of becoming wallpaper: modest target, wide detune.
  paddleOrRail: {
    path: "music/ballhitwallpaddle",
    peak: 0.559,
    target: 0.18,
    voices: 4,
    minGap: 0,
    spread: 0.05,
    fallback: "paddleHit",
  },
  brickHit: {
    path: "music/ballhitbrick",
    peak: 0.259,
    target: 0.2,
    voices: 5,
    minGap: 0,
    spread: 0.06,
    fallback: "brickChip",
  },
  // The payoff, and the only one allowed to be loud. Capped hard and gapped, because it runs for 1.19s and a
  // cascade would otherwise have a dozen of them alive at once.
  brickBroken: {
    path: "music/brickbreak",
    peak: 0.624,
    target: 0.36,
    voices: 4,
    minGap: 0.04,
    spread: 0.045,
    fallback: "brickBreak",
  },
};

/**
 * Rail and paddle share one recording, per the design, and are told apart by gain and rate instead.
 *
 * The tone vocabulary pitched them a full octave and a half apart on purpose: a rally is meant to be readable
 * with the screen ignored, and paddle-rail-rail-paddle is the shape you are reading. One file for both keeps
 * the material consistent; these keep the shape. Set both to 1 to hear them identical.
 */
export const RAIL_VOICE = { gain: 0.62, rate: 1.12 } as const;

const EXTENSIONS = ["opus", "ogg", "mp3", "m4a", "wav"] as const;

/** The gain a sample plays at before anything situational is applied to it. */
export function baseGain(spec: SampleSpec): number {
  return spec.target / spec.peak;
}

/** What the nth simultaneous copy of a sound is worth, counting from zero. */
export function crowdGain(active: number): number {
  return Math.max(SFX.crowdFloor, 1 / (1 + SFX.crowdFalloff * Math.max(0, active)));
}

/** A playback rate detuned within `spread`. Separated out so the range is testable without an audio context. */
export function jitteredRate(spread: number, random: () => number): number {
  return 1 + (random() * 2 - 1) * spread;
}

/**
 * Who is still sounding, so a new voice knows how crowded it is arriving into.
 *
 * Kept as plain arithmetic over end times rather than as callbacks on the source nodes: an `onended` per voice
 * is a garbage-collected closure per brick, and a cascade fires hundreds. Nothing here needs to be exact, only
 * to know roughly how many copies are audible right now.
 */
export class VoiceCount {
  private ends = new Map<SampleId, number[]>();
  private lastStart = new Map<SampleId, number>();

  /**
   * Ask to start a voice, and be told what gain to use -- or null if this play should be dropped.
   *
   * `now` and `length` are in seconds on the audio clock.
   */
  admit(id: SampleId, spec: SampleSpec, now: number, length: number): number | null {
    const previous = this.lastStart.get(id);
    if (previous !== undefined && now - previous < spec.minGap) return null;
    const live = (this.ends.get(id) ?? []).filter((end) => end > now);
    if (live.length >= spec.voices) return null;
    live.push(now + length);
    this.ends.set(id, live);
    this.lastStart.set(id, now);
    return crowdGain(live.length - 1);
  }

  /** For tests and diagnostics: how many copies of this sound are audible. */
  active(id: SampleId, now: number): number {
    return (this.ends.get(id) ?? []).filter((end) => end > now).length;
  }

  clear(): void {
    this.ends.clear();
    this.lastStart.clear();
  }
}

/**
 * The decoded recordings, and the machinery for firing one.
 *
 * Holds no context of its own -- it is handed the game's, because the browser's rules about gestures and
 * suspension are per context and a second one would be a second thing that can be silently muted.
 */
export class SampleBank {
  private buffers = new Map<SampleId, AudioBuffer>();
  private voices = new VoiceCount();
  private loading: Promise<void> | null = null;
  /** The soft-clipped bus every voice goes through, built on the first play. */
  private bus: AudioNode | null = null;

  /** Fetch and decode, once. Safe to call on every `start()`. */
  arm(context: AudioContext): Promise<void> {
    if (!this.loading) this.loading = this.fetchAll(context);
    return this.loading;
  }

  has(id: SampleId): boolean {
    return this.buffers.has(id);
  }

  /** Which recordings arrived, for the diagnostics overlay. */
  get loaded(): SampleId[] {
    return [...this.buffers.keys()];
  }

  /**
   * Fire one, and say whether it happened.
   *
   * A false return is the caller's cue to play the synthesised fallback, which is the whole reason this
   * reports rather than just failing quietly: a missing file should cost fidelity, not feedback.
   */
  play(
    context: AudioContext,
    destination: AudioNode,
    id: SampleId,
    options: { gain?: number; rate?: number } = {},
    random: () => number = Math.random,
  ): boolean {
    const buffer = this.buffers.get(id);
    if (!buffer) return false;
    const spec = SAMPLES[id];
    const rate = jitteredRate(spec.spread, random) * (options.rate ?? 1);
    const now = context.currentTime;
    const crowd = this.voices.admit(id, spec, now, buffer.duration / Math.max(0.1, rate));
    // Refused for crowding, which still counts as handled. Answering a dropped voice with the synthesised
    // fallback would put the buzz back exactly where the crowding rules just took it out.
    if (crowd === null) return true;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    const gain = context.createGain();
    gain.gain.value = baseGain(spec) * crowd * (options.gain ?? 1);
    source.connect(gain).connect(this.output(context, destination));
    source.start(now);
    return true;
  }

  private output(context: AudioContext, destination: AudioNode): AudioNode {
    if (!this.bus) {
      const shaper = context.createWaveShaper();
      shaper.curve = clipCurve();
      // Off, because the curve is smooth and 1024 points across four units of range is already finer than the
      // ear; oversampling here would only cost latency.
      shaper.oversample = "none";
      // Before the player's own level, not after: the curve's job is to stop a cascade summing past full scale,
      // and a volume slider applied first would move the point at which it starts doing that.
      shaper.connect(destination);
      this.bus = shaper;
    }
    return this.bus;
  }

  /** Everything sounding is forgotten, so a resumed context does not think it is crowded. */
  /**
   * Forget what is sounding. Called when the context comes back from a suspension.
   *
   * Only the bookkeeping: end times measured against a clock that stopped are stale, and a bank that thinks it
   * is crowded comes back quiet. The nodes themselves survive a suspension perfectly well -- it is the same
   * context, and rebuilding the bus here would churn a fresh shaper and curve on every phone call.
   */
  reset(): void {
    this.voices.clear();
  }

  private async fetchAll(context: AudioContext): Promise<void> {
    await Promise.all(
      (Object.keys(SAMPLES) as SampleId[]).map(async (id) => {
        const buffer = await decodeFirst(context, SAMPLES[id].path);
        if (buffer) this.buffers.set(id, buffer);
      }),
    );
  }
}

/**
 * Decode the first extension of this basename that yields real audio.
 *
 * Decoding inside the loop rather than accepting the first 200 is deliberate: a dev server answers a missing
 * file with `index.html` and a cheerful 200, so the only trustworthy test of "is this the audio" is whether the
 * decoder accepts it.
 */
async function decodeFirst(context: AudioContext, base: string): Promise<AudioBuffer | null> {
  for (const extension of EXTENSIONS) {
    try {
      const response = await fetch(`${base}.${extension}`);
      if (!response.ok) continue;
      return await context.decodeAudioData(await response.arrayBuffer());
    } catch {
      // Wrong format for this browser, or not audio at all. Try the next.
    }
  }
  return null;
}

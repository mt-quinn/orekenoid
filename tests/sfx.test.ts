import { describe, expect, it } from "vitest";
import { SOUNDS } from "../src/audio";
import { RAIL_VOICE, SAMPLES, SFX, VoiceCount, baseGain, clipCurve, crowdGain, jitteredRate, softClip, type SampleId } from "../src/sfx";

const IDS = Object.keys(SAMPLES) as SampleId[];

describe("balancing the recordings", () => {
  it("plays each one at the peak it was designed for", () => {
    for (const id of IDS) {
      const spec = SAMPLES[id];
      expect(baseGain(spec) * spec.peak).toBeCloseTo(spec.target, 6);
    }
  });

  it("undoes the mastering difference between the files", () => {
    // The three were not level-matched to each other: `ballhitbrick` peaks 6.7dB below `ballhitwallpaddle`, so
    // played at equal gain a brick hit would sit quieter than a paddle return by accident rather than by
    // choice. The quieter file therefore takes the larger gain.
    expect(baseGain(SAMPLES.brickHit)).toBeGreaterThan(baseGain(SAMPLES.paddleOrRail));
  });

  it("keeps a break the loudest thing in the set", () => {
    // It is the payoff, and the only one of the three that is allowed to be.
    expect(SAMPLES.brickBroken.target).toBeGreaterThan(SAMPLES.brickHit.target);
    expect(SAMPLES.brickBroken.target).toBeGreaterThan(SAMPLES.paddleOrRail.target);
  });

  it("sits in the same range as the sounds it replaces", () => {
    // The point of this block, and the thing that was wrong: the first version set these against the score's
    // 0.34 and shipped peaks of 0.18 to 0.36, which is 15 to 20dB above the tone bank, so the recordings buried
    // everything else. A recording standing in for a tone belongs a little above that tone's peak -- a recorded
    // transient reads quieter than a decaying oscillator of the same height -- and nowhere near ten times it.
    for (const id of IDS) {
      const stand = SOUNDS[SAMPLES[id].fallback].volume ?? 0;
      const ratio = SAMPLES[id].target / stand;
      expect(ratio).toBeGreaterThanOrEqual(1);
      expect(ratio).toBeLessThanOrEqual(3.2);
    }
  });

  it("never plays louder than the loudest synthesised sound in the game", () => {
    const loudest = Math.max(...Object.values(SOUNDS).map((tone) => tone.volume ?? 0));
    for (const id of IDS) expect(SAMPLES[id].target).toBeLessThanOrEqual(loudest);
  });

  it("still cannot clip, however much is summed into the bus", () => {
    const worst = IDS.reduce(
      (total, id) =>
        total +
        SAMPLES[id].target * Array.from({ length: SAMPLES[id].voices }, (_, n) => crowdGain(n)).reduce((a, b) => a + b, 0),
      0,
    );
    // At these levels the shaper no longer does real work in ordinary play, which is where a limiter belongs:
    // one that engages during a normal rally is a mix problem wearing a limiter.
    expect(worst).toBeLessThan(1);
    expect(Math.abs(softClip(worst * 8))).toBeLessThan(1);
  });

  it("leaves an ordinary impact alone", () => {
    // The curve has unit slope at zero, so the bus is inaudible until something is actually too loud.
    for (const id of IDS) {
      const target = SAMPLES[id].target;
      expect(softClip(target) / target).toBeGreaterThan(0.99);
    }
  });

  it("keeps the rail where the tones had it relative to the paddle", () => {
    // `railHit` at 0.012 against `paddleHit` at 0.025, taken from the vocabulary rather than picked by ear, so a
    // rally reads the way it always did.
    const toneRatio = (SOUNDS.railHit.volume ?? 0) / (SOUNDS.paddleHit.volume ?? 1);
    expect(RAIL_VOICE.gain).toBeCloseTo(toneRatio, 1);
  });

  it("tells a rail apart from a paddle without a second file", () => {
    // One recording for both, per the design. The tone vocabulary pitched them an octave and a half apart
    // because a rally is meant to be readable with the screen ignored, and this is what carries that now.
    expect(RAIL_VOICE.gain).toBeLessThan(1);
    expect(RAIL_VOICE.rate).toBeGreaterThan(1);
  });
});

describe("a crowd of one sound", () => {
  it("gives the first voice everything", () => {
    expect(crowdGain(0)).toBeCloseTo(1, 6);
  });

  it("steps every further copy back", () => {
    // Six bricks breaking in one frame is six correlated copies of one recording. Summed flat that is
    // clipping and mud, not a bigger event.
    for (let n = 1; n < 8; n++) expect(crowdGain(n)).toBeLessThanOrEqual(crowdGain(n - 1));
    expect(crowdGain(1)).toBeLessThan(0.75);
  });

  it("never lets the tail of a cascade vanish", () => {
    expect(crowdGain(50)).toBeCloseTo(SFX.crowdFloor, 6);
  });
});

describe("the soft-clip curve", () => {
  it("is monotone and bounded, so nothing folds back on itself", () => {
    const curve = clipCurve();
    for (let i = 1; i < curve.length; i++) expect(curve[i]).toBeGreaterThan(curve[i - 1]);
    expect(Math.abs(curve[0])).toBeLessThan(1);
    expect(Math.abs(curve[curve.length - 1])).toBeLessThan(1);
  });

  it("passes zero through zero", () => {
    expect(softClip(0)).toBe(0);
    expect(softClip(-0.2)).toBeCloseTo(-softClip(0.2), 9);
  });
});

describe("detuning", () => {
  it("stays inside the spread it was given", () => {
    for (const value of [0, 0.25, 0.5, 0.75, 1]) {
      const rate = jitteredRate(0.06, () => value);
      expect(Math.abs(rate - 1)).toBeLessThanOrEqual(0.06 + 1e-9);
    }
  });

  it("is centred, so a run of hits does not drift in pitch", () => {
    expect(jitteredRate(0.06, () => 0.5)).toBeCloseTo(1, 6);
    expect(jitteredRate(0.06, () => 0)).toBeCloseTo(0.94, 6);
    expect(jitteredRate(0.06, () => 1)).toBeCloseTo(1.06, 6);
  });
});

describe("counting live voices", () => {
  it("admits up to the cap and refuses beyond it", () => {
    const spec = SAMPLES.brickBroken;
    const voices = new VoiceCount();
    const gains = [];
    for (let n = 0; n < spec.voices; n++) gains.push(voices.admit("brickBroken", spec, n * spec.minGap * 2, 1.2));
    expect(gains.every((gain) => gain !== null)).toBe(true);
    const now = spec.voices * spec.minGap * 2;
    expect(voices.admit("brickBroken", spec, now, 1.2)).toBeNull();
  });

  it("hands each further voice a quieter gain", () => {
    const spec = SAMPLES.brickHit;
    const voices = new VoiceCount();
    const first = voices.admit("brickHit", spec, 0, 0.07);
    const second = voices.admit("brickHit", spec, 0, 0.07);
    expect(first).toBeCloseTo(1, 6);
    expect(second!).toBeLessThan(first!);
  });

  it("forgets voices that have finished", () => {
    // No `onended` per voice: a closure per brick, and a cascade fires hundreds. End times are enough.
    const spec = SAMPLES.brickHit;
    const voices = new VoiceCount();
    for (let n = 0; n < spec.voices; n++) voices.admit("brickHit", spec, 0, 0.07);
    expect(voices.admit("brickHit", spec, 0, 0.07)).toBeNull();
    expect(voices.active("brickHit", 0.5)).toBe(0);
    expect(voices.admit("brickHit", spec, 0.5, 0.07)).toBeCloseTo(1, 6);
  });

  it("refuses a second copy of the long one inside the same frame", () => {
    // Two copies of a 1.19s recording a few milliseconds apart are not two breaks, they are one break with a
    // comb filter on it.
    const spec = SAMPLES.brickBroken;
    expect(spec.minGap).toBeGreaterThan(0);
    const voices = new VoiceCount();
    expect(voices.admit("brickBroken", spec, 0, 1.2)).not.toBeNull();
    expect(voices.admit("brickBroken", spec, 0.008, 1.2)).toBeNull();
    expect(voices.admit("brickBroken", spec, spec.minGap + 0.001, 1.2)).not.toBeNull();
  });

  it("lets the short ones repeat as fast as the ball can hit", () => {
    // Distinct contacts are the information in a rally, so nothing gaps them.
    expect(SAMPLES.paddleOrRail.minGap).toBe(0);
    expect(SAMPLES.brickHit.minGap).toBe(0);
  });

  it("keeps each sound's crowd separate", () => {
    const voices = new VoiceCount();
    for (let n = 0; n < SAMPLES.brickHit.voices; n++) voices.admit("brickHit", SAMPLES.brickHit, 0, 0.07);
    expect(voices.admit("brickHit", SAMPLES.brickHit, 0, 0.07)).toBeNull();
    expect(voices.admit("paddleOrRail", SAMPLES.paddleOrRail, 0, 0.07)).toBeCloseTo(1, 6);
  });

  it("comes back uncrowded after a suspension", () => {
    const voices = new VoiceCount();
    for (let n = 0; n < SAMPLES.brickHit.voices; n++) voices.admit("brickHit", SAMPLES.brickHit, 0, 0.07);
    voices.clear();
    expect(voices.admit("brickHit", SAMPLES.brickHit, 0, 0.07)).toBeCloseTo(1, 6);
  });
});

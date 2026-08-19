import { describe, expect, it } from "vitest";
import { MUSIC, crossfadeGains, driftCorrection, durationsAgree, layerFor, playableExtension, playableExtensions, sharedLoopLength } from "../src/music";

describe("which layer is playing", () => {
  const state = (over: Partial<Parameters<typeof layerFor>[0]> = {}) =>
    layerFor({ started: true, mode: "survey", dying: false, ...over });

  it("plays the mine's music on the title screen too", () => {
    // The exploration mix is the game's music and the title screen is part of the game. It used to wait for a
    // deployment, which meant somebody had to dismiss a menu before hearing anything.
    expect(state({ started: false })).toBe("survey");
  });

  it("plays the mine out in the mine", () => {
    expect(state({ mode: "survey" })).toBe("survey");
  });

  it("leans into a live claim", () => {
    expect(state({ mode: "play" })).toBe("framed");
  });

  it("keeps the mine's music under the forge", () => {
    // The Refit Bay is a panel over the mine rather than a place of its own, and swapping the score for a
    // menu would announce it as somewhere you have travelled to.
    expect(state({ mode: "forge" })).toBe("survey");
  });

  it("stops when the drone is going down", () => {
    expect(state({ dying: true })).toBeNull();
  });
});

describe("the crossfade", () => {
  it("holds the level flat, because the two mixes are the same track", () => {
    // Linear, not equal-power. Correlated material adds amplitudes, so `a + b` is what has to stay at one;
    // the usual `a² + b² = 1` would put a bulge in the middle of every transition.
    for (const mix of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      const gains = crossfadeGains(mix);
      expect(gains.survey + gains.framed).toBeCloseTo(1, 6);
    }
  });

  it("is fully one thing at each end", () => {
    expect(crossfadeGains(0)).toEqual({ survey: 1, framed: 0 });
    expect(crossfadeGains(1)).toEqual({ survey: 0, framed: 1 });
  });

  it("is not equal-power, which would be louder in the middle", () => {
    // Stated as a test because it is the one thing about this file somebody will "fix" later.
    const half = crossfadeGains(0.5);
    expect(half.survey).toBeCloseTo(0.5, 6);
    expect(half.survey).not.toBeCloseTo(Math.SQRT1_2, 2);
  });

  it("survives a mix outside the range", () => {
    expect(crossfadeGains(-3)).toEqual({ survey: 1, framed: 0 });
    expect(crossfadeGains(9)).toEqual({ survey: 0, framed: 1 });
  });
});

describe("keeping the two in step", () => {
  it("loops both on the shorter one", () => {
    // A file a few samples longer than its partner would otherwise walk them apart one loop at a time, and
    // the symptom -- two mixes of one recording slowly turning into a flam -- reads as a playback bug.
    expect(sharedLoopLength(90.0, 90.02)).toBeCloseTo(90.0, 6);
    expect(sharedLoopLength(90.02, 90.0)).toBeCloseTo(90.0, 6);
  });

  it("forgives an encoder rounding a few samples", () => {
    expect(durationsAgree(90, 90 + MUSIC.lengthTolerance / 2)).toBe(true);
  });

  it("does not forgive a real mismatch", () => {
    // Worth complaining about: the two mixes are supposed to be the same piece at the same length, and this
    // is the one failure whose cause nobody would guess from its symptom.
    expect(durationsAgree(90, 96)).toBe(false);
  });
});

describe("keeping two streams in step", () => {
  // Two media elements keep their own clocks and pull apart, where two buffer sources could not. The score is
  // streamed rather than decoded because eight and a half minutes of PCM measured 98MB a mix with the heap at
  // 342MB after both -- survivable on a desktop, a good way to have a phone kill the tab. Drift is the price,
  // and this is how it is paid. It is only ever audible during a crossfade, when both mixes are up at once.
  it("leaves a pair that is already together alone", () => {
    expect(driftCorrection(0)).toEqual({ rate: 1, snap: false });
    expect(driftCorrection(MUSIC.syncNudge * 0.5)).toEqual({ rate: 1, snap: false });
  });

  it("slows a follower that has run ahead, and speeds up one that has fallen behind", () => {
    expect(driftCorrection(0.05).rate).toBeLessThan(1);
    expect(driftCorrection(-0.05).rate).toBeGreaterThan(1);
  });

  it("corrects gently enough to be inaudible", () => {
    // A harder correction is a pitch wobble, which is a worse artefact than the drift it is fixing. Three parts
    // in a thousand is about five cents.
    expect(Math.abs(1 - driftCorrection(0.05).rate)).toBeLessThan(0.01);
  });

  it("snaps rather than nudges when the gap is a jump", () => {
    // A backgrounded tab, or one mix wrapping its loop before the other. Nudging three parts in a thousand
    // across half a track would take days.
    expect(driftCorrection(3).snap).toBe(true);
    expect(driftCorrection(-508).snap).toBe(true);
  });
});

describe("choosing a format", () => {
  it("returns every format the browser claims, best first", () => {
    // A list rather than one answer, because `canPlayType` is a claim and not a promise: Safari said "probably"
    // about an AAC file whose media element then refused it outright with MEDIA_ERR_SRC_NOT_SUPPORTED.
    const probe = (type: string) => (type.includes("ogg") ? "" : "probably");
    expect(playableExtensions(probe)).toEqual(["m4a", "mp3", "wav"]);
  });

  it("is empty when the browser claims nothing", () => {
    expect(playableExtensions(() => "")).toEqual([]);
    expect(playableExtension(() => "")).toBeNull();
  });

  it("prefers opus when it is offered, because it is the smallest", () => {
    expect(playableExtension(() => "maybe")).toBe("opus");
  });
});

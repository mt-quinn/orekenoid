import { describe, expect, it } from "vitest";
import { DEFAULT_AUDIO_PREFS, clampVolume, effectiveVolume, readPrefs } from "../src/audioSettings";

describe("a channel's level", () => {
  it("is silent when the switch is off, whatever the slider says", () => {
    expect(effectiveVolume(false, 0.8)).toBe(0);
  });

  it("remembers the level across being muted", () => {
    // The switch and the slider are separate on purpose: turning the score off and turning it down are
    // different intentions, and folding them together loses the level the moment you want it back.
    expect(effectiveVolume(true, 0.35)).toBeCloseTo(0.35, 6);
  });

  it("clamps a level from anywhere", () => {
    expect(clampVolume(-1)).toBe(0);
    expect(clampVolume(4)).toBe(1);
    expect(clampVolume(Number.NaN)).toBe(1);
  });
});

describe("reading stored preferences", () => {
  it("defaults everything when there is nothing to read", () => {
    expect(readPrefs(null)).toEqual(DEFAULT_AUDIO_PREFS);
    expect(readPrefs("nonsense")).toEqual(DEFAULT_AUDIO_PREFS);
  });

  it("keeps what is valid and defaults the rest", () => {
    // Per field rather than wholesale, the same rule the key bindings use: a blob from an older build is
    // missing whatever has been added since, and one absent field should not reset the ones the player set.
    const prefs = readPrefs({ music: false, sfxVolume: 0.25 });
    expect(prefs.music).toBe(false);
    expect(prefs.sfxVolume).toBeCloseTo(0.25, 6);
    expect(prefs.sfx).toBe(DEFAULT_AUDIO_PREFS.sfx);
    expect(prefs.musicVolume).toBeCloseTo(DEFAULT_AUDIO_PREFS.musicVolume, 6);
  });

  it("refuses a level of the wrong type or out of range", () => {
    expect(readPrefs({ musicVolume: "loud" }).musicVolume).toBeCloseTo(DEFAULT_AUDIO_PREFS.musicVolume, 6);
    expect(readPrefs({ musicVolume: 9 }).musicVolume).toBe(1);
  });
});

describe("the defaults", () => {
  it("start both channels on, and neither pinned at the top of its range", () => {
    // A slider that starts at maximum has only one direction to go, and the mix was built with the score
    // already well under full scale.
    expect(DEFAULT_AUDIO_PREFS.music).toBe(true);
    expect(DEFAULT_AUDIO_PREFS.sfx).toBe(true);
    for (const level of [DEFAULT_AUDIO_PREFS.musicVolume, DEFAULT_AUDIO_PREFS.sfxVolume]) {
      expect(level).toBeGreaterThan(0.5);
      expect(level).toBeLessThan(1);
    }
  });
});

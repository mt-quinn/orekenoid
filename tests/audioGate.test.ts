import { describe, expect, it } from "vitest";
import { FaultSettler, GATE, audioFault, type AudioReport } from "../src/audioGate";

const healthy = (over: Partial<AudioReport> = {}): AudioReport => ({
  attempted: true,
  started: true,
  running: true,
  format: "opus",
  refusal: null,
  musicRequested: true,
  musicPlaying: true,
  musicWanted: true,
  samplesLoaded: 3,
  samplesExpected: 3,
  ...over,
});

describe("working sound", () => {
  it("says nothing when everything is fine", () => {
    expect(audioFault(healthy())).toBeNull();
  });

  it("says nothing on the title screen, where the score has not been asked for", () => {
    // The state most people see first. An earlier version reported it as a fault, which is a panel crying
    // wolf at its own normal condition -- the fastest way to teach somebody to dismiss it unread.
    expect(audioFault(healthy({ musicRequested: false, musicPlaying: false, format: null }))).toBeNull();
  });

  it("says nothing about a score the player turned off", () => {
    expect(audioFault(healthy({ musicWanted: false, musicPlaying: false }))).toBeNull();
  });
});

describe("before anybody has asked", () => {
  it("says nothing at all", () => {
    // The title screen's state until the first click. Reported as NO SOUND CHANNEL at first, in a plate, over a
    // game whose audio was fine and simply had not been opened yet.
    expect(audioFault(healthy({ attempted: false, started: false, running: false, samplesLoaded: 0 }))).toBeNull();
  });
});

describe("what it blames first", () => {
  it("blames the channel before anything downstream of it", () => {
    // These are not independent: a suspended context makes the score and the samples look broken too, and
    // naming the wrong one sends the player after the wrong thing.
    const fault = audioFault(healthy({ running: false, musicPlaying: false, samplesLoaded: 0 }));
    expect(fault?.code).toBe("suspended");
  });

  it("blames a missing context before a suspended one", () => {
    expect(audioFault(healthy({ started: false, running: false }))?.code).toBe("nostart");
  });

  it("blames the format before the files that could not be read in it", () => {
    const fault = audioFault(healthy({ refusal: "no playable format", samplesLoaded: 0, musicPlaying: false }));
    expect(fault?.code).toBe("unsupported");
  });
});

describe("what it offers to do", () => {
  it("offers to open a held channel", () => {
    expect(audioFault(healthy({ running: false }))?.action).toBeTruthy();
  });

  it("offers nothing for a format the browser has refused", () => {
    // Asking a browser the same question twice does not change its answer, and a button that cannot work is
    // worse than no button.
    expect(audioFault(healthy({ refusal: "no playable format" }))?.action).toBeNull();
  });

  it("offers a retry for files that did not arrive", () => {
    expect(audioFault(healthy({ samplesLoaded: 0 }))?.action).toBeTruthy();
  });
});

describe("partial failures", () => {
  it("notices some recordings missing, not just all of them", () => {
    const fault = audioFault(healthy({ samplesLoaded: 2 }));
    expect(fault?.code).toBe("samples");
    expect(fault?.detail).toContain("2 of 3");
  });

  it("notices a score that loaded and then would not start", () => {
    // The WebKit failure this whole gate was built for: a format was chosen, the file was fine, and the
    // browser refused the play. Invisible from inside the game before this.
    const fault = audioFault(healthy({ musicPlaying: false }));
    expect(fault?.code).toBe("score");
    expect(fault?.detail).toContain("OPUS");
  });

  it("distinguishes a score that never loaded from one that would not start", () => {
    const fault = audioFault(healthy({ musicPlaying: false, format: null }));
    expect(fault?.code).toBe("score");
    expect(fault?.detail).toContain("did not load");
  });
});

describe("waiting before it says anything", () => {
  const broken = audioFault(healthy({ musicPlaying: false }))!;

  it("says nothing the first time it sees a fault", () => {
    // Every state this watches passes through a bad-looking moment on the way to working: a stream just asked to
    // play has not moved its clock yet, a resuming context is suspended until it is not, and the score's loop
    // drops `currentTime` to zero once a pass. Judged on one reading, the plate flashed over a healthy game.
    const settler = new FaultSettler();
    expect(settler.see(broken, 0)).toBeNull();
  });

  it("says nothing while the fault is younger than the settle time", () => {
    const settler = new FaultSettler();
    settler.see(broken, 0);
    expect(settler.see(broken, GATE.settle - 0.1)).toBeNull();
  });

  it("reports a fault that has stayed true", () => {
    const settler = new FaultSettler();
    settler.see(broken, 0);
    expect(settler.see(broken, GATE.settle + 0.1)).toEqual(broken);
  });

  it("forgets a fault that cleared, so a blip never accumulates", () => {
    // Two separate one-frame glitches a minute apart must not add up to a plate.
    const settler = new FaultSettler();
    settler.see(broken, 0);
    expect(settler.see(null, 1)).toBeNull();
    expect(settler.see(broken, 60)).toBeNull();
    expect(settler.see(broken, 60 + GATE.settle + 0.1)).toEqual(broken);
  });

  it("restarts the clock when the fault changes to a different one", () => {
    const settler = new FaultSettler();
    const other = audioFault(healthy({ running: false }))!;
    settler.see(broken, 0);
    expect(settler.see(other, GATE.settle + 1)).toBeNull();
    expect(settler.see(other, GATE.settle * 2 + 2)).toEqual(other);
  });

  it("settles over long enough to outlast a loop wrap", () => {
    // The wrap is one step of the stepper, tens of milliseconds. The margin here is three orders of magnitude.
    expect(GATE.settle).toBeGreaterThan(1);
  });
});

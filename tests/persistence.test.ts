import { describe, expect, it } from "vitest";
import { DEFAULT_SEED, WORLD_COLS, WORLD_ROWS } from "../src/config";
import { Economy } from "../src/economy";
import {
  packDiscovered,
  parseSave,
  SAVE_VERSION,
  unpackDiscovered,
  validateSave,
  type SaveData,
} from "../src/persistence";
import { WorldModel } from "../src/world";
import type { OrientedFootprint } from "../src/types";

const footprint = (x: number, y: number, angle = 0): OrientedFootprint => ({
  center: { x, y },
  halfWidth: 0.5,
  halfHeight: 0.5,
  angle,
});

function baseSave(overrides: Partial<SaveData> = {}): SaveData {
  return {
    version: SAVE_VERSION,
    savedAt: 1,
    seedLabel: DEFAULT_SEED,
    elapsed: 0,
    world: { history: [], discovered: "" },
    player: { x: 10, y: 20, heading: 0 },
    economy: new Economy().snapshot(),
    chassisIndex: 1,
    chassisIntegrity: {},
    cornerstoneProgress: {},
    anchors: [],
    annotations: [],
    progress: {
      deaths: 0,
      tutorialComplete: false,
      tutorialDone: [],
      regionsSeen: [],
      hasCommitted: false,
      hasServed: false,
    },
    ...overrides,
  };
}

describe("discovery mask codec", () => {
  it("round-trips a sparse mask exactly", () => {
    const source = new Uint8Array(WORLD_COLS * WORLD_ROWS);
    const set = [0, 1, 7, 8, 9, 240, 1000, 5001, source.length - 1];
    for (const index of set) source[index] = 1;

    const restored = new Uint8Array(source.length);
    const count = unpackDiscovered(packDiscovered(source), restored);

    expect(count).toBe(set.length);
    expect([...restored]).toEqual([...source]);
  });

  it("round-trips a fully surveyed world", () => {
    const source = new Uint8Array(WORLD_COLS * WORLD_ROWS).fill(1);
    const restored = new Uint8Array(source.length);
    expect(unpackDiscovered(packDiscovered(source), restored)).toBe(source.length);
    expect(restored.every((value) => value === 1)).toBe(true);
  });

  it("clears any prior mask on unpack, so loading never inherits stale discovery", () => {
    const restored = new Uint8Array(WORLD_COLS * WORLD_ROWS).fill(1);
    expect(unpackDiscovered(packDiscovered(new Uint8Array(restored.length)), restored)).toBe(0);
    expect(restored.some((value) => value === 1)).toBe(false);
  });
});

describe("world mutation log", () => {
  it("records cuts with their exhaustion and persistence flags", () => {
    const world = new WorldModel(DEFAULT_SEED);
    world.removeFootprint(footprint(60, 40), true, false);
    world.removeFootprint(footprint(61, 40, 0.6), false, true);

    expect(world.history).toEqual([
      { t: "cut", x: 60, y: 40, hw: 0.5, hh: 0.5, a: 0, e: 1 },
      { t: "cut", x: 61, y: 40, hw: 0.5, hh: 0.5, a: 0.6, p: 1 },
    ]);
  });

  it("replays a log onto a fresh world of the same seed to identical solidity", () => {
    const played = new WorldModel(DEFAULT_SEED);
    // Cut a swathe through the Landing neighbourhood at an angle, which is the
    // case a cell-grid save would get wrong.
    for (let step = 0; step < 24; step++) {
      played.removeFootprint(footprint(24 + step * 0.6, 12 + step * 0.35, 0.4), step % 3 === 0);
    }

    const loaded = new WorldModel(DEFAULT_SEED);
    loaded.applyHistory(played.history);

    expect(loaded.history).toEqual(played.history);
    let compared = 0;
    for (let y = 6; y < 30; y++) {
      for (let x = 16; x < 60; x++) {
        expect(loaded.solidAt(x + 0.5, y + 0.5)).toBe(played.solidAt(x + 0.5, y + 0.5));
        expect(loaded.cells[y][x].exhausted).toBe(played.cells[y][x].exhausted);
        expect(loaded.cells[y][x].hidden).toBe(played.cells[y][x].hidden);
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(0);
  });

  it("does not double-log while replaying", () => {
    const world = new WorldModel(DEFAULT_SEED);
    world.applyHistory([{ t: "cut", x: 60, y: 40, hw: 0.5, hh: 0.5, a: 0 }]);
    expect(world.history).toHaveLength(1);
  });

  it("records bounded regrowth so a regrown cell survives a reload", () => {
    const played = new WorldModel(DEFAULT_SEED);
    // Find an open cell whose neighbourhood the generator left hollow.
    let target: { x: number; y: number } | null = null;
    for (let y = 10; y < 40 && !target; y++) {
      for (let x = 20; x < 80; x++) {
        const cell = played.cells[y][x];
        if (!cell.solid && !cell.exhausted && !cell.persistent) { target = { x, y }; break; }
      }
    }
    expect(target).not.toBeNull();

    expect(played.restoreCell(target!.x, target!.y, "living")).toBe(true);
    const loaded = new WorldModel(DEFAULT_SEED);
    loaded.applyHistory(played.history);
    expect(loaded.cells[target!.y][target!.x].solid).toBe(true);
    expect(loaded.cells[target!.y][target!.x].kind).toBe("living");
  });
});

describe("discovery marking", () => {
  it("reveals a disc and never counts a cell twice", () => {
    const world = new WorldModel(DEFAULT_SEED);
    const first = world.markDiscovered(50, 50, 4);
    expect(first).toBeGreaterThan(0);
    expect(world.discoveredCount).toBe(first);
    expect(world.markDiscovered(50, 50, 4)).toBe(0);
    expect(world.discoveredCount).toBe(first);
    expect(world.isDiscovered(50, 50)).toBe(true);
    expect(world.isDiscovered(50, 60)).toBe(false);
  });

  it("clips to world bounds rather than throwing at the edges", () => {
    const world = new WorldModel(DEFAULT_SEED);
    expect(() => world.markDiscovered(0, 0, 12)).not.toThrow();
    expect(() => world.markDiscovered(WORLD_COLS - 1, WORLD_ROWS - 1, 12)).not.toThrow();
    expect(world.isDiscovered(-1, -1)).toBe(false);
    expect(world.isDiscovered(WORLD_COLS + 5, 3)).toBe(false);
  });
});

describe("economy snapshot", () => {
  it("round-trips holdings, crafted modules, verbs and fabrication", () => {
    const economy = new Economy();
    economy.add("copper", 12);
    economy.add("coal", 6);
    economy.deposit();
    economy.add("iron", 3);
    economy.grantVerb("railSeed");
    economy.blastCharges = 2;
    const before = economy.snapshot();
    const upgradesBefore = { ...economy.upgrades("bx04-surveyor") };

    const restored = new Economy();
    restored.restore(before);

    expect(restored.snapshot()).toEqual(before);
    expect(restored.amount("copper")).toBe(12);
    expect(restored.carried("iron")).toBe(3);
    expect(restored.verbs.has("railSeed")).toBe(true);
    expect(restored.blastCharges).toBe(2);
    expect(restored.upgrades("bx04-surveyor")).toEqual(upgradesBefore);
  });

  it("preserves fitted grades, so a reload cannot cost the player their machine", () => {
    const economy = new Economy();
    economy.add("copper", 400);
    economy.add("coal", 400);
    economy.add("iron", 400);
    economy.deposit();
    expect(economy.upgrade("bx04-surveyor", "plating").ok).toBe(true);
    expect(economy.upgrade("bx04-surveyor", "plating").ok).toBe(true);

    const restored = new Economy();
    restored.restore(economy.snapshot());
    expect(restored.gradeOf("bx04-surveyor", "plating")).toBe(2);
    expect(restored.upgrades("bx04-surveyor")).toEqual(economy.upgrades("bx04-surveyor"));
  });

  it("clamps a grade beyond the ladder rather than indexing off the end of it", () => {
    // A save written against a longer ladder -- or hand-edited -- must degrade to the top
    // grade, not produce an undefined part.
    const economy = new Economy();
    economy.restore({
      resources: {}, banked: {}, grades: { "bx04-surveyor": { plating: 99 } },
      verbs: [], fabricated: [], blastCharges: 0, totalSecured: 0,
    });
    expect(economy.gradeOf("bx04-surveyor", "plating")).toBe(5);
    expect(economy.fittedGrade("bx04-surveyor", "plating")?.name).toBe("Runite Plate");
  });

  it("replaces rather than merges, so loading cannot inherit the previous state", () => {
    const economy = new Economy();
    economy.add("ruby", 9);
    economy.deposit();
    economy.grantVerb("surveyResonance");
    economy.restore(new Economy().snapshot());
    expect(economy.amount("ruby")).toBe(0);
    expect(economy.verbs.size).toBe(0);
  });
});

describe("save validation", () => {
  it("accepts a well-formed save", () => {
    const result = validateSave(baseSave());
    expect(result.ok).toBe(true);
    expect(result.data?.seedLabel).toBe(DEFAULT_SEED);
  });

  it("fills in fields an older or hand-written save omitted", () => {
    const partial = baseSave();
    delete (partial as Partial<SaveData>).annotations;
    delete (partial as Partial<SaveData>).progress;
    const result = validateSave(partial);
    expect(result.ok).toBe(true);
    expect(result.data?.annotations).toEqual([]);
    expect(result.data?.progress.deaths).toBe(0);
  });

  it("rejects a save from an unsupported version", () => {
    const result = validateSave(baseSave({ version: SAVE_VERSION + 1 }));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("not supported");
  });

  it.each([
    ["no seed", baseSave({ seedLabel: "" })],
    ["no world record", baseSave({ world: undefined as unknown as SaveData["world"] })],
    ["no drone position", baseSave({ player: undefined as unknown as SaveData["player"] })],
    ["no economy", baseSave({ economy: null as unknown as SaveData["economy"] })],
  ])("rejects a save with %s", (_label, save) => {
    expect(validateSave(save).ok).toBe(false);
  });

  it("rejects a malformed world edit rather than partially applying it", () => {
    const result = validateSave(baseSave({
      world: { history: [{ t: "teleport", x: 1, y: 1 } as never], discovered: "" },
    }));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("unknown world edit");
  });

  it("rejects a world edit with a non-finite position", () => {
    const result = validateSave(baseSave({
      world: { history: [{ t: "cut", x: Number.NaN, y: 1, hw: 0.5, hh: 0.5, a: 0 }], discovered: "" },
    }));
    expect(result.ok).toBe(false);
  });

  it("drops annotations that have no position", () => {
    const result = validateSave(baseSave({
      annotations: [
        { id: "a", x: 5, y: 5, icon: "◆", note: "keep" },
        { id: "b", x: Number.NaN, y: 5, icon: "◆", note: "drop" },
      ],
    }));
    expect(result.data?.annotations.map((note) => note.id)).toEqual(["a"]);
  });

  it("rejects non-objects and non-JSON text", () => {
    expect(validateSave(null).ok).toBe(false);
    expect(validateSave("a string").ok).toBe(false);
    expect(parseSave("{not json").ok).toBe(false);
    expect(parseSave(JSON.stringify(baseSave())).ok).toBe(true);
  });
});

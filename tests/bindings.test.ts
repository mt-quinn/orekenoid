import { beforeEach, describe, expect, it } from "vitest";
import { Bindings, DEFAULT_BINDINGS, keyName } from "../src/bindings";

/** A `localStorage` that exists, since these tests are about what survives one. */
beforeEach(() => {
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as Storage;
});

describe("key names", () => {
  it("reads codes back as keys somebody has", () => {
    // `KeyF` is not printed on any keyboard.
    expect(keyName("KeyF")).toBe("F");
    expect(keyName("Space")).toBe("SPACE");
    expect(keyName("ArrowUp")).toBe("UP ARROW");
    expect(keyName("Backquote")).toBe("`");
  });
});

describe("binding a key", () => {
  it("starts on the defaults", () => {
    const bindings = new Bindings();
    expect(bindings.codesFor("commit")).toEqual([...DEFAULT_BINDINGS.commit]);
    expect(bindings.label("moveUp")).toBe("W / UP ARROW");
  });

  it("takes a key off whatever else had it", () => {
    // A code doing two things is a bug the player cannot see: they press it and get both, or get
    // whichever branch the handler happened to reach first.
    const bindings = new Bindings();
    expect(bindings.bind("serve", "KeyM").ok).toBe(true);
    expect(bindings.matches("serve", "KeyM")).toBe(true);
    expect(bindings.matches("atlas", "KeyM")).toBe(false);
  });

  it("moves both halves of a control that wears two names", () => {
    // Flying left and sliding the paddle left are one key to the player. A settings screen that made
    // them separate rows would be describing the implementation rather than the game.
    const bindings = new Bindings();
    bindings.bind("moveLeft", "KeyJ");
    expect(bindings.matches("moveLeft", "KeyJ")).toBe(true);
    expect(bindings.matches("paddleLeft", "KeyJ")).toBe(true);
  });

  it("refuses Escape, which is how the player gets out of things", () => {
    const bindings = new Bindings();
    const result = bindings.bind("serve", "Escape");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("reserved");
    expect(bindings.codesFor("serve")).toEqual([...DEFAULT_BINDINGS.serve]);
  });

  it("answers held keys through the action, not the code", () => {
    const bindings = new Bindings();
    bindings.bind("moveRight", "KeyL");
    expect(bindings.isHeld("moveRight", new Set(["KeyL"]))).toBe(true);
    expect(bindings.isHeld("moveRight", new Set(["KeyD"]))).toBe(false);
  });

  it("composes a prompt hint from what the keys are now", () => {
    // The rungs used to carry their own hardcoded strings, which would have been teaching the wrong
    // keyboard the moment anything was rebound.
    const bindings = new Bindings();
    bindings.bind("commit", "KeyG");
    expect(bindings.hint("aimLeft", "aimRight", "commit")).toBe("Q, E, G");
  });

  it("remembers a rebind, and forgets it on reset", () => {
    const bindings = new Bindings();
    bindings.bind("atlas", "KeyN");
    expect(new Bindings().codesFor("atlas")).toEqual(["KeyN"]);
    bindings.reset();
    expect(new Bindings().codesFor("atlas")).toEqual([...DEFAULT_BINDINGS.atlas]);
  });

  it("falls back to the default for an action a stored file has never heard of", () => {
    // A save from an older build is missing the actions added since, and the right answer for those is
    // the default rather than nothing at all.
    localStorage.setItem("orekenoid.bindings.v1", JSON.stringify({ atlas: ["KeyN"] }));
    const bindings = new Bindings();
    expect(bindings.codesFor("atlas")).toEqual(["KeyN"]);
    expect(bindings.codesFor("commit")).toEqual([...DEFAULT_BINDINGS.commit]);
  });

  it("survives a corrupt stored file", () => {
    localStorage.setItem("orekenoid.bindings.v1", "{not json");
    expect(new Bindings().codesFor("commit")).toEqual([...DEFAULT_BINDINGS.commit]);
  });
});

describe("prompt hints", () => {
  it("reads a direction cluster the way a person would write it", () => {
    // The naive join produced "W / UP ARROW, A / LEFT ARROW, S / DOWN ARROW, D / RIGHT ARROW" in a prompt
    // that has room for about a line.
    const bindings = new Bindings();
    expect(bindings.hint("moveUp", "moveLeft", "moveDown", "moveRight")).toBe("WASD / ARROWS");
  });

  it("keeps the cluster honest after a rebind", () => {
    const bindings = new Bindings();
    bindings.bind("moveUp", "KeyI");
    // One key now, so the columns are no longer even and it names them rather than inventing a cluster.
    // Uneven columns now, so it names them rather than inventing a cluster that is not true.
    expect(bindings.hint("moveUp", "moveLeft", "moveDown", "moveRight")).toContain("I");
  });

  it("does not cluster a pair, which reads worse than naming them", () => {
    const bindings = new Bindings();
    expect(bindings.hint("aimLeft", "aimRight")).toBe("Q / E");
  });

  it("names a mixed rung one control at a time", () => {
    // Turning the frame and committing it are three different controls. "Q / E / F" would read as three
    // ways to do one thing.
    const bindings = new Bindings();
    expect(bindings.hint("aimLeft", "aimRight", "commit")).toBe("Q, E, F / ENTER");
  });
});

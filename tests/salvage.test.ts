import { describe, expect, it } from "vitest";
import { Grinder } from "../src/salvage";

/**
 * The grinder's arithmetic.
 *
 * Tested without a DOM, which is why it lives apart from the drone that draws it -- the view
 * builds a blur filter in its constructor and cannot be instantiated in Node at all. The
 * questions are whether a 50% drone keeps exactly half over a run, and whether the short-run
 * pattern reads as a rate rather than as a broken machine.
 */
describe("the salvage drone's cut", () => {
  const run = (tax: number, pieces: number): number => {
    const grinder = new Grinder();
    grinder.configure(tax);
    let eaten = 0;
    for (let piece = 0; piece < pieces; piece++) if (grinder.grinds()) eaten++;
    return eaten;
  };

  it("takes no cut with no drone fitted", () => {
    expect(run(0, 100)).toBe(0);
  });

  it("takes exactly its share over a run", () => {
    expect(run(0.5, 100)).toBe(50);
    expect(run(0.3, 100)).toBe(30);
    expect(run(0.15, 100)).toBe(15);
  });

  it("never eats two in a row at half, so the pattern reads as a rate", () => {
    const grinder = new Grinder();
    grinder.configure(0.5);
    let previous = false;
    for (let piece = 0; piece < 40; piece++) {
      const eaten = grinder.grinds();
      expect(eaten && previous, `two eaten in a row at piece ${piece}`).toBe(false);
      previous = eaten;
    }
  });

  it("never eats the first piece, so a new drone pays out immediately", () => {
    // The first rescue a player ever sees should arrive whole. A drone whose debut is to eat the
    // thing it just saved reads as a downgrade.
    for (const tax of [0.5, 0.3, 0.15]) {
      const grinder = new Grinder();
      grinder.configure(tax);
      expect(grinder.grinds(), `tax ${tax} ate the first piece`).toBe(false);
    }
  });

  it("forgets its debt when the drone is removed", () => {
    const grinder = new Grinder();
    grinder.configure(0.5);
    grinder.grinds();
    grinder.configure(0);
    grinder.configure(0.5);
    expect(grinder.grinds()).toBe(false);
  });
});

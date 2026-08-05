import { describe, expect, it } from "vitest";
import { WorldModel } from "../src/world";

/**
 * Regrowth restores the rock but never the debt.
 *
 * The Rootwarren's rule is that cleared cells grow back, and before this a regrown cell was
 * counted as load a second time -- so taking your time in a claim you had already cleared
 * charged you for it twice, which turned the province's signature mechanic into a penalty for
 * playing carefully.
 */
describe("worked rock", () => {
  const world = () => new WorldModel("bounceworld-01");

  it("starts unworked", () => {
    const model = world();
    const cell = model.generated.cells[20][40];
    expect(cell.worked).toBe(false);
  });

  it("marks a cell the moment it is cut", () => {
    const model = world();
    // Find a solid cell to break.
    let target: { x: number; y: number } | null = null;
    for (let y = 10; y < 60 && !target; y++) {
      for (let x = 40; x < 120; x++) {
        const cell = model.generated.cells[y][x];
        if (cell.solid && !cell.persistent) { target = { x, y }; break; }
      }
    }
    expect(target).not.toBeNull();
    model.removeCell(target!.x, target!.y);
    expect(model.generated.cells[target!.y][target!.x].worked).toBe(true);
  });

  it("keeps the mark through regrowth, which is the whole point", () => {
    const model = world();
    let target: { x: number; y: number } | null = null;
    for (let y = 10; y < 60 && !target; y++) {
      for (let x = 40; x < 120; x++) {
        const cell = model.generated.cells[y][x];
        if (cell.solid && !cell.persistent && !cell.resource) { target = { x, y }; break; }
      }
    }
    const { x, y } = target!;
    const kind = model.generated.cells[y][x].kind;
    model.removeCell(x, y);
    expect(model.solidAt(x + 0.5, y + 0.5)).toBe(false);
    expect(model.restoreCell(x, y, kind)).toBe(true);
    // Solid again -- solidity is derived from the cut footprints, not the `solid` field, which is
    // never lowered during play -- and still spent.
    expect(model.solidAt(x + 0.5, y + 0.5)).toBe(true);
    expect(model.generated.cells[y][x].worked).toBe(true);
  });

  it("recovers the mark from the mutation log, so a reload cannot refund the debt", () => {
    // Nothing about `worked` is stored in a save. Replaying the log has to rebuild it, or loading
    // an expedition would hand the player back liability they had already paid off.
    const first = world();
    let target: { x: number; y: number } | null = null;
    for (let y = 10; y < 60 && !target; y++) {
      for (let x = 40; x < 120; x++) {
        const cell = first.generated.cells[y][x];
        if (cell.solid && !cell.persistent) { target = { x, y }; break; }
      }
    }
    const { x, y } = target!;
    const kind = first.generated.cells[y][x].kind;
    first.removeCell(x, y);
    first.restoreCell(x, y, kind);

    const reloaded = new WorldModel("bounceworld-01");
    reloaded.applyHistory(first.history);
    expect(reloaded.solidAt(x + 0.5, y + 0.5)).toBe(true);
    expect(reloaded.generated.cells[y][x].worked).toBe(true);
  });
});

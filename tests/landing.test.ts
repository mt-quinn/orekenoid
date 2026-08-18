import { describe, expect, it } from "vitest";
import { generateWorld } from "../src/worldgen/generate";
import {
  BANK,
  BAY,
  DROP,
  FIRST_BOUNDER,
  ISLAND,
  LANDING,
  LANDING_MAP,
  LANDING_ORIGIN,
  OVERLOAD_FACE,
  SEAL_CELLS,
} from "../src/worldgen/landing";

/** The map's glyph at a world cell, or null outside it. */
function glyphAt(x: number, y: number): string | null {
  const row = LANDING_MAP[y - LANDING_ORIGIN.y];
  if (row === undefined) return null;
  return row[x - LANDING_ORIGIN.x] ?? null;
}

const OPEN = new Set([".", "L", "$", "T"]);

/**
 * Every open cell reachable from a starting cell, four-connected.
 *
 * `blocked` names glyphs to treat as rock even when they are not, so the same walk can answer both
 * "where can the player go" and "where could they go if this wall were gone".
 */
function reachableFrom(startX: number, startY: number, blocked: ReadonlySet<string> = new Set()): Set<string> {
  const seen = new Set<string>();
  const queue: Array<[number, number]> = [[startX, startY]];
  while (queue.length) {
    const [x, y] = queue.pop()!;
    const key = `${x},${y}`;
    if (seen.has(key)) continue;
    const glyph = glyphAt(x, y);
    if (glyph === null || !OPEN.has(glyph) || blocked.has(glyph)) continue;
    seen.add(key);
    queue.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  return seen;
}

describe("the Landing map", () => {
  it("is a rectangle, in a legend it declares", () => {
    // A tile map is exactly the kind of thing that goes wrong by one character, so the shape of the
    // art is asserted rather than eyeballed.
    const widths = new Set(LANDING_MAP.map((row) => row.length));
    expect(widths.size).toBe(1);
    expect(LANDING_MAP.length).toBeGreaterThan(20);
    const glyphs = new Set(LANDING_MAP.join(""));
    expect([...glyphs].sort().join("")).toBe("#$.=?BLSTXco");
  });

  it("wakes the drone in the open, in the Berth", () => {
    expect(glyphAt(LANDING.x, LANDING.y)).toBe(".");
  });

  it("puts the Refit Bay and the bank where the drone starts, not somewhere else", () => {
    // The old bay was drawn in one place and located in another, which blocked traversal into most of
    // it. Both now come off the map, so there is only one answer.
    // BAY is the rect's centre and so lands on a half cell; the bay is five wide.
    for (const place of [{ x: Math.round(BAY.x), y: Math.round(BAY.y) }, BANK]) {
      expect(OPEN.has(glyphAt(place.x, place.y) ?? "#")).toBe(true);
      expect(Math.hypot(place.x - LANDING.x, place.y - LANDING.y)).toBeLessThan(14);
    }
  });

  it("seals the Berth so the Seal is the only way on", () => {
    // The whole opening rests on this. The old Landing had 148 breakable exits on one seed and no
    // pocket at all on another, so there was nothing for a door to mean.
    const berth = reachableFrom(LANDING.x, LANDING.y);
    expect(berth.size).toBeGreaterThan(60);
    for (const place of [ISLAND, OVERLOAD_FACE, DROP, FIRST_BOUNDER]) {
      expect(berth.has(`${Math.round(place.x)},${Math.round(place.y)}`)).toBe(false);
    }
  });

  it("opens the whole Gallery once the Seal is cut", () => {
    // Treating the Seal as air is what breaking it does. Everything the opening goes on to teach has
    // to be behind it -- the island to fight over, the face that costs armour, the shaft down.
    const breached = reachableFrom(LANDING.x, LANDING.y, new Set());
    expect(breached.has(`${DROP.x},${DROP.y}`)).toBe(false);

    const seal = new Set<string>();
    for (const cell of SEAL_CELLS) seal.add(`${cell.x},${cell.y}`);
    const walk = new Set<string>();
    const queue: Array<[number, number]> = [[LANDING.x, LANDING.y]];
    while (queue.length) {
      const [x, y] = queue.pop()!;
      const key = `${x},${y}`;
      if (walk.has(key)) continue;
      const glyph = glyphAt(x, y);
      if (glyph === null) continue;
      if (!OPEN.has(glyph) && !seal.has(key)) continue;
      walk.add(key);
      queue.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    expect(walk.has(`${DROP.x},${DROP.y}`)).toBe(true);
    expect(walk.has(`${Math.round(FIRST_BOUNDER.x)},${Math.round(FIRST_BOUNDER.y)}`)).toBe(true);
  });

  it("sets the Seal at an angle, so a square frame cannot cover it", () => {
    // The angle *is* the aim lesson. A Seal that ran straight down a column would teach nothing.
    const columns = new Set(SEAL_CELLS.map((cell) => cell.x));
    const rows = new Set(SEAL_CELLS.map((cell) => cell.y));
    expect(columns.size).toBeGreaterThan(2);
    expect(rows.size).toBeGreaterThan(2);
  });

  it("stands the first Bounder on solid ground, in sight of the Seal", () => {
    // It has to be somewhere the player can watch it walk before it has cost them anything, which
    // means standing on the island with open air between it and the ledge.
    const below = glyphAt(Math.round(FIRST_BOUNDER.x), Math.round(FIRST_BOUNDER.y) + 1);
    expect(OPEN.has(below ?? ".")).toBe(false);
  });

  it("stamps the drawn geology as well as the gameplay grid", () => {
    // `solid` is what the player collides with; `baseSolid` is what the terrain renderer, the shadow
    // contour and creature collision reconstruct the world from. Stamping only the first left the whole
    // Landing invisible to everything visual -- so this compares the shipped world against the art.
    const world = generateWorld("bounceworld-01");
    let checked = 0;
    for (let y = LANDING_ORIGIN.y; y < LANDING_ORIGIN.y + LANDING_MAP.length; y++) {
      for (let x = LANDING_ORIGIN.x; x < LANDING_ORIGIN.x + LANDING_MAP[0].length; x++) {
        const glyph = glyphAt(x, y);
        if (glyph === null || glyph === "?") continue;
        const cell = world.cells[y][x];
        const wanted = !OPEN.has(glyph);
        expect(cell.solid, `solid at ${x},${y} (${glyph})`).toBe(wanted);
        expect(cell.baseSolid, `baseSolid at ${x},${y} (${glyph})`).toBe(wanted);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(500);
  });

  it("keeps ore inside the island, where it has to be claimed rather than flown to", () => {
    const ores = LANDING_MAP.join("").match(/[coS]/g) ?? [];
    expect(ores.length).toBeGreaterThan(20);
    for (let y = LANDING_ORIGIN.y; y < LANDING_ORIGIN.y + LANDING_MAP.length; y++) {
      for (let x = LANDING_ORIGIN.x; x < LANDING_ORIGIN.x + LANDING_MAP[0].length; x++) {
        if (!"coS".includes(glyphAt(x, y) ?? "")) continue;
        // Ore is rock, so it is never somewhere the drone can simply fly through.
        expect(OPEN.has(glyphAt(x, y) ?? "")).toBe(false);
      }
    }
  });
});

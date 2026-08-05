import { describe, expect, it } from "vitest";
import { WORLD_COLS, WORLD_ROWS } from "../src/config";
import { generateWorld } from "../src/worldgen/generate";
import { LANDING } from "../src/worldgen/landmarks";
import { BASE_LAYERS, largestComponent, rasterizeWorld, reachableFromLanding } from "../src/worldmap/raster";

const SEEDS = ["bounceworld-01", "seed-two", "seed-three"];

describe("world inspector raster", () => {
  it("paints every cell opaquely, on every layer", () => {
    // A transparent or missing pixel would read as void and quietly misrepresent the world,
    // which is the one thing an inspection tool must never do.
    const world = generateWorld("bounceworld-01");
    for (const layer of BASE_LAYERS) {
      const raster = rasterizeWorld(world.cells, { layer: layer.id, resources: true, persistent: true });
      expect(raster.width).toBe(WORLD_COLS);
      expect(raster.height).toBe(WORLD_ROWS);
      expect(raster.pixels).toHaveLength(WORLD_COLS * WORLD_ROWS * 4);
      for (let index = 3; index < raster.pixels.length; index += 4) {
        expect(raster.pixels[index], `${layer.id} left a transparent pixel`).toBe(255);
      }
    }
  });

  it("is deterministic for a seed", () => {
    const a = rasterizeWorld(generateWorld("seed-two").cells, { layer: "material", resources: true, persistent: true });
    const b = rasterizeWorld(generateWorld("seed-two").cells, { layer: "material", resources: true, persistent: true });
    expect([...b.pixels]).toEqual([...a.pixels]);
  });

  it("distinguishes ore-bearing rock, so the economy is visible at all", () => {
    const world = generateWorld("bounceworld-01");
    const withOre = rasterizeWorld(world.cells, { layer: "material", resources: true, persistent: false });
    const without = rasterizeWorld(world.cells, { layer: "material", resources: false, persistent: false });
    let changed = 0;
    for (let index = 0; index < withOre.pixels.length; index += 4) {
      if (withOre.pixels[index] !== without.pixels[index]) changed++;
    }
    expect(changed, "the ore tint changed nothing").toBeGreaterThan(200);
  });
});

describe("world connectivity, as the inspector measures it", () => {
  it("keeps the cave network in one body outside the Landing", () => {
    // This is what "every cavern is reachable" should mean: it does not depend on where the
    // player starts, so the Landing's deliberate seal cannot flatter it, and an orphaned
    // pocket shows up wherever it is.
    //
    // `report.reachableCells` does *not* measure this. It is taken inside `verify`, whose own
    // corridor repair carves an escape route out of the Landing which is then stamped back
    // over -- so on bounceworld-01 the report claims 20,474 of 20,490 reachable while the
    // world that ships has 262. That gap is why this test measures the world directly.
    for (const seed of SEEDS) {
      const world = generateWorld(seed);
      const { largest, open } = largestComponent(world.cells);
      const start = reachableFromLanding(world.cells);
      const startPocket = start.reduce((sum, value) => sum + value, 0);
      // Everything except the largest body and the Landing's own pocket is genuinely stranded.
      const stranded = open - largest - startPocket;
      expect(stranded / open, `${seed}: ${stranded} of ${open} open cells stranded`).toBeLessThan(0.005);
    }
  });

  it("seals the Landing only with rock the player can break", () => {
    // The Landing starts enclosed on purpose -- the first lesson is to break the Chalk Face.
    // That is only survivable if the seal is breakable: a persistent wall anywhere around the
    // start pocket would make the expedition unwinnable from the first frame, and nothing
    // else in the suite would catch it.
    for (const seed of SEEDS) {
      const world = generateWorld(seed);
      const inside = reachableFromLanding(world.cells);
      let breakable = 0;
      for (let y = 0; y < WORLD_ROWS; y++) {
        for (let x = 0; x < WORLD_COLS; x++) {
          if (inside[y * WORLD_COLS + x]) continue;
          const cell = world.cells[y][x];
          if (!cell.solid || cell.persistent) continue;
          // A breakable solid cell touching the start pocket is a way out.
          const touches = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
            const nx = x + dx;
            const ny = y + dy;
            return nx >= 0 && ny >= 0 && nx < WORLD_COLS && ny < WORLD_ROWS
              && inside[ny * WORLD_COLS + nx] === 1;
          });
          if (touches) breakable++;
        }
      }
      expect(breakable, `${seed}: the Landing has no breakable wall to mine out through`)
        .toBeGreaterThan(10);
    }
  });

  it("puts the Landing's own pocket in the smaller half of that split", () => {
    // Guards against the reverse mistake: if the start pocket ever became the largest body,
    // the test above would pass while the actual mine was the stranded part.
    const world = generateWorld("bounceworld-01");
    const { largest } = largestComponent(world.cells);
    const startPocket = reachableFromLanding(world.cells).reduce((sum, value) => sum + value, 0);
    expect(startPocket).toBeGreaterThan(0);
    expect(startPocket).toBeLessThan(largest);
    expect(world.cells[LANDING.y][LANDING.x].solid).toBe(false);
  });
});

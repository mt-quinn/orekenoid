import { describe, expect, it } from "vitest";
import { generateWorld } from "../src/worldgen/generate";
import { CORNERSTONES, LANDING_FEATURES, REQUIRED_NODES } from "../src/worldgen/landmarks";
import { bandAt, dialsFor, sampleRegion } from "../src/worldgen/regions";
import { WORLD_COLS, WORLD_ROWS, type Band } from "../src/config";
import { materialOf } from "../src/materials";

// Fixed seed fixtures. The strings are opaque hash inputs, so their values are
// held stable across renames -- changing one changes which world is under test.
const SEEDS = ["bounceworld-01", "bounceworld-02", "expedition-alpha", "seam-7"];

describe("generator contract", () => {
  it("is deterministic for a given seed", () => {
    const a = generateWorld("bounceworld-01");
    const b = generateWorld("bounceworld-01");
    expect(a.report).toEqual(b.report);
    expect(a.cells[40][40].kind).toBe(b.cells[40][40].kind);
    expect(a.cells[90][150].resource).toBe(b.cells[90][150].resource);
  });

  it("produces different geology for different seeds", () => {
    const a = generateWorld("bounceworld-01");
    const b = generateWorld("bounceworld-02");
    expect(a.report.openCells).not.toBe(b.report.openCells);
  });

  it.each(SEEDS)("connects every required node to the Landing [%s]", (seed) => {
    const world = generateWorld(seed);
    expect(world.report.unreachableRequiredNodes).toEqual([]);
    // Contract 1: essentially all open space is one connected system.
    expect(world.report.reachableCells / world.report.openCells).toBeGreaterThan(0.9);
  });

  it.each(SEEDS)("places every guaranteed Landing feature [%s]", (seed) => {
    const world = generateWorld(seed);
    expect(world.report.missingLandingFeatures).toEqual([]);
    expect(world.landingFeatures).toHaveLength(8);
    expect(world.landingFeatures.map((feature) => feature.id)).toContain("bank");
  });

  it.each(SEEDS)("carries a claimable rare reagent seam in every ecotone [%s]", (seed) => {
    const world = generateWorld(seed);
    expect(world.report.ecotoneReagents.brightFault).toBeGreaterThan(0);
    expect(world.report.ecotoneReagents.chalkWarren).toBeGreaterThan(0);
    expect(world.report.ecotoneReagents.bloomShelf).toBeGreaterThan(0);
  });

  it.each(SEEDS)("affords a Copper Plate inside Band I [%s]", (seed) => {
    const world = generateWorld(seed);
    // Recipe is 10 copper and 4 coal; require real headroom over that.
    expect(world.report.bandI.copper).toBeGreaterThanOrEqual(30);
    expect(world.report.bandI.coal).toBeGreaterThanOrEqual(12);
  });

  it.each(SEEDS)("keeps all three provinces materially present [%s]", (seed) => {
    const world = generateWorld(seed);
    const total = WORLD_COLS * WORLD_ROWS;
    for (const province of ["karst", "mirrorreef", "rootwarren"] as const) {
      expect(world.report.provinceCells[province] / total).toBeGreaterThan(0.1);
    }
  });

  it.each(SEEDS)("raises density monotonically with depth [%s]", (seed) => {
    const world = generateWorld(seed);
    const bands: Band[] = [1, 2, 3, 4];
    for (let index = 1; index < bands.length; index++) {
      expect(world.report.bandDensity[bands[index]]).toBeGreaterThan(world.report.bandDensity[bands[index - 1]]);
    }
  });

  it("raises all three dials monotonically with depth inside a province", () => {
    for (const x of [40, 170, 150]) {
      let previous = { density: -1, volatility: -1, yield: -1 };
      for (const y of [20, 50, 90, 130]) {
        const sample = sampleRegion(1234, x, y);
        const dials = dialsFor(sample);
        if (sample.ecotone) continue;
        expect(dials.density).toBeGreaterThanOrEqual(previous.density);
        expect(dials.volatility).toBeGreaterThanOrEqual(previous.volatility);
        expect(dials.yield).toBeGreaterThanOrEqual(previous.yield);
        previous = dials;
      }
    }
  });

  it("never assigns a resource to a cell that is not solid", () => {
    const world = generateWorld("bounceworld-01");
    for (let y = 0; y < WORLD_ROWS; y++) {
      for (let x = 0; x < WORLD_COLS; x++) {
        const cell = world.cells[y][x];
        if (!cell.solid) expect(cell.resource).toBeNull();
      }
    }
  });

  it("keeps reagents bound to their source material", () => {
    const world = generateWorld("bounceworld-01");
    const allowed: Record<string, string[]> = {
      coal: ["coalSeam"],
      sapphire: ["facet", "chargedFacet"],
      emerald: ["facet", "chargedFacet"],
      ruby: ["facet", "chargedFacet"],
      diamond: ["mirrorSlate"],
      sulfur: ["living", "sporeBulb"],
      saltpeter: ["chalkroot"],
      vitriol: ["bloomcrystal"],
    };
    for (let y = 0; y < WORLD_ROWS; y++) {
      for (let x = 0; x < WORLD_COLS; x++) {
        const cell = world.cells[y][x];
        const permitted = cell.resource ? allowed[cell.resource] : undefined;
        if (permitted) expect(permitted).toContain(cell.kind);
      }
    }
  });

  it("marks every structural landmark persistent and non-liable", () => {
    const world = generateWorld("bounceworld-01");
    for (const site of CORNERSTONES) {
      let found = 0;
      for (let y = site.y - 6; y <= site.y + 6; y++) {
        for (let x = site.x - 8; x <= site.x + 8; x++) {
          const cell = world.cells[y]?.[x];
          if (cell?.kind === "mechanism") {
            found++;
            expect(cell.persistent).toBe(true);
            expect(materialOf(cell.kind).liable).toBe(false);
          }
        }
      }
      expect(found).toBeGreaterThan(0);
    }
  });

  it("puts the Banked Face's slate on non-liable, iron-bearing stone", () => {
    const world = generateWorld("bounceworld-01");
    let slate = 0;
    for (let y = 12; y <= 26; y++) {
      for (let x = 26; x <= 38; x++) {
        const cell = world.cells[y][x];
        // Carved-out cells keep their material kind but hold nothing.
        if (cell.kind !== "slate" || !cell.solid) continue;
        slate++;
        expect(materialOf("slate").liable).toBe(false);
        expect(materialOf("slate").hp).toBe(4);
        expect(cell.resource).toBe("iron");
      }
    }
    expect(slate).toBeGreaterThan(8);
  });

  it("exposes required nodes and cornerstone sites for navigation", () => {
    const world = generateWorld("bounceworld-01");
    expect(REQUIRED_NODES.length).toBeGreaterThanOrEqual(6);
    expect(world.cornerstones).toHaveLength(3);
    expect(bandAt(world.start.y)).toBe(1);
    expect(LANDING_FEATURES.map((feature) => feature.id)).toContain("bankedFace");
  });
});

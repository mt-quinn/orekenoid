import { describe, expect, it } from "vitest";
import { WORLD_COLS, WORLD_ROWS } from "../src/config";
import { materialOf } from "../src/materials";
import { generateWorld } from "../src/worldgen/generate";
import { LANDING_FEATURES, CORNERSTONES } from "../src/worldgen/landmarks";
import { ROOM_GLYPHS, ROOM_TEMPLATES } from "../src/worldgen/roomLibrary.generated";
import { ROOM_VARIANTS, VARIANT_BY_NAME, substitutionFor } from "../src/worldgen/roomVariants";
import { canHost } from "../src/worldgen/assign";
import { bandAt } from "../src/worldgen/regions";
import { StructureMap } from "../src/worldgen/structureMap";

const SEEDS = ["bounceworld-01", "seed-two", "seed-three"];

describe("structure reservation", () => {
  it("refuses an overlapping rectangle", () => {
    const map = new StructureMap();
    map.reserve({ x: 10, y: 10, width: 8, height: 6 });
    expect(map.canPlace({ x: 17, y: 15, width: 4, height: 4 })).toBe(false);
    expect(map.canPlace({ x: 20, y: 10, width: 4, height: 4 })).toBe(true);
  });

  it("honours padding, which is what keeps neighbours legible as separate places", () => {
    const map = new StructureMap();
    map.reserve({ x: 10, y: 10, width: 8, height: 6 });
    // Two cells clear: fine unpadded, refused once a four-cell berth is demanded.
    expect(map.canPlace({ x: 20, y: 10, width: 4, height: 4 })).toBe(true);
    expect(map.canPlace({ x: 20, y: 10, width: 4, height: 4 }, 4)).toBe(false);
  });
});

describe("room library", () => {
  it("is non-empty and every glyph resolves", () => {
    expect(ROOM_TEMPLATES.length).toBeGreaterThan(0);
    for (const template of ROOM_TEMPLATES) {
      expect(template.rows).toHaveLength(template.height);
      for (const row of template.rows) {
        expect(row).toHaveLength(template.width);
        for (const glyph of row) expect(ROOM_GLYPHS[glyph]).toBeDefined();
      }
    }
  });

  it("names a real material for every non-marker rock glyph", () => {
    for (const glyph of Object.values(ROOM_GLYPHS)) {
      if (!glyph.kind) continue;
      expect(() => materialOf(glyph.kind!)).not.toThrow();
    }
  });

  it("buries the rewards", () => {
    // A cache or a seam in open air would be free, and free rewards turn prospecting
    // back into collection. The distinction is enforced here rather than trusted.
    expect(ROOM_GLYPHS["1"].markerHost).toBe("rock");
    expect(ROOM_GLYPHS["3"].markerHost).toBe("rock");
    expect(ROOM_GLYPHS["2"].markerHost).toBe("open");
    expect(ROOM_GLYPHS["*"].markerHost).toBe("open");
  });

  it("leaves a transparent margin, so a stamp does not cut a rectangle into rock", () => {
    for (const template of ROOM_TEMPLATES) {
      const corners = [
        template.rows[0][0],
        template.rows[0][template.width - 1],
        template.rows[template.height - 1][0],
        template.rows[template.height - 1][template.width - 1],
      ];
      for (const glyph of corners) {
        expect(ROOM_GLYPHS[glyph].transparent, `${template.name} has an opaque corner`).toBe(true);
      }
    }
  });
});

describe("room variants", () => {
  it("preserves composition through every transform", () => {
    // A transform is only worth having if it is a re-*reading* of the same composition. If a
    // mirror could change how much rock a room paints or where its markers are, it would be
    // a second, worse room rather than another view of a good one.
    const census = (rows: readonly string[]) => {
      const counts = new Map<string, number>();
      for (const row of rows) {
        for (const glyph of row) {
          // Axis glyphs are expected to swap: that is the transform doing its job.
          const key = "/\\%&".includes(glyph) ? "axis" : glyph;
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      }
      return counts;
    };
    for (const variant of ROOM_VARIANTS) {
      const before = census(variant.template.rows);
      const after = census(variant.rows);
      expect([...after.keys()].sort(), variant.name).toEqual([...before.keys()].sort());
      for (const [glyph, count] of before) expect(after.get(glyph), `${variant.name} ${glyph}`).toBe(count);
      expect(variant.width * variant.height).toBe(variant.template.width * variant.template.height);
      expect(variant.rows).toHaveLength(variant.height);
      for (const row of variant.rows) expect(row).toHaveLength(variant.width);
    }
  });

  it("keeps the transparent margin, so a transformed stamp still cuts no rectangle", () => {
    for (const variant of ROOM_VARIANTS) {
      for (const glyph of [
        variant.rows[0][0],
        variant.rows[0][variant.width - 1],
        variant.rows[variant.height - 1][0],
        variant.rows[variant.height - 1][variant.width - 1],
      ]) {
        expect(ROOM_GLYPHS[glyph].transparent, `${variant.name} has an opaque corner`).toBe(true);
      }
    }
  });

  it("reverses a facet's diagonal whenever handedness reverses", () => {
    // A facet's axis is a direction, and both a mirror and a quarter turn map one diagonal
    // onto the other. Leaving the glyph alone would give a mirrored lattice reflections that
    // contradict its own drawn geometry -- the one bug in this pass that would be invisible
    // in a screenshot and obvious in play.
    let checked = 0;
    for (const variant of ROOM_VARIANTS) {
      if (variant.transform === "as-drawn" || variant.transform === "turned-mirrored") continue;
      for (let y = 0; y < variant.height; y++) {
        for (let x = 0; x < variant.width; x++) {
          const axis = ROOM_GLYPHS[variant.rows[y][x]].axis;
          if (axis === null) continue;
          const source = variant.transform === "mirrored"
            ? variant.template.rows[y][variant.width - 1 - x]
            : variant.template.rows[variant.width - 1 - x][y];
          expect(ROOM_GLYPHS[source].axis, `${variant.name} at ${x},${y}`).toBe(-axis as 1 | -1);
          checked++;
        }
      }
    }
    expect(checked, "no axis-pinned facet was transformed at all").toBeGreaterThan(20);
  });

  it("refuses a substitution that would flatten a composition", () => {
    // The Rootwarren is the only province that uses different materials for its hard rock
    // and its rule -- heartwood and living block. Karst uses slate for both. So a Rootwarren
    // room built from both has two distinct structural ideas in it that Karst cannot tell
    // apart, and rebuilding it there would merge the cells and the growth filling them into
    // one slab. Refusing is the whole reason this check exists rather than a blanket remap.
    const pruning = ROOM_TEMPLATES.find((entry) => entry.name === "rootwarren-pruning-cells")!;
    expect(substitutionFor(pruning, "karst", null)).toBeNull();
    expect(substitutionFor(pruning, "rootwarren", null)).not.toBeNull();

    // A Karst room uses three roles that stay distinct everywhere, so it travels.
    const stope = ROOM_TEMPLATES.find((entry) => entry.name === "karst-stope")!;
    for (const province of ["karst", "mirrorreef", "rootwarren"] as const) {
      const substitute = substitutionFor(stope, province, null);
      expect(substitute, `karst-stope should rebuild in ${province}`).not.toBeNull();
      const mapped = new Set(["chalk", "slate", "coalSeam"].map((kind) => substitute!(kind as never)));
      expect(mapped.size, `${province} flattened the stope`).toBe(3);
      for (const kind of mapped) expect(() => materialOf(kind)).not.toThrow();
    }
  });

  it("never lets a room tagged -fixed leave its province, or an ecotone room leave its ecotone", () => {
    for (const template of ROOM_TEMPLATES) {
      if (template.fixed) {
        for (const province of ["karst", "mirrorreef", "rootwarren"] as const) {
          if (province === template.region) continue;
          expect(substitutionFor(template, province, null), template.name).toBeNull();
        }
      }
      if (["brightFault", "chalkWarren", "bloomShelf"].includes(template.region)) {
        for (const province of ["karst", "mirrorreef", "rootwarren"] as const) {
          expect(substitutionFor(template, province, null), template.name).toBeNull();
          expect(substitutionFor(template, province, template.region as never), template.name).not.toBeNull();
        }
      }
    }
  });

  it("turns 42 authored rooms into a pool deep enough for a much bigger world", () => {
    // The point of this pass. Before it, a Karst site chose between 15 templates, which is
    // why the library rather than the world was the constraint on variety.
    expect(ROOM_VARIANTS.length).toBeGreaterThan(ROOM_TEMPLATES.length * 2);
    for (const province of ["karst", "mirrorreef", "rootwarren"] as const) {
      const usable = ROOM_VARIANTS.filter((variant) => substitutionFor(variant.template, province, null));
      expect(usable.length, province).toBeGreaterThan(40);
    }
  });
});

describe("room stamping", () => {
  it("places rooms of every tier on every seed", () => {
    for (const seed of SEEDS) {
      const { rooms } = generateWorld(seed);
      expect(rooms.placed.length, seed).toBeGreaterThan(8);
      // A tier that never places is a starved library, and it must not fail silently.
      for (const tier of ["feature", "chamber", "hall"] as const) {
        expect(rooms.attempts[tier].placed, `${seed} ${tier}`).toBeGreaterThan(0);
      }
    }
  });

  it("never places two rooms on top of each other", () => {
    for (const seed of SEEDS) {
      const { rooms } = generateWorld(seed);
      for (let a = 0; a < rooms.placed.length; a++) {
        for (let b = a + 1; b < rooms.placed.length; b++) {
          const one = rooms.placed[a].rect;
          const two = rooms.placed[b].rect;
          const overlaps = one.x < two.x + two.width && one.x + one.width > two.x
            && one.y < two.y + two.height && one.y + one.height > two.y;
          expect(overlaps, `${rooms.placed[a].name} overlaps ${rooms.placed[b].name}`).toBe(false);
        }
      }
    }
  });

  it("never lands on authored territory", () => {
    for (const seed of SEEDS) {
      const { rooms } = generateWorld(seed);
      for (const site of [...LANDING_FEATURES, ...CORNERSTONES]) {
        for (const placed of rooms.placed) {
          const inside = site.x >= placed.rect.x && site.x < placed.rect.x + placed.rect.width
            && site.y >= placed.rect.y && site.y < placed.rect.y + placed.rect.height;
          expect(inside, `${placed.name} covers ${site.id}`).toBe(false);
        }
      }
    }
  });

  it("keeps the world fully reachable and the Landing intact", () => {
    // Rooms paint rock into caverns, which can pinch a route shut. The repair passes
    // must still leave one connected world -- and must not do it by carving through a
    // guaranteed teaching feature, which is why authored ground is stamped again last.
    for (const seed of SEEDS) {
      const { report } = generateWorld(seed);
      expect(report.strandedCells / report.openCells, seed).toBeLessThan(0.005);
      expect(report.missingLandingFeatures, seed).toEqual([]);
      expect(report.unreachableRequiredNodes, seed).toEqual([]);
    }
  });

  it("gives the world an order of magnitude more to find than before", () => {
    // Before this pass the whole world held 11 points of interest: 3 cornerstones and
    // 8 Landing features. That is the number this exists to change.
    for (const seed of SEEDS) {
      const { rooms } = generateWorld(seed);
      expect(rooms.features.length, seed).toBeGreaterThan(25);
    }
  });

  it("makes every seam a valid material-and-resource pair", () => {
    // A room repaints the geology it covers, so it must repaint the contents too --
    // a resource inherited onto a material that cannot host it breaks the economy.
    // Checked against `canHost`, the generator's own law, rather than against a table
    // repeated here. The table this replaced described what rooms happened to do at the
    // time -- host rock always carried copper -- so it failed the moment rooms started
    // taking their ore from the same rule the surrounding geology uses.
    for (const seed of SEEDS) {
      const world = generateWorld(seed);
      for (const feature of world.rooms.features) {
        if (feature.marker !== "seam" && feature.marker !== "cache") continue;
        const cell = world.cells[feature.y][feature.x];
        expect(cell.solid, `${feature.marker} at ${feature.x},${feature.y} must be buried`).toBe(true);
        expect(cell.resource).not.toBeNull();
        expect(canHost(cell.kind, cell.resource!), `${cell.resource} cannot ride in ${cell.kind}`).toBe(true);
      }
    }
  });

  it("keeps every feature inside the world", () => {
    for (const seed of SEEDS) {
      const { rooms } = generateWorld(seed);
      for (const feature of rooms.features) {
        expect(feature.x).toBeGreaterThanOrEqual(0);
        expect(feature.y).toBeGreaterThanOrEqual(0);
        expect(feature.x).toBeLessThan(WORLD_COLS);
        expect(feature.y).toBeLessThan(WORLD_ROWS);
      }
    }
  });

  it("pins an authored facet's reflecting diagonal", () => {
    // A facet's axis *is* the Mirrorreef rule, and it normally comes from a world-wide
    // noise field -- fine for scattered crystal, useless for an authored lattice wall,
    // which would have mixed axes and mean nothing. Where the art states the axis, the
    // stamped cell must carry it.
    let checked = 0;
    for (const seed of SEEDS) {
      const world = generateWorld(seed);
      for (const placed of world.rooms.placed) {
        // The *variant* rows, not the template's: a mirrored or turned room has the other
        // diagonal, and checking the drawing would assert the opposite of what was stamped.
        const variant = VARIANT_BY_NAME.get(placed.variant)!;
        const cell0 = world.cells[placed.rect.y][placed.rect.x];
        const substitute = substitutionFor(variant.template, placed.province, cell0.ecotone)!;
        for (let ry = 0; ry < variant.height; ry++) {
          for (let rx = 0; rx < variant.width; rx++) {
            const glyph = ROOM_GLYPHS[variant.rows[ry][rx]];
            if (glyph.axis === null) continue;
            const cell = world.cells[placed.rect.y + ry][placed.rect.x + rx];
            // Repair passes may have opened a cell after the stamp; only assert on cells
            // that still hold the material the art asked for, after substitution.
            if (!cell.solid || cell.kind !== substitute(glyph.kind!)) continue;
            expect(cell.facetAxis, `${placed.variant} at ${rx},${ry}`).toBe(glyph.axis);
            checked++;
          }
        }
      }
    }
    expect(checked, "no axis-pinned facets were placed at all").toBeGreaterThan(20);
  });

  it("resolves every random slot into a real feature", () => {
    // `?` records nothing playable on its own. If one survives to the world it is a marker
    // that placed a carved cell and no content -- invisible, uninteractable, and counted in
    // the feature total as though it were a reason to travel.
    for (const seed of SEEDS) {
      const { rooms } = generateWorld(seed);
      for (const feature of rooms.features) {
        expect(feature.marker as string, `${feature.room} left a random slot unresolved`).not.toBe("random");
      }
    }
  });

  it("spreads repeats rather than clustering them", () => {
    // Uniform picking let one template land twelve times while others landed once. Choosing
    // the least-used candidate does more for perceived variety than a dozen more rooms, and
    // this is the number that says whether the world reads as varied or as wallpaper.
    for (const seed of SEEDS) {
      const { rooms } = generateWorld(seed);
      const counts = new Map<string, number>();
      for (const placed of rooms.placed) counts.set(placed.name, (counts.get(placed.name) ?? 0) + 1);
      const most = Math.max(...counts.values());
      expect(most, `${seed}: one room placed ${most} times`).toBeLessThanOrEqual(6);
      // And a decent share of the library should actually be in use.
      expect(counts.size, seed).toBeGreaterThan(ROOM_TEMPLATES.length * 0.6);
    }
  });

  it("keeps ecotone rooms inside their own ecotone", () => {
    // These are the sole source of diamond, saltpeter and vitriol. One appearing in pure
    // Karst would hand out a reagent the economy expects to gate a journey behind.
    const ecotones = ["brightFault", "chalkWarren", "bloomShelf"];
    for (const seed of SEEDS) {
      const world = generateWorld(seed);
      for (const placed of world.rooms.placed) {
        const template = ROOM_TEMPLATES.find((entry) => entry.name === placed.name)!;
        if (!ecotones.includes(template.region)) continue;
        const cell = world.cells[placed.rect.y][placed.rect.x];
        expect(cell.ecotone, `${placed.name} placed outside its ecotone`).toBe(template.region);
      }
    }
  });

  it("delivers ecotone reagent rooms at all", () => {
    // Ecotone ground is only ~33% solid against 57% worldwide, so an 18x9 chamber footprint
    // found enough rock about three times in a hundred and the reagent rooms placed 1, 0 and
    // 0 across three seeds. Feature-tier ecotone rooms are what actually deliver them.
    let placedSomewhere = 0;
    for (const seed of [...SEEDS, "expedition-alpha"]) {
      const world = generateWorld(seed);
      const found = world.rooms.placed.some((placed) => {
        const template = ROOM_TEMPLATES.find((entry) => entry.name === placed.name)!;
        return ["brightFault", "chalkWarren", "bloomShelf"].includes(template.region);
      });
      if (found) placedSomewhere++;
    }
    expect(placedSomewhere, "no seed placed any ecotone room").toBe(4);
  });

  it("honours depth gating, so a depth has rooms that belong to it", () => {
    // Gating is what makes descending read as progression rather than as more of the same.
    // Asserted on the anchor row, which is what placement filtered on.
    for (const seed of SEEDS) {
      const { rooms } = generateWorld(seed);
      for (const placed of rooms.placed) {
        const template = ROOM_TEMPLATES.find((entry) => entry.name === placed.name)!;
        if (template.bands.length === 4) continue;
        expect(template.bands, `${placed.name} at band ${bandAt(placed.rect.y)}`)
          .toContain(bandAt(placed.rect.y));
      }
    }
  });

  it("actually uses the multipliers, rather than shipping them idle", () => {
    // Each of these was worth building only if it reaches the player. A pass that compiles
    // and then never fires is the most expensive kind of dead code, because it looks done.
    for (const seed of SEEDS) {
      const { rooms } = generateWorld(seed);
      const transformed = rooms.placed.filter((placed) => placed.variant !== placed.name);
      const substituted = rooms.placed.filter((placed) => {
        const template = ROOM_TEMPLATES.find((entry) => entry.name === placed.name)!;
        return template.region !== "any" && template.region !== placed.province;
      });
      expect(transformed.length, `${seed}: no room was mirrored or turned`).toBeGreaterThan(5);
      expect(substituted.length, `${seed}: no room was rebuilt in another vocabulary`).toBeGreaterThan(5);
      // Distinct *readings* is the number the player experiences as variety.
      const readings = new Set(rooms.placed.map((placed) => placed.variant));
      expect(readings.size, seed).toBeGreaterThan(ROOM_TEMPLATES.length * 0.85);
    }
  });

  it("is deterministic for a seed", () => {
    const a = generateWorld("bounceworld-01").rooms;
    const b = generateWorld("bounceworld-01").rooms;
    expect(b.placed).toEqual(a.placed);
    expect(b.features).toEqual(a.features);
  });
});

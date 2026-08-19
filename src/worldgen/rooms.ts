// Room stamping: the generator's fourth scale.
//
// Provinces, ecotones and cornerstones gave the world regional identity but nothing
// at the scale of a single screen, so every patch of Karst played like every other
// patch of Karst. This pass fixes that the way both reference games do — by stamping
// authored chunks into procedural terrain.
//
// It deliberately does *not* replace the cave carve. The carve guarantees that every
// cavern is reachable, and that guarantee is tested; rooms are placed into it and the
// existing repair passes run afterwards, so a room can never orphan part of the world.
//
// Art lives in `rooms/` as PNGs and reaches here through `roomLibrary.generated.ts`.

import { WORLD_COLS, WORLD_ROWS, type EcotoneId, type MaterialKind, type ProvinceId, type ResourceId } from "../config";
import { materialOf } from "../materials";
import type { Cell } from "../types";
import { ROOM_GLYPHS, type RoomMarker, type RoomTier } from "./roomLibrary.generated";
import { ROOM_VARIANTS, substitutionFor, type RoomVariant, type Substitution } from "./roomVariants";
import { canHost, resourceFor } from "./assign";
import { bandAt, type RegionSample } from "./regions";
import type { Rng } from "./rng";
import { StructureMap, type Rect } from "./structureMap";

/** A marker resolved into a place in the world. */
export interface FeatureSite {
  /** Never `random`: a `?` slot is resolved to a real marker before it is recorded. */
  marker: Exclude<RoomMarker, "random">;
  x: number;
  y: number;
  /** Which room put it here, so the discovery layer can reason about context. */
  room: string;
}

export interface PlacedRoom {
  /** The authored room, without its transform. Repeat budgets and tests count these. */
  name: string;
  /** The exact reading that was stamped, including mirror or quarter turn. */
  variant: string;
  /**
   * The province whose material vocabulary this placement was built in.
   *
   * Recorded rather than re-derived: it is the only way to know afterwards what a
   * substituted room actually painted, and the axis-coherence check needs it.
   */
  province: ProvinceId;
  tier: RoomTier;
  rect: Rect;
}

export interface RoomStampReport {
  placed: PlacedRoom[];
  features: FeatureSite[];
  /** Per-tier attempts and successes, so a starved library is visible not silent. */
  attempts: Record<RoomTier, { target: number; placed: number }>;
  /**
   * What happened to each ecotone's guaranteed room. Reported rather than inferred: an
   * ecotone quietly ending up with no authored room is exactly the kind of failure that
   * looks like "the world just came out that way".
   */
  ecotoneGuarantee: Partial<Record<EcotoneId, "placed" | "no-site">>;
}

/**
 * Host rock per province: what `#` becomes, and what a buried marker sits in.
 *
 * Chosen as each province's plain one-hit rock rather than its rule-bearing material,
 * so a room's *authored* materials stay the thing that carries the rule.
 */
const HOST_ROCK: Record<ProvinceId, MaterialKind> = {
  karst: "chalk",
  mirrorreef: "reef",
  rootwarren: "sapwood",
};

/**
 * Ecotone hybrids override the host, because in an ecotone the hybrid *is* the local rock.
 * A room stamped on the Bright Fault built from plain Karst chalk would read as a hole
 * punched through the ecotone rather than as part of it.
 */
const ECOTONE_HOST: Record<EcotoneId, MaterialKind> = {
  brightFault: "mirrorSlate",
  chalkWarren: "chalkroot",
  bloomShelf: "bloomcrystal",
};

/**
 * What a rich seam is made of, per province.
 *
 * Deliberately the province's own rule-bearing rock carrying its own natural ore, not
 * a generic ore pocket. In Karst that means the seam *is* a slate bank -- so finding
 * one hands the player the province's central decision at its sharpest, rather than
 * just handing them iron. It also keeps the reagent-to-material binding intact, which
 * the generator contract enforces.
 */
const SEAM: Record<ProvinceId, { kind: MaterialKind; resource: ResourceId }> = {
  karst: { kind: "slate", resource: "iron" },
  mirrorreef: { kind: "facet", resource: "sapphire" },
  rootwarren: { kind: "living", resource: "sulfur" },
};

/**
 * Ecotone seams carry the reagents nothing else in the world produces.
 *
 * This is what makes an ecotone worth travelling to rather than merely different: diamond,
 * saltpeter and vitriol gate chassis fabrication, and each exists in exactly one ecotone.
 * The material is the hybrid that hosts it, so the pair stays valid.
 */
const ECOTONE_SEAM: Record<EcotoneId, { kind: MaterialKind; resource: ResourceId }> = {
  brightFault: { kind: "mirrorSlate", resource: "diamond" },
  chalkWarren: { kind: "chalkroot", resource: "saltpeter" },
  bloomShelf: { kind: "bloomcrystal", resource: "vitriol" },
};

/** The local rock for a cell, hybrid if it is in an ecotone. */
const hostFor = (cell: Cell): MaterialKind =>
  cell.ecotone ? ECOTONE_HOST[cell.ecotone] : HOST_ROCK[cell.province];

/** The local seam for a cell, reagent-bearing if it is in an ecotone. */
const seamFor = (cell: Cell): { kind: MaterialKind; resource: ResourceId } =>
  cell.ecotone ? ECOTONE_SEAM[cell.ecotone] : SEAM[cell.province];

/** Radius of the pocket a seam marker seeds. One cell of ore is not worth a journey. */
const SEAM_RADIUS = 1;

/**
 * Where each marker's feature lives, mirroring the palette.
 *
 * Needed separately because a `?` slot resolves to a marker at stamp time, after the
 * glyph that carried the host has been left behind.
 */
const MARKER_HOST: Record<Exclude<RoomMarker, "random">, "rock" | "open"> = {
  cache: "rock",
  seam: "rock",
  anomaly: "open",
  survey: "open",
  procedure: "open",
  decor: "open",
  bounder: "open",
};

/**
 * What a `?` slot becomes.
 *
 * Weighted so the common case is texture and the rare case is a reason to travel. This
 * is what lets one authored room deliver different contents on different visits -- the
 * cheapest variety in the whole pipeline, because it costs no new art.
 */
const RANDOM_MARKERS: Array<{ marker: Exclude<RoomMarker, "random">; weight: number }> = [
  { marker: "decor", weight: 50 },
  { marker: "survey", weight: 18 },
  { marker: "cache", weight: 14 },
  { marker: "anomaly", weight: 10 },
  { marker: "seam", weight: 8 },
  // Weighted like a seam: a reason to travel, and roughly as often as one. Rooms are the mine's
  // furniture, so putting encounters in them is what makes the caverns feel occupied without a spawner
  // trickling strangers in behind the player.
  { marker: "bounder", weight: 16 },
];

function resolveRandomMarker(rng: Rng): Exclude<RoomMarker, "random"> {
  const total = RANDOM_MARKERS.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = rng.range(0, total);
  for (const entry of RANDOM_MARKERS) {
    roll -= entry.weight;
    if (roll <= 0) return entry.marker;
  }
  return "decor";
}

/**
 * How many of each tier to aim for, per thousand world cells.
 *
 * Densities rather than counts, following Terraria, so the numbers survive the world
 * being resized. Calibrated against Noita's measured ~2.3 structure hooks per screen:
 * one screen here is ~522 cells, so ~4.4 rooms per thousand cells in total.
 */
const TIER_DENSITY: Record<RoomTier, number> = {
  feature: 2.6,
  chamber: 1.5,
  hall: 0.3,
};

/** Clearance demanded around each tier, so neighbours read as separate places. */
const TIER_PADDING: Record<RoomTier, number> = {
  feature: 3,
  chamber: 4,
  hall: 6,
};

const TIERS: RoomTier[] = ["hall", "chamber", "feature"];

/**
 * Would this footprint make a sensible room site?
 *
 * Two conditions, both borrowed from Terraria's own placement checks. The footprint
 * must be *mostly solid*, because a room carves its own cavity and stamping one into
 * an existing cavern wastes it. And it must *touch* open space, because a room the
 * player cannot enter is not content. Terraria's `CampsiteBiome` does the same pair
 * of tests before it places anything.
 */
function siteIsSuitable(cells: Cell[][], rect: Rect): boolean {
  let solid = 0;
  let total = 0;
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      const cell = cells[y]?.[x];
      if (!cell) return false;
      // Authored structure is never overwritten, wherever it came from.
      if (cell.persistent) return false;
      total++;
      if (cell.solid) solid++;
    }
  }
  if (total === 0 || solid / total < 0.72) return false;

  // Reachability: at least one open cell in the ring just outside the footprint.
  for (let x = rect.x - 1; x <= rect.x + rect.width; x++) {
    if (cells[rect.y - 1]?.[x]?.solid === false) return true;
    if (cells[rect.y + rect.height]?.[x]?.solid === false) return true;
  }
  for (let y = rect.y - 1; y <= rect.y + rect.height; y++) {
    if (cells[y]?.[rect.x - 1]?.solid === false) return true;
    if (cells[y]?.[rect.x + rect.width]?.solid === false) return true;
  }
  return false;
}

/** A variant a site will accept, together with how its materials resolve there. */
interface Candidate {
  variant: RoomVariant;
  substitute: Substitution;
}

/**
 * Everything a site will accept: the right depth band, and a material vocabulary the room
 * can actually be rebuilt in.
 *
 * Both filters are what turn 42 authored rooms into a usable pool. Substitution roughly
 * doubles what any one province can draw on -- a Mirrorreef funnel is a funnel in Karst
 * slate too -- while `substitutionFor` still refuses the cases that would flatten a
 * composition or leak a reagent out of its ecotone. Band gating then takes some of that
 * pool away again on purpose, so a depth has rooms that belong to it.
 *
 * Memoized per site kind: rejection sampling asks this thousands of times per generate and
 * there are only a few dozen distinct answers.
 */
const candidateCache = new Map<string, Candidate[]>();

function candidatesFor(province: ProvinceId, ecotone: EcotoneId | null, band: number, tier: RoomTier): Candidate[] {
  const key = `${province}|${ecotone ?? ""}|${band}|${tier}`;
  const held = candidateCache.get(key);
  if (held) return held;
  const pool: Candidate[] = [];
  for (const variant of ROOM_VARIANTS) {
    if (variant.tier !== tier) continue;
    if (!variant.bands.includes(band)) continue;
    const substitute = substitutionFor(variant.template, province, ecotone);
    if (substitute) pool.push({ variant, substitute });
  }
  candidateCache.set(key, pool);
  return pool;
}

/**
 * Write a material into a cell.
 *
 * `resource` is always assigned, including when it is null. Leaving an inherited
 * resource in place would break the generator's reagent-to-material binding: a cell
 * that the field pass gave saltpeter, restamped as slate by a room, would be
 * saltpeter-bearing slate, which no recipe or material rule expects. A room replaces
 * the geology it covers, so it replaces the contents too.
 *
 * What it replaces it *with* comes from `resourceFor` -- the same function the field
 * pass uses -- so a room's rock carries ore at the rate its surroundings do. Assigning
 * null instead, which is what this did first, quietly made every room a barren patch:
 * with rooms covering a growing share of the world it was eroding the shallow economy,
 * and Band I copper had already fallen to within one cell of the affordability contract.
 * The bug was not the threshold. It was that a stamped room had no reason to be barren.
 */
function paint(cell: Cell, kind: MaterialKind, resource: ResourceId | null, axis: 1 | -1 | null = null): void {
  const definition = materialOf(kind);
  cell.kind = kind;
  cell.solid = true;
  cell.baseSolid = true;
  cell.hp = definition.hp;
  cell.maxHp = definition.hp;
  cell.persistent = definition.persistent;
  cell.resource = resource;
  cell.exhausted = false;
  // A facet's reflecting diagonal is its rule. Where the art pins the axis, the room
  // gets a coherent lattice; where it does not, the cell keeps the world's own.
  if (axis !== null) cell.facetAxis = axis;
}

function carve(cell: Cell): void {
  cell.solid = false;
  cell.baseSolid = false;
  cell.resource = null;
  cell.hidden = false;
}

/**
 * Stamp one template. Transparent cells are skipped entirely, which is what lets a
 * room's corners stay geological instead of cutting a visible rectangle into rock.
 */
function stamp(
  cells: Cell[][],
  variant: RoomVariant,
  at: Rect,
  features: FeatureSite[],
  rng: Rng,
  substitute: Substitution,
  oreFor: (kind: MaterialKind, x: number, y: number) => ResourceId | null,
): void {
  for (let ry = 0; ry < variant.height; ry++) {
    const row = variant.rows[ry];
    for (let rx = 0; rx < variant.width; rx++) {
      const glyph = ROOM_GLYPHS[row[rx]];
      if (!glyph || glyph.transparent) continue;
      const cell = cells[at.y + ry]?.[at.x + rx];
      if (!cell) continue;

      if (glyph.marker) {
        // A `?` slot picks a real marker here, so identical geometry delivers different
        // contents from world to world.
        const marker = glyph.marker === "random" ? resolveRandomMarker(rng) : glyph.marker;
        const host = MARKER_HOST[marker];
        if (host === "rock") {
          if (marker === "seam") {
            // A pocket, not a pixel. Material and resource are painted together so
            // the pair is always valid.
            const seam = seamFor(cell);
            for (let oy = -SEAM_RADIUS; oy <= SEAM_RADIUS; oy++) {
              for (let ox = -SEAM_RADIUS; ox <= SEAM_RADIUS; ox++) {
                const near = cells[at.y + ry + oy]?.[at.x + rx + ox];
                if (!near || near.persistent || !near.solid) continue;
                paint(near, seam.kind, seam.resource);
              }
            }
            // The marker cell itself always becomes seam, even if it began open.
            paint(cell, seam.kind, seam.resource);
          } else {
            // A cache is an authored, guaranteed return, so it always pays something --
            // but it pays whatever the depth would pay, falling back only where the field
            // would have left the rock empty. The fallback has to respect the economy's
            // first law: copper is an ore inclusion and cannot ride in an ecotone hybrid,
            // so a cache found in the Bloom Shelf pays vitriol instead.
            const host = hostFor(cell);
            const fallback = canHost(host, "copper") ? "copper" : seamFor(cell).resource;
            paint(cell, host, oreFor(host, at.x + rx, at.y + ry) ?? fallback);
          }
        } else {
          carve(cell);
        }
        features.push({ marker, x: at.x + rx, y: at.y + ry, room: variant.family });
        continue;
      }

      if (glyph.open) {
        carve(cell);
        continue;
      }
      const kind = glyph.host ? hostFor(cell) : substitute(glyph.kind!);
      paint(cell, kind, oreFor(kind, at.x + rx, at.y + ry), glyph.axis);
    }
  }
}

/**
 * Place rooms across the world.
 *
 * Halls first, then chambers, then features: the biggest thing needs the most room to
 * fit, and letting small features claim sites first would starve the tier that
 * actually makes a place memorable.
 */
export function stampRooms(
  cells: Cell[][],
  seed: number,
  samples: RegionSample[][],
  rng: Rng,
  structures: StructureMap,
  regionAt: (x: number, y: number) => { province: ProvinceId; ecotone: EcotoneId | null },
): RoomStampReport {
  /** What the world's own assignment rule would put in this material, here. */
  const oreFor = (kind: MaterialKind, x: number, y: number): ResourceId | null =>
    resourceFor(seed, x, y, samples[y][x], kind);

  const report: RoomStampReport = {
    placed: [],
    features: [],
    attempts: { feature: { target: 0, placed: 0 }, chamber: { target: 0, placed: 0 }, hall: { target: 0, placed: 0 } },
    ecotoneGuarantee: {},
  };
  const thousands = (WORLD_COLS * WORLD_ROWS) / 1000;

  // Every ecotone cell, gathered once.
  //
  // Ecotones are field overlaps and cover only a few per cent of the world, so uniform
  // rejection sampling almost never landed on one: across three seeds the ecotone rooms
  // placed 1, 0 and 0 times, which meant diamond, saltpeter and vitriol -- the three
  // reagents that gate chassis fabrication and exist nowhere else -- were never delivered
  // by a room at all. A share of attempts therefore draws from this list instead.
  const ecotoneSites: Array<{ x: number; y: number; ecotone: EcotoneId }> = [];
  for (let y = 3; y < WORLD_ROWS - 3; y++) {
    for (let x = 3; x < WORLD_COLS - 3; x++) {
      const ecotone = cells[y][x].ecotone;
      if (ecotone) ecotoneSites.push({ x, y, ecotone });
    }
  }

  /** Placements so far, per template, so repeats can be spread rather than clustered. */
  const used = new Map<string, number>();

  // Ecotone rooms are placed *before* everything else.
  //
  // Running this afterwards failed on one seed in four, and instrumenting it showed why:
  // 94% of ecotone sites were already reserved, because the general pass had built out the
  // ecotones before the guarantee ever looked. Ground goes to the region-locked,
  // progression-relevant rooms first -- the same order Terraria uses when it places the
  // Dungeon and the Jungle Temple ahead of its general passes.
  guaranteeEcotoneRooms(cells, rng, structures, ecotoneSites, used, regionAt, oreFor, report);

  for (const tier of TIERS) {
    const target = Math.round(TIER_DENSITY[tier] * thousands);
    report.attempts[tier].target = target;
    const padding = TIER_PADDING[tier];
    // A generous attempt budget: rejection sampling against solidity, reachability
    // and reservation fails often, and a starved tier is worse than a slow generate.
    const budget = target * 60;

    for (let attempt = 0; attempt < budget && report.attempts[tier].placed < target; attempt++) {
      // A third of attempts aim at an ecotone. Without this the rare-reagent rooms are
      // effectively unreachable by chance.
      let x: number;
      let y: number;
      if (ecotoneSites.length && rng.chance(0.34)) {
        const site = ecotoneSites[(rng.range(0, ecotoneSites.length) | 0) % ecotoneSites.length];
        x = site.x;
        y = site.y;
      } else {
        x = rng.range(3, WORLD_COLS - 3) | 0;
        y = rng.range(3, WORLD_ROWS - 3) | 0;
      }
      const region = regionAt(x, y);
      const candidates = candidatesFor(region.province, region.ecotone, bandAt(y), tier);
      // `continue`, not `break`: a site with no rooms of this tier is normal -- band gating
      // guarantees it -- and aborting the whole tier on the first such pick was silently
      // placing almost nothing.
      if (!candidates.length) continue;

      // Pick from the least-used *family*, breaking ties randomly. Counting families rather
      // than variants keeps the repeat budget honest: four readings of one composition are
      // still one composition, and letting mirrors dodge the budget would give back exactly
      // the wallpaper the budget exists to prevent.
      let fewest = Infinity;
      for (const candidate of candidates) fewest = Math.min(fewest, used.get(candidate.variant.family) ?? 0);
      const rarest = candidates.filter((candidate) => (used.get(candidate.variant.family) ?? 0) === fewest);
      const { variant, substitute } = rarest[(rng.range(0, rarest.length) | 0) % rarest.length];

      const rect: Rect = { x, y, width: variant.width, height: variant.height };
      if (rect.x + rect.width >= WORLD_COLS - 2 || rect.y + rect.height >= WORLD_ROWS - 2) continue;
      if (!structures.canPlace(rect, padding)) continue;
      if (!siteIsSuitable(cells, rect)) continue;

      stamp(cells, variant, rect, report.features, rng, substitute, oreFor);
      structures.reserve(rect);
      used.set(variant.family, (used.get(variant.family) ?? 0) + 1);
      report.placed.push({ name: variant.family, variant: variant.name, province: region.province, tier, rect });
      report.attempts[tier].placed++;
    }
  }

  return report;
}

/**
 * Make sure every ecotone present in the world holds at least one authored room.
 *
 * Rejection sampling got there most of the time and then did not: one seed in four placed no
 * ecotone room at all. An ecotone with no authored room in it is just differently-coloured
 * terrain, which wastes the one region type the player has a concrete economic reason to seek
 * out -- diamond, saltpeter and vitriol exist nowhere else.
 *
 * So this walks that ecotone's own cells directly, smallest template first because a feature
 * footprint needs a fifth of the contiguous rock a chamber does. A *guarantee* rather than
 * another nudge, in the same spirit as the connectivity repair: the contract says these places
 * matter, so the generator makes them exist instead of hoping.
 */
function guaranteeEcotoneRooms(
  cells: Cell[][],
  rng: Rng,
  structures: StructureMap,
  ecotoneSites: ReadonlyArray<{ x: number; y: number; ecotone: EcotoneId }>,
  used: Map<string, number>,
  regionAt: (x: number, y: number) => { province: ProvinceId; ecotone: EcotoneId | null },
  oreFor: (kind: MaterialKind, x: number, y: number) => ResourceId | null,
  report: RoomStampReport,
): void {
  for (const ecotone of new Set(ecotoneSites.map((site) => site.ecotone))) {
    report.ecotoneGuarantee[ecotone] = "no-site";

    // Smallest footprint first, and ignoring band gating: a reagent that exists in exactly
    // one place must not also be forbidden from most of the depths that place spans.
    const candidates = ROOM_VARIANTS
      .filter((variant) => variant.region === ecotone)
      .sort((a, b) => a.width * a.height - b.width * b.height);
    const sites = rng.shuffle(ecotoneSites.filter((site) => site.ecotone === ecotone));

    outer: for (const variant of candidates) {
      for (const site of sites) {
        const rect: Rect = { x: site.x, y: site.y, width: variant.width, height: variant.height };
        if (rect.x + rect.width >= WORLD_COLS - 2 || rect.y + rect.height >= WORLD_ROWS - 2) continue;
        if (!structures.canPlace(rect, TIER_PADDING[variant.tier])) continue;
        if (!siteIsSuitable(cells, rect)) continue;
        stamp(cells, variant, rect, report.features, rng, (kind) => kind, oreFor);
        structures.reserve(rect);
        report.placed.push({
          name: variant.family,
          variant: variant.name,
          province: regionAt(site.x, site.y).province,
          tier: variant.tier,
          rect,
        });
        report.attempts[variant.tier].placed++;
        used.set(variant.family, (used.get(variant.family) ?? 0) + 1);
        report.ecotoneGuarantee[ecotone] = "placed";
        break outer;
      }
    }
  }
}

export { StructureMap };

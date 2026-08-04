// Material and resource assignment.
//
// Enforces the two laws from PROGRESSION_AND_ECONOMY.md §0:
//   1. Metals come from ore inclusions in host rock, in every province, banded
//      by depth. Reagents come from each province's own rule-material.
//   2. Metals govern durability, gems govern precision, coal fuels everything.
//
// Because reagents are keyed to their source brick, a player who wants coal must
// break coal seams in Karst, and a player who wants diamond has no option but to
// frame the Bright Fault. The map is enforced by the material, not by a table of
// spawn chances.

import type { Band, MaterialKind, ResourceId } from "../config";
import { fbm, sfbm, strata } from "./rng";
import type { RegionSample } from "./regions";
import { dialsFor } from "./regions";

/** Host rock carries metal inclusions. Reagent-bearing material never does. */
const HOST_ROCK: readonly MaterialKind[] = ["chalk", "slate", "reef", "sapwood", "heartwood", "chalkroot"];

const METALS_BY_BAND: Record<Band, ReadonlyArray<[ResourceId, number]>> = {
  1: [["copper", 3], ["iron", 1]],
  2: [["iron", 3], ["cobalt", 1.1], ["copper", 0.9]],
  3: [["mithril", 2.6], ["cobalt", 2], ["iron", 1], ["adamantite", 0.4]],
  4: [["adamantite", 3], ["runite", 1.2], ["mithril", 0.7]],
};

const GEM_BY_BAND: Record<Band, ResourceId> = {
  1: "sapphire",
  2: "emerald",
  3: "ruby",
  4: "ruby",
};

/**
 * Which materials may carry which resource -- law 1 of the economy, as a predicate.
 *
 * A reagent is bound to the rule-material that produces it, so wanting coal means breaking
 * coal seams in Karst and wanting diamond means framing the Bright Fault. A metal is an ore
 * inclusion and rides in any host rock. Stated here rather than reimplemented by each
 * caller, because a resource on a material that cannot host it is invisible in a screenshot
 * and breaks the recipes.
 */
const REAGENT_SOURCE: Partial<Record<ResourceId, readonly MaterialKind[]>> = {
  coal: ["coalSeam"],
  sapphire: ["facet", "chargedFacet"],
  emerald: ["facet", "chargedFacet"],
  ruby: ["facet", "chargedFacet"],
  sulfur: ["living", "sporeBulb"],
  diamond: ["mirrorSlate"],
  saltpeter: ["chalkroot"],
  vitriol: ["bloomcrystal"],
};

export function canHost(kind: MaterialKind, resource: ResourceId): boolean {
  const source = REAGENT_SOURCE[resource];
  return source ? source.includes(kind) : HOST_ROCK.includes(kind);
}

function weightedPick(entries: ReadonlyArray<[ResourceId, number]>, roll: number): ResourceId {
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let cursor = roll * total;
  for (const [id, weight] of entries) {
    cursor -= weight;
    if (cursor <= 0) return id;
  }
  return entries[entries.length - 1][0];
}

/** Coherent lattice orientation, stable across roughly twenty cells. */
export function facetAxisAt(seed: number, x: number, y: number): 1 | -1 {
  return sfbm(seed + 6421, x * 0.048, y * 0.048, 2) >= 0 ? 1 : -1;
}

/**
 * Choose the material for a solid cell.
 *
 * Volatility raises the share of multi-hit and rule-active rock, so deep claims
 * are harder to clear rather than merely bigger.
 */
export function materialFor(seed: number, x: number, y: number, sample: RegionSample): MaterialKind {
  const dials = dialsFor(sample);
  const volatility = dials.volatility;

  // Ecotone hybrids occupy the core of an overlap and thin out toward its edges.
  if (sample.ecotone) {
    const hybridPresence = (sample.blend - 0.62) / 0.38;
    const hybridRoll = fbm(seed + 991, x * 0.16, y * 0.16, 3);
    if (hybridRoll < 0.32 + hybridPresence * 0.42) {
      if (sample.ecotone === "brightFault") return "mirrorSlate";
      if (sample.ecotone === "chalkWarren") return "chalkroot";
      return "bloomcrystal";
    }
  }

  if (sample.primary === "karst") {
    // Long slate strata that visibly continue behind rock, per the province rule.
    if (strata(seed + 101, x, y, 0.42, 9.5) > 0.86 - volatility * 0.18) return "slate";
    if (strata(seed + 202, x, y, 0.36, 15.5, 2.1) > 0.93) return "coalSeam";
    return "chalk";
  }

  if (sample.primary === "mirrorreef") {
    const lattice = fbm(seed + 303, x * 0.13, y * 0.13, 3);
    if (lattice > 0.72 - volatility * 0.2) {
      return fbm(seed + 404, x * 0.31, y * 0.31, 2) > 0.74 ? "chargedFacet" : "facet";
    }
    return "reef";
  }

  const growth = fbm(seed + 505, x * 0.11, y * 0.11, 3);
  if (growth > 0.78) return "heartwood";
  if (growth > 0.56 - volatility * 0.16) {
    return fbm(seed + 606, x * 0.37, y * 0.37, 2) > 0.86 ? "sporeBulb" : "living";
  }
  return "sapwood";
}

/**
 * Choose the resource a cell drops, or null.
 *
 * Reagents are keyed strictly to their source material; metals appear only in
 * host rock, on an inclusion field independent of the material field so seams
 * and ore bodies do not correlate artificially.
 */
export function resourceFor(
  seed: number,
  x: number,
  y: number,
  sample: RegionSample,
  kind: MaterialKind,
): ResourceId | null {
  // --- Reagents, from each province's own rule-material -------------------
  if (kind === "coalSeam") return "coal";
  if (kind === "facet" || kind === "chargedFacet") {
    return fbm(seed + 717, x * 0.28, y * 0.28, 2) > 0.42 ? GEM_BY_BAND[sample.band] : null;
  }
  if (kind === "living" || kind === "sporeBulb") {
    return sample.band >= 3 && fbm(seed + 818, x * 0.26, y * 0.26, 2) > 0.4 ? "sulfur" : null;
  }
  if (kind === "mirrorSlate") return fbm(seed + 919, x * 0.3, y * 0.3, 2) > 0.34 ? "diamond" : "iron";
  if (kind === "chalkroot") return fbm(seed + 1021, x * 0.3, y * 0.3, 2) > 0.38 ? "saltpeter" : null;
  if (kind === "bloomcrystal") return fbm(seed + 1123, x * 0.3, y * 0.3, 2) > 0.38 ? "vitriol" : null;

  // --- Metals, from ore inclusions in host rock --------------------------
  if (!HOST_ROCK.includes(kind)) return null;

  // Slate is unusually iron-rich, and unconditionally so: breaking slate always
  // pays. That is what makes a slate bank simultaneously the best wall and the
  // best iron available, and forces the player to choose which one they want.
  if (kind === "slate") {
    return fbm(seed + 1331, x * 0.4, y * 0.4, 2) > 0.25 ? "iron" : "copper";
  }

  const dials = dialsFor(sample);
  const inclusion = fbm(seed + 1229, x * 0.2, y * 0.2, 3);
  if (inclusion < 1 - dials.yield) return null;
  const roll = fbm(seed + 1433, x * 0.44 + 11.3, y * 0.44 - 7.1, 2);
  return weightedPick(METALS_BY_BAND[sample.band], roll);
}

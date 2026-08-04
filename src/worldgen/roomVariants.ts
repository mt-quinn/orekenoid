// Multipliers: turning authored art into far more placements than there are files.
//
// Forty-two rooms will not fill a mine. The wrong fix is more procedural jitter, which
// produces variation without composition — a hundred rooms that all feel like noise. The
// right fix is the one both reference games use: take each authored composition and read it
// more than one way.
//
// Four multipliers, in the order of how much they change what the player meets:
//
//   substitution   a shape authored in one province, rebuilt in another's material
//                  vocabulary. The largest multiplier by far, and the only one that changes
//                  how the room *plays* rather than only how it sits.
//   mirroring      every room gets a left-handed and a right-handed reading. Cheap, safe,
//                  and it is the first thing the eye compares across two placements.
//   quarter turns  for the rooms whose composition has no up-down commitment.
//   depth bands    which rooms may appear at which depth, so descending reads as progress.
//
// None of them invent composition. A mirrored colonnade is still a composed colonnade.

import type { EcotoneId, MaterialKind, ProvinceId } from "../config";
import type { RoomTemplate, RoomTier } from "./roomLibrary.generated";
import { ROOM_GLYPHS, ROOM_TEMPLATES } from "./roomLibrary.generated";

// --- material substitution ---------------------------------------------------

/**
 * The role a material plays in a composition, as distinct from which material it is.
 *
 * This is the whole basis of substitution. `karst-slate-shelf` is not really "a shelf made
 * of slate" — it is "a shelf made of the local hard rock, over a pocket of the local soft
 * rock". Stated that way it is buildable in any province, and the shape survives the move
 * even though the *play* changes with it: a slate shelf is free to leave standing, while
 * the heartwood shelf it becomes in the Rootwarren is not. That change is the feature. The
 * same silhouette asks a different question in each province.
 */
export type StructuralRole = "plain" | "structural" | "rule" | "accent";

/** Checked before `rule`, so a province that uses one material for both resolves to it. */
const ROLE_ORDER: readonly StructuralRole[] = ["plain", "structural", "rule", "accent"];

/**
 * Each province's vocabulary.
 *
 * Karst and Mirrorreef each carry their rule in their structural rock — slate is both the
 * hard stone and the non-liable one; facet is both the hard crystal and the reflecting one.
 * The Rootwarren splits them: heartwood is the hard rock and living block is the rule. That
 * asymmetry is why `portableTo` below has to check injectivity rather than assume it.
 */
const VOCABULARY: Record<ProvinceId, Record<StructuralRole, MaterialKind>> = {
  karst: { plain: "chalk", structural: "slate", rule: "slate", accent: "coalSeam" },
  mirrorreef: { plain: "reef", structural: "facet", rule: "facet", accent: "chargedFacet" },
  rootwarren: { plain: "sapwood", structural: "heartwood", rule: "living", accent: "sporeBulb" },
};

/**
 * Materials that mean the same thing everywhere and so pass through untouched.
 *
 * A survey stake is a survey stake in any rock. These also must not block portability:
 * a room is not province-locked merely because somebody left a marker in it.
 */
const INVARIANT: ReadonlySet<MaterialKind> = new Set<MaterialKind>(["lander", "mechanism", "stake"]);

/** Material back to role, per province. Built from `VOCABULARY` so the two cannot diverge. */
const ROLE_OF: Record<ProvinceId, Partial<Record<MaterialKind, StructuralRole>>> = (() => {
  const table = {} as Record<ProvinceId, Partial<Record<MaterialKind, StructuralRole>>>;
  for (const province of Object.keys(VOCABULARY) as ProvinceId[]) {
    table[province] = {};
    for (const role of ROLE_ORDER) {
      const kind = VOCABULARY[province][role];
      table[province][kind] ??= role;
    }
  }
  return table;
})();

const PROVINCES = Object.keys(VOCABULARY) as ProvinceId[];
const isProvince = (region: string): region is ProvinceId => (PROVINCES as string[]).includes(region);

/** A material map. Identity for a room in its own province. */
export type Substitution = (kind: MaterialKind) => MaterialKind;

const IDENTITY: Substitution = (kind) => kind;

/**
 * Every literal material the art names, ignoring host glyphs, markers and open space.
 *
 * Memoized: portability is asked the same question thousands of times during a generate,
 * once per placement attempt per candidate.
 */
const materialsUsed = (() => {
  const cache = new Map<string, MaterialKind[]>();
  return (template: RoomTemplate): MaterialKind[] => {
    const held = cache.get(template.name);
    if (held) return held;
    const kinds = new Set<MaterialKind>();
    for (const row of template.rows) {
      for (const glyph of row) {
        const kind = ROOM_GLYPHS[glyph]?.kind;
        if (kind) kinds.add(kind);
      }
    }
    const list = [...kinds];
    cache.set(template.name, list);
    return list;
  };
})();

/**
 * May this room be rebuilt in this province, and if so how do its materials map?
 *
 * `null` means no, and there are four reasons for no, all of them deliberate:
 *
 *  - an ecotone room outside its ecotone, which would hand out a reagent the economy
 *    expects to gate a journey behind;
 *  - a room tagged `-fixed`, whose design depends on a behaviour that does not transfer
 *    (a cascade chain rebuilt in chalk and coal is a ring of rubble with no reason to be);
 *  - a room using a material outside any province's vocabulary, so there is nothing to map;
 *  - a room whose roles would *collide* in the target. A Rootwarren room using both
 *    heartwood and living block has two distinct structural ideas in it, and Karst has one
 *    material for both — rebuilt there, the cells and the growth filling them would become
 *    the same stone and the composition would flatten into a slab.
 */
export function substitutionFor(
  template: RoomTemplate,
  province: ProvinceId,
  ecotone: EcotoneId | null,
): Substitution | null {
  if (template.region === "any") return IDENTITY;
  if (!isProvince(template.region)) return template.region === ecotone ? IDENTITY : null;
  if (template.region === province) return IDENTITY;
  if (template.fixed) return null;

  const home = template.region;
  const kinds = materialsUsed(template).filter((kind) => !INVARIANT.has(kind));
  const roles: StructuralRole[] = [];
  for (const kind of kinds) {
    const role = ROLE_OF[home][kind];
    if (!role) return null;
    roles.push(role);
  }
  const target = VOCABULARY[province];
  if (new Set(roles.map((role) => target[role])).size !== new Set(roles).size) return null;

  const map = new Map<MaterialKind, MaterialKind>();
  kinds.forEach((kind, index) => map.set(kind, target[roles[index]]));
  return (kind) => (INVARIANT.has(kind) ? kind : map.get(kind) ?? kind);
}

// --- geometric transforms ----------------------------------------------------

/**
 * A facet's reflecting diagonal is a direction, so any transform that reverses handedness
 * has to reverse it too. Both a mirror and a quarter turn map one diagonal onto the other;
 * leaving the glyph alone would give a mirrored lattice wall reflections that contradict
 * its own geometry.
 */
const AXIS_FLIP: Record<string, string> = { "/": "\\", "\\": "/", "%": "&", "&": "%" };
const flip = (glyph: string): string => AXIS_FLIP[glyph] ?? glyph;

const mirrorRows = (rows: readonly string[]): string[] =>
  rows.map((row) => [...row].reverse().map(flip).join(""));

/** A quarter turn clockwise: `out[x][height - 1 - y] = in[y][x]`. */
function quarterRows(rows: readonly string[]): string[] {
  const height = rows.length;
  const width = rows[0].length;
  const out: string[] = [];
  for (let x = 0; x < width; x++) {
    let row = "";
    for (let y = height - 1; y >= 0; y--) row += flip(rows[y][x]);
    out.push(row);
  }
  return out;
}

export type RoomTransform = "as-drawn" | "mirrored" | "turned" | "turned-mirrored";

export interface RoomVariant {
  /** The authored room this reading came from. Repeat budgets count families, not variants. */
  family: string;
  /** Unique id including the transform, so a report can name exactly what was stamped. */
  name: string;
  template: RoomTemplate;
  transform: RoomTransform;
  region: RoomTemplate["region"];
  tier: RoomTier;
  bands: readonly number[];
  width: number;
  height: number;
  rows: readonly string[];
}

function variantsOf(template: RoomTemplate): RoomVariant[] {
  const base = {
    family: template.name,
    template,
    region: template.region,
    tier: template.tier,
    bands: template.bands,
  };
  const readings: Array<{ transform: RoomTransform; rows: readonly string[] }> = [
    { transform: "as-drawn", rows: template.rows },
  ];
  if (template.mirror) readings.push({ transform: "mirrored", rows: mirrorRows(template.rows) });
  // A quarter turn puts a room's floor on a wall, which is why it is opt-in rather than
  // universal: it reads for a room composed around a centre and is nonsense for a spoil
  // heap or a talus slope, whose whole subject is material lying on the ground.
  if (template.rotate) {
    readings.push({ transform: "turned", rows: quarterRows(template.rows) });
    if (template.mirror) readings.push({ transform: "turned-mirrored", rows: mirrorRows(quarterRows(template.rows)) });
  }
  return readings.map(({ transform, rows }) => ({
    ...base,
    transform,
    name: transform === "as-drawn" ? template.name : `${template.name}/${transform}`,
    width: rows[0].length,
    height: rows.length,
    rows,
  }));
}

export const ROOM_VARIANTS: readonly RoomVariant[] = ROOM_TEMPLATES.flatMap(variantsOf);

export const VARIANT_BY_NAME: ReadonlyMap<string, RoomVariant> =
  new Map(ROOM_VARIANTS.map((variant) => [variant.name, variant]));

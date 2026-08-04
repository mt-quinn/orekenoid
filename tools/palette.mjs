// The room authoring palette: one row per paintable thing.
//
// Three representations of the same cell, kept together so they can never drift:
//
//   glyph   a single ASCII character, for authoring rooms as text
//   colour  an 0xRRGGBB value, for authoring rooms by painting a PNG
//   cell    what the generator turns it into
//
// Colours are chosen for *separation in an image editor*, not for resemblance to
// the material's in-game appearance. A person painting a room needs to tell slate
// from reef at a glance in a 12x12 thumbnail; the game never shows these values.

/** @typedef {{glyph: string, colour: number, name: string, kind: (string|null), marker: (string|null), host?: ("open"|"rock"), axis?: (1|-1), transparent?: boolean}} PaletteEntry */

export const PALETTE = [
  // --- Structure ----------------------------------------------------------
  { glyph: "-", colour: 0xff00ff, name: "transparent", kind: null, marker: null, transparent: true },
  { glyph: ".", colour: 0x000000, name: "open", kind: null, marker: null },

  // Host rock: resolved to whatever the province at the stamp site uses, so one
  // room reads correctly in Karst, Mirrorreef and Rootwarren alike.
  { glyph: "#", colour: 0x808080, name: "host rock", kind: "*host", marker: null },

  // --- Surveyor's Karst ---------------------------------------------------
  { glyph: "c", colour: 0xd8c8a0, name: "chalk", kind: "chalk", marker: null },
  { glyph: "s", colour: 0x3a5a78, name: "slate", kind: "slate", marker: null },
  { glyph: "k", colour: 0x202020, name: "coal seam", kind: "coalSeam", marker: null },

  // --- Mirrorreef ---------------------------------------------------------
  { glyph: "r", colour: 0x304878, name: "reef rock", kind: "reef", marker: null },
  // Facets reflect against a *fixed diagonal*, so the axis is the rule, not a detail.
  // A facet whose axis comes from the world's lattice noise is fine as scattered
  // geology, but a room that wants to pose "align your claim to the lattice or get
  // chaos" has to be able to state the axis itself -- otherwise an authored facet wall
  // has mixed axes and the room means nothing. `f` and `F` keep the world's axis; the
  // slash glyphs pin it, and they are drawn to look like the plane they reflect on.
  { glyph: "f", colour: 0x40c0f0, name: "crystal facet", kind: "facet", marker: null },
  { glyph: "/", colour: 0x50d0ff, name: "facet NE-SW", kind: "facet", marker: null, axis: 1 },
  { glyph: "\\", colour: 0x30a8e0, name: "facet NW-SE", kind: "facet", marker: null, axis: -1 },
  { glyph: "F", colour: 0xa0e8ff, name: "charged facet", kind: "chargedFacet", marker: null },
  { glyph: "%", colour: 0xc8f4ff, name: "charged NE-SW", kind: "chargedFacet", marker: null, axis: 1 },
  { glyph: "&", colour: 0x88d8f8, name: "charged NW-SE", kind: "chargedFacet", marker: null, axis: -1 },

  // --- Rootwarren ---------------------------------------------------------
  { glyph: "w", colour: 0x705828, name: "sapwood", kind: "sapwood", marker: null },
  { glyph: "l", colour: 0x70a020, name: "living block", kind: "living", marker: null },
  { glyph: "b", colour: 0xf0c030, name: "spore bulb", kind: "sporeBulb", marker: null },
  { glyph: "h", colour: 0x483818, name: "heartwood", kind: "heartwood", marker: null },

  // --- Ecotone hybrids ----------------------------------------------------
  { glyph: "m", colour: 0x88b8d8, name: "mirror slate", kind: "mirrorSlate", marker: null },
  { glyph: "x", colour: 0xb0b060, name: "chalkroot", kind: "chalkroot", marker: null },
  { glyph: "y", colour: 0xa070d0, name: "bloomcrystal", kind: "bloomcrystal", marker: null },

  // --- Persistent structure ------------------------------------------------
  { glyph: "M", colour: 0xe0e0e0, name: "mechanism", kind: "mechanism", marker: null },
  { glyph: "L", colour: 0xa0a0a0, name: "lander hull", kind: "lander", marker: null },
  { glyph: "T", colour: 0xffffff, name: "survey stake", kind: "stake", marker: null },

  // --- Markers. These place *contents*, not rock. -------------------------
  // A marker resolves to a feature plus a host cell, exactly like Noita's special
  // colour pixels. `host` decides which:
  //
  //   "open"  the feature hangs in the cavity and the ball can reach it directly
  //   "rock"  the feature is buried in host rock and must be *excavated* to reach
  //
  // The distinction is load-bearing rather than cosmetic. A seam or a cache sitting
  // in open air would be free, and free rewards are what turn prospecting back into
  // collection. Buried ones cost a claim, which is the whole game.
  { glyph: "1", colour: 0xff2020, name: "cache", kind: null, marker: "cache", host: "rock" },
  { glyph: "2", colour: 0xff8000, name: "anomaly", kind: null, marker: "anomaly", host: "open" },
  { glyph: "3", colour: 0x20ff20, name: "rich seam", kind: null, marker: "seam", host: "rock" },
  { glyph: "4", colour: 0x2060ff, name: "survey data", kind: null, marker: "survey", host: "open" },
  { glyph: "5", colour: 0xc000c0, name: "procedure site", kind: null, marker: "procedure", host: "open" },
  { glyph: "*", colour: 0x606060, name: "decoration", kind: null, marker: "decor", host: "open" },
  { glyph: "?", colour: 0xffff00, name: "random feature", kind: null, marker: "random", host: "open" },
];

export const BY_GLYPH = new Map(PALETTE.map((entry) => [entry.glyph, entry]));
export const BY_COLOUR = new Map(PALETTE.map((entry) => [entry.colour, entry]));

export function entryForColour(colour) {
  const entry = BY_COLOUR.get(colour);
  if (entry) return entry;
  const hex = colour.toString(16).padStart(6, "0");
  throw new Error(
    `unknown colour #${hex} in room art.\n` +
    `Paint with exact palette values only -- anti-aliasing and colour management are\n` +
    `the usual causes. Save as 8-bit RGB PNG with no colour profile.\n` +
    `Run "npm run rooms:palette" for the full list.`,
  );
}

export function entryForGlyph(glyph) {
  const entry = BY_GLYPH.get(glyph);
  if (!entry) throw new Error(`unknown room glyph ${JSON.stringify(glyph)}`);
  return entry;
}

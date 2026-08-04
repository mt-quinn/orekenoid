#!/usr/bin/env node
// roomkit -- author, inspect and compile room art.
//
//   node tools/roomkit.mjs palette            print the palette, and write a swatch PNG
//   node tools/roomkit.mjs ascii <png...>     print a painted room as glyphs
//   node tools/roomkit.mjs preview <png...>   write a big annotated preview beside it
//   node tools/roomkit.mjs check <png...>     validate art without writing anything
//   node tools/roomkit.mjs build              compile rooms/ -> generated TS library
//
// `preview` is the important one. Room art is 6-36 cells across, which is too small
// to judge at 1:1, so previews are upscaled with a grid and a legend. That is the
// feedback loop: draw, preview, look, fix.

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { decodePng, encodePng } from "./png.mjs";
import { entryForColour, PALETTE } from "./palette.mjs";
import { Canvas } from "./canvas.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const ROOMS_DIR = join(ROOT, "rooms");

// --- glyph rendering ---------------------------------------------------------
// A 3x5 bitmap font, just enough to label a preview. Drawn here rather than pulled
// in as a dependency because the alternative is shipping a font renderer to draw
// twenty-six characters.
const FONT = {
  A: ["010", "101", "111", "101", "101"], B: ["110", "101", "110", "101", "110"],
  C: ["011", "100", "100", "100", "011"], D: ["110", "101", "101", "101", "110"],
  E: ["111", "100", "110", "100", "111"], F: ["111", "100", "110", "100", "100"],
  G: ["011", "100", "101", "101", "011"], H: ["101", "101", "111", "101", "101"],
  I: ["111", "010", "010", "010", "111"], J: ["001", "001", "001", "101", "010"],
  K: ["101", "101", "110", "101", "101"], L: ["100", "100", "100", "100", "111"],
  M: ["101", "111", "111", "101", "101"], N: ["101", "111", "111", "111", "101"],
  O: ["010", "101", "101", "101", "010"], P: ["110", "101", "110", "100", "100"],
  Q: ["010", "101", "101", "111", "011"], R: ["110", "101", "110", "101", "101"],
  S: ["011", "100", "010", "001", "110"], T: ["111", "010", "010", "010", "010"],
  U: ["101", "101", "101", "101", "011"], V: ["101", "101", "101", "010", "010"],
  W: ["101", "101", "111", "111", "101"], X: ["101", "101", "010", "101", "101"],
  Y: ["101", "101", "010", "010", "010"], Z: ["111", "001", "010", "100", "111"],
  0: ["111", "101", "101", "101", "111"], 1: ["010", "110", "010", "010", "111"],
  2: ["110", "001", "010", "100", "111"], 3: ["110", "001", "010", "001", "110"],
  4: ["101", "101", "111", "001", "001"], 5: ["111", "100", "110", "001", "110"],
  6: ["011", "100", "111", "101", "111"], 7: ["111", "001", "010", "010", "010"],
  8: ["111", "101", "111", "101", "111"], 9: ["111", "101", "111", "001", "110"],
  " ": ["000", "000", "000", "000", "000"], "-": ["000", "000", "111", "000", "000"],
  ".": ["000", "000", "000", "000", "010"], "#": ["101", "111", "101", "111", "101"],
  "*": ["000", "101", "010", "101", "000"], "?": ["110", "001", "010", "000", "010"],
  ":": ["000", "010", "000", "010", "000"], "/": ["001", "001", "010", "100", "100"],
  "(": ["010", "100", "100", "100", "010"], ")": ["010", "001", "001", "001", "010"],
  "x": ["000", "101", "010", "101", "000"],
  "\\": ["100", "100", "010", "001", "001"], "%": ["101", "001", "010", "100", "101"],
  "&": ["010", "101", "010", "101", "011"],
};

function drawText(surface, width, text, atX, atY, colour, scale = 1) {
  let cursor = atX;
  for (const raw of text.toUpperCase()) {
    const glyph = FONT[raw] ?? FONT["?"];
    for (let gy = 0; gy < 5; gy++) {
      for (let gx = 0; gx < 3; gx++) {
        if (glyph[gy][gx] !== "1") continue;
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            const px = cursor + gx * scale + sx;
            const py = atY + gy * scale + sy;
            if (px >= 0 && py >= 0 && px < width) surface[py * width + px] = colour;
          }
        }
      }
    }
    cursor += 4 * scale;
  }
}

// --- preview -----------------------------------------------------------------

/**
 * Render an annotated, upscaled preview.
 *
 * Cell colours come straight from the palette so the preview and the source art
 * agree exactly; the grid, ruler and legend are added around them. Marker cells get
 * a bright dot so contents stay visible against dark rock.
 */
function renderPreview(room, label) {
  const SCALE = 16;
  const MARGIN = 26;
  const legendRows = PALETTE.filter((entry) => room.used.has(entry.glyph));
  const LEGEND_H = 10 + legendRows.length * 9;
  const width = MARGIN + room.width * SCALE + 8;
  const height = MARGIN + room.height * SCALE + 8 + LEGEND_H;
  const surface = new Array(width * height).fill(0x101314);

  const put = (x, y, colour) => {
    if (x >= 0 && y >= 0 && x < width && y < height) surface[y * width + x] = colour;
  };

  for (let cy = 0; cy < room.height; cy++) {
    for (let cx = 0; cx < room.width; cx++) {
      const entry = room.grid[cy * room.width + cx];
      const ox = MARGIN + cx * SCALE;
      const oy = MARGIN + cy * SCALE;
      for (let y = 0; y < SCALE; y++) {
        for (let x = 0; x < SCALE; x++) {
          // Transparent reads as a checker, so "leave the world alone" is visibly
          // different from "carve this open".
          const checker = ((cx + cy) & 1) === 0 ? 0x24282a : 0x1b1f20;
          put(ox + x, oy + y, entry.transparent ? checker : entry.colour);
        }
      }
      if (entry.marker) {
        // Buried markers are drawn on a host-rock field with a ring; hanging ones on
        // open black with a solid dot. Being able to see the difference at a glance is
        // the point -- a reward in the air and a reward behind four hits of slate are
        // completely different design objects.
        const buried = entry.host === "rock";
        for (let y = 0; y < SCALE; y++) {
          for (let x = 0; x < SCALE; x++) put(ox + x, oy + y, buried ? 0x808080 : 0x000000);
        }
        for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) put(ox + x, oy + y, 0xffffff);
        for (let y = 5; y < 11; y++) for (let x = 5; x < 11; x++) put(ox + x, oy + y, entry.colour);
        if (buried) {
          for (let y = 7; y < 9; y++) for (let x = 7; x < 9; x++) put(ox + x, oy + y, 0x000000);
        }
      }
      // Grid, heavier every 5 cells so counting is possible.
      const major = cx % 5 === 0;
      for (let y = 0; y < SCALE; y++) put(ox, oy + y, major ? 0x585f60 : 0x33393a);
      const majorY = cy % 5 === 0;
      for (let x = 0; x < SCALE; x++) put(ox + x, oy, majorY ? 0x585f60 : 0x33393a);
    }
  }
  for (let y = 0; y < room.height * SCALE + 1; y++) put(MARGIN + room.width * SCALE, MARGIN + y, 0x585f60);
  for (let x = 0; x < room.width * SCALE + 1; x++) put(MARGIN + x, MARGIN + room.height * SCALE, 0x585f60);

  drawText(surface, width, `${label}  ${room.width}X${room.height}`, 3, 6, 0xe8dcc2, 2);
  for (let cx = 0; cx < room.width; cx += 5) {
    drawText(surface, width, String(cx), MARGIN + cx * SCALE + 2, MARGIN - 9, 0x9e937c, 1);
  }
  for (let cy = 0; cy < room.height; cy += 5) {
    drawText(surface, width, String(cy), 4, MARGIN + cy * SCALE + 4, 0x9e937c, 1);
  }

  let legendY = MARGIN + room.height * SCALE + 10;
  for (const entry of legendRows) {
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 7; x++) put(4 + x, legendY + y, entry.transparent ? 0x24282a : entry.colour);
    }
    const count = room.counts.get(entry.glyph) ?? 0;
    const where = entry.host === "rock" ? " buried" : entry.host === "open" ? " hanging" : "";
    drawText(surface, width, `${entry.glyph} ${entry.name}${where} (${count})`, 15, legendY + 1, 0xc8bda4, 1);
    legendY += 9;
  }
  return { width, height, pixels: surface };
}

// --- room reading ------------------------------------------------------------

function readRoom(path) {
  const { width, height, pixels } = decodePng(readFileSync(path));
  const grid = pixels.map((colour, index) => {
    try {
      return entryForColour(colour);
    } catch (error) {
      const x = index % width;
      const y = Math.floor(index / width);
      throw new Error(`${relative(ROOT, path)} at (${x},${y}): ${error.message}`);
    }
  });
  const counts = new Map();
  for (const entry of grid) counts.set(entry.glyph, (counts.get(entry.glyph) ?? 0) + 1);
  return { width, height, grid, counts, used: new Set(counts.keys()) };
}

function roomFiles(args) {
  if (args.length) return args.map((arg) => resolve(arg));
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      // `_`-prefixed PNGs are tooling output (the palette swatch), not room art.
      else if (extname(name) === ".png" && !name.endsWith(".preview.png") && !name.startsWith("_")) out.push(path);
    }
  };
  try {
    walk(ROOMS_DIR);
  } catch {
    return [];
  }
  return out.sort();
}

// --- commands ----------------------------------------------------------------

function cmdPalette() {
  const rows = PALETTE.map((entry) =>
    `  ${entry.glyph}   #${entry.colour.toString(16).padStart(6, "0")}   ${entry.name.padEnd(18)}` +
    `${entry.marker ? `marker:${entry.marker}` : entry.kind ?? ""}`);
  console.log("glyph  colour     name              becomes");
  console.log(rows.join("\n"));

  // A swatch sheet, so the palette can be loaded into an image editor and eyedropped.
  const SW = 24;
  const width = SW * PALETTE.length;
  const pixels = new Array(width * SW).fill(0);
  PALETTE.forEach((entry, index) => {
    for (let y = 0; y < SW; y++) {
      for (let x = 0; x < SW; x++) pixels[y * width + index * SW + x] = entry.colour;
    }
  });
  const out = join(ROOMS_DIR, "_palette.png");
  writeFileSync(out, encodePng(width, SW, pixels));
  console.log(`\nswatches -> ${relative(ROOT, out)} (${PALETTE.length} x 1 cells at ${SW}px)`);
}

function cmdAscii(args) {
  for (const path of roomFiles(args)) {
    const room = readRoom(path);
    console.log(`# ${relative(ROOT, path)}  ${room.width}x${room.height}`);
    for (let y = 0; y < room.height; y++) {
      console.log(room.grid.slice(y * room.width, (y + 1) * room.width).map((e) => e.glyph).join(""));
    }
    console.log();
  }
}

function cmdPreview(args) {
  for (const path of roomFiles(args)) {
    const room = readRoom(path);
    const label = basename(path, ".png");
    const image = renderPreview(room, label);
    const out = join(dirname(path), `${label}.preview.png`);
    writeFileSync(out, encodePng(image.width, image.height, image.pixels));
    console.log(`${relative(ROOT, out)}  ${image.width}x${image.height}`);
  }
}

function cmdCheck(args) {
  const files = roomFiles(args);
  let bad = 0;
  for (const path of files) {
    try {
      const room = readRoom(path);
      const markers = [...room.counts].filter(([g]) => "12345*?".includes(g)).reduce((n, [, c]) => n + c, 0);
      console.log(`ok   ${relative(ROOT, path).padEnd(46)} ${room.width}x${room.height}  markers=${markers}`);
    } catch (error) {
      bad++;
      console.error(`FAIL ${error.message}`);
    }
  }
  console.log(`\n${files.length - bad}/${files.length} rooms valid`);
  if (bad) process.exitCode = 1;
}

// --- build -------------------------------------------------------------------

const PROVINCES = ["karst", "mirrorreef", "rootwarren"];

/**
 * Ecotone filename prefixes, lowercased, mapped to the ids the generator uses.
 *
 * Ecotone rooms must place *only* in their ecotone: they are the sole source of diamond,
 * saltpeter and vitriol, and one appearing in pure Karst would hand out a reagent the
 * economy expects to gate a journey behind.
 */
const ECOTONES = { brightfault: "brightFault", chalkwarren: "chalkWarren", bloomshelf: "bloomShelf" };

/**
 * Tier from footprint, rather than from metadata beside the file.
 *
 * A painted PNG carries no metadata, and a sidecar file would be one more thing to
 * keep in sync for no gain: the tier *is* the footprint, per the ladder both
 * reference games use.
 */
function tierOf(width, height) {
  const longest = Math.max(width, height);
  if (longest <= 12) return "feature";
  if (longest >= 28) return "hall";
  return "chamber";
}

/** Region from the filename prefix. `any-` rooms may be stamped anywhere. */
function provinceOf(name) {
  const prefix = name.split("-")[0];
  if (PROVINCES.includes(prefix)) return prefix;
  if (ECOTONES[prefix]) return ECOTONES[prefix];
  return "any";
}

/**
 * Placement tags, carried as trailing segments of the filename.
 *
 * The filename is the only metadata channel a painted PNG has, and it is a good one: the
 * tag travels with the art, a sidecar file cannot fall out of sync with it, and the
 * constraint is visible in a directory listing. The same reasoning already derives region
 * from the prefix and tier from the footprint.
 *
 *   -b34     place only in depth bands 3 and 4, so the room reads as belonging to a depth
 *   -fixed   never substitute this room's materials into another province
 *   -rot     may be stamped rotated a quarter turn
 *   -nomirror  may not be stamped mirrored
 *
 * Tags are stripped from the room's id, because they are constraints on placement and not
 * part of what the room *is*.
 */
const TAG = /^(b[1-4]{1,4}|fixed|rot|nomirror)$/;

function parseTags(fileName) {
  const parts = fileName.split("-");
  const tags = new Set();
  while (parts.length > 1 && TAG.test(parts[parts.length - 1])) tags.add(parts.pop());
  const bandTag = [...tags].find((tag) => tag.startsWith("b"));
  return {
    name: parts.join("-"),
    bands: bandTag ? [...bandTag.slice(1)].map(Number).sort() : [1, 2, 3, 4],
    fixed: tags.has("fixed"),
    rotate: tags.has("rot"),
    mirror: !tags.has("nomirror"),
  };
}

function cmdBuild(args) {
  const files = roomFiles(args);
  const rooms = files.map((path) => {
    const room = readRoom(path);
    const fileName = basename(path, ".png");
    const tags = parseTags(fileName);
    const rows = [];
    for (let y = 0; y < room.height; y++) {
      rows.push(room.grid.slice(y * room.width, (y + 1) * room.width).map((e) => e.glyph).join(""));
    }
    return { ...tags, province: provinceOf(fileName), tier: tierOf(room.width, room.height), room, rows };
  });

  const glyphLines = PALETTE.map((entry) => {
    const kind = entry.kind === "*host" ? "null" : entry.kind ? JSON.stringify(entry.kind) : "null";
    const host = entry.kind === "*host" ? "true" : "false";
    const marker = entry.marker ? JSON.stringify(entry.marker) : "null";
    const markerHost = entry.marker ? JSON.stringify(entry.host) : "null";
    const axis = entry.axis === 1 ? "1" : entry.axis === -1 ? "-1" : "null";
    return `  ${JSON.stringify(entry.glyph)}: { name: ${JSON.stringify(entry.name)}, kind: ${kind}, ` +
      `host: ${host}, marker: ${marker}, markerHost: ${markerHost}, axis: ${axis}, ` +
      `transparent: ${entry.transparent === true}, open: ${!entry.transparent && !entry.kind && !entry.marker} },`;
  });

  const roomLines = rooms.map((entry) =>
    `  {\n` +
    `    name: ${JSON.stringify(entry.name)},\n` +
    `    region: ${JSON.stringify(entry.province)},\n` +
    `    tier: ${JSON.stringify(entry.tier)},\n` +
    `    bands: [${entry.bands.join(", ")}],\n` +
    `    fixed: ${entry.fixed},\n` +
    `    rotate: ${entry.rotate},\n` +
    `    mirror: ${entry.mirror},\n` +
    `    width: ${entry.room.width},\n` +
    `    height: ${entry.room.height},\n` +
    `    rows: [\n${entry.rows.map((row) => `      ${JSON.stringify(row)},`).join("\n")}\n    ],\n` +
    `  },`);

  const source = `// GENERATED FILE -- do not edit. Run \`npm run rooms\` after changing rooms/.
//
// Room art lives in \`rooms/\` as PNGs, which is what a person can paint and what
// both reference games use. It is compiled to TypeScript rather than fetched at
// runtime for two reasons: world generation stays synchronous, and the generator
// stays testable in Node without a DOM or a network.
//
// The rows below are the room art as glyphs, so a change to a room shows up as a
// readable diff instead of an opaque binary blob.

import type { EcotoneId, MaterialKind, ProvinceId } from "../config";

export type RoomMarker = "cache" | "anomaly" | "seam" | "survey" | "procedure" | "decor" | "random";

export interface RoomGlyph {
  name: string;
  /** The material this cell becomes, or null for open space and markers. */
  kind: MaterialKind | null;
  /** True when the cell takes whichever material the province at the stamp site uses. */
  host: boolean;
  marker: RoomMarker | null;
  /** Buried features cost a claim to reach; hanging ones do not. */
  markerHost: "rock" | "open" | null;
  /** Pins a facet's reflecting diagonal, so an authored lattice is coherent. */
  axis: 1 | -1 | null;
  /** Transparent cells leave the generated world exactly as it was. */
  transparent: boolean;
  open: boolean;
}

export const ROOM_GLYPHS: Record<string, RoomGlyph> = {
${glyphLines.join("\n")}
};

/** Footprint tiers, following Terraria's own point-of-interest / mini-biome ladder. */
export type RoomTier = "feature" | "chamber" | "hall";

export interface RoomTemplate {
  name: string;
  /**
   * Where this room may be stamped. A province id restricts it to that province, an
   * ecotone id to that ecotone only, and \`any\` allows it anywhere.
   */
  region: ProvinceId | EcotoneId | "any";
  tier: RoomTier;
  /**
   * Depth bands this room may be stamped in, from the \`-bNN\` filename tag.
   *
   * Gating is what makes depth read as progression rather than as more of the same: a
   * timbered drift belongs near the Landing and a cathedral does not. Most rooms are
   * ungated, because gating everything starves the tiers instead of shaping them.
   */
  bands: readonly number[];
  /** \`-fixed\`: this room's design depends on its literal materials, so never substitute. */
  fixed: boolean;
  /** \`-rot\`: this room's composition has no up-down commitment, so a quarter turn reads. */
  rotate: boolean;
  /** \`-nomirror\`: mirroring this room would break something in it. */
  mirror: boolean;
  width: number;
  height: number;
  rows: readonly string[];
}

export const ROOM_TEMPLATES: readonly RoomTemplate[] = [
${roomLines.join("\n")}
];
`;

  const out = join(ROOT, "src", "worldgen", "roomLibrary.generated.ts");
  writeFileSync(out, source);
  const byTier = rooms.reduce((acc, entry) => ({ ...acc, [entry.tier]: (acc[entry.tier] ?? 0) + 1 }), {});
  console.log(`${relative(ROOT, out)}  ${rooms.length} rooms  ${JSON.stringify(byTier)}`);
}

// --- profile ------------------------------------------------------------------

/**
 * Composition profile, with the same measurements taken from Noita's 74 authored
 * rooms so ours can be compared against something real rather than against taste.
 *
 * Noita's medians: 32% transparent, 53% open, 14% painted material, 3 markers. Its
 * side edges carry ~0% solid and its top/bottom edges are ~100% transparent.
 */
const NOITA = {
  transparent: [15, 50], open: [40, 70], solid: [4, 30], markers: [1, 14],
};

function profileRoom(room) {
  const n = room.width * room.height;
  const at = (x, y) => room.grid[y * room.width + x];
  const bucket = (entry) => entry.transparent ? "transparent"
    : entry.marker ? "marker"
    : entry.glyph === "." ? "open"
    : "solid";
  const counts = { transparent: 0, open: 0, solid: 0, marker: 0 };
  for (const entry of room.grid) counts[bucket(entry)]++;

  const edge = (cells) => {
    const c = { transparent: 0, open: 0, solid: 0, marker: 0 };
    for (const entry of cells) c[bucket(entry)]++;
    return {
      transparent: Math.round(c.transparent / cells.length * 100),
      open: Math.round((c.open + c.marker) / cells.length * 100),
      solid: Math.round(c.solid / cells.length * 100),
    };
  };
  const col = (x) => Array.from({ length: room.height }, (_, y) => at(x, y));
  const row = (y) => Array.from({ length: room.width }, (_, x) => at(x, y));

  const corners = [at(0, 0), at(room.width - 1, 0), at(0, room.height - 1), at(room.width - 1, room.height - 1)];
  return {
    width: room.width,
    height: room.height,
    pct: {
      transparent: Math.round(counts.transparent / n * 100),
      open: Math.round(counts.open / n * 100),
      solid: Math.round(counts.solid / n * 100),
    },
    markers: counts.marker,
    edges: { top: edge(row(0)), bottom: edge(row(room.height - 1)), left: edge(col(0)), right: edge(col(room.width - 1)) },
    cornersTransparent: corners.filter((entry) => entry.transparent).length,
  };
}

function cmdProfile(args) {
  const files = roomFiles(args);
  console.log("Composition, against Noita's 74 authored rooms (medians: 32% transparent, 53% open, 14% solid, 3 markers).\n");
  console.log(`${"room".padEnd(26)}${"size".padStart(8)}${"transp".padStart(8)}${"open".padStart(6)}${"solid".padStart(7)}${"mk".padStart(4)}   edges solid% T/B/L/R   corners`);
  const notes = [];
  for (const path of files) {
    const room = readRoom(path);
    const p = profileRoom(room);
    const name = basename(path, ".png");
    const e = p.edges;
    console.log(
      `${name.slice(0, 25).padEnd(26)}${`${p.width}x${p.height}`.padStart(8)}` +
      `${String(p.pct.transparent).padStart(8)}${String(p.pct.open).padStart(6)}${String(p.pct.solid).padStart(7)}` +
      `${String(p.markers).padStart(4)}   ` +
      `${String(e.top.solid).padStart(4)}${String(e.bottom.solid).padStart(4)}${String(e.left.solid).padStart(4)}${String(e.right.solid).padStart(4)}` +
      `        ${p.cornersTransparent}/4`,
    );
    const flag = (message) => notes.push(`  ${name}: ${message}`);
    if (p.cornersTransparent < 4) flag("opaque corner -- the stamp will cut a visible rectangle into rock");
    // Noita's rooms are wang tiles, so their sides carry ~0% solid and their top and
    // bottom are 100% transparent -- the neighbouring tile supplies the floor. Ours are
    // stamped into a cave field, where transparent means "defer to the world", so a
    // painted floor is correct and expected. What still has to hold is that the room
    // offers at least two ways through, or it can orphan part of the world.
    const ways = Object.values(e).filter((value) => value.transparent + value.open >= 40).length;
    if (ways < 2) flag(`only ${ways} edge(s) offer passage -- a room that seals itself can orphan the world`);
    if (p.pct.solid > NOITA.solid[1]) flag(`${p.pct.solid}% painted material -- over-painted; Noita's median is 14%`);
    if (p.pct.solid < NOITA.solid[0]) flag(`${p.pct.solid}% painted material -- nothing authored here but a hole`);
    if (p.pct.open < NOITA.open[0]) flag(`${p.pct.open}% open -- too little room to fly, let alone play`);
    if (p.markers < NOITA.markers[0]) flag("no markers -- a room with no contents is a corridor with extra steps");
  }
  if (notes.length) {
    console.log("\nNotes:");
    console.log(notes.join("\n"));
  } else {
    console.log("\nAll rooms within reference ranges.");
  }
}

// --- contact sheet ------------------------------------------------------------

/**
 * The whole library on one image.
 *
 * Once the library outgrows a handful of rooms it cannot be reviewed by opening files
 * one at a time, and a library nobody looks at drifts. A contact sheet makes the whole
 * pool judgeable at a glance: outliers in tone, footprint or density stand out
 * immediately in a way they never do in isolation.
 */
function cmdSheet(args) {
  const files = roomFiles(args);
  if (!files.length) return console.log("no rooms");
  const rooms = files.map((path) => ({ name: basename(path, ".png"), room: readRoom(path) }));
  const SCALE = 5;
  const LABEL = 9;
  const GAP = 10;
  const COLUMNS = 4;
  const cellW = Math.max(...rooms.map((r) => r.room.width)) * SCALE + GAP;
  const cellH = Math.max(...rooms.map((r) => r.room.height)) * SCALE + GAP + LABEL;
  const rows = Math.ceil(rooms.length / COLUMNS);
  const width = COLUMNS * cellW + GAP;
  const height = rows * cellH + GAP + 14;
  const surface = new Array(width * height).fill(0x0d1011);
  const put = (x, y, colour) => {
    if (x >= 0 && y >= 0 && x < width && y < height) surface[y * width + x] = colour;
  };

  drawText(surface, width, `ROOM LIBRARY  ${rooms.length} ROOMS`, GAP, 4, 0xe8dcc2, 2);
  rooms.forEach((entry, index) => {
    const ox = GAP + (index % COLUMNS) * cellW;
    const oy = 18 + GAP + Math.floor(index / COLUMNS) * cellH;
    drawText(surface, width, `${entry.name} ${entry.room.width}X${entry.room.height}`, ox, oy, 0x9e937c, 1);
    for (let cy = 0; cy < entry.room.height; cy++) {
      for (let cx = 0; cx < entry.room.width; cx++) {
        const cell = entry.room.grid[cy * entry.room.width + cx];
        const colour = cell.transparent
          ? (((cx + cy) & 1) === 0 ? 0x1b1f20 : 0x141718)
          : cell.marker ? 0xffffff : cell.colour;
        for (let y = 0; y < SCALE; y++) {
          for (let x = 0; x < SCALE; x++) put(ox + cx * SCALE + x, oy + LABEL + cy * SCALE + y, colour);
        }
      }
    }
  });
  const out = join(ROOMS_DIR, "_library.png");
  writeFileSync(out, encodePng(width, height, surface));
  console.log(`${relative(ROOT, out)}  ${width}x${height}  ${rooms.length} rooms`);
}

const COMMANDS = { sheet: cmdSheet, profile: cmdProfile, palette: cmdPalette, ascii: cmdAscii, preview: cmdPreview, check: cmdCheck, build: cmdBuild };

const [command, ...args] = process.argv.slice(2);
const run = COMMANDS[command];
if (!run) {
  console.error(`usage: roomkit <${Object.keys(COMMANDS).join("|")}> [files...]`);
  process.exitCode = 1;
} else {
  run(args);
}

export { Canvas, readRoom, renderPreview };

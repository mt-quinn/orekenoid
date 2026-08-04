// The Atlas: the player's map of the mine.
//
// Two design rules from WORLD_DESIGN_BRIEF.md govern this file:
//
//   - "Direction is discoverable; contents are a wager." The Atlas draws only what
//     the drone has actually seen, and it draws geology and excavation -- never
//     buried resources, never a claim's contents.
//   - "Nothing auto-fills or interprets discoveries for them." Every marker on the
//     map was placed by the player. Nothing here writes an annotation on its own.
//
// It renders to a plain 2D canvas rather than through Pixi. At world scale one
// cell is a handful of pixels, so the whole 240x144 mine fits the aperture at once
// with no panning -- which is the correct read for a map, and far cheaper than a
// second WebGL context competing with the game's.

import { PALETTE, PROVINCE_PALETTE, WORLD_COLS, WORLD_ROWS } from "./config";
import type { MapAnnotation } from "./persistence";
import type { WorldModel } from "./world";

/** Pixels per world cell at fit-to-aperture zoom. 240 x 5 = 1200, 144 x 5 = 720. */
export const ATLAS_SCALE = 5;
export const ATLAS_WIDTH = WORLD_COLS * ATLAS_SCALE;
export const ATLAS_HEIGHT = WORLD_ROWS * ATLAS_SCALE;

/** The marker vocabulary. Deliberately small, and deliberately uninterpreted. */
export const ATLAS_ICONS = ["◆", "▲", "●", "✕", "!", "?", "⌂", "↯"] as const;
export type AtlasIcon = (typeof ATLAS_ICONS)[number];

export interface AtlasSite {
  x: number;
  y: number;
  name: string;
  kind: "landing" | "anchor" | "cornerstone";
}

export interface AtlasViewModel {
  world: WorldModel;
  annotations: MapAnnotation[];
  sites: AtlasSite[];
  player: { x: number; y: number; heading: number };
}

const hex = (colour: number, alpha = 1): string => {
  const r = (colour >> 16) & 0xff;
  const g = (colour >> 8) & 0xff;
  const b = colour & 0xff;
  return alpha >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${alpha})`;
};

/**
 * Draw the whole map.
 *
 * Undiscovered cells are left as void rather than dimmed, so the shape of what the
 * player has explored is itself information -- the negative space is the map's
 * most useful feature early on.
 */
export function drawAtlas(context: CanvasRenderingContext2D, model: AtlasViewModel): void {
  const { world } = model;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.fillStyle = hex(PALETTE.void);
  context.fillRect(0, 0, ATLAS_WIDTH, ATLAS_HEIGHT);

  // --- Geology --------------------------------------------------------------
  for (let y = 0; y < WORLD_ROWS; y++) {
    for (let x = 0; x < WORLD_COLS; x++) {
      if (!world.isDiscovered(x, y)) continue;
      const cell = world.cells[y][x];
      const palette = PROVINCE_PALETTE[cell.province];
      const solid = world.solidAt(x + 0.5, y + 0.5);
      let colour: number;
      let alpha: number;
      if (cell.persistent && solid) {
        // Structure the player must not mistake for ore-bearing rock.
        colour = PALETTE.rail;
        alpha = 0.85;
      } else if (solid) {
        colour = palette.base;
        // Ecotones read brighter, because knowing where two rules overlap is
        // exactly the kind of direction the brief wants discoverable.
        alpha = cell.ecotone ? 1 : 0.88;
      } else if (cell.baseSolid) {
        // Excavated: rock the player removed. Warmer and lighter than natural cave,
        // so the history of an expedition is legible on the map.
        colour = palette.edge;
        alpha = 0.42;
      } else {
        // Open cave. Lifted off the void so surveyed-but-empty reads differently
        // from never-surveyed at a glance.
        colour = 0x141d20;
        alpha = 1;
      }
      context.fillStyle = hex(colour, alpha);
      context.fillRect(x * ATLAS_SCALE, y * ATLAS_SCALE, ATLAS_SCALE, ATLAS_SCALE);
    }
  }

  drawDepthBands(context);
  drawSites(context, model.sites);
  drawAnnotations(context, model.annotations);
  drawPlayer(context, model.player);
}

/** Depth is the game's difficulty axis, so the bands are labelled on the map. */
function drawDepthBands(context: CanvasRenderingContext2D): void {
  const rows = [36, 72, 108];
  context.strokeStyle = hex(PALETTE.machine, 0.22);
  context.lineWidth = 1;
  context.setLineDash([4, 6]);
  for (const row of rows) {
    context.beginPath();
    context.moveTo(0, row * ATLAS_SCALE);
    context.lineTo(ATLAS_WIDTH, row * ATLAS_SCALE);
    context.stroke();
  }
  context.setLineDash([]);
  context.font = "600 10px ui-monospace, monospace";
  context.fillStyle = hex(PALETTE.machine, 0.5);
  context.textAlign = "left";
  context.textBaseline = "top";
  [0, ...rows].forEach((row, index) => {
    context.fillText(`B${index + 1}  ${row * 14}m`, 6, row * ATLAS_SCALE + 4);
  });
}

function drawSites(context: CanvasRenderingContext2D, sites: readonly AtlasSite[]): void {
  context.textAlign = "center";
  context.textBaseline = "middle";
  for (const site of sites) {
    const px = site.x * ATLAS_SCALE;
    const py = site.y * ATLAS_SCALE;
    const colour = site.kind === "cornerstone" ? PALETTE.facetHot : PALETTE.rail;
    context.strokeStyle = hex(colour, 0.9);
    context.lineWidth = 1.5;
    context.beginPath();
    context.arc(px, py, site.kind === "cornerstone" ? 7 : 5, 0, Math.PI * 2);
    context.stroke();
    if (site.kind === "landing") {
      context.fillStyle = hex(colour, 0.9);
      context.fillRect(px - 2, py - 2, 4, 4);
    }
    context.font = "700 9px ui-monospace, monospace";
    context.fillStyle = hex(colour, 0.72);
    context.fillText(site.name, px, py - 13);
  }
}

function drawAnnotations(context: CanvasRenderingContext2D, annotations: readonly MapAnnotation[]): void {
  context.textAlign = "center";
  context.textBaseline = "middle";
  for (const note of annotations) {
    const px = note.x * ATLAS_SCALE;
    const py = note.y * ATLAS_SCALE;
    context.font = "700 15px ui-monospace, monospace";
    // Drawn twice: a dark pass first so a marker stays legible over bright rock.
    context.fillStyle = hex(PALETTE.void, 0.8);
    context.fillText(note.icon, px + 1, py + 1);
    context.fillStyle = hex(PALETTE.ink, 0.95);
    context.fillText(note.icon, px, py);
    if (!note.note) continue;
    context.font = "600 10px ui-monospace, monospace";
    const width = context.measureText(note.note).width;
    context.fillStyle = hex(PALETTE.void, 0.72);
    context.fillRect(px - width / 2 - 3, py + 8, width + 6, 13);
    context.fillStyle = hex(PALETTE.ink, 0.86);
    context.fillText(note.note, px, py + 15);
  }
}

function drawPlayer(context: CanvasRenderingContext2D, player: { x: number; y: number; heading: number }): void {
  const px = player.x * ATLAS_SCALE;
  const py = player.y * ATLAS_SCALE;
  context.save();
  context.translate(px, py);
  context.rotate(player.heading);
  context.fillStyle = hex(PALETTE.danger);
  context.beginPath();
  context.moveTo(0, -7);
  context.lineTo(5, 5);
  context.lineTo(0, 2);
  context.lineTo(-5, 5);
  context.closePath();
  context.fill();
  context.restore();
  context.strokeStyle = hex(PALETTE.danger, 0.35);
  context.lineWidth = 1;
  context.beginPath();
  context.arc(px, py, 11, 0, Math.PI * 2);
  context.stroke();
}

/** Canvas pixel position to world cell. Fractional, so markers sit where clicked. */
export function atlasToWorld(canvasX: number, canvasY: number): { x: number; y: number } {
  return { x: canvasX / ATLAS_SCALE, y: canvasY / ATLAS_SCALE };
}

/** The annotation under a click, if any. Radius is in canvas pixels. */
export function annotationAt(
  annotations: readonly MapAnnotation[],
  canvasX: number,
  canvasY: number,
  radius = 10,
): MapAnnotation | null {
  let best: MapAnnotation | null = null;
  let bestDistance = radius;
  for (const note of annotations) {
    const distance = Math.hypot(note.x * ATLAS_SCALE - canvasX, note.y * ATLAS_SCALE - canvasY);
    if (distance > bestDistance) continue;
    bestDistance = distance;
    best = note;
  }
  return best;
}

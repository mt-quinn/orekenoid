// Overlays: everything that is not a cell.
//
// Drawn in screen space rather than into the raster, because a room outline and a label have
// to stay one pixel wide and legible at any zoom. Both the on-screen view and the exported
// PNG call `drawOverlays` with their own transform, so the file is always the same picture
// that was inspected.

import { PALETTE, RESOURCES, WORLD_COLS, WORLD_ROWS, type Band, type ResourceId } from "../config";
import { CORNERSTONES, LANDING_FEATURES } from "../worldgen/landmarks";
import { BAND_NAMES, bandAt, depthMetresAt } from "../worldgen/regions";
import type { RoomStampReport } from "../worldgen/rooms";
import type { RoomMarker } from "../worldgen/roomLibrary.generated";
import { hex } from "./raster";

/** A cell-space to screen-space mapping. */
export interface Transform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export const toScreen = (view: Transform, x: number, y: number): [number, number] =>
  [x * view.scale + view.offsetX, y * view.scale + view.offsetY];

export interface OverlayOptions {
  rooms: boolean;
  roomLabels: boolean;
  features: boolean;
  bands: boolean;
  landmarks: boolean;
  grid: boolean;
}

/**
 * Marker colours, chosen so the two *buried* markers -- the ones that cost a claim to reach
 * and are the only ones that pay -- are the two warm colours and everything else is cool.
 * At a glance the map should answer "where is there a reason to dig" before anything else.
 */
export const MARKER_STYLE: Record<Exclude<RoomMarker, "random">, { colour: number; name: string }> = {
  seam: { colour: 0xffb648, name: "seam" },
  cache: { colour: 0xe8783c, name: "cache" },
  anomaly: { colour: 0xb08fd8, name: "anomaly" },
  survey: { colour: 0x7ba2cf, name: "survey" },
  procedure: { colour: 0x7fc8d8, name: "procedure" },
  decor: { colour: 0x5d6a6e, name: "decor" },
  // Danger, in the one colour the palette reserves for it. Warm like the markers that pay, because a
  // Bounder carries ore and is therefore also a reason to go somewhere.
  bounder: { colour: 0xff655b, name: "bounder" },
};

const TIER_STROKE = { hall: 0xf1eadb, chamber: 0xb9d2e8, feature: 0x6f7d82 } as const;

/**
 * The row each depth band starts on, found by asking `bandAt` where it changes its mind.
 *
 * The first version of this inverted `depthMetresAt` instead, which looks tidier and is
 * wrong: that function clamps at zero, so the two samples it was inverting from were both 0
 * and the whole overlay divided by zero and drew nothing. Reading the boundaries off the
 * authority costs 144 calls once and cannot drift from it -- including when the world is
 * reshaped to 576 rows.
 */
const BAND_ROWS: ReadonlyArray<{ band: Band; row: number }> = (() => {
  const rows: Array<{ band: Band; row: number }> = [];
  for (let y = 0; y < WORLD_ROWS; y++) {
    if (y === 0 || bandAt(y) !== bandAt(y - 1)) rows.push({ band: bandAt(y), row: y });
  }
  return rows;
})();

export function drawOverlays(
  context: CanvasRenderingContext2D,
  view: Transform,
  rooms: RoomStampReport,
  options: OverlayOptions,
): void {
  const { scale } = view;

  if (options.grid && scale >= 6) {
    context.strokeStyle = "rgba(241,234,219,0.07)";
    context.lineWidth = 1;
    context.beginPath();
    for (let x = 0; x <= WORLD_COLS; x++) {
      const [sx] = toScreen(view, x, 0);
      context.moveTo(sx, toScreen(view, 0, 0)[1]);
      context.lineTo(sx, toScreen(view, 0, WORLD_ROWS)[1]);
    }
    for (let y = 0; y <= WORLD_ROWS; y++) {
      const [, sy] = toScreen(view, 0, y);
      context.moveTo(toScreen(view, 0, 0)[0], sy);
      context.lineTo(toScreen(view, WORLD_COLS, 0)[0], sy);
    }
    context.stroke();
  }

  if (options.bands) {
    context.setLineDash([6, 5]);
    context.lineWidth = 1;
    for (const { band, row } of BAND_ROWS) {
      if (row > 0) {
        const [, sy] = toScreen(view, 0, row);
        context.strokeStyle = "rgba(241,234,219,0.35)";
        context.beginPath();
        context.moveTo(toScreen(view, 0, 0)[0], sy);
        context.lineTo(toScreen(view, WORLD_COLS, 0)[0], sy);
        context.stroke();
      }
      const [lx, ly] = toScreen(view, 0.6, row + 0.4);
      context.fillStyle = "rgba(241,234,219,0.62)";
      context.font = "600 11px ui-monospace, monospace";
      context.textBaseline = "top";
      context.fillText(`${BAND_NAMES[band]} · ${Math.round(depthMetresAt(row))}m`, lx, ly);
    }
    context.setLineDash([]);
  }

  if (options.rooms) {
    context.lineWidth = 1;
    for (const placed of rooms.placed) {
      const [sx, sy] = toScreen(view, placed.rect.x, placed.rect.y);
      context.strokeStyle = hex(TIER_STROKE[placed.tier]);
      context.globalAlpha = placed.tier === "feature" ? 0.55 : 0.85;
      context.strokeRect(
        Math.round(sx) + 0.5, Math.round(sy) + 0.5,
        placed.rect.width * scale, placed.rect.height * scale,
      );
      context.globalAlpha = 1;
    }
    // Only once a placement is big enough on screen to be worth naming. At fit scale all
    // fifty labels overlap into a solid block of text and the map underneath is invisible;
    // the hover readout already names the room under the cursor, so labels are for surveying
    // a region you have zoomed into rather than for reading the whole world at once.
    if (options.roomLabels && scale >= 8) {
      context.font = "500 10px ui-monospace, monospace";
      context.textBaseline = "bottom";
      for (const placed of rooms.placed) {
        const [sx, sy] = toScreen(view, placed.rect.x, placed.rect.y);
        // The variant, not the family: which *reading* landed here is the whole question a
        // transformed and substituted library raises.
        const label = placed.variant === placed.name
          ? `${placed.name} · ${placed.province}`
          : `${placed.variant} · ${placed.province}`;
        context.fillStyle = "rgba(7,10,11,0.72)";
        const width = context.measureText(label).width;
        context.fillRect(sx, sy - 12, width + 6, 12);
        context.fillStyle = hex(TIER_STROKE[placed.tier]);
        context.fillText(label, sx + 3, sy - 2);
      }
    }
  }

  if (options.features) {
    const radius = Math.max(1.6, Math.min(4, scale * 0.4));
    for (const feature of rooms.features) {
      const [sx, sy] = toScreen(view, feature.x + 0.5, feature.y + 0.5);
      context.fillStyle = hex(MARKER_STYLE[feature.marker].colour);
      context.beginPath();
      context.arc(sx, sy, radius, 0, Math.PI * 2);
      context.fill();
    }
  }

  if (options.landmarks) {
    context.font = "600 11px ui-monospace, monospace";
    context.textBaseline = "middle";
    for (const site of [...LANDING_FEATURES, ...CORNERSTONES]) {
      const cornerstone = CORNERSTONES.some((entry) => entry.id === site.id);
      const [sx, sy] = toScreen(view, site.x + 0.5, site.y + 0.5);
      const size = cornerstone ? 6 : 4;
      context.strokeStyle = cornerstone ? hex(PALETTE.danger) : hex(PALETTE.rail);
      context.lineWidth = 1.5;
      context.beginPath();
      context.moveTo(sx - size, sy);
      context.lineTo(sx, sy - size);
      context.lineTo(sx + size, sy);
      context.lineTo(sx, sy + size);
      context.closePath();
      context.stroke();
      // Eight Landing features sit inside a few cells of each other, so their names are
      // only separable once there is room for them.
      if (scale >= 6) {
        context.fillStyle = cornerstone ? hex(PALETTE.danger) : "rgba(241,234,219,0.8)";
        context.fillText(site.name, sx + size + 4, sy);
      }
    }
  }
}

/** Resource swatches for the legend, in the order the economy introduces them. */
export const RESOURCE_ORDER: readonly ResourceId[] = [
  "copper", "coal", "iron", "sapphire", "cobalt", "emerald",
  "mithril", "ruby", "adamantite", "runite", "sulfur", "saltpeter", "diamond", "vitriol",
];

export const resourceColour = (id: ResourceId): string => hex(RESOURCES[id].colour);

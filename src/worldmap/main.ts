// The world inspector.
//
// A development instrument for looking at a whole generated world at once: reroll a seed, pan
// and zoom the result, and export it as a PNG. It imports `generateWorld` directly rather
// than duplicating any of it, which is the point -- the picture cannot drift from the
// generator, and anything the tool can show is something the game will actually contain.
//
// This is its own page. The game's deployment previews are load-bearing and nothing here
// should be able to reach them.

import { DEFAULT_SEED, RESOURCES, WORLD_COLS, WORLD_ROWS } from "../config";
import { MATERIALS } from "../materials";
import { generateWorld, type GeneratedWorld } from "../worldgen/generate";
import { ROOM_TEMPLATES } from "../worldgen/roomLibrary.generated";
import { BAND_NAMES, ECOTONE_NAMES, PROVINCE_NAMES, depthMetresAt } from "../worldgen/regions";
import { MARKER_STYLE, RESOURCE_ORDER, drawOverlays, resourceColour, type OverlayOptions, type Transform } from "./overlays";
import { BASE_LAYERS, hex, largestComponent, rasterizeWorld, reachableFromLanding, type BaseLayer, type RasterOptions } from "./raster";

const need = <T extends Element>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`world inspector: missing ${selector}`);
  return element;
};

const canvas = need<HTMLCanvasElement>("#map");
const context = canvas.getContext("2d")!;
const readout = need<HTMLDivElement>("#readout");
const seedField = need<HTMLInputElement>("#seed");
const reportList = need<HTMLDListElement>("#report");
const zoomLabel = need<HTMLSpanElement>("#zoom");

/** The base raster, one pixel per cell, scaled up with smoothing off when drawn. */
const base = document.createElement("canvas");
base.width = WORLD_COLS;
base.height = WORLD_ROWS;
const baseContext = base.getContext("2d")!;

const raster: RasterOptions = { layer: "material", resources: true, persistent: true };
const overlays: OverlayOptions = {
  rooms: true, roomLabels: false, features: true, bands: true, landmarks: true, grid: true,
};

let world: GeneratedWorld = generateWorld(seedFromUrl());
let reach = reachableFromLanding(world.cells);
let connectivity = largestComponent(world.cells);
const view: Transform = { scale: 4, offsetX: 0, offsetY: 0 };
let hover: { x: number; y: number } | null = null;

function seedFromUrl(): string {
  const fromHash = decodeURIComponent(location.hash.replace(/^#/, "")).trim();
  return fromHash || DEFAULT_SEED;
}

/**
 * A fresh seed.
 *
 * Seeds are opaque tokens hashed into geology, so this only has to be unlikely to repeat and
 * short enough to read back over someone's shoulder.
 */
function rollSeed(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return `w-${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

// --- drawing -----------------------------------------------------------------

function repaintBase(): void {
  const { width, height, pixels } = rasterizeWorld(world.cells, raster);
  baseContext.putImageData(new ImageData(pixels, width, height), 0, 0);
}

/**
 * Shown in the corner, and updated from the DOM rather than drawn into the canvas.
 *
 * Which means it stays correct even when the browser has paused `requestAnimationFrame` --
 * a background tab holds a stale frame, and a zoom readout that lived in the canvas would go
 * stale with it and misreport the state.
 */
function refreshZoom(): void {
  zoomLabel.textContent = `${view.scale.toFixed(1)} px/cell`;
}

let queued = false;
function invalidate(): void {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    draw();
  });
}

function fitView(): void {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  // The module runs before the first layout, so at startup this is called once with a
  // zero-sized canvas. Fitting to that gives a scale of 0, which collapses the whole world
  // onto the origin and leaves a black page with two stray landmark diamonds in the corner.
  // The ResizeObserver below is what actually lands the first fit.
  if (!width || !height) return;
  view.scale = Math.min(width / WORLD_COLS, height / WORLD_ROWS) * 0.94;
  view.offsetX = (width - WORLD_COLS * view.scale) / 2;
  view.offsetY = (height - WORLD_ROWS * view.scale) / 2;
  refreshZoom();
  invalidate();
}

function draw(): void {
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return;
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.fillStyle = "#050708";
  context.fillRect(0, 0, width, height);

  context.imageSmoothingEnabled = false;
  context.drawImage(base, view.offsetX, view.offsetY, WORLD_COLS * view.scale, WORLD_ROWS * view.scale);

  // A border, so the world's own edge is distinguishable from the page background.
  context.strokeStyle = "rgba(241,234,219,0.22)";
  context.lineWidth = 1;
  context.strokeRect(
    view.offsetX - 0.5, view.offsetY - 0.5,
    WORLD_COLS * view.scale + 1, WORLD_ROWS * view.scale + 1,
  );

  drawOverlays(context, view, world.rooms, overlays);

  if (hover) {
    const [sx, sy] = [hover.x * view.scale + view.offsetX, hover.y * view.scale + view.offsetY];
    context.strokeStyle = "rgba(241,234,219,0.9)";
    context.lineWidth = 1;
    context.strokeRect(Math.round(sx) - 0.5, Math.round(sy) - 0.5, view.scale + 1, view.scale + 1);
  }
}

// --- readouts ----------------------------------------------------------------

function describeCell(x: number, y: number): string {
  const cell = world.cells[y][x];
  const room = world.rooms.placed.find((placed) =>
    x >= placed.rect.x && x < placed.rect.x + placed.rect.width
    && y >= placed.rect.y && y < placed.rect.y + placed.rect.height);
  const feature = world.rooms.features.find((entry) => entry.x === x && entry.y === y);
  const orphaned = !cell.solid && !reach[y * WORLD_COLS + x];

  const parts = [
    `<b>${x}, ${y}</b> · ${Math.round(depthMetresAt(y))}m · ${BAND_NAMES[cell.band]}`,
    `${PROVINCE_NAMES[cell.province]}${cell.ecotone ? ` → <b>${ECOTONE_NAMES[cell.ecotone]}</b>` : ""}`,
    cell.solid
      ? `<b>${MATERIALS[cell.kind].name}</b> ${cell.hp}hp${cell.persistent ? " · persistent" : ""}${MATERIALS[cell.kind].liable ? " · liable" : " · free to leave"}`
      : `open${orphaned ? ' · <b style="color:#ff655b">unreachable</b>' : ""}`,
    cell.resource ? `carries <b>${RESOURCES[cell.resource].name}</b>` : "",
    room ? `in <b>${room.variant}</b> (${room.tier}, built as ${room.province})` : "",
    feature ? `marker: <b>${feature.marker}</b>` : "",
  ];
  return parts.filter(Boolean).join("<br>");
}

function refreshReport(): void {
  const { report, rooms } = world;
  const counts = new Map<string, number>();
  for (const placed of rooms.placed) counts.set(placed.name, (counts.get(placed.name) ?? 0) + 1);
  const readings = new Set(rooms.placed.map((placed) => placed.variant)).size;
  const substituted = rooms.placed.filter((placed) => {
    const region = ROOM_REGION.get(placed.name);
    return region && region !== "any" && region !== placed.province;
  }).length;
  const transformed = rooms.placed.filter((placed) => placed.variant !== placed.name).length;
  // The report's connectivity numbers are now taken on the finished world, so the tool shows
  // them rather than a second opinion. It keeps measuring independently anyway and flags any
  // disagreement: the last version of this report described a world that never shipped, and a
  // cross-check is cheap insurance against that happening again.
  const walkable = reach.reduce((sum, value) => sum + value, 0);
  const agrees = connectivity.largest === report.networkCells
    && connectivity.open === report.openCells;
  const markerCounts = new Map<string, number>();
  for (const feature of rooms.features) {
    markerCounts.set(feature.marker, (markerCounts.get(feature.marker) ?? 0) + 1);
  }

  const rows: Array<[string, string, string?]> = [
    ["open cells", report.openCells.toLocaleString()],
    ["cave network", `${(report.networkCells / report.openCells * 100).toFixed(1)}%`,
      report.networkCells / report.openCells > 0.95 ? "good" : "bad"],
    ["stranded", report.strandedCells.toLocaleString(), report.strandedCells > 0 ? "bad" : "good"],
    ["Landing pocket", report.startPocketCells.toLocaleString()],
    ["…walkable, measured", walkable.toLocaleString(), agrees ? "good" : "bad"],
    ["Landing exits", report.landingExits.toLocaleString(), report.landingExits > 10 ? "good" : "bad"],
    ["corridors repaired", String(report.repairedCorridors)],
    ["missing landmarks", report.missingLandingFeatures.length
      ? report.missingLandingFeatures.join(", ")
      : "none", report.missingLandingFeatures.length ? "bad" : "good"],
    ["rooms placed", String(rooms.placed.length)],
    ["distinct readings", String(readings)],
    ["most repeated", String(Math.max(0, ...counts.values()))],
    ["mirrored / turned", String(transformed)],
    ["substituted", String(substituted)],
    ["features", String(rooms.features.length)],
    ...[...markerCounts.entries()].sort((a, b) => b[1] - a[1])
      .map(([marker, count]) => [`  ${marker}`, String(count)] as [string, string]),
    ["band I copper", String(report.bandI.copper), report.bandI.copper >= 30 ? "good" : "bad"],
    ["band I coal", String(report.bandI.coal), report.bandI.coal >= 12 ? "good" : "bad"],
    ...([1, 2, 3, 4] as const).map((band) =>
      [`density ${BAND_NAMES[band]}`, `${(report.bandDensity[band] * 100).toFixed(1)}%`] as [string, string]),
    ...(Object.entries(report.ecotoneReagents) as Array<[string, number]>).map(([id, count]) =>
      [`${id} reagent`, String(count), count > 0 ? "good" : "bad"] as [string, string, string]),
  ];

  reportList.innerHTML = rows.map(([key, value, tone]) =>
    `<dt>${key}</dt><dd${tone ? ` class="${tone}"` : ""}>${value}</dd>`).join("");
}

/** Authored region per template, so a placement can be recognised as a foreign rebuild. */
const ROOM_REGION = new Map<string, string>(
  ROOM_TEMPLATES.map((template) => [template.name, template.region]));

// --- controls ----------------------------------------------------------------

function buildLayerControls(): void {
  const host = need<HTMLDivElement>("#layers");
  host.innerHTML = BASE_LAYERS.map((layer) => `
    <label class="check">
      <input type="radio" name="layer" value="${layer.id}"${layer.id === raster.layer ? " checked" : ""} />
      <span>${layer.name}<br><span class="hint">${layer.hint}</span></span>
    </label>`).join("");
  host.addEventListener("change", (event) => {
    const input = event.target as HTMLInputElement;
    raster.layer = input.value as BaseLayer;
    repaintBase();
    invalidate();
  });
}

function buildOverlayControls(): void {
  const host = need<HTMLDivElement>("#overlays");
  const entries: Array<[keyof OverlayOptions | keyof RasterOptions, string, "overlay" | "raster"]> = [
    ["rooms", "Room footprints", "overlay"],
    ["roomLabels", "Room names (zoom past 8×)", "overlay"],
    ["features", "Feature markers", "overlay"],
    ["landmarks", "Landing & cornerstones", "overlay"],
    ["bands", "Depth bands", "overlay"],
    ["grid", "Cell grid (zoom in)", "overlay"],
    ["resources", "Ore tint", "raster"],
    ["persistent", "Persistent material", "raster"],
  ];
  host.innerHTML = entries.map(([key, label, target]) => {
    const on = target === "overlay"
      ? overlays[key as keyof OverlayOptions]
      : raster[key as "resources" | "persistent"];
    return `<label class="check">
      <input type="checkbox" data-target="${target}" data-key="${key}"${on ? " checked" : ""} />
      <span>${label}</span>
    </label>`;
  }).join("");
  host.addEventListener("change", (event) => {
    const input = event.target as HTMLInputElement;
    const key = input.dataset.key!;
    if (input.dataset.target === "raster") {
      raster[key as "resources" | "persistent"] = input.checked;
      repaintBase();
    } else {
      overlays[key as keyof OverlayOptions] = input.checked;
    }
    invalidate();
  });
}

function buildLegends(): void {
  need<HTMLDivElement>("#markerLegend").innerHTML = Object.entries(MARKER_STYLE)
    .map(([marker, style]) =>
      `<span><i class="swatch" style="background:${hex(style.colour)}"></i>${marker}</span>`).join("");
  need<HTMLDivElement>("#resourceLegend").innerHTML = RESOURCE_ORDER
    .map((id) =>
      `<span><i class="swatch" style="background:${resourceColour(id)}"></i>${RESOURCES[id].name}</span>`).join("");
}

function load(seed: string, { keepView = false } = {}): void {
  const label = seed.trim() || DEFAULT_SEED;
  seedField.value = label;
  history.replaceState(null, "", `#${encodeURIComponent(label)}`);
  const started = performance.now();
  world = generateWorld(label);
  reach = reachableFromLanding(world.cells);
  connectivity = largestComponent(world.cells);
  const elapsed = performance.now() - started;
  repaintBase();
  refreshReport();
  if (!keepView) fitView();
  else invalidate();
  readout.innerHTML = `<b>${label}</b> generated in ${elapsed.toFixed(0)}ms. Move over the map.`;
}

function exportPng(pixelsPerCell: number): void {
  const out = document.createElement("canvas");
  out.width = WORLD_COLS * pixelsPerCell;
  out.height = WORLD_ROWS * pixelsPerCell;
  const outContext = out.getContext("2d")!;
  outContext.imageSmoothingEnabled = false;
  outContext.drawImage(base, 0, 0, out.width, out.height);
  drawOverlays(outContext, { scale: pixelsPerCell, offsetX: 0, offsetY: 0 }, world.rooms, overlays);
  out.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `orekanoid-${seedField.value}-${raster.layer}-${pixelsPerCell}x.png`;
    link.click();
    URL.revokeObjectURL(url);
  }, "image/png");
}

// --- interaction -------------------------------------------------------------

function cellUnder(event: MouseEvent): { x: number; y: number } | null {
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor((event.clientX - rect.left - view.offsetX) / view.scale);
  const y = Math.floor((event.clientY - rect.top - view.offsetY) / view.scale);
  if (x < 0 || y < 0 || x >= WORLD_COLS || y >= WORLD_ROWS) return null;
  return { x, y };
}

let dragging: { x: number; y: number } | null = null;

canvas.addEventListener("mousedown", (event) => {
  dragging = { x: event.clientX - view.offsetX, y: event.clientY - view.offsetY };
  canvas.classList.add("dragging");
});
window.addEventListener("mouseup", () => {
  dragging = null;
  canvas.classList.remove("dragging");
});
canvas.addEventListener("mousemove", (event) => {
  if (dragging) {
    view.offsetX = event.clientX - dragging.x;
    view.offsetY = event.clientY - dragging.y;
    invalidate();
    return;
  }
  const cell = cellUnder(event);
  hover = cell;
  readout.innerHTML = cell ? describeCell(cell.x, cell.y) : "Move over the map.";
  invalidate();
});
canvas.addEventListener("mouseleave", () => {
  hover = null;
  invalidate();
});

canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const px = event.clientX - rect.left;
  const py = event.clientY - rect.top;
  // Zoom about the cursor: the cell under the pointer must not move.
  const cellX = (px - view.offsetX) / view.scale;
  const cellY = (py - view.offsetY) / view.scale;
  const next = Math.min(40, Math.max(0.8, view.scale * (event.deltaY < 0 ? 1.14 : 1 / 1.14)));
  view.scale = next;
  view.offsetX = px - cellX * next;
  view.offsetY = py - cellY * next;
  refreshZoom();
  invalidate();
}, { passive: false });

need<HTMLButtonElement>("#reroll").addEventListener("click", () => load(rollSeed()));
need<HTMLButtonElement>("#apply").addEventListener("click", () => load(seedField.value));
seedField.addEventListener("keydown", (event) => {
  if (event.key === "Enter") load(seedField.value);
});
need<HTMLButtonElement>("#copy").addEventListener("click", async () => {
  await navigator.clipboard.writeText(seedField.value);
  readout.innerHTML = `Copied <b>${seedField.value}</b>.`;
});
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-export]")) {
  button.addEventListener("click", () => exportPng(Number(button.dataset.export)));
}

window.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement) return;
  if (event.key === "r" || event.key === "R") load(rollSeed(), { keepView: true });
  if (event.key === "f" || event.key === "F") fitView();
});
// Landing the first fit.
//
// The canvas has no size until layout, so the `fitView` inside `load` bails on startup and
// something has to come back for it. A ResizeObserver is the natural answer and is not
// sufficient on its own: its callbacks are delivered with the rendering steps, so a page that
// loads in a *hidden* tab never receives one and would sit at its default scale, anchored to
// the corner, until the window happened to resize. Timers do run in a hidden tab, so the
// interval is what actually guarantees it -- and it stops as soon as the fit lands.
let fitted = false;
function ensureFitted(): boolean {
  if (fitted) return true;
  if (!canvas.clientWidth || !canvas.clientHeight) return false;
  fitted = true;
  fitView();
  return true;
}

new ResizeObserver(() => {
  if (!ensureFitted()) return;
  invalidate();
}).observe(canvas);

let attempts = 0;
const settle = window.setInterval(() => {
  // Give up after a few seconds rather than leaving a timer running forever: by then either
  // the canvas has a size or something else is wrong and refitting will not fix it.
  if (ensureFitted() || ++attempts > 50) window.clearInterval(settle);
}, 60);

document.addEventListener("visibilitychange", () => {
  ensureFitted();
  invalidate();
});
window.addEventListener("hashchange", () => {
  const seed = seedFromUrl();
  if (seed !== seedField.value) load(seed);
});

buildLayerControls();
buildOverlayControls();
buildLegends();
load(seedFromUrl());

// Expedition persistence.
//
// Orekenoid uses the forgiving expedition model: one persistent world per seed.
// Death costs cargo, never geography or capability, so a save is the record of an
// ongoing expedition rather than a checkpoint in a run.
//
// Geology is a pure function of the seed and is therefore never stored. A save
// holds the seed plus the ordered mutation log, and loading regenerates the world
// and replays the log. That keeps saves small enough to paste into a text field
// and makes an imported save verifiable: if the seed matches, the geology matches.

import { WORLD_COLS, WORLD_ROWS } from "./config";
import type { EconomySnapshot } from "./economy";
import type { WorldEdit } from "./world";

/**
 * Save schema version.
 *
 * v1 -> v2: the economy stopped storing craft counts keyed by recipe id and started storing a
 * grade per station per chassis, when twenty-one flat recipes became six upgradeable stations.
 *
 * v1 saves are *refused*, not migrated, and that is a decision with an expiry date: it is only
 * acceptable because every v1 save in existence is a development save on this machine. Once
 * builds go out to playtesters, a refused save is somebody's lost expedition -- so from that
 * point on, every schema change needs a real migration in `migrate` below rather than a version
 * bump. The seam is here and empty on purpose.
 */
export const SAVE_VERSION = 2;
export const SAVE_KEY = "orekenoid.expedition.v1";

/**
 * Bring an older save forward, or return null if it cannot be brought forward.
 *
 * Empty today. When it stops being empty, each step should be a named function from one
 * version to the next so the chain is readable and individually testable.
 */
function migrate(data: Partial<SaveData>): Partial<SaveData> | null {
  return data.version === SAVE_VERSION ? data : null;
}

export interface MapAnnotation {
  id: string;
  /** World cell coordinates. */
  x: number;
  y: number;
  icon: string;
  note: string;
}

export interface SaveData {
  version: number;
  /** Milliseconds since the epoch, for the load screen and for import ordering. */
  savedAt: number;
  seedLabel: string;
  /** Total wall-clock seconds spent in this expedition. */
  elapsed: number;
  world: {
    history: WorldEdit[];
    /** Bit-packed discovery mask, base64. One bit per cell, row-major. */
    discovered: string;
    /**
     * Indices into the generated world's authored spawn list that have already fired.
     *
     * Optional, and absent means none. That is not a hole in the schema: a save written before encounters
     * were placed is a save from a world where nothing had been spent, so the empty reading is the correct
     * one and no migration is needed to say so.
     */
    spawnsSpent?: number[];
  };
  player: { x: number; y: number; heading: number };
  economy: EconomySnapshot;
  chassisIndex: number;
  chassisIntegrity: Record<string, number>;
  /** Struck mechanism cell keys per cornerstone id. */
  cornerstoneProgress: Record<string, string[]>;
  anchors: Array<{ id: string; x: number; y: number; name: string }>;
  annotations: MapAnnotation[];
  progress: {
    deaths: number;
    tutorialComplete: boolean;
    tutorialDone: string[];
    regionsSeen: string[];
    hasCommitted: boolean;
    hasServed: boolean;
  };
}

// --- Discovery mask codec ---------------------------------------------------

const MASK_BYTES = Math.ceil((WORLD_COLS * WORLD_ROWS) / 8);

/** Pack one-byte-per-cell discovery into one bit per cell, then base64 it. */
export function packDiscovered(discovered: Uint8Array): string {
  const packed = new Uint8Array(MASK_BYTES);
  for (let index = 0; index < discovered.length; index++) {
    if (discovered[index] === 1) packed[index >> 3] |= 1 << (index & 7);
  }
  return bytesToBase64(packed);
}

export function unpackDiscovered(encoded: string, into: Uint8Array): number {
  into.fill(0);
  let count = 0;
  const packed = base64ToBytes(encoded);
  const limit = Math.min(into.length, packed.length * 8);
  for (let index = 0; index < limit; index++) {
    if ((packed[index >> 3] >> (index & 7)) & 1) {
      into[index] = 1;
      count++;
    }
  }
  return count;
}

// btoa/atob are only defined in browsers; the unit tests run in Node. Both paths
// go through these two helpers so the codec is testable without a DOM.
function bytesToBase64(bytes: Uint8Array): string {
  if (typeof btoa === "function") {
    let binary = "";
    // Chunked so a full-world mask never blows the argument limit of fromCharCode.
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
  }
  return Buffer.from(bytes).toString("base64");
}

function base64ToBytes(encoded: string): Uint8Array {
  if (typeof atob === "function") {
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }
  return new Uint8Array(Buffer.from(encoded, "base64"));
}

// --- Validation -------------------------------------------------------------

export interface LoadResult {
  ok: boolean;
  data?: SaveData;
  reason?: string;
}

/**
 * Validate an untrusted save object.
 *
 * Imported files are the one place a hand-edited or truncated payload can reach
 * the game, and a partially-applied save is worse than a refused one: it would
 * silently corrupt an expedition. So this checks shape before anything is applied,
 * and the caller applies nothing on failure.
 */
export function validateSave(value: unknown): LoadResult {
  if (typeof value !== "object" || value === null) return { ok: false, reason: "Not a save file." };
  const raw = value as Partial<SaveData>;
  const data = migrate(raw);
  if (!data) {
    // Named in the message rather than hidden behind a version number, because the player did
    // not choose a schema and cannot act on one.
    return {
      ok: false,
      reason: raw.version === 1
        ? "This expedition predates the refit bay rebuild and cannot be loaded. Start a new one."
        : `Save version ${String(raw.version)} is not supported (expected ${SAVE_VERSION}).`,
    };
  }
  if (typeof data.seedLabel !== "string" || !data.seedLabel) return { ok: false, reason: "Save has no world seed." };
  if (!data.world || typeof data.world.discovered !== "string" || !Array.isArray(data.world.history)) {
    return { ok: false, reason: "Save has no world record." };
  }
  if (!data.player || typeof data.player.x !== "number" || typeof data.player.y !== "number") {
    return { ok: false, reason: "Save has no drone position." };
  }
  if (typeof data.economy !== "object" || data.economy === null) return { ok: false, reason: "Save has no economy." };
  for (const edit of data.world.history) {
    if (!edit || typeof edit !== "object") return { ok: false, reason: "Save contains a malformed world edit." };
    const kind = (edit as WorldEdit).t;
    if (kind !== "cut" && kind !== "grow") return { ok: false, reason: "Save contains an unknown world edit." };
    if (!Number.isFinite((edit as { x: number }).x) || !Number.isFinite((edit as { y: number }).y)) {
      return { ok: false, reason: "Save contains a world edit with no position." };
    }
  }
  return { ok: true, data: withDefaults(data) };
}

/**
 * Fill in anything optional that an older or hand-written save omitted. Only
 * fields the game can safely default belong here -- required fields are rejected
 * by `validateSave` instead.
 */
function withDefaults(data: Partial<SaveData>): SaveData {
  return {
    version: SAVE_VERSION,
    savedAt: typeof data.savedAt === "number" ? data.savedAt : 0,
    seedLabel: data.seedLabel as string,
    elapsed: typeof data.elapsed === "number" ? data.elapsed : 0,
    world: {
      history: data.world?.history ?? [],
      discovered: data.world?.discovered ?? "",
      spawnsSpent: Array.isArray(data.world?.spawnsSpent) ? data.world.spawnsSpent : [],
    },
    player: {
      x: data.player?.x ?? 0,
      y: data.player?.y ?? 0,
      heading: typeof data.player?.heading === "number" ? data.player.heading : Math.PI / 2,
    },
    economy: data.economy as EconomySnapshot,
    chassisIndex: typeof data.chassisIndex === "number" ? data.chassisIndex : 1,
    chassisIntegrity: data.chassisIntegrity ?? {},
    cornerstoneProgress: data.cornerstoneProgress ?? {},
    anchors: data.anchors ?? [],
    annotations: (data.annotations ?? []).filter((note) => note && Number.isFinite(note.x) && Number.isFinite(note.y)),
    progress: {
      deaths: data.progress?.deaths ?? 0,
      tutorialComplete: data.progress?.tutorialComplete ?? false,
      tutorialDone: data.progress?.tutorialDone ?? [],
      regionsSeen: data.progress?.regionsSeen ?? [],
      hasCommitted: data.progress?.hasCommitted ?? false,
      hasServed: data.progress?.hasServed ?? false,
    },
  };
}

// --- Local storage ----------------------------------------------------------

/** Storage can be absent or full; a failed save must never break the game loop. */
export function writeSave(data: SaveData): { ok: boolean; reason?: string } {
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "Could not write the save." };
  }
}

export function readSave(): LoadResult {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(SAVE_KEY);
  } catch {
    return { ok: false, reason: "Local storage is unavailable." };
  }
  if (!raw) return { ok: false, reason: "No saved expedition." };
  return parseSave(raw);
}

export function parseSave(raw: string): LoadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "That file is not valid JSON." };
  }
  return validateSave(parsed);
}

export function clearSave(): void {
  try {
    window.localStorage.removeItem(SAVE_KEY);
  } catch {
    // Nothing useful to do: the caller is resetting anyway.
  }
}

export function hasSave(): boolean {
  try {
    return window.localStorage.getItem(SAVE_KEY) !== null;
  } catch {
    return false;
  }
}

// --- Export and import ------------------------------------------------------

export function saveFileName(data: SaveData): string {
  const stamp = new Date(data.savedAt || Date.now()).toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const seed = data.seedLabel.replace(/[^a-z0-9-]+/gi, "-");
  return `orekanoid-${seed}-${stamp}.json`;
}

/** Hand the player a save file. Two spaces of indent so it stays hand-readable. */
export function exportSave(data: SaveData): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = saveFileName(data);
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked on the next tick so the click has definitely been handled.
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Prompt for a save file and resolve with the parsed result, or null if cancelled. */
export function importSave(): Promise<LoadResult | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.style.display = "none";
    let settled = false;
    const finish = (result: LoadResult | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(result);
    };
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return finish(null);
      const reader = new FileReader();
      reader.addEventListener("load", () => finish(parseSave(String(reader.result ?? ""))));
      reader.addEventListener("error", () => finish({ ok: false, reason: "Could not read that file." }));
      reader.readAsText(file);
    });
    // Fires when the picker is dismissed without choosing anything. Not supported
    // everywhere, which is why `settled` guards double-resolution rather than this.
    input.addEventListener("cancel", () => finish(null));
    document.body.appendChild(input);
    input.click();
  });
}

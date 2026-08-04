#!/usr/bin/env node
// Compile the drawing scripts in rooms/src/ into room PNGs.
//
// The PNG is the canonical asset: the game's build reads PNGs and nothing else, so
// a room painted by hand and a room drawn in code are indistinguishable downstream.
// These scripts exist because stating a shape in coordinates is more precise and far
// more reviewable in a diff than a binary image.

import { readdirSync, writeFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { encodePng } from "./png.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const SRC = join(ROOT, "rooms", "src");

let written = 0;
for (const name of readdirSync(SRC).sort()) {
  if (extname(name) !== ".mjs") continue;
  const module = await import(pathToFileURL(join(SRC, name)).href);
  for (const room of module.rooms ?? []) {
    const out = join(ROOT, "rooms", `${room.name}.png`);
    writeFileSync(out, encodePng(room.canvas.width, room.canvas.height, room.canvas.toPixels()));
    console.log(`${relative(ROOT, out).padEnd(40)} ${room.canvas.width}x${room.canvas.height}  ${room.tier}`);
    written++;
  }
}
console.log(`\n${written} rooms drawn`);

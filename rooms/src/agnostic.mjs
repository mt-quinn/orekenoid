// Province-agnostic rooms.
//
// Built entirely from `#` host rock and `?` random slots, so one authored shape serves all
// three provinces *and* all three ecotones — taking its material from wherever it lands and
// its contents from a weighted roll. That makes these the best return per room in the whole
// library: six shapes here cover as much ground as eighteen province-specific ones.
//
// The constraint is that they cannot express a province rule, since they do not know which
// province they are in. So they carry the other kind of meaning instead: *evidence*. Every
// room here is about somebody having been here before — a choke, a crossing, a basin cut to
// hold something, a drift that was propped and abandoned.

import { Canvas } from "../../tools/canvas.mjs";

/** A choke: a passage half-filled with fallen rock. Squeeze past it or claim it out. */
function rubbleChoke() {
  const room = new Canvas(18, 9, "-");
  room.ellipse(5, 4.4, 5, 4.2, ".");
  room.ellipse(13.5, 4.4, 5, 4.2, ".");
  room.rect(8, 3, 10, 5, ".");
  // The choke itself: rubble heaped into the throat from above, leaving one clear cell.
  room.rect(8, 5, 10, 8, "#");
  room.rect(8, 1, 10, 2, "#");
  room.set(9, 4, ".");
  room.rect(1, 8, 7, 8, "#");
  room.rect(11, 8, 16, 8, "#");
  room.set(2, 3, "?");
  room.rect(15, 3, 16, 4, "#");
  room.set(16, 4, "1");
  return room;
}

/** A crossing: two routes meeting around a central island of rock. */
function crossroads() {
  const room = new Canvas(18, 9, "-");
  room.ellipse(9, 4.4, 8.6, 4.2, ".");
  room.rect(1, 3, 16, 5, ".");
  // The island. Small enough to go round either way, big enough to be worth framing.
  room.ellipse(9, 4.4, 2.4, 1.8, "#");
  room.rect(1, 8, 16, 8, "#");
  room.set(9, 4, "?");
  room.set(3, 2, "?");
  room.set(15, 6, "*");
  return room;
}

/** A basin: a bowl cut into the floor, cleanly, by somebody who wanted it to hold something. */
function cistern() {
  const room = new Canvas(12, 9, "-");
  room.ellipse(5.5, 4.4, 5.8, 4.2, ".");
  // The bowl. Machined-smooth rather than eroded, which is the whole tell.
  room.ellipse(5.5, 8, 4.4, 2.4, "#");
  room.ellipse(5.5, 8, 3.2, 1.8, ".");
  room.rect(1, 8, 10, 8, "#");
  room.set(2, 5, "#");
  room.set(9, 5, "#");
  room.set(5, 7, "?");
  room.set(3, 2, "*");
  return room;
}

/** A drift, propped and abandoned. Straight lines meeting organic ones. */
function timberedDrift() {
  const room = new Canvas(18, 9, "-");
  room.ellipse(9, 4.4, 8.6, 4.2, ".");
  room.rect(2, 3, 15, 6, ".");
  room.rect(2, 7, 15, 8, "#");
  // Props at intervals, and one that has already failed -- which is what dates the drift.
  for (const x of [4, 8, 12]) {
    room.set(x, 2, "#");
    room.set(x, 6, "#");
  }
  room.set(15, 4, "#");
  room.set(15, 5, "#");
  room.set(6, 6, "?");
  room.set(13, 2, "?");
  room.set(3, 4, "4");
  return room;
}

export const rooms = [
  { name: "any-rubble-choke", tier: "chamber", canvas: rubbleChoke() },
  { name: "any-crossroads", tier: "chamber", canvas: crossroads() },
  { name: "any-cistern", tier: "feature", canvas: cistern() },
  { name: "any-timbered-drift-b12", tier: "chamber", canvas: timberedDrift() },
];

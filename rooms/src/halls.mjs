// Halls.
//
// A hall is a full screen and the rarest tier: about ten placements in a world. That makes
// it the only tier a player will remember individually, so each one has to be a *place* —
// something you could describe to someone else — and each has to express its province rule
// at a scale the smaller tiers cannot.
//
// The existing three (colonnade, cathedral, hollow bole) are all *symmetrical enclosures*.
// These five are deliberately not: a staircase, a single vast plane, an arcade, a slope, and
// a junction. Silhouette is the first thing the eye compares, and on a contact sheet three
// symmetrical drums read as one room.

import { Canvas } from "../../tools/canvas.mjs";

/**
 * Draw a horseshoe arch: a filled ellipse, hollowed, then opened below the springline.
 * Arches are the one shape that reads unmistakably as *built* at hall scale.
 */
function arch(room, cx, springY, rx, ry, glyph) {
  room.ellipse(cx, springY, rx, ry, glyph);
  room.ellipse(cx, springY, rx - 1.4, ry - 1.4, ".");
  room.rect(Math.round(cx - rx + 1.4), springY + 1, Math.round(cx + rx - 1.4), springY + Math.ceil(ry), ".");
  return room;
}

/**
 * Surveyor's Karst: a worked-out stope, stepped in slate benches descending across the hall.
 *
 * The rule at scale: every bench is non-liable, so a claim framed down the staircase can keep
 * the entire structure standing and pay nothing for it — the largest free wall in the game,
 * and simultaneously the largest iron deposit, which is the Karst trade at its sharpest.
 */
function stope() {
  const room = new Canvas(36, 18, "-");
  room.ellipse(12, 7, 12, 6.6, ".");
  room.ellipse(24, 11, 12, 6.6, ".");
  // Six benches stepping down left to right. One cell of tread, two of riser.
  for (let step = 0; step < 6; step++) {
    const x = 3 + step * 5;
    const y = 4 + step * 2;
    room.rect(x, y, x + 5, y, "s");
    room.rect(x + 4, y + 1, x + 5, y + 2, "s");
  }
  room.rect(2, 16, 33, 17, "c");
  // A coal seam along the third bench, so the staircase is fuel as well as iron.
  room.rect(13, 7, 19, 7, "k");
  // Seams inside two of the benches: buried, and reached by working the bench itself.
  room.set(9, 6, "3");
  room.set(28, 15, "3");
  room.set(20, 4, "2");
  for (const [x, y] of [[5, 3], [17, 10], [31, 13], [24, 8]]) room.set(x, y, "?");
  return room;
}

/**
 * Mirrorreef: one vast coherent facet plane, corner to corner.
 *
 * The largest single reflecting surface in the world. Frame a claim along it and every ball
 * banks the length of the hall; frame across it and nothing survives. There is no
 * intermediate reading, which is what makes it the province's statement piece.
 */
function faultFace() {
  const room = new Canvas(36, 18, "-");
  room.ellipse(11, 6, 11, 5.6, ".");
  room.ellipse(25, 12, 11, 5.6, ".");
  room.ellipse(18, 9, 15, 7.6, ".");
  // The plane. Two cells thick and unbroken, all on one axis.
  room.band(2, 15, 33, 2, 2, "/");
  // Reef buttresses bracing it at three points, so it reads as held rather than floating.
  for (const [x, y] of [[8, 12], [18, 8], [28, 4]]) room.rect(x, y, x + 2, y + 2, "r");
  room.rect(2, 16, 33, 17, "r");
  // Charged crystal at the high end: the cascade runs *down* the plane if it is started there.
  room.set(31, 3, "%");
  room.set(29, 4, "%");
  room.set(6, 14, "3");
  room.set(24, 8, "3");
  room.set(18, 5, "2");
  for (const [x, y] of [[4, 10], [14, 13], [33, 8]]) room.set(x, y, "?");
  return room;
}

/**
 * Rootwarren: a root vault. Three heartwood arches with living rock in the spandrels and
 * spore bulbs at the apexes.
 *
 * The rule at scale: the arches are the only stable thing here and they are expensive at
 * three hits, while everything filling the gaps between them is liable and grows back. Clear
 * the spandrels and they return; take out an arch and nothing does.
 */
function rootVault() {
  const room = new Canvas(36, 18, "-");
  room.ellipse(18, 9, 17.5, 8.6, ".");
  room.rect(2, 16, 33, 17, "w");
  for (const cx of [9, 18, 27]) arch(room, cx, 12, 5.5, 7, "h");
  // Living rock in the spandrels, where the arches meet: liable, and it comes back.
  for (const x of [4, 13.5, 22.5, 32]) room.ellipse(x, 6, 2.4, 2, "l");
  // Bulbs at each apex, so their membranes hang where the ball travels highest.
  for (const cx of [9, 18, 27]) room.set(cx, 6, "b");
  room.set(18, 15, "3");
  room.set(6, 6, "3");
  room.set(18, 3, "2");
  for (const [x, y] of [[13, 14], [23, 14], [31, 11]]) room.set(x, y, "?");
  return room;
}

/**
 * A great collapse. A talus slope running the length of the hall from a roof breach at one
 * end down to the floor at the other.
 *
 * Province-agnostic, so it reads in its own local rock — and the most universally legible
 * "something enormous happened here" available in any material.
 */
function greatCollapse() {
  const room = new Canvas(36, 18, "-");
  room.ellipse(18, 9, 17.5, 8.6, ".");
  // The breach, at the left end of the roof.
  room.rect(4, 0, 9, 2, ".");
  // The slope: thickest under the breach, thinning to nothing at the far end.
  for (let x = 2; x <= 33; x++) {
    const height = Math.max(0, Math.round(8 - (x - 2) * 0.28));
    if (height <= 0) continue;
    room.rect(x, 17 - height, x, 17, "#");
  }
  // A few large blocks that fell clear of the heap, which is what gives the slope scale.
  for (const [x, y] of [[22, 13], [27, 15], [19, 15]]) room.ellipse(x, y, 1.8, 1.2, "#");
  // Buried in the slope, at the depths a claim would have to work down to.
  room.set(7, 12, "?");
  room.set(12, 13, "?");
  room.set(5, 11, "1");
  room.set(24, 6, "2");
  for (const [x, y] of [[16, 6], [30, 12]]) room.set(x, y, "?");
  return room;
}

/**
 * A shaft junction: three old drifts meeting in one chamber, timbered and staked.
 *
 * The only hall built by people rather than geology. It is also the only one with four ways
 * through, which makes it a genuine crossroads on the Atlas rather than a dead end with a
 * view.
 */
function shaftJunction() {
  const room = new Canvas(36, 18, "-");
  room.ellipse(18, 10, 11.5, 7, ".");
  // Three drifts: two lateral, one rising. Three cells tall, which is comfortable at any
  // heading -- a junction is somewhere to pass through, not somewhere to be pinched. The
  // first version was two cells and mostly transparent, so the hall read as a thin cross
  // rather than as a chamber anything converged on.
  room.rect(1, 9, 12, 11, ".");
  room.rect(24, 9, 34, 11, ".");
  room.band(19, 6, 29, 1, 3, ".");
  room.rect(2, 16, 33, 17, "#");
  // Timbering: paired props down the lateral drifts, with a stake at the junction itself.
  for (const x of [5, 9, 27, 31]) {
    room.set(x, 8, "#");
    room.set(x, 12, "#");
  }
  room.set(18, 15, "T");
  room.set(18, 14, "4");
  // The old workings paid off somewhere, and the tell is left in the walls.
  room.set(3, 12, "1");
  room.set(33, 7, "?");
  room.set(14, 5, "2");
  for (const [x, y] of [[12, 13], [22, 14], [26, 5]]) room.set(x, y, "?");
  return room;
}

export const rooms = [
  { name: "karst-stope", tier: "hall", canvas: stope() },
  { name: "mirrorreef-fault-face", tier: "hall", canvas: faultFace() },
  { name: "rootwarren-root-vault", tier: "hall", canvas: rootVault() },
  { name: "any-great-collapse-b34", tier: "hall", canvas: greatCollapse() },
  { name: "any-shaft-junction-b12", tier: "hall", canvas: shaftJunction() },
];

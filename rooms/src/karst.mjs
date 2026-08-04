// Surveyor's Karst rooms.
//
// The province rule is: chalk breaks in one hit; slate takes four, is non-liable,
// and is iron-rich. So the interesting thing a Karst room can contain is *a slate
// bank you have to decide about* — the best wall and the best iron, and you cannot
// have both from the same stone. Every room here is a different framing of that
// decision, which is what makes them worth walking to rather than past.
//
// Cavity shapes deliberately leave their corners transparent, so a stamped room
// merges into the surrounding cave field instead of cutting a rectangle into rock.

import { Canvas } from "../../tools/canvas.mjs";

/** A half-screen chamber crossed corner-to-corner by a slate bank. */
function slateBank() {
  const room = new Canvas(18, 9, "-");
  // The cavity: two overlapping lobes, taller on the left. A single centred ellipse is
  // what every chamber used at first, and on a contact sheet fourteen of them read as one
  // room -- silhouette is the first thing the eye compares, so it has to vary per room.
  room.ellipse(6, 4.4, 6, 4.4, ".");
  room.ellipse(12.5, 4.6, 5.4, 3.6, ".");
  // Chalk floor, one row, stepping up on the right so the far side is a shelf.
  room.rect(1, 8, 16, 8, "c");
  room.rect(12, 7, 16, 7, "c");
  // The bank: two cells thick, floor to ceiling, splitting the chamber in two.
  // Frame with it and it is a wall that costs nothing to leave; break it and it
  // pays iron. `band` rather than stacked lines, so it reads as one solid object.
  room.band(5, 8, 11, 0, 2, "s");
  // A coal seam along the bank's near face, so the bank is also fuel.
  room.band(4, 8, 9, 3, 1, "k");
  // The payoff, buried on the far side: reaching it means solving the bank first.
  room.rect(14, 2, 15, 3, "c");
  room.set(15, 3, "3");
  room.set(5, 2, "*");
  room.set(13, 5, "*");
  return room;
}

/**
 * A pinch: two chambers joined by a gap the drone barely fits.
 * This is the clearance variety our generator cannot currently produce at all.
 */
function pinch() {
  const room = new Canvas(18, 9, "-");
  // Two lobes of different size, so the pinch is visibly between unequal rooms.
  room.ellipse(4, 4.4, 4.2, 4.4, ".");
  room.ellipse(13.5, 4, 4.6, 3.8, ".");
  // The squeeze. Three cells of throat, walled in slate so it cannot be widened
  // cheaply — the player either fits or frames a claim to open it.
  room.rect(8, 3, 10, 5, ".");
  room.rect(8, 1, 10, 2, "s");
  room.rect(8, 6, 10, 8, "s");
  room.rect(1, 7, 7, 8, "c");
  room.rect(11, 7, 16, 8, "c");
  room.set(2, 3, "*");
  // The reward for getting through the squeeze, buried in the far wall so the
  // squeeze buys a claim rather than a free pickup.
  room.rect(15, 2, 16, 4, "c");
  room.set(16, 3, "1");
  return room;
}

/** A feature-tier find: an old survey triangle, three stakes around a pocket. */
function surveyStakes() {
  const room = new Canvas(10, 8, "-");
  room.ellipse(4.5, 4, 4.5, 3.6, ".");
  room.rect(1, 6, 8, 7, "c");
  // Three stakes. Persistent, so they survive any claim that frames them — the
  // brief requires that a clue can never be unknowably destroyed.
  room.set(2, 5, "T");
  room.set(7, 5, "T");
  room.set(4, 1, "T");
  // The calibration pocket the triangle implies.
  room.set(4, 4, "4");
  room.set(5, 4, "*");
  return room;
}

/** A hall: full-screen, memorable, with a slate colonnade holding up the roof. */
function colonnade() {
  const room = new Canvas(36, 18, "-");
  room.ellipse(18, 9, 17.5, 8.6, ".");
  room.rect(2, 16, 33, 17, "c");
  // Five slate columns, one cell thick with a capital. Non-liable, so a claim can
  // keep every one of them -- and thin enough that the hall stays flyable, which is
  // what the reference rooms spend most of their area on.
  for (const x of [7, 13, 19, 25, 31]) {
    room.rect(x, 5, x, 16, "s");
    room.rect(x - 1, 4, x + 1, 4, "s");
  }
  // A chalk vault line, so the roof reads as load-bearing rather than arbitrary.
  room.line(4, 3, 17, 1, "c");
  room.line(18, 1, 32, 3, "c");
  room.ellipse(18, 15, 3.2, 1, "k");
  // Buried markers must sit *inside* a rock mass. Placed in open space they resolve
  // to a lone one-cell block hanging in the hall, which reads as a mistake rather
  // than as a seam. One goes into the floor, one into a column's base.
  room.set(10, 17, "3");
  room.set(25, 13, "3");
  // The anomaly hangs in the vault: conspicuous, unreachable without a claim, and
  // the kind of thing the discovery layer will hang a puzzle on.
  room.set(18, 6, "2");
  for (const [x, y] of [[4, 13], [16, 14], [22, 6], [33, 12]]) room.set(x, y, "*");
  return room;
}

export const rooms = [
  { name: "karst-slate-bank", tier: "chamber", canvas: slateBank() },
  { name: "karst-pinch", tier: "chamber", canvas: pinch() },
  { name: "karst-survey-stakes-b12", tier: "feature", canvas: surveyStakes() },
  { name: "karst-colonnade-b12", tier: "hall", canvas: colonnade() },
];

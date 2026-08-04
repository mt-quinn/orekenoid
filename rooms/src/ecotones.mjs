// Ecotone rooms.
//
// An ecotone is where two provinces overlap, and the brief gives it two jobs: it combines
// both parent rules, and it is the *only* source of the three reagents that fabricate new
// chassis. So an ecotone room has to earn a long journey twice over — once by playing
// differently from either parent, and once by holding something obtainable nowhere else.
//
// These rooms are the only ones in the library restricted to a single region, and the
// generator enforces it: a non-ecotone site never accepts an ecotone template, because a
// Bright Fault room appearing in pure Karst would hand out diamond that the economy expects
// to gate a descent behind.
//
// The hybrid materials carry both parents' behaviour, and that combination is the whole
// design of each room:
//
//   mirrorSlate (Bright Fault)   4 hits, non-liable, AND turns the ball 90 degrees.
//                                Karst's free wall that is also Mirrorreef's mirror -- the
//                                best banking geometry in the game. Diamond.
//   chalkroot   (Chalk Warren)   2 hits, liable, and regrows. Karst's cheap rock that comes
//                                back. Saltpeter.
//   bloomcrystal (Bloom Shelf)   2 hits, turns the ball, AND regrows. A lattice that repairs
//                                itself. Vitriol.

import { Canvas } from "../../tools/canvas.mjs";

/**
 * The Bright Fault: a mirror-slate bank, which is the single best object in the game to
 * frame a claim against. Four hits, costs nothing to leave standing, and turns every ball
 * that touches it by a right angle -- so a claim aligned to it banks shots around the
 * chamber instead of losing them.
 */
function brightFaultBank() {
  const room = new Canvas(18, 9, "-");
  room.ellipse(6, 4.6, 6, 4.2, ".");
  room.ellipse(13, 4, 5.4, 4, ".");
  room.rect(1, 8, 16, 8, "m");
  // Two mirror-slate faces angled toward each other, forming a banking pocket. Both are
  // non-liable, so the whole apparatus can be left standing for nothing.
  room.band(3, 7, 8, 2, 2, "m");
  room.band(15, 7, 11, 2, 2, "m");
  // The diamond sits in the pocket the two faces aim at: the only way to it is through a
  // claim that uses the banking rather than fighting it.
  room.rect(9, 4, 10, 5, "m");
  room.set(9, 5, "3");
  room.set(6, 2, "?");
  room.set(14, 5, "*");
  return room;
}

/**
 * The Chalk Warren: growth eating chalk. Chalkroot is two hits and regrows, so a chamber
 * lined with it punishes clearing and rewards cutting exactly what you need -- Karst's
 * cheapest rock turned into Rootwarren's problem.
 */
function chalkWarrenGrowth() {
  const room = new Canvas(18, 9, "-");
  room.ellipse(8.5, 4.6, 8.4, 4.2, ".");
  room.ellipse(6, 3, 4.6, 2.6, ".");
  room.rect(1, 8, 16, 8, "x");
  // Slate ribs hold the roof: non-liable, does not regrow, and the only stable thing here.
  for (const x of [5, 11]) room.rect(x, 5, x, 8, "s");
  // Chalkroot in the bays between the ribs, so each bay regrows independently. Kept low and
  // flat: the decision is which bay to cut, and a bay filled to the roof is a wall instead.
  room.ellipse(3, 6.8, 1.8, 1, "x");
  room.ellipse(8, 6.8, 2.2, 1, "x");
  room.ellipse(14, 6.6, 2.4, 1.2, "x");
  // Saltpeter in the thickest growth, so the reagent is behind the regrowth problem.
  room.set(14, 7, "3");
  room.set(2, 3, "?");
  room.set(16, 3, "*");
  return room;
}

/**
 * The Bloom Shelf: a self-repairing lattice. Bloomcrystal turns the ball *and* grows back,
 * so a cascade you run once will partly rebuild itself -- the only place in the world where
 * the geometry you are playing against is not stable.
 */
function bloomShelfLattice() {
  const room = new Canvas(18, 9, "-");
  room.ellipse(5, 4.4, 5, 4.2, ".");
  room.ellipse(13, 4.4, 5, 4.2, ".");
  room.ellipse(9, 4.4, 2.6, 3.4, ".");
  room.rect(1, 8, 16, 8, "y");
  // Bloomcrystal ribs on one coherent axis, so the reflections are readable even though the
  // lattice will not stay where you left it.
  for (let i = 0; i < 4; i++) room.band(3 + i * 4, 7, 5 + i * 4, 3, 1, "y");
  // A charged facet at the centre: the cascade seed. It will not regrow -- only the
  // bloomcrystal around it does, which is what makes the room a race rather than a puzzle.
  room.set(9, 5, "%");
  // Vitriol under the lattice.
  room.rect(8, 6, 10, 6, "y");
  room.set(9, 6, "3");
  room.set(2, 2, "?");
  room.set(15, 2, "?");
  return room;
}


// --- Feature tier -----------------------------------------------------------
//
// Ecotones are the most eroded ground in the world -- only about a third of an ecotone cell
// is solid, against 57% worldwide -- so an 18x9 chamber footprint finds enough rock to carve
// into roughly three times in a hundred. The reagent rooms were therefore placing almost
// never. A feature footprint needs a fifth of the contiguous rock, so these are what
// actually deliver diamond, saltpeter and vitriol to a world.

/** A mirror-slate nook: one banking face, one diamond behind it. */
function mirrorNook() {
  const room = new Canvas(10, 8, "-");
  room.ellipse(4.5, 4, 4.8, 3.9, ".");
  room.rect(1, 7, 8, 7, "m");
  // A single angled face. Non-liable and reflective, so it is free to leave and useful to
  // bank off -- the Bright Fault's whole proposition in one object.
  room.band(2, 6, 7, 3, 1, "m");
  room.rect(7, 3, 8, 4, "m");
  room.set(8, 4, "3");
  room.set(2, 2, "?");
  return room;
}

/** A root pocket: chalkroot grown over saltpeter, which regrows back over it. */
function rootPocket() {
  const room = new Canvas(10, 8, "-");
  room.ellipse(4.5, 4, 4.8, 3.9, ".");
  room.rect(1, 7, 8, 7, "x");
  // Growth in a shallow basin, with a slate lip that will not regrow to brace against.
  room.rect(2, 6, 7, 6, "x");
  room.ellipse(5, 5.4, 2.2, 1, "x");
  room.set(2, 5, "s");
  room.set(7, 5, "s");
  room.set(5, 6, "3");
  room.set(8, 2, "?");
  return room;
}

/** A bloom bud: a self-repairing crystal knot holding vitriol. */
function bloomBud() {
  const room = new Canvas(10, 8, "-");
  room.ellipse(4.5, 4, 4.8, 3.9, ".");
  room.rect(1, 7, 8, 7, "y");
  // A bud rather than a wall: bloomcrystal turns the ball and grows back, so a small dense
  // knot is a moving target where a large one would simply be a barrier.
  room.ellipse(4.5, 4.6, 2, 1.6, "y");
  room.ellipse(4.5, 4.6, 0.9, 0.7, ".");
  room.set(4, 5, "3");
  room.set(8, 2, "?");
  room.set(2, 2, "*");
  return room;
}


// --- Chambers sized for eroded ground ---------------------------------------
//
// The 18x9 chambers above almost never place, and measuring showed why: ecotone rock is only
// about a third solid, so a full-width footprint finds enough of it roughly three times in a
// hundred. These are 13x10 -- still chamber tier, half the footprint, and they land.

/** A shear: two mirror-slate faces offset past each other, banking across a narrow gap. */
function brightFaultShear() {
  const room = new Canvas(13, 10, "-");
  room.ellipse(6, 5, 6.2, 4.8, ".");
  room.rect(1, 9, 11, 9, "m");
  // Offset rather than opposed, so a ball entering the gap is turned along it rather than
  // straight back -- the geometry that makes mirror slate worth travelling for.
  room.band(2, 3, 7, 3, 2, "m");
  room.band(5, 7, 10, 7, 2, "m");
  room.rect(9, 4, 10, 5, "m");
  room.set(10, 5, "3");
  room.set(2, 6, "?");
  return room;
}

/** Bays of chalkroot between slate ribs: cut one bay at a time or watch them all return. */
function chalkWarrenBays() {
  const room = new Canvas(13, 10, "-");
  room.ellipse(6, 5, 6.2, 4.8, ".");
  room.rect(1, 9, 11, 9, "x");
  for (const x of [4, 8]) room.rect(x, 6, x, 9, "s");
  room.ellipse(2.5, 7.6, 1.4, 1, "x");
  room.ellipse(6, 7.6, 1.6, 1, "x");
  room.ellipse(10, 7.4, 1.6, 1.2, "x");
  room.set(10, 8, "3");
  room.set(3, 3, "?");
  room.set(9, 3, "*");
  return room;
}

/** A bower of bloomcrystal: a lattice arch that repairs itself while you work under it. */
function bloomShelfBower() {
  const room = new Canvas(13, 10, "-");
  room.ellipse(6, 5, 6.2, 4.8, ".");
  room.rect(1, 9, 11, 9, "y");
  // An arch of bloomcrystal on one axis, so the reflections stay readable as it regrows.
  room.band(2, 7, 6, 3, 1, "y");
  room.band(6, 3, 10, 7, 1, "y");
  room.set(6, 3, "%");
  room.rect(5, 6, 7, 6, "y");
  room.set(6, 6, "3");
  room.set(2, 4, "?");
  return room;
}

export const rooms = [
  { name: "brightfault-bank", tier: "chamber", canvas: brightFaultBank() },
  { name: "brightfault-shear", tier: "chamber", canvas: brightFaultShear() },
  { name: "chalkwarren-bays", tier: "chamber", canvas: chalkWarrenBays() },
  { name: "bloomshelf-bower", tier: "chamber", canvas: bloomShelfBower() },
  { name: "brightfault-mirror-nook", tier: "feature", canvas: mirrorNook() },
  { name: "chalkwarren-root-pocket", tier: "feature", canvas: rootPocket() },
  { name: "bloomshelf-bud-rot", tier: "feature", canvas: bloomBud() },
  { name: "chalkwarren-growth", tier: "chamber", canvas: chalkWarrenGrowth() },
  { name: "bloomshelf-lattice", tier: "chamber", canvas: bloomShelfLattice() },
];

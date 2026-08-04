# Progress Log

## Session: 2026-08-04 — The Multipliers

Phase 1 of `WORLD_DETAIL_BRIEF.md`, complete. **42 authored rooms now expand to 94 variants**,
and any one province can draw on **50–64** of them where it could draw on 15. A world places
47–59 rooms as **38–50 distinct readings**, repeating no authored composition more than 3
times.

The wrong way to get variety here is procedural jitter, which produces variation without
composition — a hundred rooms that all feel like noise. The right way is the one both
reference games use: take each authored composition and read it more than one way.

### Substitution, which is by far the largest of the four

A room is rebuilt in another province's materials, mapped by **structural role** rather than
by material: `plain` filler, the `structural` hard rock, the province's `rule`-bearing
material, an `accent`. `karst-slate-shelf` is not really "a shelf made of slate" — it is "a
shelf of the local hard rock over a pocket of the local soft rock", which is buildable
anywhere. The play changes with the move and *that is the feature*: a slate shelf is free to
leave standing, and the heartwood shelf it becomes in the Rootwarren is not. The same
silhouette asks a different question in each province. 15–24 placements per world are now
rooms rebuilt in a foreign vocabulary.

Two refusals, both of which turned out to matter:

- **`-fixed`**, for a design that depends on a material *behaviour* rather than a role. A
  cascade chain rebuilt in chalk and coal is a ring of rubble with no reason to exist, because
  only charged facet chains. Three Mirrorreef rooms.
- **Role collision**, detected automatically. The Rootwarren is the only province that uses
  different materials for hard rock and rule — heartwood and living block — where Karst uses
  slate for both. A Rootwarren room built from both has two distinct structural ideas that
  Karst cannot tell apart, and rebuilding it there would merge the cells and the growth
  filling them into one slab. Six rooms stay home, and none of them needed tagging.

### The other three

- **Mirroring**, on by default. It also flips the facet axis glyphs `/ \ % &`, because a
  reflecting diagonal is a direction: a mirrored lattice wall would otherwise have
  reflections that contradict its own drawn geometry — the one bug in this pass that would be
  invisible in a screenshot and obvious in play.
- **Quarter turns**, which the brief expected to be opt-*out* and are in fact opt-**in**
  (`-rot`). A quarter turn puts a room's floor on a wall. That reads for a room composed
  around a centre — a vent, a charge node, a knot, a bud — and is nonsense for a spoil heap or
  a talus slope, whose entire subject is material lying on the ground. Five rooms qualify.
- **Depth-band gating** via `-b12` / `-b34` filename tags. Ten rooms: human workings shallow,
  the grand and the strange deep. Sparse on purpose — gating everything starves a band's pool
  instead of shaping it.

Repeat budgets now count authored **families** rather than variants, so four readings of one
composition still spend one unit. Letting mirrors dodge the budget would hand back exactly the
wallpaper the budget exists to prevent.

### A bug the pass exposed, and the threshold I nearly moved

Band I copper failed its affordability contract on one seed by a single cell: 29 against a
required 30. The cheap read was that the threshold was too tight.

It was not. Stamping assigned `resource: null` to every cell it painted, so **every room was a
barren patch cut out of the ore field** — and the seed that failed was the one with the most
rooms in Band I. With rooms covering a growing share of the world, and about to cover four
times as much, that was eroding the shallow economy where the first recipe gate lives. Rooms
now take their ore from `resourceFor`, the same function the field pass uses, so a room's rock
carries ore at exactly the rate its surroundings do. Band I copper went from 29–37 to 32–55. A
stamped room had no reason to be barren.

Fixing it exposed a second, smaller thing: a guaranteed cache in an ecotone was paying copper,
and copper is an ore inclusion that cannot ride in an ecotone hybrid. The resource-to-material
law now lives in one place as `canHost`, which both the generator and the test read — the test
had been carrying its own copy that described what rooms happened to do rather than what the
world's rule is.

### Verified

Strict TypeScript, production build, **127 unit tests** (12 new: composition survives every
transform, transparent margins survive, axes reverse with handedness, substitution refuses to
flatten, `-fixed` and ecotone rooms never travel, the pool is deep enough, depth gating holds,
and a check that each multiplier actually fires rather than shipping idle). Both browser flows.
All 42 rooms still inside the reference composition band. Live page renders with no console
errors.

### Next

The library is no longer the constraint — the world frame is. Placement counts come from a
density per thousand cells, so at 240×144 the mine cannot hold more rooms than it already
does. Phase 2: reshape to **240 × 576**, rule-based province placement instead of noise
fields, clearance as a designed variable, and the Atlas at 2–3 px/cell with the current 5 px
as a zoom level.


## Session: 2026-08-04 — Halls, Agnostic Rooms, and the Ecotone Guarantee

Library from 30 rooms to **42**, and the three reagent regions now deliver on every seed
rather than most of them. A world places **49–62 rooms carrying 133–149 features**, uses
**33–37 distinct templates**, and repeats none more than **3** times.

### The rooms

- **5 new halls**, taking the tier from 3 to 8. A hall is the rarest tier and the only one a
  player remembers individually, and all three existing halls were symmetrical enclosures —
  on a contact sheet three symmetrical drums read as one room. The new five are deliberately
  not: a stepped stope, one vast unbroken facet plane, a three-arch root vault, a talus slope
  under a roof breach, and a timbered shaft junction with four ways through. Eight halls, eight
  distinct silhouettes.
- **3 ecotone chambers at 13×10**, half the footprint of the 18×9 originals. Ecotone ground is
  only about a third solid, so a full-width chamber found enough rock roughly three times in a
  hundred; these land.
- Province-agnostic rooms up to 10 total, which give the best return per room in the library
  because one authored shape serves all three provinces *and* all three ecotones.

### The ecotone guarantee

One seed in four still placed no ecotone room at all, which quietly removes diamond, saltpeter
or vitriol from a whole world. Rejection sampling was never going to close that, so the
generator now *guarantees* it, in the same spirit as the connectivity repair: the contract says
these places matter, so it makes them exist instead of hoping.

The first version of the guarantee ran after the main tier loop and still failed on the same
seed. Instrumenting the rejection reasons found the cause and it was not the one I expected:
**94% of ecotone sites were already reserved** by the 48 rooms the general pass had just
placed, not rejected for want of solid rock. The fix is priority order, not thresholds — the
guarantee now runs *before* the tier loop, while the StructureMap holds only authored
territory, so the region-locked progression rooms get first refusal on ground and the general
passes fill in around them. This is the order Terraria uses when it places the Dungeon and the
Jungle Temple ahead of its general passes. All six test seeds now report `placed` for all three
ecotones.

### Verified

Strict TypeScript, production build, **119 unit tests**, both browser flows (39s each). All 42
rooms pass `roomkit profile` with no notes. Debug instrumentation removed.

### Next

The library is no longer the constraint on variety; the *world* is. From
`WORLD_DETAIL_BRIEF.md`: the multipliers that turn 42 authored rooms into several hundred
placements (horizontal mirroring, 90° chamber rotation, material substitution, depth-band
gating), then the world frame itself — reshaping to the agreed **240 × 576** deep mine.


## Session: 2026-08-04 — The Library Reaches Its Repeat Budget

Took the library from 14 rooms to **30**, and fixed the two placement problems that were
making it feel far smaller than it was. A world now places **48–55 rooms carrying 131–143
features**, uses **22–26 of the 30 templates**, and repeats none more than 5 times.

### The rooms

- **10 feature-tier rooms**, the worst-starved tier — features are 59% of all placements but
  were only 2 of 14 templates. Two Karst, two Mirrorreef, two Rootwarren and four
  province-agnostic built from `#` host rock and `?` slots, so one authored shape serves all
  three provinces *and* all three ecotones.
- **6 ecotone rooms**, which had nothing at all. These are the sole source of diamond,
  saltpeter and vitriol, so each is designed around what its hybrid material uniquely does:
  mirror slate is Karst's free wall that is also Mirrorreef's mirror, chalkroot is cheap rock
  that comes back, bloomcrystal is a lattice that repairs itself.

Ecotone placement needed generator support: templates now carry a `region` that may be an
ecotone id, and a non-ecotone site never accepts an ecotone template — otherwise a Bright
Fault room in pure Karst would hand out diamond the economy expects to gate a descent behind.
Host rock and seams resolve to the ecotone hybrid and its reagent when a room lands in one.

### Two placement bugs that made the library look small

**One template was landing twelve times while others landed once.** Candidate selection was
uniform, so with the ecotone rooms first in the list that ordering meant nothing. Now it picks
the *least-used* candidate and breaks ties randomly. **Most-repeated fell from 12 to 4**, and
distinct templates placed rose from 19 to 26. This did more for perceived variety than a dozen
more rooms would have.

**Ecotone rooms placed 1, 0 and 0 times across three seeds** — so the three reagents they exist
to deliver never arrived. Two causes, and the second was the real one:

- Uniform site sampling almost never landed in an ecotone, since ecotones cover a few per cent
  of the world. A third of attempts now draw from a precomputed list of ecotone cells.
- That alone did not help, and measuring showed why: **ecotone ground is only 32.8% solid
  against 57% worldwide**, because ecotones sit where the cave field is most eroded. An 18×9
  chamber footprint found enough rock to carve into **12 times out of 407** — 3%. The fix was
  feature-tier ecotone rooms, whose footprint needs a fifth of the contiguous rock. All three
  ecotones now place on most seeds.

### Verified

Strict TypeScript, production build, **119 unit tests** (three new: repeats stay within budget
and most of the library is in use; ecotone rooms never leave their ecotone; every seed places
at least one ecotone room), both browser flows. `roomkit profile` reports all 30 rooms inside
the reference composition band. No console or page errors.

### Next

The library has met its repeat budget for the *current* world, so it is no longer the
constraint on variety — it is now the constraint on how much bigger the world can get. Most
valuable next: more halls (only 3, and they are what the player remembers), a second ecotone
chamber sized to fit eroded ground, and more province-agnostic rooms, which give the best
return per room in the library.


## Session: 2026-08-04 — Making the World's Contents Visible

Before authoring more rooms I checked whether the ones we have actually reach the player,
and they did not. **Nothing rendered features at all** — `grep features src/game.ts
src/view/*.ts` returned nothing — and the five "hanging" marker types (`anomaly`, `survey`,
`procedure`, `decor`, `random`) resolved to a carved cell plus a record and placed nothing
whatsoever. Only the two buried types changed the world, and those were invisible until a
claim was framed over them.

So the world held **~131 recorded points of interest that the player could perceive almost
none of**. That is the same world as one with none, and no amount of extra room art would
have fixed it. It was the bottleneck for the whole "no reason to explore" complaint, so it
came first.

### Features are now objects in the world

`src/view/features.ts` gives each marker type a distinct visual in the existing
machine/geology vocabulary, on its own layer above terrain and below effects. Two rules from
`WORLD_DESIGN_BRIEF.md` decided the art:

- ***Direction is discoverable; contents are a wager.*** A buried seam shows as **mineral
  staining** — bloom and grains carrying the ore's own colour, but no shape that identifies
  it. A buried cache shows as a **machined spoil cairn** with a scratched tally: the tell is
  that somebody was here, not that ore is present.
- ***Nothing auto-fills or interprets discoveries.*** So nothing writes to the Atlas. The
  player sees a thing, travels to it, and marks it themselves. The world signals; it never
  annotates.

Anomalies are the most conspicuous thing short of a cornerstone — a haloed instrument ring
with registration ticks and a slowly rotating figure. That rotation is currently **the only
motion anywhere in the world outside an arena**, which is exactly why it reads as
significant: a still world with one turning thing in it points at the turning thing.

Also resolved `?` slots into real markers at stamp time, on a weighted pick (decor 50,
survey 18, cache 14, anomaly 10, seam 8). That is the cheapest variety in the pipeline —
identical geometry delivering different contents world to world at no art cost.

### Errors encountered

- **The halo loop ran the wrong way.** It gave the *outermost* ring alpha zero and stacked
  the middle rings, producing a flat grey disc that read as fog — the one thing a light
  source must not do in a game about a dark mine. Reversed, and taken from 7 rings to 12
  because at 7 the steps were visible as concentric banding, which read as a target painted
  on the rock.
- **Hanging props floated in mid-air.** My first surface test only checked immediately
  adjacent cells, which discarded **59 of 68** decoration markers as unattachable. That was
  reading the marker too literally rather than the art being wrong: an author marks *roughly
  here*, so the renderer now searches up to four cells for the nearest rock face, prefers
  ceilings over floors over walls, and offsets the prop to touch it. 118 of 120 features now
  draw; the two that do not have no rock within reach, which is correct.
- **The anomaly figure was a hexagram** — two overlapping triangles, a loaded symbol that
  reads as occult rather than as instrumentation, and the wrong promise for what the
  discovery layer will hang there. Now a single triangle with a radial index arm.

### Verified

Strict TypeScript, production build, **116 unit tests** (a new one asserts no `random` slot
survives to the world, since one that did would be counted in the feature total while
placing nothing), both browser flows. No console or page errors. Confirmed in the renderer:
anomaly, seam stain, cache cairn and wall-attached decoration all read correctly at play
distance.

### Next

The bottleneck has moved back to volume. With features visible, more rooms now translate
directly into more for the player to find — so the library plan in `WORLD_DETAIL_BRIEF.md`
is the work, worst gap first: only 2 of 14 rooms are feature tier while features are 59% of
placements.


## Session: 2026-08-04 — First Real Batch of Building Blocks

Took the library from **4 rooms in one province to 14 across all three**, and built the two
tools the batch needed. A world now stamps **41–43 rooms carrying 120–126 features** — points
of interest up from 11 to ~131.

### Two tools the batch needed first

**Facets could not carry an authored lattice axis.** `facetAxis` came only from a
world-wide noise field, so an authored facet wall would have had mixed diagonals and the
entire Mirrorreef rule — *align your claim to the lattice or get chaos* — would have
collapsed at room scale. Added four axis-pinning glyphs (`/` `\` `%` `&`, drawn to look
like the plane they reflect on), plumbed `axis` through the palette, the generated library
and `paint()`, and added a test asserting every axis-pinned cell carries the axis its art
asked for. `f` and `F` still take the world's axis, for scattered crystal where incoherence
is the point.

**`roomkit sheet`** renders the whole library on one annotated image. A library that cannot
be reviewed at a glance drifts, and this earned its cost immediately — see below.

### The rooms

- **Mirrorreef (5)** — `lattice-wall` (stepped shallow shelves on one coherent axis),
  `cascade-chain` (charged seeds in a coherent line), `mirror-funnel` (opposing axes forming
  a V that steers to a buried cache), `crossed-lattice` (two lattices head-on, no good
  claim heading, correspondingly good reward), `cathedral` (hall; ribs alternating axis bay
  by bay, so it is a row of small distinct problems rather than one big one).
- **Rootwarren (5)** — `pruning-cells`, `bulb-gallery`, `heartwood-knot`, `creep`,
  `hollow-bole` (hall). All built so the greedy line is the wrong one, which makes Rootwarren
  the mirror of Karst: there non-liable stone is free to leave, here living rock is liable
  *and* grows back.

### What the contact sheet caught that reading the source never would

1. **`karst-slate-bank` and `mirrorreef-lattice-wall` were the same room in two palettes.**
   I had reused the composition without noticing. The Mirrorreef one is now stepped shallow
   shelves — which also plays better, because a shallow plane turns the ball *along* the
   room instead of straight back.
2. **Every chamber shared one cavity ellipse.** I had used `ellipse(8.5, 4.2, 8.4, 4.3)` in
   almost all of them, and on a contact sheet they read as one room. Silhouette is the first
   thing the eye compares, so each cavity is now a union of two or three lobes, different
   per room.
3. **`rootwarren-creep` read as a plain box.** A complete rectangular frame does not say
   "somebody was here"; a straight line *meeting* an organic one does. Now partial pit props
   and a cut floor, with the roof left to the world.

`roomkit profile` also flagged five rooms as over-painted on first pass (30–40% material
against Noita's 14% median). All are now inside the reference band. Both tools are doing the
job they were built for.

All three lessons are now anti-patterns in `rooms/AUTHORING_GUIDE.md`.

### Errors encountered

- **The Banked Face vanished again** once 43 rooms placed instead of 14. Two distinct bugs
  stacked:
  - `verify` ran *before* the authored-territory re-stamp, so the report described the
    damaged world while the shipped world was fine — `missingLandingFeatures` named a
    feature that was present by the time anyone could look. Verification now runs on the
    world that ships, with a second idempotent re-stamp after it.
  - More seriously, `stampLanding` writes cell solidity but only mirrors the *lander hull*
    into the openness grid. So cells and `open` disagreed, and verification's corridor
    repair — which trusts `open` — un-solidified the very teaching faces just restored.
    Fixed by syncing the openness grid after re-stamping.
- My first check of the axis guarantee **measured the wrong thing**: it counted every facet
  in a room's rectangle, including the world's own under transparent cells, and so reported
  coherent rooms as incoherent. Replaced with a test that checks only the cells whose art
  pins an axis.

### Verified

Strict TypeScript, production build, **115 unit tests** (up from 114), both browser flows.
No console or page errors. Confirmed in the renderer: Mirrorreef rooms stamp with coherent
lattices, and the Karst colonnade still reads as a hall.

### Next

Still starved: the repeat budget is 4 and the most-repeated room lands 7–9 times. Target is
~81 authored rooms. Worst gap first — **only 2 of 14 are feature tier, yet features are 59%
of placements** — then ecotone rooms (which have nothing, and are the sole source of their
reagents), then more halls, then province-agnostic rooms.


## Session: 2026-08-04 — Studying the Reference Blocks, and an Authoring Guide

Decoded all 74 of Noita's authored rooms out of `reference files/noita-telescope/data/`
and read Terraria's real mini-biome code, to work out what actually makes a good building
block. Wrote `rooms/AUTHORING_GUIDE.md` from the findings, and added
`roomkit profile` so the numbers are checkable rather than advisory.

### What the reference rooms are made of

The decisive discovery was a colour: **`#ffffff` in a Noita pixel scene is not white rock,
it is transparent** — "leave the surrounding world alone". Once classified correctly the
composition falls out:

| | Median | Range |
|---|---:|---|
| transparent | **32%** | 0–100% |
| open (carved air) | **53%** | 0–91% |
| painted material | **14%** | 0–94% |
| markers per room | **3** | 1–23 |

Edges are a hard rule: **top and bottom 100% transparent**, sides ~35–58% transparent and
~42–65% open with **~0% solid**, corners transparent in 48 of 74. A room is mostly negative
space and deference; only about one cell in seven is authored rock. The recurring
composition is *an organic cavity plus one deliberate flat plane where the payload sits* —
`shop.png` is an irregular air pocket with a single stone slab carrying five evenly spaced
item markers.

Terraria contributes placement discipline rather than interiors: two clearly separated
tiers (`CampsiteBiome` radius 6–10 tiles ≈ ⅙ screen; `MarbleBiome` 168×78 and
`GraniteBiome` 200×200 ≈ 1–2 screens, nothing between), validate-then-place against
`StructureMap`, density × area rather than counts, and **detail as probability** —
stalactites 12.5% per tile, walls 25% — rather than hand-placed texture.

### Where our constraints differ

Our drone is **3.72 cells against a 30.5-cell screen — 12% of screen width, against
Noita's 1.6%**. It is 7.5× larger relative to the view, so our rooms need *more* open
space than Noita's, not the same. And the hull is 0.48 cells thin, so a real pinch is
**1 cell**, not three. Both are now stated in the guide, because copying Noita's density
directly would produce impassable rooms.

### My own rooms were wrong, and the tool said so

`roomkit profile` immediately flagged the four Karst rooms at **28–41% painted material**
against the reference median of 14%, and the slate bank at 36% open. Thinning the
colonnade's columns from two cells to one brought it from 40% to 26% painted — and it read
*more* like a colonnade, not less. All four are now inside the reference band.

One profile check I wrote was wrong and I corrected it: it flagged our painted floors as
sealed edges, applying Noita's wang-tile contract to our stamp-into-a-cave-field model. In
ours transparent means "defer to the world", so a floor is correct; what must hold is that
at least two edges offer passage.

### The density contract was passing by accident

Rooms carve open space, which perturbed band density enough to fail the depth-monotonicity
contract. Chasing it properly turned up something worse: **the contract was measured after
stamping, with the Landing excluded by a hardcoded rectangle, and removing that slice of
the shallow bands happened to sort the sequence.** Measuring honest procedural geology
before anything is stamped showed bands 2 and 3 tie within 0.6% on `bounceworld-01`, and
that 4 seeds in 6 were monotonic by luck.

Strengthening the depth coupling as far as it will go still leaves 2 seeds in 14 inverted —
130 caverns split four ways is a small sample, so this is variance, not a tuning failure.
So the measurement moved to immediately after classification, and the contract now asserts
what the design actually requires and the generator can actually deliver: band 4 exceeds
band 1 by at least 0.10, band 4 is always the densest, and no single step down the world
loosens by more than 0.08. Verified across 14 further seeds. The test carries a comment
saying not to tighten it back to strict `>`, and why.

### Verified

Strict TypeScript, production build, **114 unit tests**, both browser flows. No console or
page errors.

### Next

The library is still **four rooms, all Karst** — the pipeline is proven and starved.
Mirrorreef and Rootwarren have nothing, and a world that stamps four rooms fourteen times
is repetitive by construction. Volume is the work, and the guide exists to make it
delegable.


## Session: 2026-08-04 — Room Pipeline, and an Honest Hitbox

Measured our generator and both reference games, then built the first two mechanisms
the analysis called for. Full findings in `WORLD_DETAIL_BRIEF.md`.

### The diagnosis, in numbers

Our world is **146× smaller than the smallest Terraria world** (34,560 cells vs
5.04M), takes **40 seconds to cross**, and held **11 points of interest in total**.
It had no room scale, no populate pass and no marker system. Noita, measured from
`reference files/noita-telescope/data/`, is assembled from ~4,100 hand-drawn Wang
tiles plus **464 bespoke authored rooms**, with **181 spawn-marker colours**; the Coal
Mine template alone carries **1,724 markers**, about 1.6 reward spawns per screen.

### An honest hitbox

`isOpenWorldPixels` tested a 24px square — **0.57 cells** against a drone drawn
**3.7 cells** wide. The machine was 6.5× wider than the thing that collided, so it
clipped visibly through rock and **no passage in the world could physically constrain
it**. Replaced with `isHullOpen`, an oriented box measured off the silhouette in
`view/actors.ts`, sampled at 0.4-cell steps so a one-cell wall can never be tunnelled.

Heading is now a traversal tool, and it is the same key that aims the survey frame —
so squeezing through a gap and choosing where to claim became the same act. Measured
mobility, which was previously 100% everywhere for every chassis:

| Chassis | Hull (cells) | Reachable at *some* heading | at *every* heading |
|---|---|---:|---:|
| Needle | 2.97 × 0.48 | 89.7% | 60.0% |
| Surveyor | 3.72 × 0.48 | 82.6% | 31.4% |
| Bastion | 5.42 × 0.48 | 77.3% | 12.8% |

Rotation is refused when it would drive the hull into rock, which is always safe — the
pose the drone arrived in is by definition clear. An already-intersecting pose stays
mobile so a save loaded into rock is recoverable.

### The room pipeline

Authored PNGs, Noita's approach, compiled to TypeScript so generation stays
synchronous and Node-testable.

- **`tools/`** — zero-dependency PNG codec, a coordinate canvas (`set(x,y,glyph)`
  plus `rect`/`line`/`band`/`ellipse`/`flood`/`stamp`), a 26-entry palette, and
  `roomkit` (`palette`/`ascii`/`preview`/`check`/`build`). Rooms can be painted **or**
  drawn in code; the PNG is canonical either way, and `ascii` reads a painted room back.
- **`preview` is the part that matters.** Room art is 6–36 cells across, too small to
  judge at 1:1, so it renders upscaled with a ruler and legend. Looking at previews is
  what caught the dotted-bank and floating-marker bugs below.
- **`src/worldgen/rooms.ts`** — density-driven stamping in three tiers following
  Terraria's own ladder (feature ~⅙ screen, chamber ~½, hall ~1), with
  `structureMap.ts` reserving ground so features never collide.

Result per seed: **13–14 rooms and 34–36 features**, taking points of interest from
**11 to ~46**. Contract holds: fully reachable, no missing Landing features, no
unreachable required nodes, deterministic per seed.

### Errors encountered

- **The slate bank read as stair-step scatter.** Two offset Bresenham lines at a steep
  angle are not a band. Added `Canvas.band()`, which walks the long axis and fills
  across the short one.
- **Markers floated in mid-air.** The first palette resolved every marker to open
  space, so a "rich seam" hung in the void. Markers now carry a `host`: cache and seam
  become **rock plus a feature** and cost a claim to reach; anomaly, survey, procedure
  and decoration hang in the cavity. Not cosmetic — free rewards turn prospecting back
  into collection.
- **A stamped room broke the reagent-to-material binding.** `paint()` left an
  inherited resource in place while changing the material, producing saltpeter-bearing
  slate. A room replaces the geology it covers, so it now replaces the contents too,
  and a seam paints material and resource together as a matched pair.
- **`if (!candidates.length) break` aborted a whole tier** on the first province with
  no rooms of that tier, so almost nothing placed. `continue`. 1 room → 14.
- **Two bugs where the repair passes destroyed authored content**, both surfaced only
  once rooms started creating isolated pockets:
  - A repair corridor carved through the Banked Face, a guaranteed teaching feature.
    Reserving ground against *placement* does not help, because the damage came from
    repair. Fixed by re-stamping authored territory last — stamping is idempotent.
  - Repair also opened buried seams and caches, handing the player the reward for
    nothing. Those cells are now protected from `syncCellsFromOpen` and from the
    corridor repair. Leaving them solid can plug a repaired route with a few cells of
    mineable rock, which the design already accepts — the carve deliberately seals
    fourteen tubes with 3×3 plugs for exactly that reason.
- **Fixing the Banked Face exposed a pre-existing bug in `exhaustFrame`.** It skipped
  any footprint touching persistent material, which at the sub-cell scale a rotated
  frame works at abandoned the footprint whole and left shards of solid rock inside a
  claim the player had paid for. Cuts are now applied unconditionally; `solidAt`
  short-circuits on `persistent`, so the flag protects the landmark, not the footprint
  around it.

### Verified

Strict TypeScript, production build, **114 unit tests** (up from 100; 14 new covering
reservation, the library, stamping, contract preservation and determinism), and both
browser flows. No console or page errors. Confirmed visually in the real renderer: the
colonnade hall stamps into Band III as five slate columns floor-to-ceiling with a chalk
vault and a buried seam.

### Next

- **The library is four rooms, all Karst.** The pipeline is proven; it now needs
  volume, and Mirrorreef and Rootwarren have nothing. Noita has ~464.
- Reshape the world to **240 × 576** (vertical, 1:2.4) per the brief, and let the mine
  get deep. Not done yet — rooms were built first so they would not be authored against
  dimensions about to change.
- Populate passes for the density targets, clearance as a designed variable, and
  rule-based province placement so the horizontal axis carries information.


## Session: 2026-08-04 — Splitting game.ts

`game.ts` was 2,600 lines in one class holding input, rendering, camera, audio, particles, the arena lifecycle, the tutorial, the forge panel, the deployment previews, persistence, the Atlas, and 55 `document.querySelector` fields. Done before the discovery layer lands, not after, because every one of those systems is about to grow.

Now **1,447 lines and zero DOM access**. It is orchestration: state, input, the arena lifecycle, the fixed-step loop, and save/restore.

Extracted, in four verified stages — strict TypeScript, 95 unit tests and both browser flows green after each:

- **Behaviour:** `maths.ts`, `audio.ts`, `effects.ts`, `camera.ts`, `objectives.ts`.
- **Presentation:** `hud.ts` (every HUD node, driven by an explicit `HudModel` it is handed — it never reads game state, which is what makes the mode rules enforceable rather than aspirational), `view/brick.ts`, `view/actors.ts`, `view/board.ts`, `view/survey.ts`.
- **Panels:** `forgeView.ts`, `atlasView.ts`, `expeditionView.ts`, `deploymentPreviews.ts`.

Two things were improved rather than merely moved:

- **The 29 bare `tone(freq, dur, vol, end)` call sites became a named sound vocabulary** in `audio.ts`, grouped by what the player is being told. Impacts descend, acquisitions rise, failures fall further than anything rises. Every value was read off the original call sites rather than re-invented, so the game sounds identical — but the sonic design is now reviewable as a list, and replacing the oscillators with a sample bank touches one file.
- **`updateDisplays` was two functions fused:** syncing Pixi actor transforms, and writing the DOM. Splitting them is what made the HUD extraction possible at all.

### Errors encountered

- **The browser test failed on the tutorial panel never retiring.** Not a refactor regression: the HUD timers were advanced by a fixed `1/60` per frame, so they were *frame*-paced rather than time-paced. At the 12–30fps headless Chromium manages during arena play, a 1.4-second fade took five to seven seconds. My own comment had rationalised this as deliberate ("a stutter should not shorten a message"), which was wrong — frame-pacing makes every message longer on a slow machine, not steadier. Now advanced by real `dt` clamped to 1/20, which keeps one long frame from skipping a message while staying wall-clock honest. Adding the sixth tutorial step is what pushed it past the test's timeout and exposed it.
- **Three regex block-cuts overshot**, once swallowing `showToast` whole and once removing a method a later rewrite still expected. Each was caught immediately by `tsc` because every stage was typechecked before being tested; none reached a test run.
- **The browser test reached into `game.deploymentPreviews` as an array.** It is now a class, so it gained `arenas` and `contents` accessors — deliberately, because the test asserts the previews really are centred and bottom-aligned in their cards at the live viewport size rather than trusting the layout maths that produced them.

### Verified

Strict TypeScript, production build, 95 unit tests, both browser flows. No console or page errors. Behaviour is unchanged throughout — this was a structural change only, apart from the timer fix noted above.


## Session: 2026-08-04 — Expedition Persistence & The Atlas

Reviewed the build against `WORLD_DESIGN_BRIEF.md` and played it in the browser. The load-bearing systems are real — worldgen with contract verification, the custom swept-circle solver, continuous-angle claims, the material table, the economy. The gap to the stated Terraria/Noita/Animal Well ambition was not content volume. It was, in order: **nothing persisted**, **there was no map**, **the discovery layer was 0% built**, and **the world is inert outside an arena**.

Resolved the brief's long-open product decision in favour of the **forgiving expedition model**: one persistent world per seed, death costs cargo only, cornerstone completions are restart anchors. Pure permadeath fights the mapping-and-annotation systems the brief itself requires; Noita-style opening mastery is preserved through deliberate re-seeding instead.

Then built the first two gaps.

### Persistence

- **Geology is never stored.** It is a pure function of the seed, so `WorldModel` now keeps an ordered `WorldEdit` log of every cut and every regrowth, and loading regenerates the world and replays it. A full expedition is a few tens of kilobytes of readable JSON.
- This is why the log records `exhausted` and `includePersistent` per cut rather than a solidity bitmap: replay has to reproduce the reveal and exhaustion flags, and a cell-grid snapshot would round off the oriented diagonal cuts that continuous-angle claims produce. A test asserts solidity matches cell-for-cell across a reload after 24 angled cuts.
- `Economy.snapshot()`/`restore()` store **both** craft counts and the resulting module totals, deliberately: replaying `craft()` would charge the player for their own modules a second time, and the craft counts are what repeat-cost growth is priced against.
- Autosave on every consequential event — bank, claim resolution, craft, verb grant, death, marker — plus a 20-second heartbeat for position/discovery and a `beforeunload` write.
- **Export/import** to a `.json` file, at the user's request. Imports are validated whole before anything is applied; a truncated or hand-mangled file is refused with a reason rather than half-loaded. A save from a different seed reloads via `?seed=`, which doubles as a way to hand someone a specific mine.
- `ChunkedTerrain.reset()` added: replayed cuts never reach chunks that were rasterized before the load, so the terrain is rebuilt rather than left showing the seed's pristine geology.

### The Atlas (`M`)

- The whole mine on one 2D canvas at 5 px per cell — 1200 × 720 fits the aperture exactly, so there is nothing to pan. Deliberately not a second WebGL context competing with the game's.
- Draws **only discovered cells**, tracked from where the drone actually goes. Undiscovered ground is left as void rather than dimmed, so the shape of an expedition is itself information.
- Shows province, ecotone, depth bands, excavation, structure, anchors, the Landing, and cornerstones once approached. Never buried resources — *direction is discoverable; contents are a wager*.
- Eight icons, click-to-place on surveyed ground, optional short note, edit and delete. Nothing auto-fills or interprets. Unsurveyed ground refuses a marker and says why.
- Added to the FTUE checklist (now six steps) and the survey hint strip. It was undiscoverable otherwise, and it is now how the mine is navigable at all.

### Errors encountered

- **The Atlas canvas overflowed its stage and painted over the legend and save buttons.** `max-height: 100%` does not resolve against a centre-aligned grid item, so the canvas kept its intrinsic 720 px inside a 660 px row. A JS fit pass then *oscillated*, because sizing the canvas changed the row it had just been measured against. Fixed properly by taking the canvas out of flow — `position: absolute; inset: 0; margin: auto` — which makes the stage definite and the fit stable with no JS at all. A browser test now asserts containment.
- **The chassis name overlapped the FIELD figure** ("Surveyor" through "11×11"). Three stat columns leave the name roughly 50 px, so no type size fixes it. First attempt gave the name its own grid row, which squeezed the live previews — unacceptable, those previews run the production renderer and must stay full size. Second attempt shrank the type, which clipped the name. Fixed by lifting the name out of flow over the field window, which frees the stat row to spread across three even columns and costs the preview nothing.
- **The expedition panel stole the preview height.** `.deployment` had exactly four grid rows and the new panel took the `1fr` one, pushing the paddle bay into an implicit auto row. Added a row; only the bay flexes.
- **Annotation notes could not be typed.** The editor is opened from inside the canvas click handler, and the browser moves focus to the click target after the handler returns. Focus is now deferred a tick.

### Verified

Strict TypeScript, production build, **95 unit tests** (up from 66; 29 new covering the mask codec, log replay, discovery marking, economy round-trip and save validation), and **two browser flows** — the original vertical slice plus a new expedition test that plays, saves, reloads, continues, and asserts restored solidity cell-for-cell, Atlas layout containment, key swallowing, the annotation lifecycle, and import rejection of truncated and wrong-version files. No console or page errors.

### Next

The discovery layer: the three real cornerstone puzzles to the brief's signaling contract, plus the four knowledge procedures. That is the Animal Well axis and it is still entirely unbuilt.


## Session: 2026-08-03 — Renamed to Orekenoid

- Renamed the game from Bounceworld to Orekenoid across source, markup, styles, docs, tests, package metadata and the launcher, preserving case for each variant.
- Renamed the debug global `__BOUNCEWORLD__` to `__OREKENOID__`, the exported `BounceworldGame` class to `OrekenoidGame`, and `Start Bounceworld.command` to `Start Orekenoid.command`.
- **Seed literals were deliberately left unchanged.** `DEFAULT_SEED` and the four test fixtures are opaque hash inputs, not names: their exact characters generate the geology, so renaming them would silently reroll the world under playtest and change which worlds the contract tests exercise. Both sites now carry a comment saying so.
- The repository directory is still named `Bounceworld`; renaming it would break the running server, the session working directory, and the memory path. Flagged for the user rather than done unilaterally.
- Verification after rename: strict TypeScript, production build, 66 unit tests, and the 41-second browser flow with zero console or page errors.


## Session: 2026-08-03 — Two Balls Per Claim

- User raised the default from one ball to two: one made a single early misread end a claim outright, which reads as arbitrary rather than as the consequence of a decision.
- Added `BASE_ARENA_BALLS`, with the Twin Engine's verb adding one on top rather than granting the second outright. Two becomes three, still a fifty percent increase in attempts and a genuine reason to seek the cornerstone.
- Renamed the verb readout from "SECOND SEQUENTIAL BALL" to "THIRD SEQUENTIAL BALL" to match.
- Ball pips now stay visible while a claim has any reserve and hide only once a single ball with no spare is all that remains, so the count is present exactly when it carries information.
- Coverage asserts two balls with one spare by default, and that the verb raises it to three.
- `WORLD_DESIGN_BRIEF.md` still describes the Twin Engine as granting "the second sequential ball per arena". Left untouched as the user's design document; flagged rather than edited.
- Verification: strict TypeScript, 66 unit tests, and the 45-second browser flow with zero console or page errors.


## Session: 2026-08-03 — Trajectory Line, Ore Pull & Forge Compass

- User asked for a projected trajectory line with bounce prediction as an upgrade, a slight upgradeable ore vacuum, a forge-direction arrow when out of range, and asked why only 4 of the promised upgrades were visible.
- The missing upgrades were a real bug in the visibility filter: recipes were hidden until the player had held their materials, so an empty bank collapsed the panel to tier 1. An upgrade tree the player cannot see is not a goal. All recipes are now always listed; maxed items say so rather than vanishing.
- Added `predictPath` to the solver. It reuses the same swept collision the simulation uses rather than an approximate raycast, so the drawn line cannot disagree with what actually happens, and it honours facet planes — a predicted path through Mirrorreef that ignored the 90-degree turn would be worse than no line.
- The line is dashed, fades per leg so the certain part reads strongest, marks each predicted rebound, and doubles as the aim preview before the serve.
- Added an innate ore pull with distance falloff, so a wider radius still rewards positioning rather than removing the catch.
- Added four upgrades: Collector Coil and Field Collector widen the pull; Trajectory Optics and Deep Optics extend prediction to one and three rebounds, the latter superseding rather than stacking. Twenty recipes total.
- Pressing the forge key out of range now paints an edge compass pointing at the nearest anchor with its distance, held for four seconds, placed by intersecting the bearing with an inset viewport rectangle so it reads as a direction to travel.
- Added a scroll fade and styled scrollbar to the forge, since the full tree is now longer than the panel.
- Extended coverage: prediction stops at the first obstacle unbounced, extends with optics, predicts rail rebounds, diverges correctly on facets versus plain stone, and returns a single point for a stationary ball. Browser coverage asserts the whole tree renders across three tiers, the compass appears without opening the forge, and both new upgrade channels raise their values.
- Final verification: strict TypeScript, production build, 66 unit tests, and the 43-second browser flow with zero console or page errors.


## Session: 2026-08-03 — Refit Bay Redesign

- User rejected the forge as a sparse table with tiny text and excessive negative space.
- The core defect was hierarchy inversion: the effect line — the only reason to want any item — was the smallest text on each row, while the name and a right-aligned status string took the space. With nothing affordable the whole panel read as dead.
- Rebuilt it as a card grid grouped by tier. Each card leads with the **payoff** at large size (`+3 ARMOR`, `+12% PADDLE SPEED`, `9×19 NEW CHASSIS`), then the name, then cost chips.
- Cost chips carry each material's own colour swatch and, when the player is short, name the shortfall directly rather than merely dimming the row.
- Added a header showing current armor, health and chassis, so every card is read against what it is improving, and a bank rail listing stock — deciding what to make requires knowing what is in hand.
- Cards are now clickable as well as number-keyed; the panel became a full modal using the whole aperture instead of a narrow strip.
- Repeatable items show `OWNED n/limit`; blocked items state why, including the capability-gated Resonant Lens reading "REQUIRES A CAPABILITY NO MATERIAL CAN BUY".
- Found and removed a stale duplicate CSS block that had been shadowing the new forge styles via cascade order — the reason the first redesign attempt rendered clipped and mispositioned.
- The removal deleted more than intended. Verified recovery by diffing every selector in the last good build against the source: the only absent classes were the ones deliberately replaced. Nothing was lost.
- Extended browser coverage: every card leads with a payoff and lists a cost, tiers group correctly, the bank rail and chassis stats render, shortfalls are marked, and clicking a card crafts.
- Final verification: strict TypeScript, production build, 61 unit tests, and the 42-second browser flow with zero console or page errors.


## Session: 2026-08-03 — Banking, Death, Tutorial & HUD Scale

- User asked for a bank at the Landing, loss of unbanked resources on death, respawn at the start, a checked-off tutorial phase, Health renamed and given real emphasis, and called out that the previous pass had made HUD elements miniscule. The last point is a fair correction: the prior pass overshot from cluttered to tiny.
- Split the economy into **cargo** and **banked** pools. Cargo is what the drone holds and is lost on death; banked is safe and is the only pool recipes are priced against, so a haul is worth nothing until it comes home.
- Fixed a real bug found while splitting the pools: `craft` was pricing against the bank but deducting from cargo.
- Added the bank chest at (21, 15) as a persistent Landing feature with its own generator-contract check. Deposit is automatic on arrival, because there is never a reason to refuse it — the tension is the journey, not the keypress.
- Death now costs the hold and the walk back, never banked material, crafted capacity or earned verbs. The drone respawns at the Landing at full health and the exit camera returns there.
- Added a tutorial controls panel: large, five steps, each checked off as the player performs it, then removed from the DOM permanently. Completed steps grey out and strike through while the next pending key stays highlighted.
- Two placement bugs caught in real captures: the panel initially covered the playfield, so it moved to the left margin — the only reliably empty column in both modes — and it was intercepting clicks on the chassis cards, so it is now `pointer-events: none`.
- Renamed Integrity to **Health** throughout the player-facing UI and recipe copy, and rebuilt it as an actual health bar: a large numeral, a wide ten-segment meter, and warn/critical colour states with a pulse at critical.
- Fixed the health meter's segment gradient, which divided by a custom property inside `calc` and rendered as four detached blocks instead of thin ticks.
- Scaled the whole HUD up substantially — objective, region, stakes, cargo, hints, toasts, resonance and arrival card — while keeping the emphasis order established in the previous pass.
- Moved armor into the health block so it is stated exactly once and stays visible while surveying, where it informs which ground to take.
- Cargo now labels itself and turns amber as **CARGO — UNBANKED** while at risk, and hides entirely when the hold is empty.
- Extended coverage: cargo cannot be spent, banking makes it spendable, death clears cargo but not the bank, respawn is at the Landing at full health, and the tutorial completes and removes itself.
- Final verification: strict TypeScript, production build, 61 unit tests, and the 40-second browser flow with zero console or page errors. Inspected real captures of both modes.


## Session: 2026-08-03 — In-Game UI: Function Over Decoration

- User judged the in-game UI prettier than it was functional, asked for a video-game HUD rather than a tech demo, and rejected the objective copy as LLM-written prose instead of mechanical language.
- Audited the excavation HUD against the supplied capture and found load stated **four** times: the board bar, an overlapping telemetry line, a claim readout, and a detail line. None was authoritative.
- Found the largest text on screen during excavation was a navigation objective irrelevant to playing a board, and the telemetry line was rendering directly on top of the board's load bar.
- Root cause was not styling: the HUD was static while the player's decision changes. Surveying, the player reads the world; excavating, the player reads the stakes.
- Made the HUD mode-driven via a `data-mode` attribute on the viewport, with survey, play and forge each hiding what does not serve their decision.
- Collapsed load to one canonical readout, deleted the redundant telemetry line during play, and removed the duplicated armor figure so armor is stated once, beside the load it modifies.
- Set emphasis by decision weight rather than uniformly: DAMAGE is the largest element and appears only when non-zero, INTEGRITY carries a depletion meter with warn/critical states, LOAD is dimmed supporting detail.
- Cut the mode label entirely; the player knows which mode they are in. Reduced the band readout from "BAND 1 SHALLOW" to "B1" since the adjacent depth already says shallow.
- Made hints scaffolding rather than furniture: movement hints retire after the first commit, serve hints after the first serve, and only genuinely contextual prompts persist.
- Hid the ball pips when a single ball with no spare is the default state, since displaying it is noise.
- Replaced permanent province-rule prose with a one-time arrival card in mechanical terms, positioned above the action so it never covers the drone or the frame being aimed. A rule the player must re-read every frame is a rule the HUD failed to teach.
- Rewrote every objective as an imperative plus a number: `SECURE ORE`, `FORGE ARMOR / Refit Bay · 10 copper + 4 coal`, `SECOND CORNERSTONE / 2 of 3 required`, `DESCEND PAST 900m`. No metaphor and nothing the player cannot act on.
- Added cargo gain pulses so a caught drop registers without spending a toast.
- Extended browser coverage to the mode contract: stakes hidden while surveying, telemetry absent during play, damage active only when non-zero, load matching the liable count exactly, objectives uppercase and at most four words, and hints retiring after the serve.
- Final verification: strict TypeScript, production build, 59 unit tests, and the 32-second browser flow with zero console or page errors. Inspected real captures of both modes.


## Session: 2026-08-03 — World Replacement: Implementation

- Implemented the seeded generator in `src/worldgen/`: PRNG and coherent noise, province affinity fields with domain warp, ecotones as field overlap, depth bands, the three claim dials, three-scale cave carving over a spanning tube graph, forced plugs, material and resource assignment, and authored Landing/cornerstone stamps.
- Wrote the generator contract as executable assertions first, then fixed every failure it found rather than relaxing it.
- Contract work uncovered five real defects: isolated open pockets the player could see but never reach, non-monotonic band density, resources assigned to non-solid cells, stamped materials inheriting the resource of the material they replaced, and slate yielding iron only probabilistically.
- Resolved isolated pockets properly: genuine chambers get a carved corridor, eroded specks are filled back in. Contract 1 now holds exactly — 14979 of 14979 open cells reachable.
- Density was non-monotonic because cavern *frequency* was uniform with depth while only size fell, and random variation in node count swamped the size trend. Depth now reduces both frequency and size, making the density contract true by construction rather than on average.
- Made slate unconditionally iron-bearing, so the design's sharpest early decision is real: a slate bank is the best wall and the best iron, and both cannot come from the same stone.
- Rewrote `WorldModel` around generated data while preserving the transform, cut, remesh and exhaustion API the solver and tests depend on.
- Built chunked terrain rendering. A single canvas at the new scale would be roughly 8300x5000 pixels, past texture limits and far too slow; terrain now builds in 24-cell chunks near the camera, one per frame, with cuts composited directly into the chunks they touch.
- Added one material-contact extension point to the solver rather than scattering province branches through it, preserving the existing corner-normal and simultaneous-seam behaviour.
- Implemented the three province rules: non-liable durable slate, facet planes that turn the ball by a right angle with depth-limited charged cascades, and bounded deterministic regrowth with spore membranes.
- Implemented the economy: nine materials, three crafting tiers, per-chassis modules that deliberately do not transfer, and the structural guarantee that no recipe can grant a verb.
- Retired the Brood as a place; its multiball machinery is reused by spore membranes and sequential balls.
- **Dropped the deployment previews mid-refactor and was rightly corrected.** The file had been overwritten and the repo has no git history, but the implementation was recoverable from the session read and cross-checked against the pre-rewrite `dist/` bundle. Restored faithfully, including the per-card Pixi application, manual render, measured DOM fitting, resize relayout, and the predictive paddle tracker. Terrain behind each preview now comes from a region raster exposed by the *same* production rasterizer, so a preview cannot drift from the real world. Recorded as a memory so it cannot recur.
- Diagnosed an apparent stuck-camera bug down to the Browser pane reporting `visibilityState: hidden`, which suspends requestAnimationFrame entirely. The game was fine; the verification path was wrong. Confirmed gameplay by driving the fixed-step loop manually, then moved authoritative verification to Playwright.
- Manual loop verification reproduced the whole thesis end to end: ball served, four chalk broken, claim resolved, 32 liable over 18 armor charged exactly 14 integrity, and all 24 slate survived free.
- Iterated terrain rendering three times against real captures. Per-cell colour was blocky; colour blending washed hue-adjacent materials into fog; warping the *sample position* gave organic seams at pixel resolution with every material keeping its exact colour.
- Made the local objective province-aware after a capture showed the Karst tutorial line reading at 1610 m in Rootwarren.
- Final verification: strict TypeScript, production build, 59 deterministic unit tests across generator contract, physics, material rules, bounded province rules and the crafting chain, and the full 34-second browser flow with zero console or page errors.
- Inspected real captures of the deployment previews, all three provinces, a non-cardinal Karst claim, the forge, and Survey Resonance. The three provinces read as genuinely different places.


## Session: 2026-08-03 — World Replacement: Economy & Starting Area Design

- User asked to replace the game world entirely with one better developed and more representative of the real game, starting with repo familiarization.
- Audited `WORLD_DESIGN_BRIEF.md`, all prior plan/findings/progress logs, every file in `src/`, and the real WebGL captures.
- Established that the existing world is a test fixture rather than a world: four hardcoded ellipses, four tubes, two forced plugs, one hard biome boundary at `x > 37.2`, no seed, no generator, no province structure, and no biome rules beyond palette plus one multiball gate.
- Confirmed baseline green before touching anything: 6/6 unit tests, clean strict build.
- User selected three provinces plus ecotones, seeded procedural generation with authored cornerstones, and biome rules implemented alongside world structure.
- User then directed that design work precede implementation: starting area, crafting chain from mined resources, and a resource-by-biome-by-depth map.
- Identified and resolved a real tension with the brief's critical cuts by splitting ownership: crafting produces capacity, cornerstones produce verbs, and nothing craftable is ever a key to a place.
- Flagged that a crafting chain forces the brief's unresolved run-based-versus-expedition decision, and committed to the forgiving-expedition model with cornerstone refit anchors.
- Created `PROGRESSION_AND_ECONOMY.md`: three-axis economy model, three claim dials, four depth bands, province and ecotone extents with coordinates, resource map, three-tier crafting chain, The Landing specification, progression loop, and a nine-item generator contract written as assertions.
- User rejected the invented material names; renamed the economy to a familiar ore ladder of copper, iron, cobalt, mithril, adamantite, and runite with coal, gems, sulfur, saltpeter, vitriol, and diamond as reagents.
- The rename improved two things beyond naming: coal as smelting fuel resolved whether an abundant filler resource earns its place, and each ecotone's rare reagent became the literal chemical product of its two parent provinces' reagents.
- Recorded the sharpest emergent decision in the design: Karst slate is reflective, non-liable, and iron-rich, so a slate bank is simultaneously the best wall and the best iron, and both cannot be had from the same stone.
- Resolved the four open decisions per user direction: anchor density deferred, no module respec, four discrete gem tiers, and the Brood removed entirely.
- Discrete gem tiers made diamond both the top of the gem ladder and ecotone-locked, so the precision line can only be completed in the Bright Fault.
- Added the principle that crafting may sharpen a verb but never grant one, embodied by the Resonant Lens being worthless without Survey Resonance.
- Design phase complete. No implementation code written; `src/` remains untouched.


## Session: 2026-08-03 — Visual Paddle Selection Correction

- User rejected the prose-led deployment screen as explicitly LLM-designed and requested that all three paddles and fields visually explain the game.
- Removed the slogan, premise paragraph, and numbered explanation.
- Initially rebuilt deployment around data-derived SVG fields; user correctly rejected this because it invented a second renderer rather than using the game.
- Removed the SVG renderer entirely and replaced it with three live Pixi `Arena` instances sampled from the actual starting Old Mine.
- The selector now calls the production arena, brick, paddle, ball, trail, and exact collision systems directly. The background world is hidden until deployment so the live preview arenas remain legible.
- Reduced copy to literal equipment labels, numeric attributes, and the icon sequence `FRAME ROCK → BREAK BRICKS → REMAINING = LOAD`.
- Strict build, portable build, six deterministic tests, focused direct-file verification, and the complete 44-second Old Mine-to-Brood progression pass.
- Inspected the final real-rendered capture. All three choices visibly use the same production assets and behavior as gameplay, and their geometry communicates the chassis differences.
- User identified three remaining failures: fields were manually misaligned, the world-rock origin was absent, and stats were illegibly small. They also supplied exact instructional copy and renamed soak to Armor.
- Added the production terrain sprite behind every live arena, clipped and positioned each preview from its real DOM field window, and added resize-driven relayout.
- Replaced the rule icons with the exact supplied sentence and changed all player-facing terminology and documentation from soak to Armor.
- Increased chassis names and all numeric stats substantially; inspected the resulting real capture.
- Final verification passes: strict/portable/production build, six deterministic tests, direct-file flow, exact preview-alignment assertions, and the complete 23.5-second Old Mine-to-Brood browser progression.


## Session: 2026-08-03 — Deployment FTUE & Bespoke Game HUD

- User requested the next pass focus on UI/UX, including a succinct FTUE, one-of-three starting paddle selection, available-space viewport fitting, and removal of the LLM-forward dashboard schema.
- Read the frontend-design and game-engine skill instructions.
- Audited the current HTML/CSS, UI bindings, startup flow, chassis switching, and Playwright assumptions.
- Locked the new structure to one full-space instrument aperture with a pre-deployment chassis rack and context-sensitive in-game HUD.
- Replaced the HTML shell and CSS wholesale with the deployment FTUE, three selectable chassis rows, in-aperture objective/location instruments, and compact bottom readouts.
- Connected selection to real chassis data, disabled deployment until a choice is made, added keyboard selection before launch, and locked the chosen chassis after launch.
- Added width-and-height constrained 16:9 fitting that centers the largest possible playfield in the available browser space.
- Updated Playwright coverage for the three-step contract, required choice, Needle preview, Surveyor deployment, post-start chassis lock, and viewport fit.
- Strict build and six deterministic tests pass. Direct-file and full progression Playwright flows both pass; the software-WebGL run completed in 1.5 minutes.
- Inspected real FTUE and active survey captures. The new UI reads as a bespoke deployment rack and sparse mining instrument layer rather than a website/dashboard.
- Inspected the real Old Mine arena capture, documented the FTUE/chassis lock/viewport contract, and marked the complete UI/UX pass verified.


## Session: 2026-08-03 — Geological Claim Visual Overhaul

- User approved a full game-layer visual overhaul after the critical review.
- Read the game-engine and planning-with-files instructions.
- Locked the pass to a real, code-native Old Mine/Brood rendering system; no generated concept images will be used.
- Audited the Pixi scene graph, CPU terrain compiler, survey overlay, arena construction, brick/paddle/ball graphics, and effect pools.
- Identified coarse cell-driven terrain silhouettes and the opaque arena panel as the two highest-impact structural defects.
- Rebuilt terrain rendering from the continuous cave field while preserving exact oriented gameplay cuts; added broad strata, directional cavity edges, fine fractures, and a richer void field.
- Replaced the survey rectangle with a scanning projected lattice, machine brackets, corner emitters, and pulsing anonymous returns.
- Rebuilt arena backing, rails, anchors, bricks, drone, paddle, ball, trails, and destruction particles around one extraction-machine/material vocabulary.
- Strict TypeScript, portable/production build, and all six deterministic tests pass.
- Browser verification was initially blocked by sandbox denial of its localhost server bind; retrying with scoped approval.
- Full direct-file and complete Old Mine-to-Brood Playwright flows pass in 30.5 seconds with no reported browser errors.
- Inspected real survey and Old Mine arena captures. The new macro cave silhouette, projected lattice, mineral-in-rock bricks, anchored rails, mechanical paddle, and crisp ball are all present in the running build.
- Inspected the real opening and Brood arena captures. Macro-scale world composition holds behind the briefing, and Brood retains a strong biological identity without breaking the shared extraction-board language.
- Added explicit multi-hit fracture overlays and documented the new visual rendering contract in the README.
- Final strict TypeScript/portable/production build and all six deterministic tests pass after the fracture-state addition. The earlier full browser verification for this pass remains green: 2/2 Playwright flows in 30.5 seconds.


## Session: 2026-08-03 — Continuous Survey Chassis & Claim Liability

- User approved the combined refactor: fixed chassis frames, always-active surveying, arbitrary heading, paddle-aligned remeshing, persistent rotated excavation, and remaining-brick damage.
- Read the game-engine and planning-with-files instructions and began the architecture audit.
- Completed the first audit pass across config, types, world sampling, game state/input/rendering, exact collision solver, HTML/CSS HUD, and both test layers.
- Added the BX-04 chassis definition with immutable frame geometry, travel/rotation/paddle motion, soak, and integrity baselines.
- Replaced cardinal transforms with continuous angle bases and added inverse world-to-frame transforms.
- Added coverage-based local brick remeshing, exact oriented brick footprints, spatially bucketed persistent cuts, and rotated-world collision sampling.
- Collapsed roam/framing into an always-active survey state with continuous held Q/E rotation and F/Enter commitment.
- Added projected claim damage, a board-local soak/danger meter, integrity HUD, damage resolution feedback, and persistent exhaustion using the same brick footprints.
- Rewrote unit and browser test intent around arbitrary headings, immutable chassis geometry, oriented scars, and claim liability.
- Strict TypeScript and production bundling pass; all five deterministic unit tests pass.
- First expanded browser run completed direct-file and arbitrary-angle Old Mine verification, then hit the suite's old global timeout during a successfully committed Brood camera transition rather than an application failure.
- Expanded the browser budget and completed both browser tests successfully in 39.5 seconds.
- Inspected the real continuous-angle survey and angled Old Mine arena captures; frame orientation, paddle-flat brick remeshing, and board/HUD liability feedback are visually coherent.
- Inspected the Brood and Core-acquisition captures; safe-load feedback and persistent chassis integrity coexist cleanly with the biome's existing multiball progression.
- Added three selectable chassis profiles (Surveyor, Needle, Bastion) with distinct fixed frame aspects, paddle widths/speeds, travel/rotation, soak, maximum integrity, and separately persisted health pools.
- A parallel final browser run reached and visibly completed Core integration but exceeded its total time budget; changed GPU-heavy browser verification to one worker with a 90-second per-flow budget.
- The serial run isolated slow full-world terrain recompilation during Old Mine resolution; began replacing it with cached incremental cut rendering rather than weakening the six-second gameplay expectation.
- Implemented cached terrain composition: oriented cuts now clear and edge the existing high-resolution canvas directly, and Pixi refreshes the current GPU source instead of rebuilding the world texture.
- The first optimized run reached its input assertion in 16.6 seconds instead of timing out during resolution; lengthened the held-rotation test window to tolerate software-rendered CI frame cadence.
- Separated frame timing policies: camera transitions and continuous heading use bounded wall-clock delta, while world movement and effects retain tight safety caps and Breakout keeps its fixed-step accumulator.
- Captured and inspected the Needle's 7×15 survey projection and the post-failure diagonal scar. Chassis identity is clear, but the scar review found sub-threshold terrain slivers requiring one final resolution correction.
- Added full-frame lattice exhaustion with persistent-landmark exclusions and a dense sampling unit regression proving the rotated footprint contains no leftover solid shards.
- Removed paddle acceleration and inertia. A/D now sets exact positive/negative chassis speed immediately and release sets velocity to zero; browser coverage verifies the paddle remains stationary after release.
- The focused end-to-end browser flow passes in 25.5 seconds after the correction, and the recaptured diagonal scar is visually clean.
- Final verification passes: six deterministic unit tests, strict TypeScript, portable and production builds, direct `file://` launch, and the complete 23-second continuous-angle/chassis/damage/Brood browser flow. The full serial browser suite completes in 29.8 seconds.


## Session: 2026-08-03 — Direct-File Launch Fix

- Reproduced the failure from the supplied console message: root `index.html` depends on an absolute Vite module URL and has no standalone styling path.
- Began a dual-entrypoint fix so direct file opening and Vite development both remain supported.
- Added protocol-sensitive bootstrap logic, direct CSS loading, an async-safe classic-script entrypoint, and a portable bundle build command.
- The first portable build found that Vite 8 does not provide an `esbuild` CLI transitively; adding it explicitly rather than relying on an undeclared tool.
- Added esbuild explicitly and generated a 1.5 MB self-contained classic-script runtime with no external game assets.
- Unified direct-file, Vite, and production launch around the same `orekenoid.js`; the production build explicitly copies the verified bundle into `dist`.
- Added a Playwright regression that opens the root page through an actual `file://` URL, verifies runtime initialization, canvas visibility, and loaded shell styling, and captures `direct-file-opening.png`.
- The direct-file regression passes with no console or page errors; the captured WebGL opening was visually inspected and is correctly styled.
- Documented double-click launch, development launch, and portable-bundle regeneration in the README.
- Added explicit Node type declarations required by the direct-file Playwright regression; the subsequent strict TypeScript build passes.
- Final verification passes: 2/2 Vitest physics tests, production/portable build, and 2/2 Playwright flows (direct file plus complete Old Mine-to-Brood vertical slice).


## Session: 2026-08-03 — WebGL Vertical Slice Rebuild

- User rejected the Canvas visual slice and approved a production-stack rebuild.
- Locked Vite, TypeScript, PixiJS/WebGL, custom Breakout CCD, optional Rapier world physics, and later LDtk landmark authoring as the architecture.
- Defined feature parity and visual-quality gates before the legacy runtime can be retired.
- Added the Vite/TypeScript project, PixiJS v8, Rapier 2D compatibility package, Vitest, and Playwright with zero installation vulnerabilities.
- Added strict TypeScript, production build, unit-test, browser-test, and local preview configuration.
- Ported the exact swept circle-versus-rounded-rectangle solver, deterministic seam-contact aggregation, normalized reflection, and authored paddle English into a standalone typed physics module.
- Built an authored continuous-world model with smooth cave fields, two mining plugs, Old Mine and Brood material classification, hidden resources, persistent Brood landmarks, arbitrary frame sampling, and rounded persistent excavation cuts.
- Added a terrain texture compiler that produces material depth, strata/anatomy, stable grain, and edge light into a GPU-uploadable texture without exposing gameplay cells as visible squares.
- Built the PixiJS scene graph with far geology, compiled terrain, Brood landmark/anatomy, effects, actors, framing overlay, and active arena layers.
- Ported roaming, collision-aware movement, frame translation/rotation/resizing, anonymous ore signals, arena commitment, camera realignment, serving, paddle control, multiball, shell/heart gating, drops, exhaustion, terrain rebuilding, synthesized audio, and progression state.
- Replaced the old entrypoint with a Vite module shell and rebuilt the surrounding HUD around the remote extraction-drone fiction.
- First strict build reached the new code and identified only typed API-shape issues: Pixi v8 expects flat polygon arrays, plus Vite's CSS side-effect declaration must be included. No runtime architecture error was reported.
- Corrected Pixi v8 polygon input types and added Vite client declarations; strict TypeScript and production bundling now pass.
- Added deterministic unit coverage for radial rounded-corner normals and exact simultaneous two-brick seam contact; both tests pass while preserving constant ball speed.
- Stopped the legacy static server. The sandbox denied Vite's localhost bind before startup; retrying the same scoped development server with approval.
- Vite server launched with approval; the full first Playwright vertical-slice run passed in Chromium with no captured console/page errors.
- Inspected the real opening and framing screenshots. Smooth macro-caves, continuous strata, world edge lighting, the new drone, and the frame overlay are all present in the running WebGL build.
- Inspected live Old Mine, Brood, and Core-acquisition screenshots. Camera orientation, rounded board modules, biome-specific mechanics, real collision-driven environmental split, and permanent multiball are visually functioning.
- Increased terrain texture density by 2.25×, reduced Old Mine's over-regular banding, added slower material variation and a forward drone survey beam, and lowered arena backing opacity so world anatomy continues through the claim.
- Separated Vitest and Playwright file discovery after the unit runner correctly rejected a browser spec; unit tests, strict build, production bundle, and the complete browser slice all pass again.
- Replaced integer-sampled texture noise with continuous multi-frequency variation and completed the final real-build opening review.
- Rewrote the README for the WebGL runtime, controls, architecture, tests, deliberate Rapier boundary, retained legacy references, and current production gaps.
- Confirmed every WebGL rebuild phase is complete, recorded installed package versions, and stopped the local development server after verification.


## Session: 2026-08-03 — Achievable Visual World Slice

- Locked the visual slice to deterministic Canvas-native construction and explicitly excluded visual techniques the current stack cannot carry at consistently high quality.
- Defined the proof as a complete cross-state slice rather than a collection of isolated incremental effects.
- Began renderer audit and implementation planning.
- Replaced per-tile scratch/dot decoration with world-coordinate material fields: three broad Old Mine strata and three Brood membrane bands.
- Added boundary-only cave contours, restrained world-locked survey grid, biome-scale Brood signal rings, and a shared mineral/structure symbol system.
- Restyled arena rock modules from their exact world stratum so the committed board is a sampled precision view of the same geology.
- Rebuilt the roaming drone as a compact outlined survey chassis and upgraded framing with scan lines and explicit corner brackets.
- Updated the surrounding instrument shell to remove generated noise and use deliberate scan lines, inset survey borders, and the remote extraction-drone fiction.
- JavaScript syntax checks pass. Local server binding was denied by the sandbox; retrying the same narrow test command with approval.
- Local server is running. The first headless browser launch was stopped by the execution sandbox before page load; retrying the unchanged suite with approval.
- Full gameplay/camera/progression/collision browser suite passes with zero console or page errors after the renderer change.
- Inspected real running-build screenshots for opening, framing, Old Mine play, Brood play, and permanent multiball return play; the two biome shape languages remain clear across every state.


## Session: 2026-08-03 — Breakout Foundation & Oriented Arena Camera

- Added `R` rotation during framing while preserving player anchor, frame width, and frame depth.
- Added canonical arena presentation for all four world directions: center first, rotate second, pause simulation during transition, hold paddle-down orientation throughout play, rotate back, then return to the player.
- Used symmetric smootherstep easing, angle-scaled rotation duration, fixed scale, sequential translation/rotation, subtle transition dimming, and shake suppression for motion comfort.
- Added a north-facing fast path that does not wait through a no-op rotation.
- Replaced continuous cave texture inside committed claims with an opaque board layer of rounded, separated, material-specific brick modules.
- Unified brick artwork and collision dimensions through shared half-size and corner-radius constants.
- Replaced overlap-axis collision with 120 Hz fixed-step swept-circle vs. rounded-rectangle collision, actual corner normals, earliest-time resolution, and deterministic simultaneous seam contacts.
- Reworked paddle control around responsive target velocity, deterministic contact-position/velocity English, angle limiting, and clearer visual contact zones.
- Improved paddle, ball, trails, brick damage, local flashes, material glyphs, rails, impact particles, and screen hierarchy.
- Extended the browser suite with framing rotation, four-direction camera alignment after dwell, transition phase sequencing, camera return, rounded-corner response, and simultaneous two-brick seam response.
- Final suite passes with zero page/console errors; corner velocity reflects from `(6.364,6.364)` to `(-6.364,-6.364)`, and a centered seam returns `(0,-9)` while damaging both bricks.
- Visually inspected live Old Mine, Brood, east-facing empty-arena, and west-facing multiball screenshots; corrected a post-transition camera drift found only during visual review.

## Session: 2026-08-02 — Mobile Framing & Item Signals

- Enabled the normal collision-aware `WASD` movement update during frame mode.
- Added anonymous pale-diamond preview signals for hidden resource locations inside the current frame.
- Updated frame-mode HUD instructions and README controls.
- Added browser assertions that movement translates the frame while preserving dimensions/orientation, preview data omits identity, and previewing does not change hidden tile state.
- Full browser suite passes with four anonymous signals in the test frame and zero browser/page errors.

---

## Session: 2026-08-02 — Arena Authority Fix

- Removed the solid-ahead and 34%-density requirements from arena commitment.
- Replaced gameplay-quality validation with a technical world-bounds check only.
- Added a browser regression test that successfully commits a completely empty 5×6 arena (`0/30` solid cells).
- Re-ran the full Brood progression suite; all assertions pass with zero browser/page errors.

---

## Session: 2026-08-02 — Field Test 02 Implementation

- Read the game-engine, frontend-design, and planning-with-files skill instructions.
- Audited the full Field Test 01 HTML, CSS, game loop, rendering, physics, controls, and automated smoke test.
- Defined the next slice around one complete progression transformation: environmental multiball → Brood Heart → permanent controlled multiball → Old Mine return proof.
- Rebuilt the application shell, HUD, objective readout, and developer Power Lab around Field Test 02.
- Replaced single-ball state with a multiball collection, environmental division, swarm-gated shells/hearts, controlled permanent splitting, improved paddle physics, aim preview, trails, impact rings, hit-stop, and synthesized audio.
- `node --check game.js` and `node --check smoke-test.mjs` pass.
- Local server binding was denied in the sandbox; requesting the same narrowly scoped testing permission used by Field Test 01.
- First headless browser launch was blocked by the execution sandbox before page load; no application failure occurred. Retrying with scoped browser approval.
- Browser launch succeeded with approval and produced opening/frame screenshots with no reported page errors before the legacy test reached its obsolete single-ball assertion.
- Visually reviewed both screenshots; the presentation direction is working, and the deterministic test path now needs to select valid surfaces from world state.
- Replaced the legacy smoke test with a Field Test 02 browser suite covering route topology, one-ball baseline, final-ball loss, persistent landmarks, environmental division, real swarm damage against a heart, permanent multiball unlock, controlled three-ball splitting, Power Lab access, and browser errors.
- Added three authored cave plugs so the Brood expedition requires mining rather than allowing a continuous walk-through.
- Made heart-adjacent division cells regenerative until the landmark is conquered, eliminating an arena-exhaustion soft lock.
- Final browser suite passes with zero console/page errors; visual screenshots were reviewed after HUD-clutter fixes.
- Updated `README.md` for Field Test 02 with the complete progression premise, controls, Power Lab, scope, and verification command.
- Marked all Field Test 02 implementation phases complete. Subjective balance—especially whether players ever choose to delay the permanent split—remains the primary external playtest question.

---

## Session: 2026-08-03 — World & Progression Design

- Began a research-backed design brief for biomes, upgrades, locations, puzzles, and secret layers.
- Read the full imported conversation and treated later corrections as authoritative.
- Selected low-to-mid fidelity: enough specificity to prototype interactions without prematurely specifying content production details.
- Researched authoritative/reference material for Terraria's biome progression, Starbound's mission cadence, Noita's systemic discovery, and Animal Well's layered puzzle signaling.
- Created `WORLD_DESIGN_BRIEF.md` with seven provinces, seven embedded cornerstones, a branching three-reach progression spine, a shared puzzle grammar, three secret layers, early-run knowledge advantages, critical cuts, and a narrow next prototype.
- Verified that core abilities are solo-solvable and that no biome relies on passive immunity, gear score, random keys, or mandatory outside information.

---

## Session: 2026-08-02

### Phase 1: Requirements & Discovery
- **Status:** complete
- Actions taken:
  - Read the imported design conversation and identified later statements as authoritative.
  - Confirmed the workspace is empty.
  - Read the game-engine, frontend-design, and planning skill guidance.
- Files created/modified:
  - `task_plan.md`
  - `findings.md`
  - `progress.md`

### Phase 2: Planning & Structure
- **Status:** complete
- Actions taken:
  - Chose a dependency-free Canvas implementation.
  - Designed explore, frame, and excavate state transitions.
  - Designed a rotated local-coordinate model for cardinal arenas.
- Files created/modified:
  - `task_plan.md`
  - `findings.md`

### Phase 3: Implementation
- **Status:** complete
- Actions taken:
  - Built the visual application shell and responsive instrument panel.
  - Implemented deterministic mine generation, caverns, depth strata, hidden ore, crystal, and fossil resources.
  - Implemented roam, frame, and excavation modes with rotated local-coordinate arena physics.
  - Implemented resource reveal, ball/brick collisions, drops, collection, persistent excavation, and claim depletion.
- Files created/modified:
  - `index.html`
  - `styles.css`
  - `game.js`
  - `README.md`

### Phase 4: Testing & Verification
- **Status:** complete
- Actions taken:
  - `node --check game.js` passed.
  - Initial localhost server launch was blocked by sandbox policy; preparing a narrowly escalated retry.
  - Local server launched successfully with approval.
  - First Playwright run could not launch because its matching Chromium runtime was absent; preparing a scoped runtime install.
  - Installed Playwright's matching headless Chromium runtime.
  - Visual review found and fixed out-of-bounds movement and an overly shallow starting location.
  - Added a guaranteed starting resource seam so the first board demonstrates the resource loop.
  - Verified live north-facing play, collection, forced loss, persistent exhaustion, and a separate east-facing arena.
- Files created/modified:
  - `task_plan.md`
  - `findings.md`
  - `progress.md`

## Test Results
| Test | Input | Expected | Actual | Status |
|------|-------|----------|--------|--------|
| JavaScript syntax | `node --check game.js` | No syntax errors | No syntax errors | ✓ |
| North arena commit | Move north, frame, commit | Live arena with rock and revealed resources | 142 bricks, 97 value | ✓ |
| Breakout simulation | Serve and run for 2.5 seconds | Ball destroys tiles and can recover drops | 8 value recovered | ✓ |
| One-ball loss | Force ball below opening away from paddle | Return to roam; all surviving claim tiles exhausted | 132/132 surviving tiles exhausted | ✓ |
| Rotated arena | Place player at valid east wall and commit | Same simulation establishes facing east | 131-brick east arena live | ✓ |
| Runtime errors | Full smoke flow | No page or console errors | None | ✓ |

## Preview Boot Reliability (2026-08-03)

- Added an initial `INITIALIZING PADDLES` state that owns the entire selector until Pixi has built, laid out, and rendered all three production preview scenes.
- The selector now exposes `loading`, `ready`, and `failed` render states; initialization errors produce a visible reload message rather than three silent empty bays.
- Versioned the direct-file stylesheet and classic-script URLs so an updated `index.html` cannot silently reuse the prior selection renderer from browser cache.
- Added browser assertions requiring the selector to reach `ready` before interaction.
- `npm run build` passed.
- Full continuous-angle/progression browser regression passed in 36.9 seconds.
- Direct `file:///.../index.html` launch regression passed in 8.1 seconds with all three real fields visible and no console/page errors.
- Follow-up diagnosis at the user's 2048×1152 resolution found Pixi's inline 1280×720 CSS dimensions were overriding the responsive viewport. The HUD expanded while the renderer remained top-left at 1280×720, progressively shifting the three previews left until later cards appeared empty.
- The canvas now exactly fills the viewport content box; the preview fitter uses each production arena's measured display bounds rather than nominal grid dimensions.
- Starter order is now Needle / Surveyor / Bastion. Instructional copy is a high-contrast rule panel, and chassis names, values, units, dividers, and speed bars have materially larger treatments.
- Direct-file verification now runs at 2048×1152 and asserts canvas/HUD box equality. Direct-file and full gameplay browser suites both pass.
- A subsequent user capture showed that current markup and bundle reached `ready`, but WebGL still produced no composited pixels in the user's browser. The portable `file://` path now explicitly uses Pixi's Canvas renderer; HTTP/dev launches retain WebGL with Canvas fallback.
- The direct-file suite now inspects the Canvas pixel buffer across all three field rectangles and fails unless each contains a meaningful proportion of non-background pixels. It passes at 2048×1152 in 3.3 seconds; the served WebGL gameplay regression passes in 32.7 seconds.
- A further user capture established that even the populated Canvas backing buffer could remain invisible when composited underneath the full-screen deployment layer. The previews no longer rely on that stacking arrangement.
- Each field now owns a visible `.deployment-preview-surface` canvas inside its card. It is continuously mirrored from the actual live Pixi renderer, preserving the real terrain, production displays, ball simulation, and collision feedback while eliminating cross-layer browser compositing.
- Readiness now requires visible pixels in all three card-local surfaces. Direct-file verification passes in 2.9 seconds and the full served gameplay regression passes in 25.4 seconds.

## Localhost Runtime Correction (2026-08-03)

- User rejected the entire direct-file compatibility direction. Static PNG previews, generated assets, card-local canvas mirrors, Canvas readback checks, portable bundles, and the direct-file browser test were removed.
- `index.html` again loads `/src/main.ts` as a Vite module. There is one live Pixi renderer for both selection previews and gameplay.
- `Start Orekenoid.command` is executable and runs `npm run dev -- --open` from the repository directory.
- README now explicitly directs players to the launcher or `npm run dev`; opening `index.html` directly is unsupported.
- `npm run build`, six deterministic tests, and the complete localhost browser progression/render regression all pass.
- The Vite server was started and left running at `http://127.0.0.1:8080/`.

## Error Log
| Timestamp | Error | Attempt | Resolution |
|-----------|-------|---------|------------|
| 2026-08-02 | Localhost server bind denied by sandbox | 1 | Relaunch with local-server permission |
| 2026-08-02 | Playwright Chromium executable missing | 1 | Install matching Chromium runtime and rerun smoke test |
| 2026-08-02 | Forced loss was caught; naïve east route hit a tunnel | 1 | Put probe outside paddle and choose a valid east wall from generated topology |
| 2026-08-02 | Planning completion script lacked execute permission | 1 | Run it explicitly with `sh` |

## 5-Question Reboot Check
| Question | Answer |
|----------|--------|
| Where am I? | Phase 5 complete |
| Where am I going? | User playtest and design feedback |
| What's the goal? | Validate the open-mine/player-defined-Breakout-arena loop |
| What have I learned? | See `findings.md` |
| What have I done? | See above |

# Orekenoid — World Detail Brief

*Written 2026-08-04, after measuring our generator and both reference games.*

`WORLD_DESIGN_BRIEF.md` sets the large-scale design and it stands. This brief is
about the scale below it: **what a screen of the mine contains, and why a player
would go and look at another one.**

## The complaint

> There is no reason to explore, only reason to traverse. The world feels entirely
> lifeless and like I have no reasonable expectation of surprises anywhere of any
> kind at any time.

That is accurate, and it is not a tuning problem. Three mechanisms that both
reference games rely on are entirely absent from our generator.

## Measured facts

### Ours, from `src/worldgen/`

| | Measured |
|---|---|
| World | 240 × 144 cells = 34,560 |
| Screens of world | 7.9 × 8.4 ≈ **66** |
| Time to cross | **40 seconds** wide, 24 seconds down |
| Open space | 43% |
| Corridor clearance | median **2** cells, p90 4, max 7 |
| Caverns | 130 procedural ellipses, 4.6–17.4 cells across (median 9.3) |
| Connections | 206 edges, 19 dead ends |
| Authored room chunks | **0** |
| Generator passes that place contents | **0** |
| Points of interest, whole world | **11** (3 cornerstones, 8 Landing features) |

### Noita, measured from `reference files/noita-telescope/data/`

| | Measured |
|---|---|
| World | 70 × 48 biome chunks × 512 px = **35,840 × 24,576** world px |
| Distinct biome regions | **129** |
| Terrain composition | herringbone Wang tiling over hand-drawn PNG templates |
| **One Wang tile = one room** | Coal Mine **260×130** px · Excavation Site 400×200 · Snow Cave 520×260 · Crypt 440×220 |
| Screen | ~427×242 px — so **a room is about half a screen** |
| Hand-drawn tile variants | **~4,100** across 30 templates (upper bound, from template area) |
| Hand-authored bespoke rooms (*pixel scenes*) | **464**, stamped in place of procedural tiles at exact tile footprints |
| Spawn-marker colours | **181** — a coloured pixel *in the art* spawns a thing |

Density counted directly out of `coalmine.png`, which carries **1,724 markers**:

| | Count | Per screen-equivalent |
|---|---:|---:|
| Enemy spawns | 578 | ~3.7 |
| Reward spawns | 249 | ~1.6 |
| Structure / room hooks | 354 | ~2.3 |
| Decoration | 543 | ~3.5 |

### Terraria, from the tModLoader wiki and decompiled 1.4.0.5

Population is **density × world area**, not hand placement:

- Copper ore: `6e-05` / `8e-05` / `2e-04` by depth layer. On a small world
  (4200×1200 = 5.04M tiles) the deep pass alone is over a thousand splotches.
- `TileRunner(strength, steps)`: shallow caves `3–6, 2–6`; deep `4–9, 4–8`.
- ~100 Life Crystals on a small world.
- `StructureMap.CanPlace()` / `AddProtectedStructure()` reserves rectangles so
  placed features never collide.
- A primitive vocabulary: `GenShape` (Circle, Rectangle, Slime, Mound,
  ShapeBranch) × `GenAction` (SetTile, PlaceWall, Blotches, Dither, NotTouching,
  OnlyTiles).

Room-scale ladder, from real code:

| Structure | Dimensions | Behaviour |
|---|---|---|
| `CampsiteBiome` | radius **6–10 tiles** | validate a 10-tile circle, check StructureMap, place campfire/torch/tent at 90% each |
| `MarbleBiome` | **168×78 tiles**, cave 80–150 × 40–60 | elliptical formula, walls 25% |
| `GraniteBiome` | **200×200 tiles** | 300-iteration pressure simulation, stalactites 12.5%/tile |

A Terraria screen is roughly 100×60 tiles, so a campsite is **~1/6 of a screen**
and a mini-biome is **1–2 screens**. Two clearly separated tiers.

### Terraria's macro map — the part worth copying wholesale

Vertical axis: **four named layers with sharp, legible boundaries**, as fractions of
world height.

| Layer | Small world (1200 tall) | Share |
|---|---|---|
| Space / Surface | 0 → ~228 | 19% |
| Underground | 228 → 552 | 27% |
| **Cavern** | 552 → 1000 | **37% — the largest layer** |
| Underworld | 1000 → 1200 | bottom 200 tiles, flat, not a fraction |

Horizontal axis: **discrete named destinations placed by rule at fixed fractional
positions**, mirrored by one coin flip:

| Feature | Position | Rule |
|---|---|---|
| Dungeon | 7% or **93%** | near an edge; side decided by the coin flip |
| Snow | 14% or 86% | same side as the dungeon |
| Jungle | 78% or **22%** | deliberately the **opposite** side from the dungeon |
| Desert | 68% or 32% | |
| Evil biome | 30% or 72% | forced at least 12% of width away from centre |
| Oceans | both ends | coast ~7% of width, capping the world |
| Spawn | dead centre | so both directions are a real choice |

Three lessons:

1. **The horizontal axis carries information.** "Go left" means something specific.
2. **The two most important destinations are placed at opposite ends on purpose**,
   so reaching the second is a journey rather than a detour.
3. **The world is bounded and the bounds are legible** — oceans tell you the world
   has ends, which is what makes the middle feel like somewhere.

### Both reference games have a dominant axis. Ours does not.

| | Aspect | Journey |
|---|---|---|
| Terraria (small) | 4200 × 1200 = **3.5 : 1** | strongly horizontal |
| Noita (playable main path) | ~10 × 48 chunks ≈ **1 : 5** | strongly vertical |
| **Orekenoid** | 240 × 144 = **1.67 : 1** | **none — nearly square** |

A square world has no dominant axis, so it has no sense of journey: every direction
is statistically identical to every other. For a *mine*, the natural dominant axis
is descent, and our depth bands already want to be that.

### The comparison that matters

| | Terraria (small) | Noita | **Orekenoid** |
|---|---:|---:|---:|
| World in tile-equivalents | 5,040,000 | ~8,800,000 | **34,560** |
| Authored room chunks | many | ~4,100 tiles + 464 rooms | **0** |
| Populate passes | dozens | 181 marker types | **0** |
| Things worth finding | ~100 crystals + hundreds of chests/pots | ~1.6 per screen | **11 total** |

**Our world is 146× smaller than the smallest Terraria world**, and it has no room
scale, no populate pass and no marker system.

## The thesis

Both games compose terrain from **authored chunks whose art also carries the
population data**. Noita does it literally: colour → material, special colour →
spawn. That pipeline is directly copyable, because we already have a cell grid and
a material table.

But copying the mechanism is not enough on its own, because it would answer *what
is in a room* without answering *why go to the next one*. So:

> **The reason to explore must be to find good ground to claim.**

Right now every wall in the mine is equally claimable, so no location is preferable
to any other, so there is no prospecting — only transit. If the world contains
rare, visibly signposted *good claims* — a seam that crosses three chambers, a
lattice aligned so a cascade will run, a slate bank you could leave standing — then
roaming becomes reading the world for a place worth committing to. That is
pleasures 1 and 2 of `WORLD_DESIGN_BRIEF.md` doing their job, and it makes every
other addition below serve the core loop instead of decorating it.

## The plan

### 0. Scale and shape: 4× area, and make it vertical

4× area was chosen over a 20× jump because a bigger empty world is worse than a
small empty one: the room library and populate passes have to exist before more
space helps.

But **shape matters more than area**. 480×288 keeps our aspect at 1.67:1 — still
square, still no journey. The recommendation is instead:

> **240 × 576 cells** (138,240 — the same 4× area, keeping the current width and
> quadrupling the depth) for an aspect of **1 : 2.4**.

That makes descent the journey and lateral movement a local choice, which is what a
mine is. It also gives each of the four depth bands 144 rows to itself — as much
vertical room as the *entire* world has today.

Consequence to decide: at the current 13.5 m per cell that is a 7,776 m mine rather
than 1,946 m. Either the mine gets genuinely deep, or metres-per-cell is rescaled to
keep the ~2,000 m figure the existing brief and HUD use.

### 0b. Give the horizontal axis meaning

Provinces are currently noise fields, which produces fuzzy blobs and means no
direction promises anything. Adopt Terraria's rule-based placement instead: named
destinations at fixed fractional positions, mirrored by one coin flip per world,
with the most important ones deliberately far apart. The Landing stays central so
both directions are a real choice.

### 1. Rooms: authored PNG chunks, stamped

Painted in any image editor. Colour → material via a table; reserved colours are
markers. Three size tiers, following Terraria's own ladder rather than inventing
one:

| Tier | Cells | Share of screen | Role |
|---|---|---|---|
| **Feature** | 6×6 – 12×12 | ~⅙ | a cache, a stake circle, a collapsed cart, a vent |
| **Chamber** | 18×9 / 9×18 | ~½ | a real room with internal structure |
| **Hall** | 36×18 | ~1 | rare, memorable, worth telling someone about |

Stamped into the **existing** procedural cave field rather than replacing it, with
a `StructureMap` equivalent for reservation. This keeps the tested connectivity
contract intact. Replacing the cavern/corridor carve with full herringbone Wang
tiling is a later option, once the library exists and has proven itself.

### 2. Populate passes

The thing our pipeline has none of. Density × area, targeting Noita's measured
per-screen figures rather than Terraria's constants (whose absolute values assume
a world 36× larger in tiles):

- ~1.6 reward-class placements per screen → ~420 across the world
- ~2.3 structure hooks per screen → ~600
- decoration to taste

Every placement resolves through the material table and respects reservations.

### 3. Fix the drone's collision box before touching clearance

Found while authoring a "pinch" room and checking whether the drone could fit through
it. `WorldModel.isOpenWorldPixels(x, y, radius = 12)` tests a 24 px box:

| | |
|---|---|
| Collision box | 24 px = **0.57 cells** |
| Drone silhouette | ~156 px = **3.7 cells** |
| Ratio | the drone is **6.5× wider than the thing that collides** |

So the machine visibly clips through rock, and **no passage in the world can
physically constrain it** — a one-cell gap is passable by something drawn nearly four
cells wide. This is a direct mechanical cause of frictionless traversal, and it means
clearance variety cannot matter until it is fixed. It is also close to a one-line
change plus tuning, which makes it the highest-leverage item in this whole document.

### 4. Clearance as a designed variable

Today clearance is a byproduct: median 2, max 7, smooth falloff, no pinches and no
galleries. It should be an input — a field that the carve consults — so the world
contains squeezes the drone barely fits through and halls that open up and make
the player stop. This is most of what makes traversal stop feeling uniform.

### 5. The world must run

Rapier is installed and idle; nothing outside an arena moves. Per the existing
brief, no ordinary enemies until the ball/terrain ecology is rich, and anything
autonomous must alter trajectories or geography rather than turn this into combat.
Candidates that qualify:

- loose rock that falls and settles when its support is removed
- water seeping into excavated space (already the Tidal Hollows rule)
- Rootwarren growth creeping in the *world*, not only inside arenas, so the mine
  changes while the player is elsewhere
- drifting spores that carry between chambers

### 6. Reason to explore

In priority order, all of them tied to the core loop rather than bolted beside it:

1. **Good claims** — rare, readable, worth travelling to. The primary reward.
2. **Anomalies** — the signalling-contract hooks the discovery layer will need.
3. **Procedure sites** — the four knowledge procedures already in the brief.
4. **Survey data** — a room that improves what the player can read.
5. **Material caches** — smallest, and deliberately last, so exploration never
   becomes a substitute for claiming.

## Open questions

- Does the Atlas need zoom at 480×288? At 5 px/cell that is 2400×1440, larger than
  the aperture. Probably 2–3 px/cell fitted, with the current 5 px as a zoom level.
- Worldgen cost at 4× area, and whether generation needs to be chunked or
  backgrounded to keep boot time acceptable.
- How the room library is versioned: PNGs in the repo are opaque to diffs.

---

# The block library plan

*Added 2026-08-04, after measuring the reference libraries. What it takes to get from
four rooms to a shippable amount of variety.*

## The number

Our placement densities are already calibrated to Noita's measured ~2.3 structure hooks
per screen. On the reshaped world they produce:

| | | |
|---|---:|---|
| World | 240 × 576 | 138,240 cells, **265 screens** |
| Feature placements | **359** | 2.6 per 1,000 cells |
| Chamber placements | **207** | 1.5 per 1,000 cells |
| Hall placements | **41** | 0.30 per 1,000 cells |
| **Total** | **607** | 2.29 rooms per screen |

A block the player meets more than about four times stops being a place and becomes
wallpaper; a *hall* stops being memorable after two. Working backwards, and taking the
free doubling that horizontal mirroring gives:

| Tier | Placements | Max repeats | Distinct needed | **Authored** |
|---|---:|---:|---:|---:|
| feature | 359 | 4 | 90 | **45** |
| chamber | 207 | 4 | 52 | **26** |
| hall | 41 | 2 | 20 | **10** |
| | | | | **~81** |

**~81 hand-authored rooms** is the target. We have 4. For scale, Noita ships ~464
authored rooms plus ~4,100 wang-tile variants, so 81 is modest by comparison — but it is
the largest single content task in the project, and it is the whole job.

## The to-do list

### Phase 1 — multipliers, before volume — **done**

Every one of these makes an authored room go further, so they came first. Doing them after
authoring 81 rooms would have wasted most of their value. 42 rooms now expand to **94
variants**, of which any one province can draw on 50–64 where it could draw on 15.

1. ~~**Horizontal mirroring on stamp.**~~ Done, on by default, `-nomirror` to opt out. It
   also flips facet axis glyphs, since a reflecting diagonal is a direction and a mirrored
   lattice would otherwise contradict its own drawn geometry.
2. ~~**90° rotation.**~~ Done, but **opt-in** via `-rot` rather than opt-out, which is the
   opposite of what this item assumed. A quarter turn puts a room's floor on a wall: that
   reads for a room composed around a centre and is nonsense for a spoil heap or a talus
   slope. Five rooms qualify, not most of them.
3. ~~**Province material substitution.**~~ Done, and it is the largest of the four. Mapped
   by *structural role* — `plain`, `structural`, `rule`, `accent` — with two refusals that
   turned out to matter: rooms tagged `-fixed`, whose design depends on a behaviour rather
   than a role (a cascade rebuilt in chalk and coal is a ring of rubble), and rooms whose
   roles would *collide* in the target, since the Rootwarren splits hard rock and rule
   across heartwood and living block where Karst uses slate for both. 15–24 placements per
   world are now rooms rebuilt in a foreign vocabulary.
4. ~~**Resolve `?` random-feature slots.**~~ Done in the previous pass.
5. ~~**Depth-band gating.**~~ Done, via `-b12` / `-b34` filename tags. Ten rooms gated:
   human workings shallow, the grand and the strange deep. Gating is deliberately sparse —
   gating everything starves a band's pool rather than shaping it.
6. ~~**Repetition-aware placement.**~~ Done in the previous pass, and now counts authored
   *families* rather than variants, so four readings of one composition still spend one
   unit of the repeat budget. Letting mirrors dodge the budget would hand back exactly the
   wallpaper the budget exists to prevent.

**A bug this pass exposed, worth recording:** stamping was assigning `resource: null` to
every cell it painted, so each room was a barren patch cut out of the ore field. With rooms
covering a growing share of the world that was quietly eroding the shallow economy — Band I
copper had fallen to within one cell of the affordability contract, and the temptation was
to lower the threshold. Rooms now take their ore from `resourceFor`, the same function the
field pass uses, so a room's rock carries ore at the rate its surroundings do. Band I
copper went from 29–37 to 32–55. A stamped room had no reason to be barren.

### Open finding — `report.reachableCells` describes a world that never ships

Found by the world inspector's connectivity layer within minutes of it existing, and it needs
a decision before Phase 2 touches the world frame.

Probing `caves.open` through the tail of `generateWorld` on `bounceworld-01`:

```
before verify:            open=20285  reach=262     <- already sealed
after verify:             open=20490  reach=20474   <- repair carved an exit
after restamp:            open=20464  reach=264     <- the re-stamp walls it up again
after enforceInvariants:  open=20464  reach=264
```

The Landing starts enclosed by its five teaching faces, which is almost certainly deliberate —
the first lesson *is* to break the Chalk Face. Verification's corridor repair then treats that
enclosure as a fault and carves an escape route through the authored faces; `verify` measures
reachability at that moment and reports 20,474 of 20,490; and the re-stamp immediately after
restores the faces, so the shipped world has **262**. The contract test
`report.reachableCells / report.openCells > 0.99` therefore passes on a number that describes
an intermediate state no player ever sees. It is the same class of error as the
`missingLandingFeatures` bug — verification must run on the world that ships — fixed in one
direction and left in the other.

Measured directly on the shipped world instead: the cave network **is** one connected body,
98.5% of open cells, and the only cut-off region is the Landing's own 262-cell pocket. Beyond
that pocket just 44 cells are genuinely stranded. So the generator is fine; the *measurement*
is wrong.

The recommended fix, which is a design decision rather than a bug fix:

1. Replace the reachability contract with a **largest-connected-component** one — no start
   point, so the Landing's seal cannot flatter it and an orphaned pocket shows up wherever it
   is. `openComponents` in `caves.ts` already computes this.
2. Add the property that actually matters and that nothing currently checks: the Landing's
   seal must be **breakable**. A persistent wall anywhere around the start pocket would make
   an expedition unwinnable from the first frame.
3. Stop verification's repair from carving through authored territory at all, rather than
   carving and then stamping over it. The repair should treat reserved ground as impassable.

Items 1 and 2 are now asserted in `tests/worldmap.test.ts` against the shipped world, so the
property is covered while the report itself is still misleading. Item 3 is the real fix.

### Phase 2 — the world frame, before bulk authoring

Rooms must not be authored against dimensions and rules that are about to change.

7. **Reshape to 240 × 576** and let the mine get deep (decided; not yet done). Atlas needs
   2–3 px/cell fitted with the current 5 px as a zoom level.
8. **Rule-based province placement** at fixed fractional positions with a per-world coin
   flip, replacing the noise fields, so the horizontal axis carries information.
9. **Clearance as a designed variable** — a field the carve consults, so pinches (1 cell)
   and galleries (8+) exist by intent rather than by accident.
10. **Populate passes for non-room content** — ore splotches, decoration, texture — at
    Terraria-style `density × area`, with detail as per-cell probability rather than hand
    placement.

### Phase 3 — the authored library

11. **Karst: 22 rooms** — 12 features, 7 chambers, 3 halls. All about the slate decision:
    the best wall and the best iron from the same stone.
12. **Mirrorreef: 22 rooms** — all about lattice alignment. Facet walls at angles, cascade
    chains that only run if framed one way, mirror geometry that banks a ball across the
    room.
13. **Rootwarren: 22 rooms** — all about pruning versus clearing. Regrowth that punishes
    clearing everything, spore bulbs positioned so membranes help or hinder.
14. **Ecotones: 9 rooms** — 3 each for Bright Fault, Chalk Warren, Bloom Shelf, combining
    both parent rules, and the only place their rare reagents appear.
15. **Province-agnostic: 11 rooms** — 6 features, 3 chambers, 2 halls built entirely from
    the structural vocabulary in (3), so each one serves all three provinces.
16. **Cornerstone approaches: 6 rooms** — two per cornerstone, stamped only near it, so
    arriving somewhere important feels like arriving.

### Phase 4 — quality control at scale

Eighty rooms cannot be reviewed by opening eighty preview files.

17. **Contact-sheet renderer.** `roomkit sheet` — every room in the library on one
    annotated image, so the whole library can be judged at a glance and outliers spotted.
18. **Repetition metrics in the generation report.** Placements per room, most-repeated
    room, nearest same-room distance. Surface it so starvation and over-use are visible
    instead of inferred.
19. **Profile thresholds enforced in tests**, not just printed — composition, corners,
    passable edges, marker counts. A library this size will drift otherwise.
20. **A variety test.** Generate a world and assert no room exceeds its repeat budget and
    every province has at least N distinct rooms placed.

## Ordering

Phases 1 and 2 are engineering and should be finished first — together they roughly
quadruple what each authored room is worth, and they change the dimensions rooms are drawn
against. Phase 3 is the bulk of the calendar time and is highly parallel: each room is
independent, and `rooms/AUTHORING_GUIDE.md` exists so it can be delegated. Phase 4 should
land early in Phase 3, not after it, because it is what keeps quality from drifting once
the library is too large to eyeball.

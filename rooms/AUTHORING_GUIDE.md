# Authoring building blocks for Orekenoid

*A guide for whoever writes the next room — human or model. Written 2026-08-04 after
measuring all 74 of Noita's authored rooms and reading Terraria's real mini-biome code.*

Read this before writing a room. Then run `npm run rooms && node tools/roomkit.mjs profile`
and **look at the preview**.

---

## 1. What a building block is here

One PNG in `rooms/`. One pixel is one world cell. It is stamped into procedurally
generated terrain, not placed on an empty canvas — so the most important thing about a
block is not what it contains but **how it negotiates with the rock around it.**

Three cell classes, and the whole contract lives in the difference between them:

| Glyph | Colour | Means |
|---|---|---|
| `-` | `#ff00ff` | **transparent** — leave the generated world exactly as it was |
| `.` | `#000000` | **open** — carve this, whatever was here |
| any material | see `npm run rooms:palette` | **paint** this rock |
| `1`–`5` `*` `?` | | **marker** — place a feature, plus its host cell |

Transparent is not "empty". It is a deliberate statement that the generator's decision
is better than yours at that cell. **Roughly a third of a good room is transparent.**

---

## 2. What the reference games actually do

Measured, not remembered.

### Noita — 74 authored rooms, decoded from `reference files/noita-telescope/data/`

| | Median | Range |
|---|---:|---|
| transparent | **32%** | 0–100% |
| open (carved air) | **53%** | 0–91% |
| painted material | **14%** | 0–94% |
| markers per room | **3** | 1–23 |

Its edges are a hard rule, not a tendency:

- **Top and bottom edges: 100% transparent** in almost every room. The world decides
  what is above and below.
- **Left and right edges: ~35–58% transparent, ~42–65% carved open, and ~0% solid.**
  Noita's rooms are wang tiles, so a sealed side would sever the corridor network.
- **All four corners transparent in 48 of 74 rooms.**

The headline: **a room is mostly negative space and deference. Only about one cell in
seven is authored rock.** Every author's instinct is to paint too much.

The composition pattern that recurs: **an organic cavity carved into rock, plus one
deliberate flat man-made plane where the payload sits.** Noita's `shop.png` is a large
irregular air pocket with a single flat stone slab across the bottom carrying five
evenly-spaced item markers. The cavity is geology; the slab is authorship; the contents
sit on the slab.

### Terraria — real decompiled 1.4.0.5 code

Terraria contributes the *placement* discipline rather than the interior:

- **Two clearly separated tiers.** `CampsiteBiome` is radius **6–10 tiles** — about ⅙ of
  a screen, a small found thing. `MarbleBiome` is **168×78** and `GraniteBiome` **200×200**
  — 1–2 screens, a place. Nothing sits between them.
- **Validate, then place.** `CampsiteBiome` checks a 10-tile circle has enough solid tiles
  *and* asks `StructureMap.CanPlace()` before committing, then calls
  `AddProtectedStructure()`. Never place without testing the site.
- **Density × area, never counts.** Ore is `6e-05`–`2e-04` per tile, so the numbers
  survive the world being resized.
- **Detail is probabilistic, not placed.** Stalactites at 12.5% per tile, walls at 25%.
  Texture comes from a coin flip per cell, not from hand-placing every rock.

---

## 3. Orekenoid's own constraints, which differ

Do not copy Noita's numbers blindly. Three things about our game change the maths.

**Our machine is enormous relative to the screen.** Noita's player is ~7px against a
427px screen — 1.6% of screen width. Our drone is 3.72 cells against 30.5 — **12%**. It
is **7.5× larger relative to the view**. So:

> Our rooms need *more* open space per screen than Noita's, not the same. Detail density
> must be lower. A room that would read as pleasantly cluttered in Noita reads as
> impassable here.

**The hull is a long thin rectangle: 3.72 × 0.48 cells.** It rotates with heading.
Therefore:
- A gap **1 cell** wide or tall is passable *only* edge-on. That is what a pinch is.
- A gap **4+ cells** is passable at any heading. That is a corridor, not a pinch.
- 2–3 cells is the interesting middle: passable at some headings, not others.

**A room becomes a Breakout arena when claimed.** Material choice is not decoration, it
is claim economics:
- Liable material left standing at resolution becomes **load**, and load becomes damage.
- `slate` and `mirrorSlate` are **non-liable** — free to leave standing, and 4 hits.
- `chalk`, `reef`, `sapwood` are 1 hit and liable.
- So a room packed with liable rock is a *risk*; a room built from slate is a *puzzle*.
  Choose deliberately and say which you meant in the comment.

---

## 4. The rules

### Structure

1. **All four corners transparent.** Enforced by a test. An opaque corner cuts a visible
   rectangle into the rock and destroys the illusion that the room is geology.
2. **At least two edges must offer passage** (≥40% transparent-or-open). Enforced by
   `roomkit profile`. A room that seals itself can orphan part of the world; the repair
   pass will then carve through it and ruin what you made.
3. **A floor is fine.** Unlike Noita's wang tiles, our rooms stamp into a cave field, so
   a painted floor row is correct and expected. Do not make the bottom edge transparent
   just because Noita does.
4. **Carve the cavity as an ellipse or a blob, never a rectangle.** `room.ellipse(...)`
   with transparent corners is the whole trick.

### Composition

5. **Target 45–65% open, 15–30% painted, 15–40% transparent.** Our band is shifted more
   open than Noita's because of the hull size. `roomkit profile` flags you outside it.
6. **One deliberate plane per room.** A flat shelf, a floor, a slab — somewhere the eye
   rests and the contents sit. Everything else can be irregular.
7. **Thin your structure.** A one-cell column with a capital reads better and plays
   better than a two-cell block. My first colonnade was 40% painted material; thinning
   the columns to one cell brought it to 26% and it looked *more* like a colonnade.
8. **Do not hand-place texture.** No speckling individual rocks. Variation at that scale
   is the terrain renderer's job, and Terraria does it with a per-cell probability.

### Contents

9. **Bury the rewards.** `1` cache and `3` seam resolve to **rock plus a feature** — they
   cost a claim to reach. `2` anomaly, `4` survey, `5` procedure, `*` decor and `?` random
   hang in the cavity. A seam in open air is free, and free rewards turn prospecting back
   into collection.
9b. **Every marker now draws something.** Seams show as mineral staining, caches as spoil
    cairns, anomalies as haloed rotating instruments, survey points as plumb rigs,
    procedure sites as socketed plinths, decor as props attached to the nearest rock face
    within four cells. So a marker is a visible object the player can travel to, not a
    database row — place them where you want the player's eye to go.
9c. **`?` is the cheapest variety in the pipeline.** It resolves at stamp time to a weighted
    pick (decor 50, survey 18, cache 14, anomaly 10, seam 8), so identical geometry delivers
    different contents world to world at no art cost. Use it liberally in place of `*`.
10. **A buried marker must sit inside a rock mass.** Place one in open space and it
    resolves to a single one-cell block hanging in mid-air, which reads as a bug.
11. **Put the payoff behind the obstacle.** The reward should be on the far side of the
    thing the room is about — through the pinch, behind the bank — so solving the room is
    what earns it.
12. **2–5 markers for a chamber, 1–3 for a feature, 5–10 for a hall.** Noita's median is
    3. Its 23-marker `laboratory` is a deliberate set-piece; do not make every room one.

### Meaning

13. **Every room must be *about* its province's rule.** This is the one that separates a
    building block from a corridor with extra steps.
    - **Surveyor's Karst** — the slate decision. Slate is simultaneously the best wall
      (non-liable, 4 hits) and the best iron. A Karst room poses that trade in a new
      shape: a bank across the middle, a colonnade you can keep, a seam behind slate.
    - **Mirrorreef** — lattice alignment. Facets turn the ball 90° against a fixed
      diagonal, and charged facets cascade. A Mirrorreef room should make claim heading
      versus lattice orientation *matter*: a facet wall at 45°, a cascade that only runs
      if you frame it one way.
    - **Rootwarren** — pruning versus clearing. Living rock regrows on a budget and spore
      bulbs leave rebound membranes, so fast clearing can be worse than careful cutting.
      A Rootwarren room should punish clearing everything.
14. **Say what the room is for, in a comment, in one sentence.** If you cannot, it is not
    a building block yet.

---

## 5. The workflow

```bash
# 1. Write it. rooms/src/<province>.mjs, using the Canvas API.
# 2. Compile, validate, and generate the typed library.
npm run rooms
# 3. Check composition against the reference numbers.
node tools/roomkit.mjs profile
# 4. Render a big annotated preview.
npm run rooms:preview
# 5. LOOK AT IT. Open rooms/<name>.preview.png. Do not skip this.
# 6. Confirm nothing broke.
npm test
```

**Step 5 is not optional, and it is where the bugs are.** Every composition bug in the
first four rooms was found by looking, not by reasoning: a slate bank that read as
stair-step scatter instead of one object; a seam marker floating in mid-air; columns so
thick the hall was unflyable. None of them were visible in the source.

### The Canvas API

```js
const room = new Canvas(18, 9, "-");        // transparent by default
room.ellipse(8.5, 4.2, 8.4, 4.3, ".");      // the cavity — cx, cy, rx, ry, glyph
room.rect(1, 8, 16, 8, "c");                // a chalk floor row
room.band(5, 8, 11, 0, 2, "s");             // a solid 2-thick diagonal bank
room.line(4, 3, 17, 1, "c");                // one-cell line
room.set(15, 3, "3");                       // a single cell, by coordinate
room.frame(...) room.flood(...) room.replace(...) room.stamp(other, x, y)
```

Use `band()` and not stacked `line()` calls for anything thicker than one cell: at angles
steeper than 45° offset Bresenham lines read as scatter, not as one object.

---

## 6. Anti-patterns

| Don't | Because |
|---|---|
| Fill the rectangle with material | It cuts a visible box into the rock. ~⅓ transparent. |
| Paint 40% of the room solid | You have made a maze, not a room. Median is 14–26%. |
| Wall in three or four edges | The repair pass will carve through it and ruin the room. |
| Put a cache or seam in open air | Free rewards destroy prospecting. Bury them. |
| Speckle individual rocks for texture | That is the renderer's job. Author *shape*. |
| Author a shape with no rule in it | A room that is only a shape is a corridor with steps. |
| Make a 3-cell "pinch" | The hull is 0.48 cells thin. Pinches are **1** cell. |
| Copy Noita's density | Our drone is 7.5× larger relative to the screen. |
| Trust the source | Render the preview and look at it. |
| Reuse a composition across provinces | A steep diagonal band in slate and the same band in facet are *one room in two palettes*. The contact sheet makes it obvious; reading the source never does. |
| Use the same cavity ellipse in every room | Silhouette is the first thing the eye compares. Fourteen rooms sharing one centred ellipse read as one room. Union two or three lobes, differently per room. |
| Draw a facet wall with `f` | `f` takes the world's noise axis, so the wall has mixed diagonals and the rule collapses. Pin it with `/` and `\`. |
| Frame a "somebody was here" structure completely | A full rectangle reads as a box. What sells it is a straight line *meeting* an organic one — partial props, a cut floor, roof left to the world. |

---

## 7. Checklist before you commit a room

- [ ] `npm run rooms` passes — every colour resolves
- [ ] `roomkit profile` reports no notes
- [ ] All four corners transparent; at least two edges passable
- [ ] Between 45% and 65% open
- [ ] Buried markers are inside rock; the payoff is behind the obstacle
- [ ] One sentence in the comment says what the room is *for*
- [ ] The room expresses its province's rule
- [ ] **You have opened the preview PNG and looked at it**
- [ ] `npm test` passes

---

## 8. Where the library stands

**42 rooms** — 16 features, 18 chambers, 8 halls; 7 Karst, 8 Mirrorreef, 8 Rootwarren, 3 per
ecotone, 10 province-agnostic. Expanded by the multipliers to **94 variants**, of which any
one province can draw on 50–64. A world places **47–59 rooms carrying 126–142 features** as
**38–50 distinct readings**, and repeats no authored composition more than 3 times.

The library is no longer the constraint on variety. The *world* is: placement counts come from
a density per thousand cells, so at 240×144 the mine simply cannot hold more rooms than that.
Next is the reshape to 240×576 in `WORLD_DETAIL_BRIEF.md`, which the pool is now deep enough
to fill.

## 9. Designing for the multipliers

One authored room becomes many placements. That is mostly free, but it is not automatic — a
room that ignores the multipliers gets fewer of them, and a room that fights one has to say so.

**Every room is mirrored.** So do not lean on left-versus-right as a load-bearing idea, and
check that your composition still reads reversed. If the room genuinely has a handedness worth
protecting, tag it `-nomirror` — but that is rare, and it halves the room's value.

**Every room is rebuilt in the other provinces' materials**, mapped by *structural role*
rather than by material: `plain` filler rock, the `structural` hard rock, the province's
`rule`-bearing material, and an `accent`. So `karst-slate-shelf` is not really "a shelf made
of slate" — it is "a shelf of the local hard rock over a pocket of the local soft rock", which
is buildable anywhere. The play changes with the move and that is the feature: a slate shelf is
free to leave standing, the heartwood shelf it becomes in the Rootwarren is not. The same
silhouette asks a different question in each province.

Two things block substitution, both deliberate:

- **Tag `-fixed`** when the design depends on a material *behaviour* rather than its role. A
  cascade chain rebuilt in chalk and coal is a ring of rubble with no reason to exist, because
  only charged facet chains. Shape transfers; behaviour does not.
- **Role collision**, checked automatically. The Rootwarren is the only province that uses
  different materials for its hard rock and its rule — heartwood and living block. Karst uses
  slate for both. So a Rootwarren room built from both has two distinct structural ideas that
  Karst cannot tell apart, and rebuilding it there would merge the cells and the growth filling
  them into one slab. Those rooms stay home; nothing needs tagging.

**No room is rotated unless you tag `-rot`.** A quarter turn puts the room's floor on a wall.
That reads for a room composed around a centre — a vent, a charge node, a knot, a bud — and is
nonsense for a spoil heap or a talus slope, whose entire subject is material lying on the
ground. Only five rooms qualify. Do not tag it hopefully; look at the turned reading first.

**Facet axes flip themselves.** `/` `\` `%` `&` pin a reflecting diagonal, which is a
direction, and both a mirror and a quarter turn map one diagonal onto the other. The transform
swaps the glyphs for you. Draw the axis you mean in the as-drawn reading and stop thinking
about it.

**Depth tags shape the world, they do not decorate it.** `-b12` on a timbered drift and `-b34`
on a cathedral is what makes descending read as progress. Gate sparingly: gating everything
starves a band's pool instead of shaping it, and a band with nothing to place in it gets bare
procedural cave.

## 10. Two things worth knowing before you start

**Small rooms need proportionally more air.** A one-cell floor is 12% of an eight-row room but
5% of an eighteen-row one, so features hit the over-painted flag far more easily than chambers.
Use a single floor row, and lean on transparent.

**Not every wall should be painted.** `any-vent` began by painting its own shaft walls, which
wasted a third of the room's area *and* replaced whatever the province had put there with
generic host rock. A shaft is a hole through rock that is already there: carve the throat, leave
the sides transparent, and add only a collar at the mouths so it reads as worked rather than as
a rendering glitch.

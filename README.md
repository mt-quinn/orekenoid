# Orekenoid — WebGL Vertical Slice

A browser-first TypeScript/PixiJS build of Orekenoid's core expedition: move a remote mining drone through a continuous, seeded underground world, frame arbitrary terrain as a Breakout arena, reveal its hidden contents, and convert what you recover into capability at the forge.

The world is generated at three scales — **provinces** with one readable physical rule each, **ecotones** where two rules combine, and **authored cornerstones** stamped into procedural geology. See `WORLD_DESIGN_BRIEF.md` for the design and `PROGRESSION_AND_ECONOMY.md` for the resource map, crafting chain and generator contract.

## Run it

Double-click **`Start Orekenoid.command`**. It starts the local Vite server and opens the game at `http://127.0.0.1:8080/`.

Do not open `index.html` directly. Pixi and the browser module runtime are supported through HTTP, not `file://`.

Equivalent terminal command:

```sh
npm install
npm run dev
```

Open `http://127.0.0.1:8080/` if the browser does not open automatically.

Production verification:

```sh
npm test
npm run build
npm run test:browser
```

### Looking at generated worlds

```bash
npm run worldmap
```

Opens the world inspector at `/worldmap.html`: reroll seeds, pan and zoom the whole world at
one pixel per cell, switch base layers, and export a PNG. `R` rerolls, `F` fits, the seed is
in the URL so a world can be linked or bookmarked.

## Controls

### Survey

- `WASD`: move through open caverns
- Hold `Q` / `E`: rotate the drone and survey projection continuously
- `F` or `Enter`: commit the currently projected claim
- `C`: open the forge, at the Refit Bay or any cornerstone anchor
- `M`: open the Atlas, from anywhere including mid-arena

Cargo is deposited automatically on reaching the **bank** beside the lander. Only banked material can be spent at the forge, and only cargo is lost if the drone dies — banked material, crafted capacity and earned verbs all survive, and you respawn at the Landing at full health.

There is no separate roaming or framing mode. The equipped paddle's fixed survey footprint is always active, moves with the drone, and displays anonymous returns over buried resources. Each chassis permanently owns its frame dimensions, paddle width, movement profile, armor value, and maximum integrity; the frame cannot be resized manually.

Before deployment, the FTUE teaches survey, commitment, and unresolved-load damage, then requires one starting-paddle choice: the balanced Surveyor, fast narrow Needle, or broad resilient Bastion. That chassis is locked for the deployment; there is no mid-run hot swapping.

### The caverns

Roaming is no longer a commute. The drone carries a lamp, the mine is dark beyond it, and things
live out there.

- `Space`: fire the ball into the cavern. It rebounds off rock at the same pace and with the same
  feel as an arena volley, and it lights the room as it flies.
- `R`: recall it, taking the recharge early. A shot that has gone somewhere useless costs the same
  as one that has finished, so pulling it back is a decision rather than a wait.

The ball is a charge, not an inventory. One is out at a time; when it is lost, recalled, or runs out
of life, the emitter builds another, and how long that takes is the **emitter station's grade**. That
gap is the combat progression: attacking lights the room, reloading blinds you.

Darkness is Teleglitch's, and works the way Teleglitch's does: **black polygons extruded from wall
faces away from the drone.** Those faces are traced from the silhouette the renderer actually draws —
the noise-warped `visualSolidAt` contour, not the cell grid under it, which disagrees with the drawn
edge by twenty to fifty pixels and would put a staircase of square steps alongside a curved rock
face. A shadow that disagrees with the thing casting it is not a shadow. There is no lamp and no
radius. A corridor is visible all the way down
it, and what hides a thing is never how far off it is, only what is standing in between — so you are
hidden from by *shape*, and excavation carves sightlines. A claim you cut last hour is a window.

Shadow is translucent, not black: terrain and floor survive in it at about a third brightness, so
the silhouette of a chamber you are standing in the dark half of stays readable. **Creatures do not**
— they are hidden outright, because one at a third brightness is one you can still see. That is the
whole trade the layer makes.

The one thing that ever imposes a distance is a **Douser** on the hull, which closes sight down to a
few cells. The radius is the emergency, never the everyday.

Three creatures, differentiated by what they take from you rather than by how they die. All three
die the same way: hit them with the ball, enough times.

| Creature | Takes | How it reads |
|---|---|---|
| **Grinder** | Standing still | Locks its aim, paints the lane in red, and charges. Dodge and it slams into rock, which is the window to hit it. |
| **Spitter** | Free positioning | Holds its range, never closes, and lobs slow globs. Globs die on rock and to the ball. |
| **Douser** | Your light | Ignores the hull, latches on, and closes your sight to a few cells. Shaking it off means banking the ball back into your own machine. |

The rule the dark cannot break: **every attack is its own light source.** Darkness hides where
something is, never what it is about to do.

### The Atlas

Press `M`. The whole mine fits one screen: 240 × 144 cells at 5 px each, so there is nothing to pan.

The Atlas draws **only what the drone has actually seen**. Undiscovered ground is left as void rather than dimmed, so the shape of an expedition is legible in the negative space. Province colour, ecotone brightness, depth bands, excavation, structure, anchors and the Landing are all shown; buried resources never are. Cornerstones appear once the player has been near them.

Markers are entirely the player's. Pick one of eight icons, click surveyed ground, and optionally attach a short note; click a marker to edit its icon or text, or delete it. Nothing auto-fills and nothing interprets a discovery for the player. Unsurveyed ground refuses a marker.

### Expedition persistence

Orekenoid uses a **forgiving expedition model**: one persistent world per seed. Progress autosaves whenever something consequential happens — banking, a claim resolving, a craft, a verb, a death, a marker — plus every 20 seconds and on leaving the page. The deployment screen offers `CONTINUE`, `IMPORT SAVE`, and `NEW EXPEDITION`.

Geology is a pure function of the seed and is therefore never stored. A save holds the seed plus an ordered log of every world mutation, and loading regenerates the world and replays the log. A full expedition's save is a few tens of kilobytes of readable JSON, which is what makes `EXPORT SAVE` / `IMPORT SAVE` in the Atlas footer practical: the file can be moved between machines, kept as a backup, or handed to someone else. An imported save is validated before anything is applied — a truncated or hand-mangled file is refused with a reason rather than half-loaded. Importing a save from a different seed reloads the game with `?seed=`, which also works as a way to hand someone a specific mine.

Claims can be committed at any angle. Terrain is coverage-sampled into a clean paddle-local brick lattice, so every generated brick faces flat toward the paddle while preserving the framed world's material and silhouette as closely as the brick grid permits. The camera uses the shortest comfortable rotation into paddle-down play and returns to world orientation when the arena ends.

### Excavate

- `A` / `D`: move the paddle at immediate full chassis speed; release stops it with no inertia or interpolation
- `Q` / `E`: aim the opening serve
- `Space`: serve
- `R`: place the rail seed, once per claim, before the serve (requires the Root Choir)
- `B`: detonate a blast charge, cutting surviving load

A claim gives two balls by default; the Twin Engine raises that to three. The claim ends when its final ball is lost. Only material the ball actually broke is cut out of the world — anything still standing goes back into the terrain with its ore intact, so an abandoned claim is postponed rather than destroyed. What is still standing does load the hull on the way out, which is the price of walking away. Resources are only banked if the drop is caught, so yield and risk are the same decision.

### The three province rules

| Province | Rule | Why placement changes |
|---|---|---|
| **Surveyor's Karst** | Chalk breaks in one hit. Slate takes four, is **non-liable**, and is iron-rich. | A slate bank is simultaneously the best wall and the best iron. You cannot have both from the same stone. |
| **Mirrorreef** | Facets reflect against a fixed diagonal, turning the ball by a right angle. Charged facets cascade the break into adjacent crystal. | Claim heading versus lattice orientation decides whether you get a controllable cascade or nothing. |
| **Rootwarren** | Living rock regrows into cleared cells on a bounded budget. Spore bulbs leave a short-lived rebound membrane. | Fast clearing can be worse than pruning. |

Ecotones combine both parent rules and are the only source of diamond, saltpeter and vitriol — the reagents that fabricate new chassis.

Every clearable brick still alive at claim resolution creates one point of load. The equipped chassis absorbs its armor value first, then loses one health per excess brick:

```text
damage = max(0, remaining clearable bricks - armor)
```

The HUD is mode-driven. Surveying shows what you need to read the world — region, depth, Survey Resonance, health. Excavating shows what is at stake — load, projected damage, health and balls — and steps the rest back. A tutorial checklist teaches the controls by checking each one off as you use it, then removes itself permanently.

## Architecture

- **PixiJS v8/WebGL:** scene graph, GPU texture rendering, masks/transforms, blur, compositing, actors, and effects.
- **Seeded world generator (`src/worldgen/`):** province affinity fields with domain warp, ecotones as overlap, three-scale cave carving over a spanning tube graph, depth-banded material and resource assignment, authored Landing and cornerstone stamps, and a verification pass that repairs connectivity and reports contract violations.
- **Chunked terrain:** the world is far too large to rasterize into one canvas, so terrain is built in 24-cell chunks near the camera, amortized one chunk per frame, with cuts composited directly into the chunks they touch.
- **Material table (`src/materials.ts`):** one authority on hit points, liability, rebound behaviour, regrowth and cascades. The solver consults the table rather than branching on province.
- **World mutation log (`src/world.ts`):** every cut and every regrowth is appended to an ordered log, and replaying that log over a freshly generated world of the same seed reproduces its exact state — solidity, exhaustion and reveal flags included. This is what makes a save small, and what makes diagonal excavation survive a reload that a cell-grid snapshot would round off.
- **Persistence (`src/persistence.ts`):** versioned save schema, a bit-packed discovery mask, validation of untrusted imports before anything is applied, and file export/import. Nothing is partially applied: a bad save is refused with a reason.
- **The Atlas (`src/atlas.ts`):** the whole world on one 2D canvas at 5 px per cell, drawn from discovered cells only, with player-placed annotations. Deliberately not a second WebGL context competing with the game's.
- **Economy (`src/economy.ts`):** three crafting tiers gated by geology. Crafting produces capacity; cornerstones produce verbs; crafting may sharpen a verb but never grant one.
- **Custom fixed-step solver:** swept circle-versus-rounded-rectangle contacts, exact corner normals, simultaneous seam hits, paddle English, and deterministic arcade reflection.
- **Continuous-angle claim remesher:** the fixed chassis polygon is sampled in paddle-local space; generated rounded bricks retain exact oriented world footprints for persistent diagonal excavation and exhaustion.
- **Continuous terrain compiler:** geological cells remain source data, while visible solidity comes from smooth base caves plus spatially bucketed oriented cuts, material textures, and edge light.
- **Geological claim presentation:** broad world-space strata and cavity lighting continue around a translucent extracted section; an animated industrial scan resolves that section into spaced, rounded material bricks instead of switching to an opaque minigame panel.
- **Material-readable modules:** each material draws the thing that makes it behave differently. A facet draws its actual diagonal, so the turn is visible before it happens; non-liable stone is banded and heavy so it reads as structure you may keep; growth and spore bulbs are organic; resource inclusions carry their own metal's colour. Multi-hit bricks expose a fracture state before destruction.
- **Readable world rock:** terrain is painted from the material table through a warped sample lookup, so slate strata, coal seams and crystal lattices are legible in the world *before* a claim is framed. Natural cavity boundaries are organic; machined cut edges are crisp and rimmed. Direction is discoverable; contents stay a wager.
- **Shared machine language:** survey drone, projected lattice, rail anchors, paddle emitter, ball optics, tapered trail, and material shards use the same carbon/ceramic/amber construction vocabulary.
- **Bespoke interface aperture:** the playfield is the largest 16:9 rectangle that fits both available width and height. A single pre-deployment chassis rack gives way to sparse, context-sensitive instruments drawn inside the aperture; there is no separate website masthead or dashboard footer.
- **Paddle chassis data:** Surveyor, Needle, and Bastion demonstrate fixed frame aspect, paddle width/speed, travel/rotation, armor, and maximum-integrity identities without restoring manual resizing.
- **Direct paddle authority:** gameplay input sets paddle velocity exactly each fixed step. Chassis differ in top speed, never in input latency or acceleration lag.
- **Authored territory:** The Landing's seven guaranteed teaching features, the Echo Observatory, the Twin Engine split across the Bright Fault, and the Root Choir.
- **Rapier 2D compatibility:** installed for later moving machinery, creatures, and general world dynamics; it deliberately does not control Breakout rebounds.
- **Module boundaries:** `game.ts` is orchestration only — state, input, the arena lifecycle, the fixed-step loop, and save/restore. It touches no DOM at all. Presentation lives in `hud.ts` (every HUD node, driven by an explicit model it is handed), `view/` (display factories: `brick`, `actors`, `board`, `survey`), `atlas.ts`/`atlasView.ts`, `forgeView.ts`, `expeditionView.ts` and `deploymentPreviews.ts`. Behaviour lives in `camera.ts`, `effects.ts`, `audio.ts`, `objectives.ts` and `maths.ts`.
- **Room pipeline (`rooms/`, `tools/`, `src/worldgen/rooms.ts`):** authored PNG room chunks stamped into procedural terrain, the fourth generator scale. One pixel is one cell; colour maps to material, and reserved colours are markers that place contents. Painted by hand or drawn on a coordinate canvas in `rooms/src/`, then compiled to TypeScript by `npm run rooms` so generation stays synchronous and testable in Node. Three tiers following Terraria's own ladder — feature (~1/6 screen), chamber (~1/2), hall (~1) — placed by density with `structureMap.ts` reserving ground so features never collide. See `rooms/README.md` to author one, and `WORLD_DETAIL_BRIEF.md` for why.
- **World features (`src/view/features.ts`):** the ~120 features the generator places per world, drawn so they can be seen. Two brief rules govern the art: *direction is discoverable, contents are a wager* — a buried seam shows as mineral staining carrying the ore's colour but no shape that identifies it, and a buried cache as a machined spoil cairn saying only that somebody was here; and *nothing auto-interprets discoveries*, so nothing here writes to the Atlas. The player sees a thing, travels to it, and marks it themselves. Anomalies are the most conspicuous thing short of a cornerstone and carry the only motion in the world outside an arena, which is what makes them read as significant.
- **Honest drone hull:** `WorldModel.isHullOpen` tests an oriented box measured off the drone's own silhouette rather than a fixed square. Heading is therefore a traversal tool — a drone turned broadside needs nearly four cells, edge-on needs half of one — and it is the same key that aims the survey frame, so threading a gap and choosing where to claim are one act.
- **World inspector (`worldmap.html`, `src/worldmap/`):** a development instrument, on its own page at `/worldmap.html` — run `npm run worldmap`. Rerolls whole worlds and draws them at one pixel per cell, pannable and zoomable, exportable as a PNG at 1–8 px per cell. Five base layers (material, region, solidity, walkable-from-Landing, connectivity), overlays for room footprints and names, feature markers, landmarks and depth bands, a hover readout naming the material, ore, room variant and substitution province under the cursor, and the generation report beside it. It imports `generateWorld` directly, so the picture cannot drift from the generator. It exists because the report can say a world is *correct* and cannot say whether it is *good* — and it earned itself immediately by showing that `report.reachableCells` describes a world that never ships (see `WORLD_DETAIL_BRIEF.md`).
- **Vite + TypeScript:** strict modules and production bundling.
- **Vitest + Playwright:** deterministic collision regression and full browser progression/render validation.

The old `game.js`, `styles.css`, and `smoke-test.mjs` files are retained as historical prototype references, but the application no longer loads them.

## Current slice boundaries

This proves the production renderer, seeded generation at province/ecotone/cornerstone scale, the three province rules in play, continuous-angle claims, chassis variation, liability damage, the resource map, and the crafting chain.

Cornerstones are currently completed by striking each of their mechanisms with the ball, which grants the real verb and establishes an anchor. Their full authored puzzles — triangulation at the Observatory, the paired circuits of the Twin Engine, the Choir's voice ordering — are **not yet built**, and neither are the four knowledge procedures (survey triangle, reserve ball, tempering pocket, cartographer's exchange). The whole discovery layer is therefore still outstanding, and it is the next thing that matters.

Also outstanding: four-player co-op, LDtk import, general Rapier bodies (Rapier is installed and idle — nothing moves in the world outside an arena), the four remaining provinces, Reach II and III, music and a real SFX bank, and production asset libraries.

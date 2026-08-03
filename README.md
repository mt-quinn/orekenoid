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

## Controls

### Survey

- `WASD`: move through open caverns
- Hold `Q` / `E`: rotate the drone and survey projection continuously
- `F` or `Enter`: commit the currently projected claim
- `C`: open the forge, at the Refit Bay or any cornerstone anchor

Cargo is deposited automatically on reaching the **bank** beside the lander. Only banked material can be spent at the forge, and only cargo is lost if the drone dies — banked material, crafted capacity and earned verbs all survive, and you respawn at the Landing at full health.

There is no separate roaming or framing mode. The equipped paddle's fixed survey footprint is always active, moves with the drone, and displays anonymous returns over buried resources. Each chassis permanently owns its frame dimensions, paddle width, movement profile, armor value, and maximum integrity; the frame cannot be resized manually.

Before deployment, the FTUE teaches survey, commitment, and unresolved-load damage, then requires one starting-paddle choice: the balanced Surveyor, fast narrow Needle, or broad resilient Bastion. That chassis is locked for the deployment; there is no mid-run hot swapping.

Claims can be committed at any angle. Terrain is coverage-sampled into a clean paddle-local brick lattice, so every generated brick faces flat toward the paddle while preserving the framed world's material and silhouette as closely as the brick grid permits. The camera uses the shortest comfortable rotation into paddle-down play and returns to world orientation when the arena ends.

### Excavate

- `A` / `D`: move the paddle at immediate full chassis speed; release stops it with no inertia or interpolation
- `Q` / `E`: aim the opening serve
- `Space`: serve
- `R`: place the rail seed, once per claim, before the serve (requires the Root Choir)
- `B`: detonate a blast charge, cutting surviving load

A claim gives two balls by default; the Twin Engine raises that to three. The claim ends when its final ball is lost, and unsecured resources in its footprint are exhausted. Resources are only banked if the drop is caught, so yield and risk are the same decision.

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
- **Vite + TypeScript:** strict modules and production bundling.
- **Vitest + Playwright:** deterministic collision regression and full browser progression/render validation.

The old `game.js`, `styles.css`, and `smoke-test.mjs` files are retained as historical prototype references, but the application no longer loads them.

## Current slice boundaries

This proves the production renderer, seeded generation at province/ecotone/cornerstone scale, the three province rules in play, continuous-angle claims, chassis variation, liability damage, the resource map, and the crafting chain.

Cornerstones are currently completed by striking each of their mechanisms with the ball, which grants the real verb and establishes an anchor. Their full authored puzzles — triangulation at the Observatory, the paired circuits of the Twin Engine, the Choir's voice ordering — are not yet built. Also outstanding: save data, four-player co-op, LDtk import, general Rapier bodies, the four remaining provinces, Reach II and III, and production asset libraries.

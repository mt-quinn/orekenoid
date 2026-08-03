# Task Plan: Orekenoid

## Active Deliverable: World Replacement — Economy & Starting Area Design

### Goal
Before any generator code is written, establish the starting area, the resource distribution map across biome and depth, and the crafting chain that converts mined resources into capability, so the three-province world can be generated as a progression rather than a tour.

### Scope decisions (user-directed)
- Three provinces plus real ecotones: Surveyor's Karst, Mirrorreef, Rootwarren.
- Seeded procedural generation with authored cornerstones stamped in.
- Biome mechanical rules implemented in the same pass as world structure.

### Phases

- [complete] Audit existing world model, physics, arena remesher, chassis data, and HUD
- [complete] Establish depth/province/ecotone axis model and the three claim dials
- [complete] Specify world frame, province extents, ecotone extents, cornerstone sites
- [complete] Specify resource set, sources, and province × depth-band yield matrix
- [complete] Specify three-tier crafting chain, recipes, and access model
- [complete] Specify The Landing starting area with generator guarantees
- [complete] Normalize material naming to a familiar ore ladder plus reagents
- [complete] Resolve open design decisions
- [complete] Implement seeded world generator
- [complete] Implement chunked terrain rendering for the enlarged world
- [complete] Implement per-material contact rules via one solver extension point
- [complete] Implement crafting, resource inventory, and Refit Bay
- [complete] Implement cornerstone verbs and anchors (mechanism-strike interaction)
- [complete] Retire the Brood; migrate multiball machinery to new sources
- [complete] Extend unit and browser coverage to the generator contract
- [complete] Restore the deployment previews against the new world
- [complete] Rebuild the in-game HUD around mode-driven emphasis and mechanical copy
- [complete] Cargo/bank split, death cost, respawn, tutorial checklist, Health emphasis
- [complete] Redesign the Refit Bay as a payoff-led card grid
- [complete] Trajectory line with upgradeable bounce prediction, ore pull, forge compass
- [pending] Authored cornerstone puzzles: Observatory triangulation, Twin Engine paired circuits, Root Choir voice ordering
- [pending] Tune coal drop rate and the Blast Charge detonation cap by playing
- [pending] Save data and expedition anchors as a persistence layer

### Non-negotiables
- Crafting produces capacity; cornerstones produce verbs. No crafted item is ever a key to a place.
- Crafting may sharpen a verb but never grant one.
- Metals govern durability, gems govern precision. The families are not interchangeable.
- Frame geometry stays immutable per chassis; new frames come only from fabrication.
- Generator contract items in `PROGRESSION_AND_ECONOMY.md` §6 are assertions, not aspirations.

### Assumption requiring confirmation
- A crafting chain is incompatible with pure permadeath, so this design commits to the brief's recommended forgiving-expedition model, with cornerstone completions establishing refit anchors.

### Errors encountered
| Error | Resolution |
|---|---|
| Generator contract failed on 5 of 32 assertions | Fixed the generator in each case rather than relaxing the contract |
| Isolated open pockets unreachable from the Landing | Carve corridors to real chambers, fill eroded specks |
| Band density non-monotonic with depth | Depth now reduces cavern frequency as well as size |
| Stamped material inherited the replaced material's resource | `paintCell` clears resource when kind changes |
| Dropped the deployment previews mid-refactor | Restored from session read, cross-checked against the pre-rewrite `dist/` bundle; memory recorded so it cannot recur |
| Apparent stuck camera during browser verification | Browser pane reports `visibilityState: hidden`, suspending rAF; verification moved to Playwright |
| Terrain blocky, then foggy, then blocky again | Warp the material sample position instead of blending colours or quantizing per cell |

## Active Correction: Localhost-Only Runtime

### Goal
Remove the rejected `file://` compatibility work and run the actual Vite/Pixi application through its correct HTTP environment with a one-click launcher.

### Phases

- [complete] Remove static PNG selection previews and generated preview assets
- [complete] Remove card-canvas mirroring, Canvas readback, portable bundle generation, and direct-file tests
- [complete] Restore the single production Pixi renderer and Vite module entrypoint
- [complete] Add an executable macOS launcher that starts Vite and opens localhost
- [complete] Build, run deterministic tests, and pass the complete localhost browser regression
- [complete] Start the live server at `http://127.0.0.1:8080/`

### Errors encountered

| Error | Attempt | Resolution |
|---|---:|---|
| Browser regression still expected the rejected card-local canvases | 1 | Remove the obsolete assertion and rerun the authoritative live-render regression |

## Active Correction: Preview Boot Reliability

### Goal
Never expose an apparently usable paddle selector before its three production-rendered preview scenes exist, and prevent the portable file from pairing current markup with a stale classic-script bundle.

### Phases

- [complete] Reproduce and distinguish preview data failure from render/boot timing
- [complete] Gate the selector behind an explicit renderer loading state
- [complete] Surface initialization failures instead of leaving empty bays
- [complete] Version portable CSS and JavaScript asset URLs to invalidate stale browser cache
- [complete] Make the Pixi canvas CSS box exactly match the responsive HUD viewport
- [complete] Fit previews from their measured rendered bounds and verify at 2048×1152
- [complete] Reorder chassis as Needle / Surveyor / Bastion and increase information hierarchy
- [complete] Use Pixi Canvas rather than WebGL for portable `file://` launches
- [complete] Require non-background rendered pixels inside every field before direct-file verification passes
- [complete] Remove the previews' dependency on compositing a game canvas underneath the menu
- [complete] Mirror each live production simulation into a visible canvas owned by its field card
- [complete] Verify both localhost and direct-file launch paths

### Errors encountered

| Error | Attempt | Resolution |
|---|---:|---|
| Sandbox denied Playwright's configured localhost bind with `EPERM` | 1 | Reran the unchanged browser suite with scoped local-server approval |
| Pixi's inline 1280×720 canvas size overrode the responsive HUD at large resolutions | 1 | Force the canvas to the viewport content box and assert its browser bounds at 2048×1152 |
| The original alignment test validated nominal container origins rather than visible arena geometry | 1 | Replace it with rendered-content bounds checks for centering, containment, bottom gap, and field coverage |
| Updated DOM reached `ready` in the user's browser while the WebGL preview canvas remained visually blank | 1 | Route portable launches through Pixi Canvas and test actual field pixels; retain WebGL for served gameplay |
| Installed WebKit runtime could not launch on the host macOS version due an unsupported `PushAPIEnabled` protocol setting | 1 | Use renderer-independent portable Canvas output and pixel-buffer assertions instead of relying on the obsolete WebKit runtime |
| The user's browser continued to hide the populated shared canvas underneath the deployment overlay without reporting an error | 1 | Present the renderer output through three card-local DOM canvases and verify those exact surfaces contain pixels |

## Active Correction: Visual Paddle Selection

### Goal
Remove the rejected slogan/prose-led deployment screen and make the three real paddles, their differently shaped claim fields, and the Breakout mining loop the dominant content.

### Phases

- [complete] Remove the giant slogan, premise paragraph, and numbered prose contract
- [complete] Instantiate three real Pixi arenas from the starting Old Mine sample and chassis data
- [complete] Run real brick, rail, paddle, ball, trail, and collision systems inside all three choices
- [complete] Reframe the remaining copy as literal equipment labels and a three-icon rule chain
- [complete] Run complete regression coverage and inspect the real selection capture

### Non-negotiables

1. All three paddles and fields are visible simultaneously and dominate the screen.
2. Field aspect and paddle width come from the actual chassis data.
3. No slogan, narrative pitch, numbered explainer prose, or decorative marketing hierarchy.
4. Selection remains readable through field geometry even with every label removed.
5. Selection previews use gameplay renderers and physics directly; no parallel SVG/DOM imitation renderer exists.
6. Each preview contains the production Old Mine terrain behind its production arena and is clipped/aligned from its actual UI window bounds.
7. Player-facing terminology is `Armor`, never `soak`, and the instructional sentence is user-authored verbatim.

### Errors encountered

| Error | Attempt | Resolution |
|---|---:|---|

---

## Active Build: Deployment FTUE & Bespoke Game HUD

### Goal
Replace the website-like interface shell with a minimal extraction-console HUD, teach the complete play contract in one succinct deployment sequence, require a meaningful choice among three starting paddles, and fit the 16:9 playfield as large as possible inside any available browser space.

### Phases

- [complete] Audit current DOM shell, responsive sizing, game/UI bindings, and browser assumptions
- [complete] Build the single-screen FTUE and three-paddle deployment choice
- [complete] Lock the chosen chassis for the run and connect selection to real game data
- [complete] Replace masthead/footer/dashboard UI with an in-viewport bespoke instrument HUD
- [complete] Implement available-space playfield fitting and compact responsive adaptations
- [complete] Update browser coverage for selection, FTUE removal, locked chassis, and viewport fit
- [complete] Build, run, capture, critically inspect, iterate, and document

### UX contract

1. Before deployment, the player understands: move/aim a claim, commit to reveal, keep the ball alive, and uncleared load causes damage.
2. Chassis choice communicates frame geometry, paddle behavior, soak, and integrity as a strategic identity—not a stat dump.
3. Starting chassis is chosen once and cannot be hot-swapped during exploration.
4. The playfield receives the maximum possible 16:9 rectangle inside the available viewport.
5. Live UI only shows information actionable in the current state.
6. No repeated headings, generic cards, decorative telemetry, fake latency, or dashboard chrome.

### Errors encountered

| Error | Attempt | Resolution |
|---|---:|---|

---

## Active Build: Geological Claim Visual Overhaul

### Goal
Replace the current tile-map/debug-overlay presentation with a cohesive, production-feasible visual language in which the Old Mine reads as a tactile alien cross-section, the survey frame reads as projected mining equipment, and committed Breakout bricks visibly resolve from the geology they represent.

### Phases

- [complete] Audit the current Pixi scene graph, terrain compiler, board modules, drone, ball, and effects
- [complete] Rebuild the Old Mine terrain compiler around smooth macro silhouettes, material strata, cavity depth, and restrained mineral detail
- [complete] Replace the debug frame with an animated industrial scan projection and anonymous material returns
- [complete] Rebuild claim presentation so rails anchor into the world and bricks inherit geological/biological material identity
- [complete] Redesign chassis, paddle, ball, trails, impacts, and destruction feedback as one extraction-machine family
- [complete] Build, run deterministic/browser coverage, capture real screenshots, critically inspect, and iterate
- [complete] Document the rendering contract and hand off the verified visual slice

### Visual contract

1. No generated concept art or raster illustration is used as a promise of quality.
2. Macro silhouette and material hierarchy do the work; procedural noise is subordinate surface detail.
3. Collision geometry remains untouched and visually exact at the brick/paddle/ball layer.
4. The active board is a transformed cross-section of the world, not an opaque minigame panel.
5. Survey projection, arena rails, drone, and paddle share one industrial construction language.
6. Old Mine rock, ore, armor, Brood tissue, divider, shell, and heart remain identifiable without relying on UI labels.

### Errors encountered

| Error | Attempt | Resolution |
|---|---:|---|
| Strict build rejected the retired `brickGlyph` helper and test Arena fixture lacked new display-only `visualAge` | 1 | Remove the unused helper and update the deterministic fixture without changing gameplay state |
| Sandbox denied Playwright's configured localhost server bind with `EPERM` | 1 | Retry the unchanged browser suite with scoped local-server/browser approval |

---

## Active Build: Continuous Survey Chassis & Claim Liability

### Goal
Replace toggleable/resizable cardinal framing with a fixed chassis-defined survey footprint that moves and rotates continuously, remesh arbitrary-angle world geometry into paddle-aligned rounded bricks, persist the resulting oriented excavation, and damage paddle integrity for every clearable brick left beyond its soak capacity.

### Phases

- [complete] Audit current world authority, frame-local physics, input, rendering, and browser test hooks
- [complete] Define chassis data, continuous-angle transforms, oriented sampling, and persistent rotated cuts
- [complete] Remove roam/frame split and resizing; implement always-active survey movement and rotation
- [complete] Rebuild arena commitment and camera alignment for arbitrary angles
- [complete] Add soak, integrity, projected damage, board feedback, and end-of-claim resolution
- [complete] Expand deterministic and browser regression coverage
- [complete] Build, run, visually inspect, iterate, and document the new controls and rules

### Non-negotiables

1. Frame size and shape come exclusively from the equipped paddle chassis.
2. Survey preview and anonymous buried-item returns are active whenever an arena is not live.
3. The heading is continuous, not snapped to cardinal directions.
4. Bricks are axis-aligned in frame-local space and face flat toward the paddle at every world angle.
5. Preview sampling, committed bricks, collision geometry, terrain removal, and exhaustion use the same oriented footprint model.
6. Only clearable remaining bricks create liability; damage is `max(0, remaining - soak)`.
7. Projected damage is legible before the final ball is lost, both in the arena and in the HUD.

### Errors encountered

| Error | Attempt | Resolution |
|---|---:|---|
| Initial planning patch expected `# Progress` instead of the existing `# Progress Log` heading | 1 | Inspect the file headers and apply the additions against their actual headings |
| Oriented-cut test assumed every coverage-qualified brick has solid terrain at its center | 1 | Assert against an actual solid coverage sample; edge bricks may legitimately have an empty center |
| Full progression browser test exceeded the old 30-second budget while already committed and realigning the Brood arena | 1 | Preserve the successful state transition and give the expanded two-claim visual flow a 60-second test budget |
| Parallel software-WebGL browser workers exhausted the 60-second budget after the Core had already integrated successfully | 2 | Run the two GPU-heavy visual flows serially and use a 90-second per-test budget to avoid resource contention |
| Dense claim resolution exceeded the explicit six-second state-return assertion | 1 | Replace full-world pixel recompilation with incremental oriented-cut compositing into a cached terrain canvas and refresh the existing GPU texture |
| Continuous-input assertion sampled only 0.115 radians under a slow software-rendered frame cadence | 1 | Hold the real rotation input for 600ms so the test validates meaningful rotation without depending on high frame rate |
| Camera remained in `REALIGNING` beyond six seconds despite incremental terrain updates | 1 | Stop feeding camera/UI time a 33ms simulation cap; use wall-clock frame delta for transitions while independently capping movement and effects |


## Active Fix: Double-Clickable WebGL Build

### Goal
Make the repository root `index.html` work when opened directly with `file://` while preserving the Vite/TypeScript development workflow.

### Phases

- [x] Diagnose the direct-file failure
- [x] Add a self-contained classic-script browser bundle and direct stylesheet link
- [x] Use one universal entrypoint for `file://`, Vite, and production output
- [x] Add direct-file browser regression coverage
- [x] Rebuild, inspect, and document the corrected launch paths

### Root cause

The page loaded `/src/main.ts` as an absolute ES module and imported all CSS from that module. Direct-file navigation therefore resolved it as `file:///src/main.ts`, which the browser rejected; the failed module also prevented all application styling and initialization.

### Errors encountered

| Error | Attempt | Resolution |
|---|---:|---|
| Vite 8 no longer exposes an `esbuild` executable transitively | 1 | Add `esbuild` explicitly as a development dependency and rerun the portable bundle |
| Strict build could not type the regression's `node:path` and `node:url` imports | 1 | Add `@types/node` as an explicit development dependency |

---

## Active Build: WebGL Vertical Slice Rebuild

### Goal
Replace the disposable Canvas renderer with a production-shaped TypeScript/PixiJS vertical slice that proves high-quality organic world rendering and exact Breakout feel across one Old Mine chamber, the Brood transition, a Brood arena, and permanent multiball.

### Phases

- [x] Confirm production stack and define migration boundary
- [x] Scaffold Vite, TypeScript, PixiJS, physics tests, and asset pipeline
- [x] Build chunked masked terrain with textured Old Mine and animated Brood materials
- [x] Port roam, mobile/rotatable framing, anonymous buried-item signals, and camera alignment
- [x] Port exact rounded-brick Breakout physics, multiball, drops, loss/exhaustion, and effects
- [x] Build the authored Old Mine → Brood → Core progression slice
- [x] Add unit, browser, rendering, and physics regression coverage
- [x] Capture and critically inspect real WebGL screenshots; iterate
- [x] Retire the old runtime entrypoint, document the new architecture, and hand off

### Architecture decisions

1. PixiJS/WebGL owns rendering, transforms, masks, render textures, particles, and shader effects.
2. A fixed-step custom solver remains authoritative for balls, rounded bricks, paddle English, simultaneous contacts, and future overlapping arenas.
3. Rapier is available for general dynamic world bodies, but is not allowed to make Breakout rebounds opaque or nondeterministic.
4. Terrain state is gameplay data; its presentation is chunk geometry plus material textures and edge treatment, not one visible rectangle per cell.
5. The vertical slice is authored in data now and kept compatible with later LDtk landmark import; installing an editor format is not required to prove this slice.
6. The rejected Canvas visual pass remains only as historical source until feature parity is verified.

### Success criteria

1. The running build is unmistakably beyond the Canvas prototype in terrain silhouette, material depth, lighting, effects, and composition.
2. Old Mine and Brood are visually and mechanically distinct before reading any label.
3. Frame placement, arena camera alignment, and Breakout response retain or improve their existing accuracy.
4. The full slice runs in a production Vite build and passes deterministic physics plus browser tests.

### Errors encountered

| Error | Attempt | Resolution |
|---|---:|---|
| PixiJS v8 `Graphics.poly` rejects tuple arrays and TypeScript lacks a CSS side-effect declaration | 1 | Flatten polygon coordinates to numeric arrays, remove an unused type import, and add a Vite client declaration |
| Sandbox denied binding the Vite browser-test server | 1 | Retry the scoped `npm run dev` command with approval |
| Vitest discovered the Playwright `.spec.ts` file and invoked the wrong test runner | 1 | Add a Vitest config restricted to `tests/**/*.test.ts` |

---

## Superseded Build: Achievable Visual World Slice

### Goal
Prove a cohesive, production-feasible visual language for the continuous mine using only deterministic Canvas geometry: an animated geological survey print whose terrain, voids, drone systems, arena bricks, and Brood formations all belong to one authored graphic system.

### Phases

- [x] Lock the abstraction contract and reject unsupported visual ambitions
- [x] Audit the current renderer and choose the smallest complete slice
- [x] Implement the shared geological-survey rendering vocabulary
- [x] Give Old Mine and Brood unmistakable large-scale shape languages
- [x] Integrate drone, frame, arena, HUD, and effects into the same hierarchy
- [x] Closed before further Canvas investment; WebGL browser coverage replaced this phase
- [x] Closed after the Canvas result was rejected; WebGL captures replaced this phase
- [x] Superseded by the documented WebGL vertical slice

### Non-negotiables

1. Every visible form must be reproducible from Canvas paths, fills, strokes, clipping, and deterministic cached procedural fields.
2. Large composition and silhouette carry the image; noise never substitutes for authored structure.
3. The world is represented as a remote drone's geological reconstruction, not as faux-painterly cave art.
4. Old Mine and Brood must be recognizable from shape and rhythm before color or labels.
5. The active Breakout board remains the clearest and most precise layer without looking pasted onto another game.

### Errors encountered

| Error | Attempt | Resolution |
|---|---:|---|
| Sandbox denied binding the localhost visual-test server | 1 | Retry the same scoped server command with approval |
| Headless Chromium exited with sandbox-level `SIGTRAP`/`EPERM` before page load | 1 | Rerun the existing smoke suite with browser execution approval |

---

## Active Build: Breakout Foundation & Oriented Arena Camera

### Goal
Rebuild active arenas around trustworthy rounded-brick physics and premium feedback, while allowing frame rotation and presenting every committed arena with the paddle at the bottom through comfortable animated camera transitions.

### Phases

- [x] Audit rendering, input, state transitions, camera transforms, and test hooks
- [x] Add frame-mode player rotation without changing frame dimensions or anchor behavior
- [x] Add comfort-oriented camera rotation into arena-local view and back to world space
- [x] Replace full-tile overlap collisions with exact visible rounded-brick continuous collision
- [x] Rebuild brick, paddle, ball, rail, damage, trail, and impact presentation
- [x] Tune responsive paddle control and deterministic rebound behavior
- [x] Expand automated tests for every orientation, collision edge cases, and transitions
- [x] Visually inspect representative north/east/south/west arenas and iterate
- [x] Update documentation and hand off

### Non-negotiables

1. A committed arena always presents its paddle along the bottom edge and play direction upward.
2. Camera rotation is view-only; world coordinates and persistent excavation remain unchanged.
3. Transition easing never spins more than the shortest cardinal arc and avoids simultaneous aggressive zoom or translation.
4. Brick artwork and collision geometry share identical bounds and corner radius.
5. Frame rotation remains possible while movement continues to translate the frame without resizing it.

### Errors encountered

| Error | Attempt | Resolution |
|---|---:|---|
| Sandbox denied binding the localhost test server | 1 | Retry the existing scoped localhost server command with approval |
| Headless Chromium exited with sandbox-level `SIGTRAP`/`EPERM` before page load | 1 | Rerun the existing smoke suite with browser execution approval |
| Splitter regression setup approached through a neighboring packed brick, which exact clearance correctly blocks | 1 | Open a deterministic test approach lane before firing at the target brick |
| Arena rotation began drifting back toward world space after the entry animation | 1 | Hold the arena's canonical target rotation throughout play; test again after a dwell period |

---

## Active Research: Breakout Look, Feel & Physics Benchmark

### Goal
Identify the highest-leverage visual, collision, control, feedback, and legibility standards from best-in-class brick-breakers, then translate them into a focused next polish specification for Orekenoid without compromising player-defined arena geometry.

### Phases

- [x] Diagnose the current prototype from the supplied screenshots and code
- [x] Research Ricochet Extreme/Infinity and other genre high-water marks
- [x] Separate transferable feel principles from game-specific spectacle
- [x] Define the target brick, ball, paddle, collision, audio, camera, and readability model
- [x] Recommend a staged implementation and validation plan

### Evaluation dimensions

1. Brick silhouette, spacing, material hierarchy, damage states, and destruction cadence
2. Continuous collision accuracy, corner behavior, tunneling resistance, and deterministic rebound rules
3. Paddle latency, acceleration, edge influence, aim control, and save readability
4. Ball visibility, trail design, velocity communication, and multiball tracking
5. Impact audio/visual response, hit-stop, shake, particles, and information priority

---

## Active Build: Field Test 02 — The Brood

### Goal
Turn the validated mining proof of concept into a polished progression slice that teaches environmental multiball, culminates in a Brood landmark, grants permanent player-controlled multiball, and immediately recontextualizes the Old Mine.

### Phases

- [x] Audit the Field Test 01 architecture and identify reusable systems
- [x] Reshape the deterministic world into Old Mine, Brood approach, Brood Heart, and return-proof spaces
- [x] Replace single-ball arena state with robust multiball physics and lineage loss rules
- [x] Implement division cells, shell cells, heart nodes, permanent Brood Core, and a hybrid return objective
- [x] Polish Breakout feel: aiming, paddle motion, collisions, trails, particles, audio, hit feedback, and HUD
- [x] Add a compact developer power laboratory
- [x] Run syntax, automated browser, visual, and progression-loop tests
- [x] Update player-facing documentation and deliver

### Prototype success criteria

1. The Brood reads immediately as the multiball biome.
2. Three simultaneous balls remain trackable and satisfying.
3. The permanent split changes arena strategy rather than acting as a passive safety upgrade.
4. The return objective makes an earlier-looking challenge newly inviting.
5. Paddle contact, brick impact, resource collection, serving, loss, and splitting all feel substantially better than Field Test 01.

### Errors encountered

| Error | Attempt | Resolution |
|---|---:|---|
| Sandbox denied binding the local HTTP test server | 1 | Retry with narrowly scoped localhost-server approval |
| Headless Chromium exited with sandbox-level `SIGTRAP`/`EPERM` | 1 | Rerun the existing smoke test with browser execution approval |
| Field Test 01 smoke test dereferenced `arena.ball`/a completed arena under the new model | 1 | Replace with a Field Test 02 progression-aware browser test using `arena.balls` |
| Test-forced ball loss was caught by the paddle because it used center alignment | 1 | Force loss outside the paddle span while remaining inside the arena rails |
| Test-forced return did not cross the narrow paddle collision threshold reliably | 1 | Place the ball immediately inside the collision threshold and shorten the observation window |
| Heart assault assertion checked the first failed node after retry surface selection chose another valid node | 1 | Record the actual heart coordinates for the retry arena before simulating impacts |

---

## Active Deliverable: World & Progression Design Brief

### Goal
Produce a succinct, critically filtered design brief covering biome mechanics, consequential upgrades, authored locations, puzzles, secret layers, and progression cadence. Preserve the central rule that claiming terrain creates a one-or-more-ball Breakout arena whose unrecovered value is exhausted on final loss.

### Phases

- [x] Reconcile the imported design conversation with the existing prototype context
- [x] Research the most relevant lessons from Terraria, Starbound, Noita, and Animal Well
- [x] Build and critique the biome/progression/puzzle matrix
- [x] Write the concise design deliverable
- [x] Verify internal consistency and hand off prototype priorities

### Design filters

1. Every major mechanic must deepen arena placement, Breakout execution, exploration, or discovery.
2. Core progression must be explicable and solo-solvable; opacity is reserved for optional upper layers.
3. Biome differences must change play, not merely visuals, damage numbers, or loot tables.
4. Upgrades should appropriate a mastered rule and reopen old geography.
5. Avoid systems that turn exploration into checklist collection, mandatory wiki use, or rote opening errands.

---

# Prior Task: Orekenoid Core Prototype

## Goal
Create a playable browser prototype that tests whether exploring a persistent 2D mine and defining arbitrary cardinal Breakout arenas is compelling.

## Current Phase
Phase 5

## Phases

### Phase 1: Requirements & Discovery
- [x] Extract the authoritative core loop from the imported design conversation
- [x] Inspect the workspace and identify constraints
- [x] Choose the smallest useful prototype scope
- **Status:** complete

### Phase 2: Planning & Structure
- [x] Choose dependency-free HTML/CSS/Canvas JavaScript
- [x] Define explore, frame, and excavate states
- [x] Define persistent tile-world and local-coordinate arena model
- **Status:** complete

### Phase 3: Implementation
- [x] Create the application shell and responsive presentation
- [x] Generate a large mine with caverns, strata, ore, and landmarks
- [x] Implement exploration, arena framing, Breakout physics, collection, and depletion
- [x] Add onboarding and readable feedback
- **Status:** complete

### Phase 4: Testing & Verification
- [x] Run syntax/static checks
- [x] Play through the core loop in a browser
- [x] Verify framing in multiple orientations and persistence after loss
- [x] Fix issues found
- **Status:** complete

### Phase 5: Delivery
- [x] Document controls and local launch instructions
- [x] Summarize prototype boundaries and recommended next experiments
- **Status:** complete

## Key Questions
1. Does choosing arena width, depth, and direction feel meaningfully different from choosing a level?
2. Does the mine remain legible while an arena temporarily becomes the center of play?
3. Does losing unrecovered value make commitment exciting without feeling opaque?

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| Pure Canvas and JavaScript | Fastest path to a tactile prototype with no framework overhead |
| Cardinal arena orientations | Tests arbitrary approach direction while keeping controls and collision geometry readable |
| Local arena coordinates | One Breakout simulation can rotate into any world-facing direction |
| Deterministic seeded world | Repeatable testing while still conveying scale and variety |
| Resource drops move toward the paddle | Preserves the paddle's dual role of survival and collection |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| Python localhost server blocked by sandbox (`PermissionError: Operation not permitted`) | 1 | Relaunch with narrowly escalated local-server permission |
| Playwright package had no installed Chromium executable | 1 | Install the matching headless Chromium runtime, then rerun the existing smoke test |
| Automated forced-loss probe landed over the paddle; east movement reached a tunnel | 1 | Force the miss outside paddle bounds and select a generated valid east-facing wall deterministically |
| Planning completion script was not executable | 1 | Invoke the script through `sh` instead of executing it directly |

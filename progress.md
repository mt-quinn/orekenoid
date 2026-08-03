# Progress Log

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

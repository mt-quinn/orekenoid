# Findings & Decisions

## Visual Paddle Selection Correction (2026-08-03)

- The first FTUE replacement failed the stated goal: its vague giant slogan and supporting prose reproduced the exact LLM-forward marketing hierarchy the user rejected.
- Paddle silhouettes and tiny field aspect icons were insufficient. The selection decision is fundamentally spatial, so each option now renders an actual open-bottom Breakout field at its true chassis aspect ratio.
- The attempted SVG field diagrams were still a parallel imitation renderer and were correctly rejected. They have been removed completely.
- Each option now owns a real `Arena` sampled from the actual starting Old Mine geometry. `buildArenaDisplay`, `createBrickDisplay`, `createPaddle`, `attachBall`, and `stepBall` render and simulate the choices exactly as they do during play.
- The corrected real capture is dominated by the three fields. Surveyor reads square/balanced, Needle reads tall/narrow, and Bastion reads broad/shallow before consulting their labels.
- A literal icon strip—frame rock, break bricks, remaining equals load—does the work previously assigned to the rejected premise and numbered prose.
- Final capture confirms production bricks, ore veins, armor, anchors, rails, paddle machinery, ball optics, and trails appear in the selector. Surveyor, Needle, and Bastion differences come from their real remeshed claims rather than staged artwork.
- Rendering only the arena was still insufficient: it did not communicate that the arena was cut from world rock, and manual fixed screen coordinates allowed the Pixi scenes to drift outside their DOM options.
- Each live preview now includes a transformed clone of the production Old Mine terrain texture behind the arena. The board therefore visibly remeshes the same rock field it occupies.
- Preview center, bottom baseline, scale, and clip mask are derived from each `.field-window` DOM rectangle in canvas coordinates and recomputed on resize. Browser coverage asserts all three centers and baselines agree with those rectangles.
- Player-facing `soak` terminology has been replaced with `Armor`; internal calculation names remain implementation details only.
- The final capture has three aligned option windows and one common stats baseline. Field tops correctly differ because 11×11, 7×15, and 15×9 are different real frame shapes.


## Deployment FTUE & Bespoke Game HUD (2026-08-03)

- The current shell repeats the same state across masthead, mission card, telemetry strip, briefing hero, footer counters, and instruction ribbon. Much of it is ornamental rather than actionable.
- Fixed page width plus a separate 74px footer prevents the game from occupying the maximum available browser rectangle. The correct structure is a single centered 16:9 aperture sized from both viewport width and viewport height, with HUD instruments inside it.
- A genuine starting-paddle choice conflicts with the current post-start `1/2/3` hot-swap controls. Selection should happen before `started = true`, and gameplay key handling should no longer switch chassis.
- The three chassis already have sufficiently differentiated data. The FTUE should translate those values into roles: balanced/forgiving Surveyor, fast/narrow Needle, and broad/slow/high-capacity Bastion.
- The imported web font request undermines portable `file://` reliability and is unnecessary. A bespoke industrial typographic hierarchy can use condensed local fallbacks plus authored letter spacing and geometry.
- Real FTUE capture confirms the single-screen structure works: premise and three-step contract occupy one side, while the chassis rack makes shape, role, claim size, soak, and integrity directly comparable without generic card chrome.
- The selected Needle row reads as a physical rack selection through one continuous amber field and edge index; the deploy action becomes available only after that choice.
- Real post-deployment capture confirms the full website shell is gone. The game occupies the maximum 16:9 aperture allowed by viewport width/height, with objective/location at the top and only extracted material, contextual controls, integrity/soak, and claim load along the bottom.
- Locking chassis after deployment removes both a balance loophole and one entire live control family. `1–3` no longer appears in the runtime HUD.
- The Old Mine arena capture confirms the HUD remains subordinate during Breakout. The board occupies the central visual field; liability and integrity sit at opposite lower edges, and context controls form a single quiet baseline.


## Geological Claim Visual Overhaul (2026-08-03)

- The current WebGL build is presentation-limited rather than stack-limited: Pixi is mostly blitting one CPU terrain canvas plus simple `Graphics` primitives.
- The largest visual defect begins in `WorldModel.visualSolidAt`, which delegates to cell solidity. That converts originally smooth authored cave ellipses/tubes into visible 42px stair steps before texture or lighting can help.
- The safest visual improvement is to decouple the initial terrain silhouette from coarse gameplay occupancy: render the continuous authored cave field, then apply the exact persistent oriented cuts. Gameplay collision authority remains unchanged.
- Bricks already retain world coordinates and oriented footprints. This is sufficient to derive stable strata, inclusions, wear, and material accents per brick without image assets or changing physics.
- The current opaque arena backing, uniform white rails, pill drone, pill paddle, soft ball bloom, and circular debris belong to separate visual vocabularies. The replacement language is dark machined carbon, ceramic edge light, amber extraction energy, and material-specific fracture.
- A staggered scan-to-lattice reveal can happen entirely in display state during the existing camera transition. It does not need a new gameplay mode or simulation delay.
- Real survey capture confirms the silhouette correction is the highest-impact improvement: the former stair-stepped cave now reads as a continuous immense bore/cavern, and the animated amber lattice reads as projected equipment rather than a green debug polygon.
- Real Old Mine arena capture confirms ore is now embedded as a bright vein through the same brown host rock rather than represented by an orange UI button. Rock, armor, rail anchors, paddle, and ball share a coherent dark-metal/ceramic/amber hierarchy.
- The active board still has a deliberately dark sectional wash, but it is translucent and surrounded by continuous geological strata; its remaining rectangular presence now reads closer to an extracted cross-section. Keep this restrained rather than returning to an opaque black panel.
- The opening capture now establishes the world at large scale before interaction: the drone is a small machine inside an immense continuous void, rather than a pill on a tile grid.
- The Brood arena remains immediately distinct through radial anatomy, membrane bands, lime biological containment hardware, paired divider cells, faceted shells, and heart cells. The shared rail/paddle/ball construction keeps it recognizably the same game.
- The exhausted angled claim remains a clean void against the smooth macro cave wall; the continuously rendered world did not reintroduce the previously fixed floating terrain shards.


## Continuous Survey Chassis & Claim Liability (2026-08-03)

- The current Breakout simulation already uses frame-local `u/v` coordinates, so arbitrary world heading does not require rotating collision math. The refactor belongs at the world/frame transform and sampling boundary.
- The current `DirectionIndex` plus `Math.floor` tile-center sampler cannot be extended safely to arbitrary angles: it will duplicate or omit cells and leave axis-aligned scars.
- Each generated brick needs a stable oriented world footprint. That footprint must be the authority for world removal and for synchronizing future overlapping claims.
- The clean player state model is `survey | play`; survey is always visible and commit is the only mode transition.
- Claim liability is clearest as one damage per remaining clearable brick after a chassis soak allowance. Persistent or invulnerable landmark geometry must not create unavoidable damage.
- The renderer positions every arena actor through `localToWorld`, so replacing the cardinal basis with `sin/cos` will automatically align bricks, paddle, balls, trails, drops, rails, and camera around one continuous heading.
- The production-safe persistence model for this slice is an ordered set of oriented brick cuts sampled by `solidAt(x,y)`. It preserves exact rotated scars without allocating a world-sized high-resolution bitmap and can later be spatially indexed by chunks.
- Chassis dimensions must remain integer brick columns/rows for the existing local solver; arbitrary *world angle* does not require arbitrary brick dimensions.
- Existing browser coverage directly mutates `direction`, `frame.width`, and mode state, so it must be rewritten around `heading`, immutable chassis stats, `survey | play`, and liability assertions rather than patched superficially.
- A coverage-qualified boundary brick can correctly represent mostly solid terrain while its exact center lies in a cavity. Tests and content mapping must respect aggregate footprint coverage rather than assuming center-point occupancy.
- Real survey capture confirms continuous rotation reads immediately: the chassis, projection edges, corner anchors, tinted footprint, and anonymous resource returns share the same non-cardinal heading without changing frame dimensions.
- Real arena capture confirms remeshing performs the intended abstraction. The surrounding mine remains diagonally oriented while every rounded brick, rail, paddle, and ball is presented flat in local Breakout space.
- The board-local liability bar is legible at play scale: green shows the portion the chassis can soak, red shows integrity exposure, and the threshold marker agrees with the exact HUD (`37 unresolved`, `19 damage`, `18 soak`).
- The follow-on Brood capture demonstrates the other side of the rule: seven unresolved landmark bricks sit fully inside the 18-brick buffer, so the board bar, telemetry, and HUD all switch to an unambiguous safe state.
- Integrity persistence is visible across claims (`21/40` after the intentionally failed Old Mine board), while the existing Core/multiball presentation remains intact.
- The second browser timeout was not a gameplay failure: the final snapshot showed the Core integrated, two balls active, and the objective updated. Parallel software-WebGL pages were competing during expensive terrain compilation; serial browser workers are the stable verification configuration.
- The next serial run isolated a genuine performance defect: `finishArena()` synchronously called `buildTerrainCanvas()`, which recomputed roughly 2.4 million pixels with multiple solidity and trigonometric samples after every claim. Incremental canvas compositing is required for acceptable resolution latency.
- After incremental composition, the remaining delayed return was caused by the global 33ms delta cap: camera easing advanced in simulation-frame increments under software WebGL instead of elapsed wall time. Physics, movement safety, effects, and camera comfort require separate delta policies.
- Final scar inspection exposed thin triangular rock remnants inside the failed angled claim. They are terrain fragments below the brick coverage threshold: valid remeshing omissions during play, but invalid leftovers after the claim's exhaustion rule resolves the whole framed area.
- Claim resolution should therefore clear every frame-local lattice footprint while computing damage only from generated clearable bricks. Persistent landmark footprints remain excluded from blanket exhaustion.
- The corrected scar capture is completely empty across the committed angled footprint; the only remaining boundary is the intentional outer frame/world intersection. No isolated collision-bearing shards remain.
- The final arena capture retains the high-quality paddle/brick presentation and liability read after switching paddle motion from eased target velocity to exact per-step input velocity.


## Direct-File Launch Failure (2026-08-03)

- The submitted root page only worked behind Vite. Double-clicking `index.html` resolved the absolute module path `/src/main.ts` against the filesystem root and failed before either PixiJS or the imported CSS could initialize.
- This is a deliverable defect, not a user setup mistake. The root page should either run directly or present an intentional launcher; bare unstyled HTML is unacceptable.
- Because the current Pixi runtime has no external runtime assets, esbuild can produce a single classic-script IIFE suitable for `file://`. The same HTML can select that bundle for direct-file use and the TypeScript module when served by Vite.
- A universal classic-script entrypoint is safer than protocol-dependent module selection: it guarantees direct-file and hosted builds execute the same code. Vite warns that it is not processing the classic script, which is intentional because esbuild already produced it; the build copies that artifact into `dist` explicitly.
- A real Chromium navigation to the root `file:///.../index.html` now initializes `window.__OREKENOID__`, displays the styled Pixi canvas, and reports no page or console errors.
- Visual inspection of `direct-file-opening.png` confirms the direct-file page matches the intended WebGL opening rather than falling back to unstyled markup.


## WebGL Vertical Slice Rebuild (2026-08-03)

- The dependency-free Canvas prototype has completed its job: it validated player-defined mining arenas, but it is no longer an acceptable visual production base.
- Selected stack: Vite + TypeScript + PixiJS v8/WebGL. The active Breakout simulation remains a custom fixed-step CCD solver; Rapier 2D is reserved for general world dynamics and collision queries.
- The new slice will replace visible tiles with chunk-level terrain masks, textured fills, irregular edge geometry, lighting/highlight passes, parallax depth, and material-specific effects.
- Pixi scene layers will be explicit: far geology, terrain material, terrain edge/decal, landmarks, arena reconstruction, actors/effects, and screen-space instrumentation.
- One authored Old Mine-to-Brood expedition is the correct proof. Full procedural scale and LDtk import wait until the renderer, physics, and material language survive critical visual inspection.
- Existing gameplay and browser tests are migration specifications, not implementation constraints. The old single-file runtime may be consulted but should not dictate the new module structure.

### First WebGL visual review

- The continuous cave silhouette is an immediate qualitative improvement over exposed tile geometry: the starting chamber reads as a large excavated volume with a narrow engineered throat, not as a staircase of squares.
- Textured strata wrap through the rock mass and remain subordinate to the bright navigable edge. The limited palette and large negative-space chambers preserve ball/frame legibility.
- The extraction drone is crisp at play scale and its orientation, probe, paddle body, and ball are distinct without needing a large sprite.
- Framing is materially clearer against the organic surface: it reads as a precise rectangular intervention imposed on an unrelated geological form, which reinforces the core premise.
- The current half-resolution terrain texture shows visible sampling bands at full-screen scale. Increasing compilation scale to 0.75 is justified if startup and rebuild cost remain acceptable.
- Opening typography and world composition now support the same fiction without pretending that a generated concept painting has been implemented.

### Arena and Brood visual review

- The Old Mine board has the requested real brick-breaker read: separated rounded modules, consistent collision silhouettes, material glyphs, a luminous ball/trail, and a segmented paddle inside the literal chosen world footprint.
- Canonical camera orientation works in the WebGL scene graph; the east-facing Old Mine claim is presented paddle-down while the surrounding strata rotate coherently.
- The Brood is strongly characterized at screen scale by a different material body, fluorescent edge tissue, a vast rib/chamber structure, paired division glyphs, sealed cells, and the embedded heart. It is not a green recolor of the mine.
- The permanent upgrade moment is legible in the running build: the heart disappears, the directive changes, two live balls remain visually distinct, and the Core instruction enters the HUD.
- The active board backing is currently too opaque: it interrupts the Brood rib structure and risks reading as an instanced minigame. Lower opacity should preserve geology/anatomy beneath the reconstructed field while maintaining brick contrast.
- Old Mine strata are too high-contrast and periodic at the first texture settings, approaching wood grain. Reduce band amplitude/frequency, add slower modulation, and increase texture sampling resolution before final capture.

### Second WebGL visual review

- Higher sampling density materially smooths the navigable edge and brick/world relationship.
- Lower board opacity fixes the detached-minigame problem: the Brood's chamber ribs now remain visible through the local playfield without competing with balls or bricks.
- Reduced Old Mine band contrast produces a quieter mass that better frames orange extraction elements.
- A remaining block-pattern artifact comes from integer hash sampling in the texture compiler, not Pixi scaling. Replacing it with continuous multi-frequency material variation should remove the last conspicuous procedural grid without adding more detail.

### Final material review

- Continuous sine-modulated material variation removed the visible square noise blocks while preserving restrained rock breakup.
- The final opening screenshot reads cleanly at full viewport scale: uninterrupted organic silhouette, subdued rock mass, a single warm navigable edge, crisp drone, and strong typographic hierarchy.
- The result is intentionally a vertical-slice art direction, not a claim that biome content production is solved. It now proves the renderer can carry authored assets, richer textures, shaders, and landmark composition without being trapped by raw Canvas tiles.


## Achievable Visual World Slice Contract (2026-08-03)

- The target is a **premium animated geological survey print**, deliberately authored from vector-like Canvas primitives rather than an approximation of painted cave art.
- Allowed vocabulary: crisp merged silhouettes, two-to-three-tone material ramps, broad continuous strata, sparse contour marks, clipped veins, large geometric motifs, informational gradients, precise particles, and controlled transitions.
- Rejected vocabulary: painterly or photoreal rock, dense procedural microtexture, fake normal mapping, complex lighting, bespoke illustration-dependent landmarks, repeated detail pretending to be naturalism, and noise used to conceal weak forms.
- The visual proof must be comprehensive at slice scale: terrain, open void, Old Mine, Brood, drone, frame preview, committed board, resources, HUD, and motion must share one hierarchy and palette logic.
- Biome identity is primarily structural. Old Mine should read as pressure, bedding, seams, and survey cuts; Brood should read as chambers, membranes, paired nodes, and synchronized pulses.
- Generated concept images are not acceptable evidence. Only screenshots of the running implementation count as approval material.

### Renderer audit

- The present world renderer is tile-by-tile (`fillRect` per cell) with a random scratch on every Old Mine tile and an isolated dot/curve on every Brood tile. That makes both biomes read as repeated texture rather than large geological systems.
- The active board is already the strongest layer: its rounded modules, gutters, shared collision bounds, glyphs, ball, and paddle should be retained and restyled—not structurally replaced.
- The current per-frame world pass can support the new style without assets. Large-scale fields can be evaluated from world coordinates, while only boundary tiles receive contour strokes; this keeps the cost proportional to visible tiles.
- World generation already provides authored macro-cavities and a deterministic `scar`/`pulse` per tile. The visual pass can use stable world-coordinate functions and biome distance fields without changing gameplay or save topology.
- The Brood boundary is currently a simple analytic curve. That is valuable for rendering: paired membrane bands and a frontier silhouette can be drawn consistently across solid and empty space.
- The DOM shell is already restrained and legible, but the global SVG noise overlay directly contradicts the no-noise contract and should be removed or replaced with intentional survey-line overlays.
- Objective markers and depth ticks should become part of one instrumentation grammar: hairlines, corner brackets, small indexed labels, and signal arcs rather than generic circles/dashes.

### First running-build visual review

- The opening view now reads as one restrained survey plate: solid geological masses, negative-space caverns, fine world grid, outlined drone, and instrument shell share a consistent value structure.
- Old Mine identity is visible through long folded bedding lines and stacked pressure bands. It is intentionally quieter than the Brood, preserving room for the active board and orange extraction systems.
- The Brood is immediately different at macro scale. Concentric membrane chords cross many tiles as one anatomy, boundary tissue pulses in sync, and the heart emits sparse ellipsoidal signal rings. This is substantially stronger than the old per-tile green dots and curves.
- Arena bricks remain the sharpest, highest-frequency layer. Sampling their base palette from world position makes the board feel like a precision reconstruction of local material rather than a detached minigame.
- The new drone is small but reads as a piece of extraction hardware: dark chassis, orange structural outline, pale sensor/ball, paired end segments, and a forward probe.
- Framing reads as measurement: translucent scan pass, strong corner brackets, anonymous diamond returns, and a thinner dashed perimeter.
- The deliberate stepped cavern silhouette is now a chosen diagrammatic convention. Attempting faux-organic smoothing on top of the tile topology would reintroduce the exact “mud” the abstraction contract forbids.
- Remaining refinement should focus on rail endpoints/instrument hierarchy and verifiable visual invariants, not more terrain detail.


## Breakout Look/Feel Audit — Supplied Screenshots (2026-08-02)

- Solid arena tiles currently remain a continuous world texture. Only special tiles receive inset artwork, so the board does not parse as a field of discrete collidable bricks.
- The visible tile art and the physics box disagree perceptually: the collision box occupies the full 24×24 tile, while several rendered special tiles appear inset, irregular, or smaller. Near-corner rebounds therefore cannot be predicted from the image.
- Empty world cavities cut irregular black shapes through the arena. This preserves world continuity, but without a board-treatment pass it visually overwhelms the rails and makes the active collision surface difficult to parse.
- Bricks lack uniform gutters, rounded silhouettes, contact highlights, damage states, and material-specific edge treatments. Their centers communicate type, but their edges do not communicate collision.
- The ball is legible at rest but its trail is too faint and short to communicate velocity or recent bounce direction reliably.
- The paddle reads as a glowing bar, but there is no visible contact zone, curvature/segment language, or crisp impact deformation to explain how different hit positions affect rebound angle.
- Arena rails are visually louder and more regular than the bricks, causing the temporary boundary—not the playable board—to dominate the scene.

---

## Framing Interaction Improvements (2026-08-02)

- `frameGeometry()` already derives the frame origin and orientation directly from the player, so enabling ordinary player motion during frame mode naturally translates the whole frame without changing its size or paddle-relative placement.
- Arrow keys remain exclusive to width/depth changes; `WASD` remains exclusive to physical movement, avoiding control ambiguity.
- Preview signals are derived through a resource-category set and return coordinates only. They do not mutate `tile.hidden` and do not expose the underlying `kind`, preserving uncertainty while making placement informed.
- Pale hollow diamonds are visually distinct from the orange ore rendering and from Brood division glyphs.

---

## Arena Authority Correction (2026-08-02)

- Field Test 02 inherited an unjustified `isFrameValid()` heuristic: it required solid rock directly in front of the paddle and more than 34% solid coverage.
- That heuristic silently made the prototype judge whether the player's wager was "good," contradicting arbitrary arena placement as the central mechanic.
- Arena commitment must accept empty, sparse, awkward, or strategically terrible rectangles. Only technical world-boundary violations may be rejected.

---

## Field Test 02 Audit (2026-08-02)

- The existing prototype is a clean dependency-free Canvas implementation with roam/frame/play states and a useful rotated local arena coordinate system.
- The single `arena.ball` assumption touches physics, rendering, input, UI, and smoke tests; Field Test 02 needs a first-class `arena.balls` collection rather than incremental special cases.
- Existing brick collision uses discrete substeps and stops after one brick per substep. This is adequate for the current speeds if multiball balls are updated independently and capped during the slice.
- Existing impact feedback is minimal: one particle burst, constant shake, no trail, no sound, no impact ring, and abrupt paddle movement. These are the highest-value feel improvements.
- Arena completion currently consumes every tile in the footprint. Persistent heart nodes must be exempt unless actually destroyed so a failed experiment cannot delete progression.
- The current random walker world does not guarantee a readable biome expedition. The next slice needs authored macro-geography with procedural surface variation.

### Implementation decisions

- Environmental division cells split balls automatically; the permanent Brood Core arms one controlled split on the next paddle return.
- All descendants of one serve share an arena life; the life ends only when the final active ball is lost.
- Simultaneous ball count is capped for readability and performance, with three as the permanent default.
- The Brood uses two primary mechanics only: division cells and shell cells that require an active swarm. Heart nodes combine those mechanics but add no new rule.
- Audio will be synthesized through Web Audio after user interaction, avoiding asset and network dependencies.

### First visual review

- The new shell has a strong industrial field-manual identity and the title/briefing hierarchy is substantially more confident than Field Test 01.
- The authored starting cavern, sealed shell-and-ore pocket, and distant biological signal are simultaneously visible in the opening composition, giving the player both a remembered obstacle and a direction.
- The objective panel and footer remain readable without visually competing with the playfield. The objective is intentionally occluded by the opening briefing and becomes visible after entry.
- The old smoke test reaches frame mode but no longer guarantees a valid commitment; its fixed movement sequence is coupled to the previous procedural world and must be replaced with state-aware surface selection.
- In-arena objective beacons competed with ball trails and the arena readout. Objective direction is useful while roaming/framing but should disappear during live Breakout.
- The first authored cave path was fully open, allowing the player to walk from the start to the Brood without mining. Three easy-to-escalating cave plugs are required to preserve the intended travel → claim rhythm.
- Heart nodes are correctly persistent, but persistence alone is insufficient: the environmental divider that makes a heart vulnerable could be consumed on a failed attempt. Authored heart-adjacent dividers must regenerate until the Brood Core is acquired.

### Final visual/playtest review

- Removing the objective beacon during live arenas materially improves ball/brick readability while preserving direction during travel and framing.
- The Brood is visually unmistakable from the Old Mine through its sickly cellular field, paired-circle division glyphs, shell outlines, pulsing heart iconography, and green arena rails.
- Environmental split and permanent split now have distinct presentations: ordinary division creates a smaller ring/chime, while the Brood Core produces a large layered pulse, screen flash, unique sound, and explicit HUD state.
- The bottom arena readout keeps ball population, chain, and split availability visible without covering active geometry.
- Automated topology validation confirms the Brood is initially unreachable on foot but becomes connected when the three intended claim barriers are removed.
- Automated browser validation confirms a failed heart claim preserves both the heart and its required division mechanism; a retry can create a swarm and destroy the heart through three genuine collisions.

---

## Active Design Brief Constraints (2026-08-03)

- The game needs Terraria-like underground scale and discovery, Starbound-like authored progression punctuation, Noita-like knowledge mastery at the optional high end, and Animal Well-like readable signaling.
- Auto-filled notebooks are rejected; the player may annotate the map manually.
- The design deliverable should be compact and selective, prioritizing mechanics that are fun, learnable, and legible through play.
- Existing prototype validates only the core roam/frame/commit/excavate/loss loop; the next design should identify the smallest additions worth prototyping rather than imply full production scope.

## Reference Research — Design Lessons

- **Terraria:** World layers and geographically coherent biomes combine distinct resources, structures, and threats; biome-native finds often help the player deal with that biome. Boss defeats can change the whole world's available content. Adopt geographic identity and world-state consequences; avoid making gear score the main gate.
- **Starbound:** Procedural travel is punctuated by guaranteed authored missions; environmental protection and tech upgrades make progression legible. Adopt the expedition cadence and authored landmarks embedded in the mine; avoid detached instances, scanning checklists, and passive immunity keys.
- **Noita:** A largely stable macro-topology, systemic material interactions, optional bosses, orbs, parallel worlds, and obscure alternate endings make learned routes/processes a form of progression. Adopt knowledge-based optional advantages and systemic rituals; reject inscrutable requirements for core abilities.
- **Animal Well:** The creator explicitly describes multiple puzzle layers, with a broadly understandable foundation and deeper secret-oriented layers. Recurring visual language, surprising reuse of existing verbs, and mysteries that linger are strengths. Community-required or hardware/external-information puzzles are a poor fit for consequential rewards here.

### Emerging synthesis

- Use **six authored cornerstone expeditions** as the readable spine inside a much larger procedural world.
- Each major biome needs one immediately perceptible physics rule, one escalation, one exploitable opportunity, and one landmark that tests the rule before granting control over it.
- Separate three reward tracks: run resources, permanent capability upgrades, and player knowledge. Do not blur them into a broad crafting tree.
- Manual map annotations are sufficient; the game itself should provide environmental reactions and persistent world-state feedback, not an auto-solving journal.

### Evidence-backed guardrails

- Starbound's mission loop demonstrates the value of a themed authored location with a clear climax, but its repeated "find themed structures and fill a scanning bar" is exactly the connective tissue to remove. Clues should form vectors, silhouettes, sounds, and geological continuities instead.
- Animal Well's Billy Basso frames foundational play as understandable to all players, optional discovery as a second layer, and community puzzles as a deepest layer. He also emphasizes acknowledging even wrong experiments with a reaction. For Orekenoid, every consequential mechanism needs readable states for untouched, plausible interaction, correct partial step, reset, and completion.
- Terraria's biome finds often enhance mobility/exploration, and its boss/world transitions unlock new structures, enemies, or access. Orekenoid upgrades should similarly change reachable geography, but through expressive ball/paddle/arena verbs rather than keys or immunity flags.
- Terraria's locked biome-chest chain shows a potential anti-pattern: layered key prerequisites can create long-delayed payoff but also devolve into farming and return errands. Use visible future affordances, but avoid random key drops and consumable locks.
- Noita's simulated materials generate rediscovery because the rules combine, not because each area has a bespoke minigame. Orekenoid biome mechanics should share a small interaction grammar (momentum, charge, heat, pressure, polarity, growth) that recombines across borders.

---

## Requirements
- The player is a mobile Breakout paddle in a continuous 2D mine.
- The player explicitly establishes a Breakout arena over an arbitrary section of world rock.
- Committing reveals all resources in the arena and launches exactly one ball.
- Destroyed material remains excavated in the persistent world.
- When the one ball is lost, all uncollected resources in the arena are permanently lost.
- The world should already suggest great scale, exploration, and geological variety, even in prototype form.
- Full progression, authored landmarks, and deep secret systems are out of scope until the core loop is validated.

## Research Findings
- The workspace contained no application files, package manifest, or prior implementation.
- Canvas 2D with requestAnimationFrame is sufficient for a dependency-free Breakout prototype.
- A local arena coordinate system (`u` across the paddle, `v` away from it) lets the same simulation support all four cardinal orientations.

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| Tile world for persistent geology | Makes arena/world overlap, excavation, and depletion explicit |
| Smooth camera over a larger-than-screen world | Conveys that arenas are local interventions in a continuous place |
| Resource types are hidden outside committed arenas | Preserves placement as the reveal action |
| Exhausted unbroken tiles remain as barren rock | Prevents scouting exploits without erasing the geological boundary |
| No dependencies or build step | Keeps feedback cycles immediate |

## Issues Encountered
| Issue | Resolution |
|-------|------------|
| Sandbox blocked binding the localhost test server | Syntax check still passed; browser test server requires narrowly escalated launch permission |
| Bundled Playwright package lacked its matching browser binary | Use Playwright's scoped Chromium installer, not a project dependency |

## Resources
- `/Users/quinn/.agents/skills/game-engine/assets/paddle-game-template.md`
- Imported game-design conversation supplied by the user

## Breakout Look-and-Feel Audit (2026-08-03)

### Current screenshots and implementation

- The committed arena still renders as a continuous cave texture. Only special cells read as inset objects, so ordinary rock does not read as a premium Breakout board made from discrete collidable bricks.
- The physics use a full tile-sized collision box while the visible tile treatment is smaller or inset in several cases. That undermines trust at corners and in apparent gaps.
- Irregular void silhouettes visually dominate the arena; the player has to infer which contour is live collision geometry.
- The board lacks uniform gutters, rounded brick silhouettes, contact highlights, damage-state material treatment, and a strong separation between backdrop and interactable layer.
- The ball trail is too faint and short for the demonstrated speed, while the paddle has no visual segmentation or contact language that explains rebound angle.
- The dashed arena rails are often louder than the bricks, reversing the desired gameplay hierarchy.

### Visual benchmark pass

- Ricochet Xtreme gives the playfield a separate, authored visual identity from its backdrop. Brick silhouettes, power-up icons, ball glow, paddle ship, and impact explosions occupy different contrast and shape bands; the board remains readable even over elaborate scenery.
- Ricochet's strongest transferable trait is not its chrome-heavy science-fiction skin. It is categorical clarity: brick types look deliberately manufactured, specials advertise themselves, and impacts are localized bursts centered exactly at contact.
- Shatter treats the ball, paddle, and live brick layer as luminous foreground actors over a darker, lower-frequency environment. Its screenshots preserve readable square modules and gaps even during dense particle events.
- Shatter's spectacle works because effects reinforce direction and impact. Copying only bloom and particles would obscure rather than improve Orekenoid; the collision normal and surviving brick state must remain visible through every effect.
- DX-Ball 2 demonstrates the continuing value of a strict brick matrix: regular gaps and consistent silhouettes let dense boards, durability, numerical feedback, and chain destruction coexist without uncertainty about what is solid.
- The common visual hierarchy is: ball head first; imminent paddle contact second; intact/damaged bricks third; local hit effects fourth; backdrop and frame last. The current prototype often reverses the last three.
- The useful synthesis is a board-space transformation on arena commitment: geological cells become separated, rounded, materially legible Breakout pieces while preserving the mine's formation and resource topology.

### Current physics audit and research implications

- `updateBall` currently tests overlap against every live brick after movement, chooses the smaller penetration axis, pushes the ball out, and flips one velocity component. This is a discrete overlap solver, not contact-time collision; fast motion, deep corner penetration, adjacent bricks, and nearly simultaneous contacts can produce unstable or visually inexplicable bounces.
- Current brick collision is a full 1x1 local cell (`abs(dx/dy) < .5 + radius`). If the artwork gains visible gutters without changing that collider, balls will bounce in empty-looking space. Visual and physical bounds must be the same source of truth.
- Paddle output already uses contact offset plus paddle velocity, which is directionally right, but the input model is strongly inertial (`acceleration` plus exponential damping). Premium responsiveness needs paddle position to follow intent much more directly while retaining a separately measured velocity term for controlled English.
- A fixed physics tick plus swept circle time-of-impact is the appropriate foundation: find the earliest wall/paddle/brick collision in the remaining tick, advance to contact, resolve against the actual surface normal, separate by a tiny epsilon, and continue through the remaining time with a bounded iteration count.
- Shatter's sound designer reports reviewing gameplay events with the programmer and giving individual brick types different sounds. The useful lesson is an explicit audio event hierarchy and reserved frequency space, not simply a large number of samples.
- Ricochet Xtreme's historical praise consistently emphasizes detailed presentation, tutorialized mechanics, differentiated power states, and audiovisual pacing. These reinforce that polish is a coherent response system rather than a particle count.

### Genre design evidence

- Mark Nelson's long-form Breakout design survey identifies paddle handling and rebound behavior as foundational: if a miss feels attributable to the paddle rather than the player, the control model has failed. He distinguishes paddle contact position from paddle friction/momentum transfer and recommends designing ball speed, block density, and effect readability as one system.
- The same survey emphasizes that voids are functional level geometry: they both reveal target structures and determine how interesting the trajectory is. Orekenoid's gutters therefore must be real navigable space, while larger geological voids need a quieter but still unambiguous visual treatment.
- Arkanoid remains an essential baseline because it sustains clear ball tracking during frantic multiball and makes paddle-altering power states visually explicit. Its repetitive high-frequency brick pings are a documented weakness; Orekenoid should vary timbre and intensity while avoiding constant sonic fatigue.
- A semi-fixed or fixed timestep isolates simulation quality from rendering frame variance. Combined with continuous collision detection, it permits high-speed/powered balls without increasing tunneling risk or making collision response depend on display performance.

## Oriented Arena Camera & Frame Rotation Audit (2026-08-03)

- Arena physics already live in local `(u,v)` coordinates with `v` extending away from the paddle. This is the correct canonical simulation space for always presenting play upward; only rendering/camera transforms need rotate.
- Rendering currently subtracts a world-axis camera offset independently in every draw routine. A view rotation is safest as one canvas-level world transform around an explicit focus point, with world objects drawn in world pixels and screen-space HUD left outside the transform.
- The four player directions use quarter-turn indices and `localToWorld`; the required play-view angle is the negative of the arena's world direction angle, modulo the current coordinate convention. North already needs zero view rotation.
- `finishArena` immediately returns to roam and clears arena state. A comfortable return animation therefore needs a short resolving mode/state that retains the arena focus and view rotation until the camera has eased back to world orientation.
- Frame-mode keyboard handling resizes with arrows but only rotates with `R` while roaming. The same rotate action can be accepted in frame mode without affecting width/depth or player position.
- Comfort guardrail: cardinal quarter-turns should use smoothstep or quintic ease over roughly 450–650 ms, keep the arena center pinned, freeze simulation until the entry rotation completes, and avoid concurrent zoom pulses/shake. A 180-degree transition should use a deterministic direction rather than frame-to-frame angle wrapping.
- Existing smoke coverage already asserts frame translation does not resize or reorient it; it should be extended to assert explicit rotation changes only direction, and that all four arena directions settle to the same screen-space paddle-down presentation.

### Implementation constraints discovered

- World, preview, actors, particles, rings, objectives, and depth marks currently each bake camera subtraction into their coordinates. Introducing rotation piecemeal would create mismatched layers; drawing must be centralized around a `worldToScreen`/view transform or a shared canvas transform.
- The canvas is fixed at 1280x720 while arenas can reach 19x20 tiles, so the current fit remains viable without adding zoom during rotation. Keeping scale fixed is preferable for motion comfort and ball-speed consistency.
- The active UI currently knows only roam/frame/play. Add explicit camera transition state orthogonal to gameplay mode, rather than showing a misleading fourth gameplay mode.
- Effects are stored in world pixels, whereas ball trails are also converted to world pixels at update time. A shared rotated world transform will keep both aligned without changing their storage.
- Current tile drawing reveals active kinds through the persistent world renderer. Premium arena bricks should be overlaid from `arena.bricks` after a subdued world pass; this permits exact rounded geometry and damage state without changing exploration rendering.
- The current screen shake is applied before all rendering. It should be suppressed during camera rotation and return transitions to avoid combined rotational and translational motion.

### First implementation decisions

- Entry is a two-stage comfort transition: a 340 ms center move with no rotation, followed by a 560 ms cardinal rotation around the locked arena center. Exit reverses that sequence with a 520 ms rotation and 360 ms return to the paddle.
- Simulation and serve input are paused during entry/exit. This prevents the ball from moving while the player's visual frame of reference is changing.
- The arena board is now an opaque local play surface drawn above continuous geology, so the visible gutters are actual empty board space rather than cave texture between invisible full-tile colliders.
- Brick visual and collision constants are shared (`BRICK_HALF=.42`, `BRICK_RADIUS=.13`). Collision uses swept circle vs. expanded rounded rectangle at a 120 Hz fixed step.
- Rendering rotation is applied once around screen center to every world-space layer; UI, vignette, and depth instrumentation remain screen-aligned.
- The existing smoke suite assumes input is accepted 50–100 ms after commitment and roam resumes 180 ms after loss. These timings must be updated to wait for camera transition completion rather than weakened in the game.

### First browser and visual validation

- The full progression suite passes after transition-aware waits: all four directions map local forward to screen `(0,-1)`, frame rotation preserves anchor and dimensions, final loss returns to zero camera rotation, and no page/console errors occur.
- East-facing visual inspection confirms the frame and paddle are upright while the surrounding mine visibly rotates as context. The expanded diagonal culling prevents black corner exposure during the 90-degree view.
- The active Brood board now reads as a distinct manufactured play surface: dark board backing, consistent separated modules, visible rounded corners, and material-specific glyphs are substantially clearer than the continuous terrain treatment.
- The first east screenshot used an intentionally empty arbitrary arena, usefully confirming that the player can still create a poor/empty claim and that the camera system does not depend on brick density.
- The current board still needs a final live Old Mine screenshot and moving-ball inspection; the Brood image validates dense material readability but not ordinary rock contrast or high-speed trail clarity.

### Visual defect found and corrected

- The live Old Mine board clearly validates the rounded-square grid, regular gutters, differentiated armor/ore treatment, stronger ball, paddle zones, and local hit effects.
- A later west-facing multiball screenshot exposed camera drift after entry: once the transition object cleared, ordinary camera smoothing incorrectly eased rotation back toward zero. This made the board slowly tilt during play even though the immediate orientation assertion passed.
- The steady camera target is now the arena's canonical view rotation for the entire live claim; zero is targeted only outside arenas. The regression must sample orientation after a dwell period, not only at transition completion.

### Final visual confirmation

- The corrected west-facing multiball screenshot remains perfectly upright after the dwell and active split. Surrounding world texture is rotated exactly 90 degrees, making the local play direction clear without detaching the arena from geography.
- The board now has a coherent Old Mine material family: ordinary stone, armor, ore, and Brood cells share one rounded chassis but retain distinct palettes/glyphs. This meets the requested “premium board” read without making the mine look like unrelated arcade tiles.
- Live collision regression confirms a diagonal corner hit returns `(-6.364,-6.364)` from an incoming `(6.364,6.364)`, while an exact two-brick seam damages both bricks and returns `(0,-9)` with no array-order bias.

## Visual/Browser Findings
- The opening screen reads as an industrial field manual rather than a generic game menu, with the continuous mine visible behind onboarding.
- The established arena remains visibly embedded in surrounding rock; temporary rails and paddle clearly communicate the local Breakout space.
- Moving the start deeper removed artificial world-edge void from the first claim.
- A guaranteed starting seam makes the first successful claim demonstrate reveal, value, drops, and collection.
- Final automated run: 142-tile north arena, 97 revealed value, 8 recovered during a short live simulation, all 132 surviving tiles exhausted after forced loss.
- A separate valid east-facing arena committed with 131 bricks, confirming rotated arena construction.
- No page errors or console errors were observed.

## Preview boot finding (2026-08-03)

- Terrain compilation and construction of three complete Pixi simulations are intentionally heavier than ordinary DOM setup. Letting the DOM selector appear first created a credible but invalid blank-screen state during boot.
- Because the portable build uses a non-module `orekenoid.js`, an unversioned script URL also allowed current HTML/CSS to be paired with an older cached renderer. Query-versioned portable asset URLs and render-readiness gating address the two failure classes independently.
- Readiness is now defined by two animation frames after preview construction and layout, not merely by canvas insertion or debug API exposure.
- The persistent blank/misaligned fields were ultimately a CSS coordinate-space error: Pixi set an inline 1280×720 canvas size, while the DOM HUD responsively grew beyond it. Stage positions were correctly calculated for the HUD but displayed in a smaller canvas. Testing only stage-space numbers could never detect this.
- Visual preview verification must compare the browser rectangles of the canvas, HUD, field windows, and transformed content. Object existence and nominal container positions are insufficient.
- A `ready` scene graph is not proof of browser presentation. Portable verification now reads the actual 2D pixel buffer in all three card regions. `file://` launches use Pixi Canvas to avoid browser/driver-specific WebGL compositing failures while preserving the production containers, physics, terrain, and displays.
- Reading pixels from a shared backing canvas is still not proof that a browser composites that canvas through a full-screen DOM overlay. The reliable architecture is to make each card own its presentation surface and copy the production renderer's corresponding region into it. Tests must inspect these visible leaf surfaces.

## Runtime correction

- The project should not spend implementation complexity supporting `file://`. Vite is already part of the stack and supplies the module, asset, and browser security context Pixi expects.
- The rejected direct-file work has been removed rather than retained as an alternate renderer. One authoritative HTTP path is easier to reason about, visually verify, and maintain.
- A double-clickable `.command` launcher gives the user the convenience originally sought from a portable HTML file without compromising the runtime architecture.

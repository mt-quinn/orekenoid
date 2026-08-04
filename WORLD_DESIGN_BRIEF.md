# Orekenoid — World, Progression & Mystery Brief

## North star

Orekenoid is an exploration game in which **choosing the ground is as important as playing the shot**.

The player roams a continuous underground world as a paddle. At any exposed face they may frame a rectangular claim. Committing reveals that claim's exact contents and begins a Breakout attempt with the balls available for that arena. Excavation persists; when the final ball is lost, every uncollected resource in the claim is exhausted forever.

Every system below must improve at least one of four pleasures:

1. reading the world;
2. choosing a consequential arena;
3. playing excellent Breakout;
4. discovering something that changes the player's understanding.

If a feature only adds damage, loot rarity, or a themed obstruction, cut it.

## The world model

Generate the mine at three scales:

- **Provinces:** enormous, named regions with a dominant physical rule and recognizable silhouette.
- **Ecotones:** wide overlaps where two rules combine. These produce the best emergent boards and make travel feel continuous rather than level-based.
- **Cornerstones:** seven guaranteed, authored territories embedded into procedural geology. Their internal relationships are fixed, but their approach angles, surrounding caves, and incidental claims vary by seed.

The world should telegraph distant destinations through features that cross arena boundaries: pipes, roots, strata, tones, leaks, bones, drifting spores, and pieces of architecture. Exact resources remain hidden until commitment. **Direction is discoverable; contents are a wager.**

Natural caverns provide long exploratory breaths between tense claims. A good session alternates:

> roam → notice → infer → frame → reveal → improvise → reshape → break through

## The biome set

Use a small shared grammar—rebound, momentum, pressure, heat, polarity, growth—rather than dozens of isolated gimmicks.

| Province | One readable rule | What makes arena placement interesting | Authored location / payoff |
|---|---|---|---|
| **Surveyor's Karst** | Chalk breaks easily; dark slate is durable and highly reflective. Long strata visibly continue behind rock. | The tutorial biome teaches that leaving slate banks is often better than clearing everything. Narrow claims are safe; deep claims can breach huge caves. | **The Echo Observatory** teaches triangulation. Restoring three dishes grants **Survey Resonance**: while framing, the claim shows coarse *density, volatility,* and *yield* signals—never exact contents. |
| **Mirrorreef** | Crystal facets turn the ball by fixed, visually explicit angles; charged facets chain that turn to nearby crystal. | Orientation matters more than size. A claim aligned with the lattice creates controllable cascades; one aligned against it creates chaos. | **The Twin Engine**, split across paired chambers, makes impacts echo between halves. Completing both circuits grants the **second sequential ball per arena**. |
| **Rootwarren** | Living blocks regrow into adjacent empty cells; spore bulbs create short-lived rebound membranes when struck. | Fast clearing can be worse than pruning. Players frame around growth fronts and decide which membranes to preserve as future banks. | **The Root Choir** is a persistent organism spanning many possible claims. Silencing its voices in any viable order grants a **rail seed**: one temporary bumper may be placed before each arena's first serve. |
| **Tidal Hollows** | Fluids move through excavated space; pressure accelerates the ball and carries loose resources, while deep water slows both. | Claims become plumbing decisions. Opening a pocket early can flush value toward the paddle—or sweep it behind dangerous geometry. | **The Inverted Reservoir** teaches fill, drain, and release. Its heart grants **Catch & Release**: once per ball, a clean paddle contact may hold the ball briefly for an aimed re-serve. |
| **Lodestone Foundry** | Magnetic stone curves charged balls and attracts metal drops; opposite poles repel. Polarity is always shown by color and field lines. | Players can include useful magnets as steering geometry or exclude strong fields that would sabotage a valuable seam. | **The Great Magnetarium** requires routing one ball through several field states. Its core grants **Vector Pulse**: once between paddle contacts, apply a small lateral impulse; the next paddle hit recharges it. |
| **Cinder Deep** | Repeated impacts build heat. Hot balls melt soft seams and ignite gas; coolant vents reset heat. Overheating makes rebounds faster and less forgiving. | Long arenas promise huge thermal chains but threaten control. Arena composition, not a protection stat, determines whether heat is weapon or liability. | **The Mantle Lock** tests deliberate heating and quenching across adjacent claims. Opening it grants the **third sequential ball** and releases heat currents into older provinces, creating new optional routes rather than replacing them. |
| **The Null Seam** | Gravity bends sideways around vast voids; ancient gates exchange ball position while preserving angle and speed. | Existing excavation becomes the board. Claims that overlap old tunnels can create extraordinary routes or immediate losses. | **The World Frame** is the final cornerstone. Aligning its boundary machines allows the normal ending; mastering their hidden relationship enables the world-scale arena secret. |

### Critical cuts

- No biome deals ambient damage that is solved by an immunity suit.
- No region is just “harder bricks.” Durability may support a rule but cannot be the rule.
- No biome needs its own currency, crafting bench, or disposable key.
- Do not add ordinary enemies until the ball/terrain ecology is already rich; autonomous creatures must alter trajectories or geography, not turn the game into combat with a paddle avatar.
- Root growth and fluid simulation are production risks. Prototype bounded, deterministic versions before committing to full simulation.

## Progression spine

The campaign is structured, but not a straight line.

### Reach I — Learn to choose

The player starts with one ball and can locate three cornerstones from world evidence: Echo Observatory, Twin Engine, and Root Choir. They can be approached in any order; completing any two reveals the next reach, while the third remains available. Survey Resonance improves judgment, the second ball improves risk capacity, and the rail seed improves board composition. Each makes the others easier without making them obsolete.

### Reach II — Learn to control

Those completions expose routes into Tidal Hollows and the Lodestone Foundry. Catch & Release and Vector Pulse deepen execution without replacing paddle skill. Either can be acquired first. The combined verbs support much larger claims and recontextualize suspicious mechanisms in every earlier biome.

### Reach III — Learn to transform

The Mantle Lock demands mastery of planning, survival, and state manipulation across several persistent claims. The third ball makes monumental late-game arenas reasonable, not routine. Opening the Null Seam begins the final expedition.

### Ending structure

- **Standard ending:** activate the World Frame after overcoming its local system. Complete, satisfying, clearly signaled.
- **Deep ending:** solve one optional relationship in each province, then use them together at the World Frame. Entirely solo-solvable from in-game evidence.
- **Mythic event:** deliberately shape and activate the whole mine as one arena. No essential upgrade is attached; its reward is a transformed world state, lore, and recognition.

This borrows Starbound's cadence of free exploration resolving into authored climaxes, but the cornerstones remain physical parts of the player's world rather than detached missions. It borrows Terraria's world-changing milestones, but upgrades are expressive verbs rather than permission keys.

## Puzzle language

All puzzles should use the same actions as mining.

| Family | Player insight | Fair feedback |
|---|---|---|
| **Frame** | Include, exclude, orient, or align world features within one claim. | Arena preview changes subtly; correctly included nodes light before commitment. |
| **Trajectory** | Hit resonators from a direction or in an order. | Each correct hit persists; wrong order gives a distinct reset tone. |
| **State** | Move heat, pressure, polarity, or growth through connected material. | The state is visible in the material itself and remains after the arena. |
| **Topology** | Leave deliberate stone, connect chambers, or use old excavation as a circuit. | World-map geometry and local mechanisms show continuity. |
| **Transport** | Move a unique, non-exhaustible object between locations through several claims. | The object cannot be permanently lost; failure returns it to its last socket. |

Consequential puzzle objects are not ordinary resources. Losing an arena may exhaust its ore, but it must not unknowably delete a cornerstone, clue, or unique quest object.

### Signaling contract

Every core and deep puzzle gets:

1. a conspicuous anomaly that says “there is intent here”;
2. a local reaction to any plausible experiment;
3. persistent partial progress;
4. at least two clues, one near the mechanism and one elsewhere in the relevant province;
5. a clear distinction between wrong idea, wrong order, and failed execution.

The player can freely annotate the map with icons, arrows, colors, and short text. Nothing auto-fills or interprets discoveries for them.

## Secrets and knowledge progression

Use three layers, not an endless hierarchy.

| Layer | Share of meaningful content | Standard |
|---|---:|---|
| **Core** | ~70% | Clearly signaled, redundant clues, solo-solvable, contains all required capabilities. |
| **Deep** | ~25% | Recurring motifs, negative space, unusual uses of known verbs, hidden bosses and alternate routes; hard but fair alone. |
| **Esoteric** | ~5% | World-spanning processes and alternate endings. A wiki may accelerate synthesis, but every necessary fact exists in the game. |

Reserve genuinely community-scale obscurity for one or two cosmetic/lore curiosities. Never put ball capacity, control upgrades, convenience features, or the best ending behind outside collaboration.

### Knowledge that improves a run's opening

An experienced player should recognize several early opportunities, but a seed should make pursuing all of them inefficient:

- **Survey triangle:** three old stakes always imply a nearby calibration pocket; framing all three provides one enhanced geological reading.
- **Reserve ball:** a collapsed maintenance spur contains one temporary arena life, but reaching it costs a risky early claim and it cannot stack with itself.
- **Tempering pocket:** a ball that strikes a warm vent, crystal, then coolant in one arena begins the next arena with a single armored impact.
- **Cartographer's exchange:** placing a common fossil chip into one of several boundary shrines reveals the direction—not distance—of one optional province.

These are procedures, not permanent account bonuses. They raise the floor through knowledge, execution, and opportunity cost. Their relationships are stable across seeds; their exact geometry is not.

## Future multiplayer constraint — four-player composable co-op

Orekenoid should ultimately support up to four players in the same persistent mine. Co-op must preserve individual agency rather than tethering the group to one paddle or one shared arena.

### Core contract

- Each player navigates the world independently and may frame, commit, play, finish, or abandon an arena without requiring the other players to join them.
- Frames may overlap in world space by player choice. Overlap is not an error to prevent; it is the mechanism by which independent Breakout games become one cooperative physical situation.
- Overlapping arenas continue to sample and cut the same persistent world-space terrain. Their differently oriented local brick grids are projections, not player-specific copies of the mine.
- A ball may be reflected by another player's paddle whenever that ball and paddle genuinely intersect through appropriately overlapping arena geometry.
- Failure is resolved by **active world-space footprint coverage**, not by blanket ownership of the failed polygon. Terrain still covered by at least one surviving active frame remains live in that arena. Only material that loses its final active-frame coverage resolves under the failed claim's exhaustion/loss rule.
- This coverage rule must apply symmetrically for two, three, or four overlapping frames and must not depend on commitment order.

The desired fantasy is that four players can conduct unrelated expeditions across the mine, deliberately converge on an enormous formation, and compose a temporary cooperative Breakout machine from independently placed frames and paddles.

### Deferred questions

- Whether balls can cross another frame's rails, or only interact inside the geometric intersection.
- Whether a ball retains an owning arena/life after another player's paddle returns it.
- How recovered resources are credited or shared.
- How simultaneous reveal, destruction, and failure events are ordered without producing frame-order exploits.
- How canonical paddle-down camera presentation works when multiple overlapping arenas have different orientations, particularly for local shared-screen play.

Do not prototype networking or multiplayer yet. Preserve oriented world footprints, stable feature IDs, active-claim coverage, ball provenance, and paddle provenance in future architecture so the eventual co-op model is not blocked by assumptions of one global arena, one tile orientation, or one global player.

## What to prototype next

Do not build all seven provinces. Add one **vertical slice of contrast** to the existing prototype:

1. Implement a small Mirrorreef pocket with fixed-angle crystal facets.
2. Place a miniature two-chamber Twin Engine across its boundary.
3. Grant a second sequential ball when the paired mechanism is completed.
4. Add one optional three-step resonator puzzle with distinct partial/reset feedback.
5. Let players annotate the map with one icon and one short note.

This slice tests the entire design thesis at low cost: whether a biome can change arena placement, whether an authored location can remain spatially open, whether an upgrade transforms all future Breakout, and whether a secret can be readable without explanation.

## Resolved product decision — forgiving expedition (2026-08-04)

This was previously open. It is now decided in favour of the **forgiving expedition model**, as recommended: one persistent world per seed, autosaved. Death costs cargo only; banked material, crafted capacity and earned verbs all survive, and cornerstone completions create restart anchors. Geography and capabilities are never reset.

The reasoning: the emotional investment of mapping an almost unbelievable mine is the point, and pure permadeath actively fights the Atlas and annotation systems this brief requires elsewhere. Noita-like opening mastery is preserved through deliberate re-seeding — a player who wants a fresh world starts one — rather than through forced world loss.

Nothing in the resource economy, map persistence, or campaign length should be designed around losing a world. Saves are portable: geology is a pure function of the seed, so a save file is the seed plus an ordered log of world mutations, and can be exported, kept, or handed to another player.

## Research lineage

- [Terraria official overview](https://terraria.org/about) and [official progression guide](https://terraria.wiki.gg/wiki/Guide:Game_progression): biome identity, discovery-driven equipment, and world-changing boss progression.
- [Starbound storyline](https://starbounder.org/Storyline): authored mission cadence and the scanning-checklist failure mode.
- [Noita developer interview](https://www.gamedeveloper.com/game-platforms/road-to-the-igf-nolla-games-i-noita-i-) and [GDC design talk](https://www.gdcvault.com/play/1025695/Exploring-the-Tech-and-Design): systemic physical interactions and rediscovery.
- [Billy Basso interview at Thinky Games](https://thinkygames.com/features/interview-how-animal-well-is-using-secrets-and-mysteries-to-be-a-different-kind-of-metroidvania/) and his [Day of the Devs note](https://store.steampowered.com/news/posts/?enddate=1654821540&feed=steam_community_announcements): layered mysteries, learnable rules, and feedback for experimentation.

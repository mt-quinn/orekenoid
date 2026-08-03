# Orekenoid — Starting Area, Resource Map & Crafting Chain

Companion to `WORLD_DESIGN_BRIEF.md`. The brief defines *what the world is*. This document defines *where its materials are* and *how the player converts them into capability*, so the three-province slice can be generated and played as a progression rather than a tour.

## 0. The governing model

Three structural facts about the world are also the three axes of the economy. This is the load-bearing idea of the document; everything below is a consequence of it.

| World structure | Economic axis | Yields |
|---|---|---|
| **Depth** — how far down the claim is | Tier | The **metal ladder**: copper → iron → cobalt → mithril → adamantite → runite. Found in every province. |
| **Province** — which physical rule governs | Identity | One **reagent** per province: coal, gems, sulfur |
| **Ecotone** — where two provinces overlap | Mastery | Three **rare reagents** that form nowhere else and gate the top tier: diamond, saltpeter, vitriol |

Two laws cover the whole map. The first says where things are:

> **Metals come from ore inclusions in host rock, in every province, banded by depth. Reagents come from each province's own rule-material.**

The second says what they are good for, and keeps the two families from being interchangeable:

> **Metals govern durability — armor, hull, structure. Gems govern precision — paddle speed, survey rotation, reading a claim. Coal fuels everything. Sulfur and saltpeter make gunpowder. Rare reagents fabricate.**

No amount of runite will let you aim, and no amount of ruby will let you survive a bad claim.

So a player who only goes deep climbs the metal ladder and can smelt nothing. A player who only ranges wide gathers reagents and has no metal worth working. And the best equipment in the game needs a reagent that only forms where two provinces overlap — so the brief's claim that ecotones produce the best boards becomes economically true rather than merely asserted.

### The three dials

Every claim, at survey time, has three hidden scalars. They rise with depth and are modulated by province.

| Dial | Definition | Consequence |
|---|---|---|
| **Density** | fraction of framed cells that are solid | brick count → load → integrity damage |
| **Volatility** | fraction of bricks that are multi-hit or rule-active | how hard the board is to actually clear |
| **Yield** | count of resource-bearing bricks | reward |

These are the same three signals **Survey Resonance** (Echo Observatory, Reach I) reveals coarsely while framing. The danger curve, the resource map, and the first cornerstone's reward are one system, not three.

## 1. World frame

240 × 144 cells. Depth in metres is the existing convention, `m = (y − 5) × 14`, so the world runs 0 m to 1946 m.

| Band | Cells (y) | Depth | Character |
|---|---|---|---|
| **I — Shallow** | 5 – 32 | 0 – 378 m | Teaching. Low density, forgiving load, no rule punishes you yet. |
| **II — Mid** | 32 – 68 | 378 – 882 m | Density rises past starting armor. Cobalt appears. Machining opens. |
| **III — Deep** | 68 – 106 | 882 – 1414 m | Province rules dominate framing. Mithril, and all three rare reagents. |
| **IV — Abyssal** | 106 – 144 | 1414 – 1946 m | Adamantite and runite. Only reasonable with a fabricated chassis and two cornerstone verbs. |

### Province territories

Approximate extents; boundaries are seed-warped, never straight.

```
      x=0        48         96        144        192       240
 y=5   ┌──────────────────────┬───────────────────────────────┐  0m
       │                      │▓                              │
       │   SURVEYOR'S KARST   │▓        MIRRORREEF            │
 y=32  ├─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ──┤▓ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ── │  378m
       │      ◆ Echo Obs.     │▓                              │
       │      (52,26)         │▓◆ Twin Engine (92|104, 46)    │
 y=68  ├─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ──┤▓ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ── │  882m
       │                      │▓                              │
       │        ▒▒▒▒▒▒▒▒▒▒▒▒▒▒│▓▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒ │
 y=88  │        ▒ CHALK WARREN●▒▒▒▒ BLOOM SHELF ▒▒▒▒▒▒▒▒▒▒▒▒▒ │
       ├────────┴─────────────┴───────────────────────────────┤
       │            ROOTWARREN        ◆ Root Choir (128,98)   │  1302m
 y=106 ├─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ──┤  1414m
       │                   (abyssal Rootwarren)                │
 y=144 └───────────────────────────────────────────────────────┘  1946m

  ▓ Bright Fault (Karst ∩ Mirrorreef)     ● The Confluence (95,88) — all three
  ▒ Chalk Warren / Bloom Shelf ecotones   ◆ Cornerstone
```

| Province | Extent | Bands | Rule (from brief) | Reagent |
|---|---|---|---|---|
| **Surveyor's Karst** | x 4–96, y 5–98 | I–III, dominant I–II | Chalk breaks easily; slate is durable and reflective. Strata visibly continue behind rock. | **Coal** |
| **Mirrorreef** | x 96–236, y 5–86 | I–III | Facets turn the ball by fixed, drawn angles; charged facets chain the turn to nearby crystal. | **Gems** — sapphire → emerald → ruby |
| **Rootwarren** | x 74–236, y 84–140 | III–IV | Living blocks regrow into adjacent empty cells; spore bulbs create short-lived rebound membranes. | **Sulfur** |

| Ecotone | Extent | Band | Combined rule | Rare reagent |
|---|---|---|---|---|
| **The Bright Fault** | x 88–108, y 10–80 | II–III | Reflective slate banks that *also* turn the ball. The best banking geometry in the world. | **Diamond** — coal seams crushed against the crystal lattice; also the fourth and final gem tier |
| **The Chalk Warren** | x 30–96, y 84–104 | III | Regrowth into chalk it can eat, blocked by slate it cannot. Framing decides what the organism reclaims. | **Saltpeter** — sulfurous growth curing in limestone |
| **The Bloom Shelf** | x 110–230, y 78–96 | III | Crystal overgrown by living tissue; cutting growth exposes facets, growth re-covers them. | **Vitriol** — sulfur leached through gem-bearing rock |

Each rare reagent is the literal product of its two parent provinces' reagents. Coal under pressure becomes diamond; coal, sulfur and saltpeter are the three components of gunpowder; sulfur through mineral rock gives vitriol. The chemistry explains the map without a word of exposition.

**The Confluence** (≈95, 88) is where all three provinces meet. No Reach I content is placed there; it is reserved as an esoteric-layer site.

## 2. The resource map

### Metals — depth-banded, every province

From ore inclusions in host rock. Yield rises with depth; province does not matter.

| Metal | Bands | Abundance | Role |
|---|---|---|---|
| **Copper** | I – II | High in I | First plate, first patches. Soft and cheap. |
| **Iron** | I – III | Characteristic of II | The workhorse. Plate, hull, structure. |
| **Cobalt** | II – III | Characteristic of III | Machining. The gate on Tier 2. |
| **Mithril** | III | Characteristic of III | Light, strong. Best armor before fabrication. |
| **Adamantite** | III – IV | Characteristic of IV | Chassis fabrication. The gate on Tier 3. |
| **Runite** | IV | Scarce even in IV | The endgame chassis and the best plate in the game. |

### Reagents — province-locked

| Reagent | Province | Bands | Source brick |
|---|---|---|---|
| **Coal** | Karst | I – III | Coal seams in chalk |
| **Gems** | Mirrorreef | I – III | Crystal facets |
| **Sulfur** | Rootwarren | III – IV | Living blocks and spore bulbs |

#### The gem ladder

Four discrete tiers, each with its own job. Gems are the precision line, so the ladder climbs through *what you can control* rather than through raw magnitude.

| Gem | Band | Source | Governs |
|---|---|---|---|
| **Sapphire** | I | Mirrorreef facets | Paddle speed and travel speed — the basic emitter and drive work |
| **Emerald** | II | Mirrorreef facets | Survey rotation — the gimbal, and everything about aiming a frame |
| **Ruby** | III | Mirrorreef facets | The high-end emitter that replaces the sapphire one outright |
| **Diamond** | II – III, **Bright Fault only** | Coal crushed against the crystal lattice | Sharpening Survey Resonance, and fabricating the Lantern chassis |

Diamond is both the top of the gem ladder and an ecotone-locked rare reagent. The precision line therefore cannot be finished anywhere except the seam between Karst and Mirrorreef — the gate the design already wanted, arriving without being engineered.

Coal is the fuel for every recipe in the game. That answers a question the previous draft left open — whether an abundant filler material earns its place. As undifferentiated filler it did not; as **smelting fuel** it does, because the player understands immediately why every recipe wants it and why running out of it stops the forge.

### Rare reagents — ecotone-only, Tier 3 gate

| Reagent | Ecotone | Band | Fabricates |
|---|---|---|---|
| **Diamond** | Bright Fault | II – III | **Lantern** chassis |
| **Saltpeter** | Chalk Warren | III | **Weir** chassis · blast charges |
| **Vitriol** | Bloom Shelf | III | **Prismatic** chassis |

### Slate — the best wall and the best iron

Karst slate is 4 HP, reflective, and **non-liable**, so leaving it standing costs zero load. It is also unusually iron-rich host rock. A slate bank is therefore simultaneously the best defensive geometry available and the best iron in the shallow world, and the player cannot have both from the same stone. This is the sharpest single decision in the early game and it needs no tutorial text.

### Province × band yield matrix

Empty cells are deliberate. Rootwarren has no shallow expression; Karst has no abyssal one. This is a map, not a grid.

| | **Karst** | **Bright Fault** | **Mirrorreef** | **Bloom Shelf** | **Chalk Warren** | **Rootwarren** |
|---|---|---|---|---|---|---|
| **I** | copper ▰▰▰<br>iron ▰<br>coal ▰▰▰ | copper ▰▰<br>coal ▰▰ | copper ▰▰▰<br>iron ▰<br>sapphire ▰▰ | — | — | — |
| **II** | iron ▰▰▰<br>cobalt ▰<br>coal ▰▰▰ | iron ▰▰<br>cobalt ▰<br>coal ▰▰<br>**diamond ▰** | iron ▰▰▰<br>cobalt ▰▰<br>emerald ▰▰▰ | — | — | — |
| **III** | iron ▰▰<br>cobalt ▰▰<br>mithril ▰<br>coal ▰▰ | cobalt ▰▰<br>mithril ▰▰<br>**diamond ▰▰▰** | cobalt ▰▰<br>mithril ▰▰<br>ruby ▰▰▰ | mithril ▰<br>ruby ▰<br>sulfur ▰<br>**vitriol ▰▰▰** | iron ▰<br>coal ▰<br>sulfur ▰<br>**saltpeter ▰▰▰** | mithril ▰▰▰<br>adamantite ▰<br>sulfur ▰▰▰ |
| **IV** | — | — | — | — | — | adamantite ▰▰▰<br>runite ▰▰<br>sulfur ▰▰▰ |

▰ scarce · ▰▰ present · ▰▰▰ characteristic

**Resources are only secured if the drop is caught.** A resource brick broken is not a resource banked — the existing paddle-catch rule stands, and it is the reason yield and risk are the same decision.

## 3. The crafting chain

### Access — the Refit Bay and anchors

Smelting and smithing happen at the **Refit Bay**, a persistent forge in the lander at the starting area, and at any **anchor** established afterward. **Completing a cornerstone establishes an anchor.** That is the brief's recommended "limited restart anchors" model doing double duty: it is also the reason deep expeditions become viable, and the reason cornerstone order has logistical weight, not just narrative weight.

### Tier 1 — Field Forge

Available from the first minute. Copper, iron and coal, all abundant in the starting province. Repeatable, with rising cost.

| Item | Effect | Cost | Repeat |
|---|---|---|---|
| **Copper Plate** | +3 armor | 10 copper · 4 coal | ×3, cost +50% each |
| **Iron Plate** | +5 armor | 12 iron · 6 coal | ×3 |
| **Hull Patch** | restore 10 integrity (consumable) | 6 copper · 2 coal | unlimited |
| **Hull Extension** | +6 maximum integrity | 14 iron · 6 coal | ×3 |

Hull Patch closes a loop the game currently lacks entirely: integrity only ever falls. Repair must exist before depth is allowed to be dangerous.

### Tier 2 — Machined Modules

Gated on cobalt, so gated on Band II. Modules bolt onto the *equipped* chassis; one per category, each individually upgradeable. They tune the chassis without violating its identity — frame geometry stays immutable, as the current chassis contract requires.

| Module | Effect | Cost |
|---|---|---|
| **Emitter Coil** | +12% paddle speed | 10 cobalt · 4 sapphire · 4 coal |
| **Drive Tune** | +15% travel speed | 8 cobalt · 3 sapphire · 4 coal |
| **Broad Emitter** | +0.4 paddle width | 12 cobalt · 6 coal |
| **Gimbal** | +25% survey rotation speed | 8 cobalt · 4 emerald · 3 coal |
| **Ruby Emitter** | +20% paddle speed; replaces Emitter Coil rather than stacking | 14 cobalt · 6 ruby · 8 coal |
| **Resonant Lens** | Survey Resonance readings gain one extra grade of precision | 10 cobalt · 5 diamond · 6 coal |
| **Cobalt Plate** | +8 armor | 16 cobalt · 8 coal |
| **Mithril Plate** | +12 armor | 14 mithril · 10 coal |
| **Trajectory Optics** | the trajectory line predicts 1 rebound | 10 cobalt · 5 emerald · 5 coal |
| **Deep Optics** | predicts 3 rebounds; replaces Trajectory Optics | 14 cobalt · 7 ruby · 9 coal |
| **Field Collector** | +2.1 ore pull radius | 12 cobalt · 4 emerald · 6 coal |
| **Blast Charge** ×3 | detonate up to 8 surviving bricks at claim resolution, cutting load | 6 saltpeter · 6 sulfur · 4 coal |

Gimbal deserves a note: rotation speed sounds like convenience, but in Mirrorreef — where claim heading versus lattice orientation *is* the decision — faster aiming is a real capability.

Resonant Lens establishes a principle worth stating plainly: **crafting may sharpen a verb, but never grant one.** The Lens is worthless until the Echo Observatory has given you Survey Resonance to sharpen. Capacity can improve understanding; it can never substitute for it.

Blast Charge is the one consumable that touches the load rule directly, and gunpowder is the obvious thing to build from coal, sulfur and saltpeter. It lets a player rescue a claim they misjudged, at a cost in materials from three different provinces.

### Tier 3 — Chassis Fabrication

Gated on adamantite **and** a rare reagent, so gated on Band III–IV **and** on deliberately framing an ecotone. This is where the crafting chain answers a gap the README currently lists as unimplemented: paddle acquisition. Each ecotone fabricates one distinct chassis.

| Chassis | Frame | Identity | Cost |
|---|---|---|---|
| **Lantern** | 9 × 19 | Deep narrow shaft; highest paddle speed. Reads long vertical seams. | 18 adamantite · 10 diamond · 12 coal |
| **Weir** | 19 × 9 | Very wide, shallow, enormous armor. Takes whole cavern walls at once. | 18 adamantite · 10 saltpeter · 12 coal |
| **Prismatic** | 13 × 13 | Balanced, best rotation. Built for aligning to a lattice. | 22 runite · 12 vitriol · 16 coal |
| **Runite Plate** | — | +18 armor | 16 runite · 12 coal |

Fabricated chassis join the roster alongside Needle, Surveyor and Bastion; they do not replace them. A wide shallow frame and a deep narrow frame are different tools, not sequential upgrades — which keeps the starting three relevant.

### Balls per claim

A claim gives **two** balls by default. One made a single early misread end the claim outright, which reads as arbitrary rather than as a consequence of a decision. Two leaves room to recover from a bad first serve while keeping the load rule the real pressure. The Twin Engine raises it to three, which is still a fifty percent increase in attempts and therefore a genuine reason to seek the cornerstone.

### Two aids the drone has innately

The ball always draws a dotted line along its **current** trajectory, and the drone always exerts a slight **ore pull** on nearby drops. Both are baseline conveniences rather than upgrades, and both are deliberately weak: the line shows the current leg only, so it aids aim without solving the board, and the pull falls off with distance, so a wide radius still rewards positioning rather than removing the catch. Optics extend the line through rebounds; collectors widen the pull.

### What is never craftable

Survey Resonance, the third sequential ball, and the rail seed. Verbs come only from cornerstones, and every cornerstone is solo-solvable from in-world evidence. No crafted item is a key to any place.

## 4. The starting area — The Landing

Surveyor's Karst, Band I, centred on cell **(24, 14)** ≈ 126 m. Every feature below is a **generator guarantee**, not a probability. The opening must teach the whole thesis before the world is allowed to be interesting.

### Death, cargo and the bank

Material exists in two pools. **Cargo** is what the drone is carrying and is lost on death. **Banked** material is safe, and is the only pool recipes may be priced against — so a haul is worth nothing until it comes home. Deposit is automatic on reaching the bank, because there is never a reason to refuse it; the tension is the journey, not the keypress.

Death costs the hold and the walk back. Banked material, crafted capacity and earned verbs all survive, and the drone respawns at the Landing at full health. That is the forgiving-expedition model this economy assumes, made concrete.

| # | Feature | Location | Teaches |
|---|---|---|---|
| 1 | **Lander & Refit Bay** — persistent, unbreakable forge, anchor #0 | (24, 14) | There is a home. Capacity is smelted here. |
| 1b | **The Bank** — deposits cargo the moment you reach it | (21, 15) | Cargo is only safe once banked. Dying with a full hold loses it. |
| 2 | **The Chalk Face** — pure chalk, low density, no slate | (16, 16) | Frame, commit, serve, clear. Full clear = zero load. |
| 3 | **The Banked Face** — chalk crossed by two diagonal slate strata | (32, 18) | Slate takes four hits, costs nothing to leave, and is the best iron here. The most important beat in the game. |
| 4 | **The First Seam** — guaranteed copper and coal pocket, visible as anonymous survey returns | (28, 24) | Direction is discoverable; contents are a wager. Drops must be caught. |
| 5 | **The Overload Face** — legibly too dense for starting armor | (20, 26) | Load damage, at a depth where it cannot kill. Strictly optional. |
| 6 | **Three survey stakes** in a triangle | ≈(36, 20) | The brief's survey-triangle procedure; framing all three reveals a calibration pocket worth one enhanced reading. |
| 7 | **The Drop** — shaft descending south to Band II | (24, 30)→ | Deeper is a direction you choose. |

Features 2, 3 and 4 in sequence are the whole game in three boards: clear one cleanly, learn that clearing everything is wrong, then wager on hidden contents.

### Telegraphs leaving the Landing

Per the brief's requirement that the world advertise distant destinations through features crossing arena boundaries:

- A **slate stratum** runs visibly east out of the chamber, continuing behind rock toward the Bright Fault.
- A **dish fragment and severed cable run** point north-east toward the Echo Observatory at (52, 26).
- A faint **crystal glimmer** is visible at the chamber's far eastern lip — Mirrorreef, four hundred metres away.

### FTUE and the chassis choice

The existing three-step deployment selector survives, reframed. Because Tier 3 fabricates new chassis, the opening choice is now an **opening style rather than a permanent fate** — which removes the current selector's worst property, that a first-minute decision with no information silently sets the run's ceiling.

## 5. The progression loop

| Band | Pressure | What the player needs | What the band gives back |
|---|---|---|---|
| **I** | Low density; nothing punishes you | Starting chassis, nothing more | Copper, coal → Tier 1. Echo Observatory is reachable. |
| **II** | Density passes starting armor; load starts to bite | Iron plate and hull; ideally Survey Resonance to read claims before committing | Iron, cobalt, emerald, first diamond → Tier 2. Twin Engine sits in the Bright Fault here. |
| **III** | Province rules dominate framing; volatility is high | Cobalt and mithril plate, modules, one or two cornerstone verbs | Mithril, ruby, sulfur, and all three rare reagents → Tier 3. Root Choir at (128, 98). |
| **IV** | Punishing on every dial | A fabricated chassis and two verbs | Adamantite and runite; the route onward to Reach II |

The loop in one line: **depth pays in metal, provinces pay in reagents, and the seams between them pay in the only materials that build the best equipment — while cornerstones, bought with nothing but understanding, change what all of it means.**

## 6. Generator contract

Requirements the world generator must satisfy or fail loudly. These exist so "the world is broken" is a test failure and not a playtest note.

1. Every cavern is reachable from the Landing without committing a claim, **or** is reachable by breaking material the starting chassis can actually break.
2. All three cornerstones are reachable. Cornerstone internal geometry is fixed; approach angle and surrounding caves vary by seed.
3. All seven numbered Landing features are present at their specified cells.
4. Every ecotone contains at least one claimable seam of its rare reagent within its band, or the seed is rejected.
5. Density, volatility and yield are monotonic in depth within each province.
6. No band-I claim can reduce a starting chassis below 25% integrity.
7. Persistent landmarks (lander, cornerstone mechanisms, stakes) are never exhausted by claim resolution — the existing `persistent` flag already enforces this.
8. Resource drops are never generated inside a cell no ball can reach.
9. Band I always contains enough copper and coal to afford one Copper Plate without requiring a Band II descent.

## 7. Decisions taken

| Question | Decision |
|---|---|
| **Anchor generosity** | **Deferred.** Anchor count is a tuning dial with negligible effect on the generation problem; adding anchors later costs nothing structurally. Not a blocker. |
| **Module respec** | **No respec.** Tier 2 modules are permanent per chassis. Fabricated chassis therefore start bare, which gives the starting three a real ongoing advantage and makes fabrication a considered commitment rather than a strict upgrade. |
| **Gem specificity** | **Four discrete tiers** — sapphire, emerald, ruby, diamond — each governing a different aspect of precision, not merely a different price. Diamond is ecotone-locked. |
| **The Brood** | **Removed.** The province, its Core, and its permanent-multiball arc are gone. The multiball machinery in the solver is retained and reused by Rootwarren spore membranes and the Twin Engine's sequential balls; the place is not preserved. |

One consequence of the no-respec decision is worth stating, because it is load-bearing rather than incidental: because modules do not transfer, a fully-moduled Surveyor can remain the correct tool deep into Band III even after a Lantern is fabricable. Fabrication buys a *different shape of claim*, not a better one, and the player pays for that shape in re-earned modules.

### Still genuinely open

- **Grit's replacement is settled but its abundance is not.** Coal is the fuel for every recipe, so its drop rate directly sets the pace of the entire crafting chain. This can only be tuned by playing it.
- **Blast Charge's detonation cap.** Eight bricks is a guess. If it trivialises misjudged claims it should fall; if nobody ever crafts it, it should rise.

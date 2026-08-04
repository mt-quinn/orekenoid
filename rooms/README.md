# Room art

Every PNG in this directory is one room, stamped into the generated world. Rooms are
what give the mine variety at the scale of a single screen — the scale our generator
had nothing at before. Both reference games work this way: Noita assembles biomes
from hand-drawn Wang tiles plus 464 bespoke "pixel scenes", and Terraria stamps
mini-biomes and small points of interest into procedural caves.

## Two ways to author

**Paint a PNG.** One pixel is one world cell. Use *exact* palette colours — run
`npm run rooms:palette` to print the table and write `_palette.png`, which you can
open in an editor and eyedrop. Save as 8-bit RGB with no colour profile; the loader
rejects unknown colours rather than guessing, because a silently mis-mapped cell is
worse than a failed build.

**Draw it in code.** `rooms/src/*.mjs` build rooms on a coordinate canvas and compile
to PNG via `npm run rooms`. Coordinates are more precise than pixels for stating a
shape deliberately, and a diff of a drawing script is readable where a diff of a PNG
is not. The PNG is the canonical asset either way.

## Looking at what you made

```bash
npm run rooms                     # compile rooms/src -> PNG, validate, regenerate the library
node tools/roomkit.mjs profile    # composition vs Noita's 74 authored rooms
npm run rooms:preview             # write <name>.preview.png: upscaled, gridded, legended
npm run rooms:ascii               # print a painted room back as glyphs
```

Room art is 6–36 cells across, far too small to judge at 1:1. Always look at the
preview.

> **Writing a room? Read [`AUTHORING_GUIDE.md`](AUTHORING_GUIDE.md) first.** It carries the
> measured composition targets from all 74 of Noita's authored rooms and Terraria's real
> mini-biome code, the constraints specific to our drone and claim economics, and the
> anti-patterns. This file is the pipeline; that one is the craft.

## Rules the art has to respect

- **Leave the corners transparent.** Transparent means *don't touch the world here*.
  A room whose full rectangle is opaque cuts a visible box into the rock; a room with
  a rounded, transparent-cornered cavity reads as geology.
- **Never fully seal.** The generator guarantees every cavern is reachable, and a
  room that walls itself off breaks that contract. Leave at least two ways through.
- **Bury the rewards.** `1` cache and `3` seam resolve to *rock plus a feature*, so
  they cost a claim to reach. Author them inside a rock mass — placed in open space
  they become a single block hanging in mid-air. `2` `4` `5` `*` `?` hang in the
  cavity and are free to approach.
- **Say what the province rule is.** A Karst room should be about the slate decision;
  a Mirrorreef room about lattice alignment; a Rootwarren room about pruning versus
  clearing. A room that is only a shape is a corridor with extra steps.

## Filename tags

The filename is the only metadata channel a painted PNG has, and a good one: the tag
travels with the art, a sidecar file cannot fall out of sync with it, and the constraint
is visible in a directory listing. Region already comes from the prefix and tier from the
footprint; placement constraints come from trailing tags, which are stripped from the
room's id.

| Tag | Effect |
|---|---|
| `-b12` `-b34` `-b234` … | Stamp only in these depth bands. Untagged means all four. |
| `-fixed` | Never rebuild this room in another province's materials. |
| `-rot` | May be stamped rotated a quarter turn. |
| `-nomirror` | May not be stamped mirrored. |

So `mirrorreef-crossed-lattice-b34-fixed-rot.png` is a deep Mirrorreef room that never
leaves its own vocabulary and reads at either orientation.

Defaults matter: **every room is mirrored and substituted unless it says otherwise**, and
no room is rotated unless it says so. See §9 of the authoring guide for when to override
each one — the short version is that mirroring is always safe, substitution is safe unless
the room's design depends on a specific material *behaviour*, and rotation is only safe
for a room composed around a centre rather than sitting on its floor.

## Tiers

| Tier | Cells | Share of a screen |
|---|---|---|
| feature | 6×6 – 12×12 | ~⅙ |
| chamber | 18×9 / 9×18 | ~½ |
| hall | 36×18 | ~1 |

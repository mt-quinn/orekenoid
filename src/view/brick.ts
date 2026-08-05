// Brick artwork.
//
// The governing rule: **a brick draws the thing that makes it behave differently.**
// A facet draws its actual reflecting diagonal, so the turn is visible before it
// happens. Non-liable stone is banded and heavy, so it reads as structure worth
// keeping rather than work left undone. A turn the player cannot see coming is not
// a rule, it is a surprise — so nothing here is decorative.

import { Container, Graphics } from "pixi.js";
import { BRICK_HALF, CELL, PALETTE, RESOURCES } from "../config";
import { materialOf } from "../materials";
import type { Brick } from "../types";

export interface BrickDisplay {
  container: Container;
  /** Revealed once the brick has taken a hit but is not yet broken. */
  damage: Graphics;
}

export function createBrickDisplay(brick: Brick): BrickDisplay {
  const container = new Container();
  const size = BRICK_HALF * 2 * CELL;
  const definition = materialOf(brick.kind);
  // Stable per-cell variation, so plain rock is not a repeating tile and does not
  // shimmer when an arena is re-entered.
  const seed = ((brick.x * 73 + brick.y * 151) % 97) / 97;

  const shadow = new Graphics()
    .roundRect(-size / 2 + 2, -size / 2 + 4, size, size, 6)
    .fill({ color: 0x000000, alpha: 0.55 });
  // Rim weight encodes hit points. Four-hit stone is visibly heavier than chalk
  // before the player has struck either.
  const rimWidth = definition.hp >= 4 ? 3.4 : definition.hp >= 2 ? 2.8 : 2.2;
  const rim = new Graphics()
    .roundRect(-size / 2, -size / 2, size, size, 6)
    .fill(0x151817)
    .stroke({ width: rimWidth, color: definition.edge, alpha: 0.9 });
  const face = new Graphics()
    .roundRect(-size / 2 + 3, -size / 2 + 3, size - 6, size - 6, 4)
    .fill(definition.base);

  const material = new Graphics();
  if (definition.reflect === "facet") {
    // The facet plane, along its real axis. This is the whole Mirrorreef rule made
    // visible: claim heading against lattice orientation is readable per brick.
    const extent = size * 0.42;
    const dx = brick.facetAxis === 1 ? extent : -extent;
    material.moveTo(-dx, -extent).lineTo(dx, extent).stroke({ width: 6, color: definition.edge, alpha: 0.45 });
    material.moveTo(-dx, -extent).lineTo(dx, extent).stroke({ width: 2.2, color: 0xffffff, alpha: 0.8 });
    if (definition.chains) {
      // Charged: the ring says this one propagates.
      material.circle(0, 0, size * 0.17).stroke({ width: 2, color: 0xffffff, alpha: 0.85 });
      material.circle(0, 0, size * 0.07).fill({ color: 0xffffff, alpha: 0.9 });
    }
  } else if (!definition.liable) {
    // Non-liable stone: banded, heavy, structural. Leaving it standing is free.
    for (const offset of [-0.22, 0, 0.22]) {
      material.moveTo(-size * 0.36, size * offset - 3).lineTo(size * 0.36, size * offset + 3)
        .stroke({ width: 2.4, color: definition.edge, alpha: 0.34 });
    }
    material.moveTo(-size * 0.3, -size * 0.3).lineTo(size * 0.12, size * 0.02)
      .stroke({ width: 2, color: 0xffffff, alpha: 0.22 });
  } else if (definition.regrows) {
    material.circle(-size * 0.16, -size * 0.08, size * 0.2).circle(size * 0.13, size * 0.12, size * 0.24)
      .stroke({ width: 2.3, color: definition.edge, alpha: 0.42 });
    material.moveTo(-size * 0.34, size * 0.14).lineTo(-size * 0.1, 0).lineTo(size * 0.1, size * 0.1).lineTo(size * 0.34, -size * 0.12)
      .stroke({ width: 2, color: definition.edge, alpha: 0.6 });
  } else if (definition.spawnsMembrane) {
    material.circle(0, 0, size * 0.26).fill({ color: definition.edge, alpha: 0.28 })
      .stroke({ width: 2.4, color: definition.edge, alpha: 0.9 });
    material.circle(0, 0, size * 0.1).fill({ color: 0xffffff, alpha: 0.7 });
  } else if (definition.persistent) {
    // Machined, cross-braced: this is a mechanism, not ore. It will not break.
    material.roundRect(-size * 0.3, -size * 0.3, size * 0.6, size * 0.6, 3)
      .fill(0x1b2224).stroke({ width: 2.2, color: definition.edge, alpha: 0.95 });
    material.moveTo(-size * 0.16, 0).lineTo(size * 0.16, 0)
      .moveTo(0, -size * 0.16).lineTo(0, size * 0.16)
      .stroke({ width: 2, color: definition.edge, alpha: 0.8 });
  } else {
    // Plain host rock: bedding planes only, seeded so no two are identical.
    material.moveTo(-size * 0.34, -size * 0.28 + seed * 4).lineTo(-size * 0.08, -size * 0.3).lineTo(size * 0.34, -size * 0.26)
      .stroke({ width: 2, color: definition.edge, alpha: 0.26 });
    material.moveTo(-size * 0.3, size * 0.06).lineTo(size * 0.02, size * 0.02).lineTo(size * 0.3, size * 0.1)
      .stroke({ width: 1.2, color: 0x191b19, alpha: 0.46 });
  }

  // A revealed resource inclusion, in its own metal's colour. Only ever drawn for
  // a brick inside a committed claim -- the world never shows contents.
  if (brick.resource) {
    const colour = RESOURCES[brick.resource].colour;
    const inclusion = [-5, 7, -9, -2, -2, -10, 7, -6, 10, 4, 3, 10];
    material.poly(inclusion).fill({ color: colour, alpha: 0.92 });
    material.poly(inclusion).stroke({ width: 1.4, color: 0xffffff, alpha: 0.42 });
  }

  const bevel = new Graphics()
    .moveTo(-size / 2 + 7, -size / 2 + 5).lineTo(size / 2 - 7, -size / 2 + 5)
    .stroke({ width: 1.5, color: 0xffffff, alpha: 0.2 })
    .moveTo(-size / 2 + 5, size / 2 - 7).lineTo(-size / 2 + 5, -size / 2 + 7)
    .stroke({ width: 1, color: 0xffffff, alpha: 0.12 });

  // Fracture state. Multi-hit material must expose its progress, or a four-hit
  // slate bank is indistinguishable from a wasted shot.
  const damage = new Graphics()
    .moveTo(-size * 0.3, -size * 0.1).lineTo(-size * 0.08, 1).lineTo(-size * 0.18, size * 0.28)
    .moveTo(-size * 0.08, 1).lineTo(size * 0.15, -size * 0.18).lineTo(size * 0.32, -size * 0.08)
    .stroke({ width: 2.1, color: PALETTE.ink, alpha: 0.78 });
  damage.alpha = 0;

  container.addChild(shadow, rim, face, material, bevel, damage);

  // Worked rock: broken once already, so it is not load and the player should be able to see that
  // at a glance rather than counting. Desaturated toward the rim colour rather than merely dimmed,
  // because dim reads as "far away" and washed-out reads as "spent" -- and a wash keeps the
  // material identity legible, which matters when the same claim holds both fresh and regrown
  // cells of the same stone.
  if (brick.worked) {
    container.tint = 0x8e9694;
    container.alpha = 0.72;
    // A slash across the face, so the state survives being colour-blind or on a dim screen.
    container.addChild(new Graphics()
      .moveTo(-size * 0.28, size * 0.28).lineTo(size * 0.28, -size * 0.28)
      .stroke({ width: 2, color: PALETTE.ink, alpha: 0.28 }));
  }
  return { container, damage };
}

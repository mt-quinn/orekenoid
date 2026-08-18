// World dressing and the survey projection.
//
// Two jobs, both in service of "direction is discoverable; contents are a wager":
//
//   - Cornerstones telegraph themselves from far away with light and structure, so
//     the player can decide to walk toward something before knowing what it is.
//   - The survey frame shows *where* the claim will land and *that* there are
//     returns inside it, with the returns drawn as anonymous contacts. Never what
//     they are.

import { BlurFilter, Container, Graphics, Text } from "pixi.js";
import { CELL, PALETTE, PROVINCE_PALETTE, WORLD_COLS, WORLD_ROWS } from "../config";
import { flatPoints } from "../maths";
import type { FrameGeometry, Vec2 } from "../types";
import type { WorldModel } from "../world";
import { BANK } from "../worldgen/landmarks";

/**
 * The floor of the mine, behind the terrain.
 *
 * A flat plate rather than anything drawn per cell, because it is only ever seen through the holes
 * in the terrain -- which is exactly what open ground is. It carries a real tone now instead of
 * `void`: the shadow layer multiplies over it, so this is the brightness that tells the player
 * where their line of sight reaches. Without it, lit floor and unseen floor were both black and the
 * shadows had nothing to be shadows against.
 */
export function buildFarGeology(layer: Container): void {
  const floor = new Graphics();
  floor.rect(0, 0, WORLD_COLS * CELL, WORLD_ROWS * CELL).fill(PALETTE.floor);
  layer.addChild(floor);
}

/**
 * World-scale cornerstone telegraphs.
 *
 * Three layers at three distances: a very large soft glow visible from across a
 * province, concentric ribs that resolve as you approach, and a name that is only
 * legible up close. The player should be drawn in before they can read it.
 */
export function buildLandmarks(layer: Container, world: WorldModel): void {
  for (const site of world.generated.cornerstones) {
    const colour = PROVINCE_PALETTE[world.provinceAt(site.x, site.y)].accent;

    const glow = new Graphics();
    glow.circle(site.x * CELL, site.y * CELL, 300).fill({ color: colour, alpha: 0.06 });
    glow.filters = [new BlurFilter({ strength: 34, quality: 3 })];
    layer.addChild(glow);

    const ribs = new Graphics();
    for (let index = 0; index < 6; index++) {
      const radius = (4.4 + index * 1.15) * CELL;
      ribs.ellipse(site.x * CELL, site.y * CELL, radius, radius * 0.76)
        .stroke({ width: 3, color: colour, alpha: 0.1 });
    }
    ribs.label = `landmark-${site.id}`;
    layer.addChild(ribs);

    const marker = new Text({
      text: site.name,
      style: { fill: colour, fontSize: 26, fontWeight: "800", letterSpacing: 4 },
    });
    marker.anchor.set(0.5);
    marker.position.set(site.x * CELL, (site.y - 7) * CELL);
    marker.alpha = 0.42;
    layer.addChild(marker);
  }

  drawHomeBeacon(layer);
}

/**
 * Home, made findable by eye.
 *
 * The Refit Bay had no landmark treatment at all: cornerstones glowed and the one place the player
 * has to keep coming back to looked like any other stretch of rock. Which meant "there is a home"
 * was a fact the interface only ever asserted in text, and "where is it" could only be answered by
 * the compass.
 *
 * Deliberately brass rather than a province accent. Every other glow in the mine is geology; this one
 * is the machine, and it should not read as another seam worth cutting.
 */
function drawHomeBeacon(layer: Container): void {
  // The rack, which is what the compass points at and what banking measures against.
  const x = BANK.x * CELL;
  const y = BANK.y * CELL;
  const colour = PALETTE.machine;

  // Visible from most of a province, the way the cornerstones are -- the point is to be spotted from
  // far enough away that the player heads for it rather than stumbling on it.
  const glow = new Graphics();
  glow.circle(x, y, 340).fill({ color: colour, alpha: 0.05 });
  glow.filters = [new BlurFilter({ strength: 36, quality: 3 })];
  layer.addChild(glow);

  // A landing pad rather than concentric geology: squared off, with approach marks on the four
  // sides, so up close it reads as somewhere built.
  const pad = new Graphics();
  for (let ring = 0; ring < 3; ring++) {
    const radius = (3.2 + ring * 1.6) * CELL;
    pad.rect(x - radius, y - radius, radius * 2, radius * 2)
      .stroke({ width: 2, color: colour, alpha: 0.13 - ring * 0.03 });
  }
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const inner = 2.1 * CELL;
    const outer = 3.1 * CELL;
    pad.moveTo(x + dx * inner, y + dy * inner)
      .lineTo(x + dx * outer, y + dy * outer)
      .stroke({ width: 3, color: colour, alpha: 0.3 });
  }
  pad.label = "landmark-refitBay";
  layer.addChild(pad);

  const marker = new Text({
    text: "REFIT BAY",
    style: { fill: colour, fontSize: 24, fontWeight: "800", letterSpacing: 4 },
  });
  marker.anchor.set(0.5);
  marker.position.set(x, (BANK.y - 5.5) * CELL);
  marker.alpha = 0.5;
  layer.addChild(marker);
}

/** The four Graphics layers the survey projection draws into. */
export interface FramePreviewLayers {
  wash: Graphics;
  grid: Graphics;
  scan: Graphics;
  returns: Graphics;
}

/**
 * Draw the survey projection for the frame the drone is currently pointing.
 *
 * `time` drives the scan sweep and the return pulses. The frame turns danger-red
 * when it would cross the survey limit, which is the one refusal the player needs
 * to see *before* pressing commit rather than after.
 */
export function drawFramePreview(
  layers: FramePreviewLayers,
  world: WorldModel,
  frame: FrameGeometry,
  time: number,
): void {
  const half = frame.width / 2;
  const toWorld = (u: number, v: number): Vec2 => world.localToWorld(u, v, frame);
  const corners = [[-half, 0], [half, 0], [half, frame.depth + 0.5], [-half, frame.depth + 0.5]]
    .map(([u, v]) => toWorld(u, v));
  // Reddened for the one condition that genuinely refuses a commit: an empty frame. Overhanging the
  // edge of the world used to colour red too, which told the player a legal claim was illegal --
  // outside the map there is simply nothing to cut, and the board carries empty space there.
  const province = world.provinceAt(frame.origin.x, frame.origin.y);
  const signal = world.frameHasMaterial(frame) ? PROVINCE_PALETTE[province].accent : PALETTE.danger;
  const polygon = flatPoints(corners.map((point) => ({ x: point.x * CELL, y: point.y * CELL })));

  layers.wash.clear().poly(polygon)
    .fill({ color: 0x090d0d, alpha: 0.18 })
    .stroke({ width: 10, color: 0x020405, alpha: 0.38 });

  layers.grid.clear().poly(polygon).stroke({ width: 2.2, color: signal, alpha: 0.78 });
  // The brick lattice the claim will actually produce, at very low alpha: enough to
  // judge alignment against a facet plane, not enough to read as a wall.
  for (let column = 1; column < frame.width; column++) {
    const u = -half + column;
    const a = toWorld(u, 0);
    const b = toWorld(u, frame.depth + 0.5);
    layers.grid.moveTo(a.x * CELL, a.y * CELL).lineTo(b.x * CELL, b.y * CELL);
  }
  for (let row = 1; row <= frame.depth; row++) {
    const a = toWorld(-half, row);
    const b = toWorld(half, row);
    layers.grid.moveTo(a.x * CELL, a.y * CELL).lineTo(b.x * CELL, b.y * CELL);
  }
  layers.grid.stroke({ width: 0.7, color: signal, alpha: 0.085 });

  // Corner brackets, bright. These are what the eye tracks while rotating.
  const bracket = 0.46;
  const brackets = [
    [-half, 0, 1, 1],
    [half, 0, -1, 1],
    [half, frame.depth + 0.5, -1, -1],
    [-half, frame.depth + 0.5, 1, -1],
  ] as const;
  for (const [u, v, sx, sy] of brackets) {
    const corner = toWorld(u, v);
    const along = toWorld(u + sx * bracket, v);
    const inward = toWorld(u, v + sy * bracket);
    layers.grid
      .moveTo(along.x * CELL, along.y * CELL)
      .lineTo(corner.x * CELL, corner.y * CELL)
      .lineTo(inward.x * CELL, inward.y * CELL);
  }
  layers.grid.stroke({ width: 4, color: signal, alpha: 0.96 });

  const scanV = (time * 3.1) % (frame.depth + 0.5);
  const scanA = toWorld(-half, scanV);
  const scanB = toWorld(half, scanV);
  layers.scan.clear()
    .moveTo(scanA.x * CELL, scanA.y * CELL)
    .lineTo(scanB.x * CELL, scanB.y * CELL)
    .stroke({ width: 9, color: signal, alpha: 0.11 });

  // Anonymous returns. A contact, never an identity: the player learns that there
  // is something worth having in the frame, and wagers on what.
  layers.returns.clear();
  for (const cell of world.surveyedItems(frame)) {
    const x = (cell.x + 0.5) * CELL;
    const y = (cell.y + 0.5) * CELL;
    const pulse = 0.62 + Math.sin(time * 4.2 + cell.x * 0.7) * 0.2;
    layers.returns.circle(x, y, 9).stroke({ width: 1, color: PALETTE.ink, alpha: pulse * 0.35 });
    layers.returns.poly([x, y - 6, x + 6, y, x, y + 6, x - 6, y])
      .stroke({ width: 2, color: PALETTE.ink, alpha: pulse })
      .circle(x, y, 1.8).fill(PALETTE.ink);
  }
  for (const point of corners) {
    layers.returns.circle(point.x * CELL, point.y * CELL, 4).fill(signal)
      .circle(point.x * CELL, point.y * CELL, 9).stroke({ width: 1, color: signal, alpha: 0.3 });
  }
}

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
import { BANK, BAY_RECT } from "../worldgen/landmarks";

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

  // Drawn to the bay's own rect, because the bay is a place and not a decoration.
  //
  // This used to be three concentric squares up to thirteen cells across, centred on the bank rather
  // than on the recess -- so the drawn bay and the bay disagreed about both size and position, and the
  // part that looked most like somewhere to fly into was solid rock. Now the art is derived from the
  // same map cells that make the floor, so the two cannot drift apart again.
  const pad = new Graphics();
  const left = BAY_RECT.x * CELL;
  const top = BAY_RECT.y * CELL;
  const width = BAY_RECT.width * CELL;
  const height = BAY_RECT.height * CELL;
  for (let ring = 0; ring < 3; ring++) {
    const inset = ring * 0.34 * CELL;
    pad.rect(left + inset, top + inset, width - inset * 2, height - inset * 2)
      .stroke({ width: 2, color: colour, alpha: 0.2 - ring * 0.05 });
  }
  // Approach marks on the open side only. The other three are wall, and a mark drawn into rock is an
  // invitation to fly at it.
  for (let step = 1; step < BAY_RECT.height; step++) {
    const markY = top + step * CELL;
    pad.moveTo(left + width, markY)
      .lineTo(left + width + 0.7 * CELL, markY)
      .stroke({ width: 3, color: colour, alpha: 0.26 });
  }
  pad.label = "landmark-refitBay";
  layer.addChild(pad);

  const marker = new Text({
    text: "REFIT BAY",
    style: { fill: colour, fontSize: 24, fontWeight: "800", letterSpacing: 4 },
  });
  marker.anchor.set(0.5);
  marker.position.set(left + width / 2, (BAY_RECT.y - 1.4) * CELL);
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

/**
 * Mark the Seal, so the door the opening is built around is a thing the player can see.
 *
 * It had no indication at all: a band of chalk that looked like the rock either side of it, in a room
 * lit only ahead of the paddle, with a refusal ("FRAME THE SEAL") that arrived without ever having said
 * where the Seal was. This is the fix for that, and it is drawn above the shadow layer on purpose --
 * the one thing the game is currently asking for must not be something the dark can hide.
 *
 * `armed` is whether the frame is actually covering it, which turns the mark from a request into a
 * confirmation and is the feedback the rotation lesson was missing.
 */
export function drawSealMarker(
  marker: Graphics,
  cells: ReadonlyArray<{ x: number; y: number }>,
  time: number,
  armed: boolean,
): void {
  marker.clear();
  if (!cells.length) return;
  // Bright in both states. The first version used the dim machine tone unarmed, which put the one thing
  // the game was asking for at roughly the brightness of the wall it sits in.
  const colour = PALETTE.rail;
  // Breathing rather than static. A steady outline on a dark wall reads as part of the art; something
  // that moves reads as being addressed to you.
  const pulse = armed ? 1 : 0.62 + Math.sin(time * 3.4) * 0.26;

  for (const cell of cells) {
    marker.rect(cell.x * CELL, cell.y * CELL, CELL, CELL)
      .fill({ color: colour, alpha: armed ? 0.34 : 0.16 });
  }

  // One outline around the whole band rather than a grid of boxes, so it reads as a single door.
  const minX = Math.min(...cells.map((cell) => cell.x));
  const maxX = Math.max(...cells.map((cell) => cell.x)) + 1;
  const minY = Math.min(...cells.map((cell) => cell.y));
  const maxY = Math.max(...cells.map((cell) => cell.y)) + 1;
  const corner = 1.1 * CELL;
  const left = minX * CELL;
  const top = minY * CELL;
  const right = maxX * CELL;
  const bottom = maxY * CELL;
  // Corner brackets, which is the language the claim frame already uses for "this rectangle matters".
  // Armed, the brackets close into a full outline: the frame is on the door and the player should be
  // able to see that without reading a word.
  if (armed) {
    marker.rect(left, top, right - left, bottom - top).stroke({ width: 3, color: colour, alpha: 1 });
  }
  for (const [cx, cy, sx, sy] of [
    [left, top, 1, 1], [right, top, -1, 1], [right, bottom, -1, -1], [left, bottom, 1, -1],
  ] as const) {
    marker.moveTo(cx + sx * corner, cy)
      .lineTo(cx, cy)
      .lineTo(cx, cy + sy * corner)
      .stroke({ width: 3, color: colour, alpha: pulse });
  }
}

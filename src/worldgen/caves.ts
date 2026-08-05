// Cave carving at three scales: caverns, a connecting tube graph, and fine
// erosion. Connectivity is built rather than hoped for -- the tube graph is a
// spanning tree over every cavern, so no chamber can generate isolated, and a
// flood fill afterwards proves it.

import { WORLD_COLS, WORLD_ROWS } from "../config";
import { fbm, sfbm, type Rng } from "./rng";

export interface CaveNode {
  x: number;
  y: number;
  rx: number;
  ry: number;
  required: boolean;
  label?: string;
}

export interface CaveEdge {
  a: number;
  b: number;
  radius: number;
}

export interface PlugRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CaveField {
  open: Uint8Array;
  nodes: CaveNode[];
  edges: CaveEdge[];
  plugs: PlugRect[];
  isOpen(x: number, y: number): boolean;
}

const index = (x: number, y: number) => y * WORLD_COLS + x;

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax;
  const aby = by - ay;
  const lengthSquared = abx * abx + aby * aby;
  const t = lengthSquared < 1e-9 ? 0 : Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / lengthSquared));
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}

/**
 * Poisson-style rejection sampling for cavern centres.
 *
 * Depth reduces both how *often* caverns occur and how *large* they are. Relying
 * on radius alone left band density non-monotonic, because random variation in
 * node count per depth swamped the size trend in the upper world. Both dials
 * moving together is what makes the density contract true by construction rather
 * than true on average.
 */
function scatterNodes(rng: Rng, required: CaveNode[], target: number, spacing: number): CaveNode[] {
  const nodes = [...required];
  for (let attempt = 0; attempt < target * 40 && nodes.length < target; attempt++) {
    const x = rng.range(8, WORLD_COLS - 8);
    const y = rng.range(5, WORLD_ROWS - 8);
    const depth01 = y / WORLD_ROWS;
    // Frequency falls with depth.
    if (!rng.chance(1 - depth01 * 0.62)) continue;
    if (nodes.some((node) => Math.hypot(node.x - x, node.y - y) < spacing)) continue;
    // Size falls with depth.
    const depthFactor = 1 - depth01 * 0.5;
    nodes.push({
      x,
      y,
      rx: rng.range(3.8, 9.2) * depthFactor,
      ry: rng.range(3.1, 6.9) * depthFactor,
      required: false,
    });
  }
  return nodes;
}

/** Prim's algorithm over the complete graph, then a few extra edges for loops. */
function connectNodes(rng: Rng, nodes: CaveNode[]): CaveEdge[] {
  const edges: CaveEdge[] = [];
  if (nodes.length < 2) return edges;
  const reached = new Set<number>([0]);
  const pending = new Set<number>(nodes.map((_, i) => i).filter((i) => i !== 0));

  while (pending.size) {
    let bestFrom = -1;
    let bestTo = -1;
    let bestDistance = Infinity;
    for (const from of reached) {
      for (const to of pending) {
        const distance = Math.hypot(nodes[from].x - nodes[to].x, nodes[from].y - nodes[to].y);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestFrom = from;
          bestTo = to;
        }
      }
    }
    if (bestTo < 0) break;
    edges.push({ a: bestFrom, b: bestTo, radius: rng.range(1.95, 3.1) });
    reached.add(bestTo);
    pending.delete(bestTo);
  }

  for (let a = 0; a < nodes.length; a++) {
    for (let b = a + 1; b < nodes.length; b++) {
      if (Math.hypot(nodes[a].x - nodes[b].x, nodes[a].y - nodes[b].y) > 26) continue;
      if (!rng.chance(0.16)) continue;
      edges.push({ a, b, radius: rng.range(1.9, 2.7) });
    }
  }
  return edges;
}

/**
 * Carve the world.
 *
 * `required` nodes are authored sites -- the Landing and the three cornerstones --
 * and are always node 0..n so the spanning tree roots at the Landing.
 */
export function carveCaves(seed: number, rng: Rng, required: CaveNode[]): CaveField {
  const nodes = scatterNodes(rng, required, 130, 11.5);
  const edges = connectNodes(rng, nodes);

  const field = new Float32Array(WORLD_COLS * WORLD_ROWS).fill(-1);

  for (const node of nodes) {
    const minX = Math.max(1, Math.floor(node.x - node.rx - 3));
    const maxX = Math.min(WORLD_COLS - 2, Math.ceil(node.x + node.rx + 3));
    const minY = Math.max(1, Math.floor(node.y - node.ry - 3));
    const maxY = Math.min(WORLD_ROWS - 2, Math.ceil(node.y + node.ry + 3));
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = (x + 0.5 - node.x) / node.rx;
        const dy = (y + 0.5 - node.y) / node.ry;
        const wobble = sfbm(seed + 2203, x * 0.13, y * 0.13, 3) * 0.22;
        const value = 1 - (dx * dx + dy * dy) + wobble;
        if (value > field[index(x, y)]) field[index(x, y)] = value;
      }
    }
  }

  for (const edge of edges) {
    const a = nodes[edge.a];
    const b = nodes[edge.b];
    const minX = Math.max(1, Math.floor(Math.min(a.x, b.x) - edge.radius - 3));
    const maxX = Math.min(WORLD_COLS - 2, Math.ceil(Math.max(a.x, b.x) + edge.radius + 3));
    const minY = Math.max(1, Math.floor(Math.min(a.y, b.y) - edge.radius - 3));
    const maxY = Math.min(WORLD_ROWS - 2, Math.ceil(Math.max(a.y, b.y) + edge.radius + 3));
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const distance = distanceToSegment(x + 0.5, y + 0.5, a.x, a.y, b.x, b.y);
        const wobble = sfbm(seed + 3307, x * 0.16, y * 0.16, 3) * 0.19;
        const value = 1 - distance / edge.radius + wobble;
        if (value > field[index(x, y)]) field[index(x, y)] = value;
      }
    }
  }

  const open = new Uint8Array(WORLD_COLS * WORLD_ROWS);
  for (let y = 1; y < WORLD_ROWS - 1; y++) {
    for (let x = 1; x < WORLD_COLS - 1; x++) {
      const value = field[index(x, y)];
      // Fine erosion: cells just outside a cavity open ragged rather than smooth.
      // Erosion also weakens with depth, so deep rock reads as tighter and less
      // weathered than the shallow world.
      const erosion = 0.6 + (y / WORLD_ROWS) * 0.22;
      const ragged = value > -0.24 && fbm(seed + 4409, x * 0.34, y * 0.34, 2) > erosion;
      if (value > 0 || ragged) open[index(x, y)] = 1;
    }
  }

  // Forced plugs. A handful of tubes are sealed so progress requires committing a
  // claim rather than walking through the whole world.
  const plugs: PlugRect[] = [];
  const plugCandidates = rng.shuffle(edges.filter((edge) => {
    const a = nodes[edge.a];
    const b = nodes[edge.b];
    return Math.hypot(a.x - b.x, a.y - b.y) > 12 && !(edge.a < required.length && edge.b < required.length);
  }));
  for (const edge of plugCandidates.slice(0, 14)) {
    const a = nodes[edge.a];
    const b = nodes[edge.b];
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    const rect: PlugRect = {
      x: Math.round(midX - 1.5),
      y: Math.round(midY - 1.5),
      width: 3,
      height: 3,
    };
    plugs.push(rect);
    for (let y = rect.y; y < rect.y + rect.height; y++) {
      for (let x = rect.x; x < rect.x + rect.width; x++) {
        if (x < 1 || y < 1 || x >= WORLD_COLS - 1 || y >= WORLD_ROWS - 1) continue;
        open[index(x, y)] = 0;
      }
    }
  }

  return {
    open,
    nodes,
    edges,
    plugs,
    isOpen: (x: number, y: number) =>
      x >= 0 && y >= 0 && x < WORLD_COLS && y < WORLD_ROWS && open[index(x, y)] === 1,
  };
}

/**
 * Flood fill over open cells from a start point.
 * Used to prove generator contract items 1 and 2 rather than assume them.
 */
export function reachableFrom(open: Uint8Array, startX: number, startY: number): Uint8Array {
  const seen = new Uint8Array(WORLD_COLS * WORLD_ROWS);
  const start = index(Math.round(startX), Math.round(startY));
  if (open[start] !== 1) return seen;
  const queue = [start];
  seen[start] = 1;
  while (queue.length) {
    const current = queue.pop()!;
    const x = current % WORLD_COLS;
    const y = (current - x) / WORLD_COLS;
    for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + ox;
      const ny = y + oy;
      if (nx < 0 || ny < 0 || nx >= WORLD_COLS || ny >= WORLD_ROWS) continue;
      const next = index(nx, ny);
      if (seen[next] || open[next] !== 1) continue;
      seen[next] = 1;
      queue.push(next);
    }
  }
  return seen;
}

export interface OpenComponent {
  cells: number[];
  centroidX: number;
  centroidY: number;
}

/** Connected components of open space, four-connected. */
export function openComponents(open: Uint8Array): OpenComponent[] {
  const seen = new Uint8Array(WORLD_COLS * WORLD_ROWS);
  const components: OpenComponent[] = [];
  for (let start = 0; start < open.length; start++) {
    if (open[start] !== 1 || seen[start]) continue;
    const cells: number[] = [];
    const queue = [start];
    seen[start] = 1;
    let sumX = 0;
    let sumY = 0;
    while (queue.length) {
      const current = queue.pop()!;
      cells.push(current);
      const x = current % WORLD_COLS;
      const y = (current - x) / WORLD_COLS;
      sumX += x;
      sumY += y;
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + ox;
        const ny = y + oy;
        if (nx < 0 || ny < 0 || nx >= WORLD_COLS || ny >= WORLD_ROWS) continue;
        const next = index(nx, ny);
        if (seen[next] || open[next] !== 1) continue;
        seen[next] = 1;
        queue.push(next);
      }
    }
    components.push({ cells, centroidX: sumX / cells.length, centroidY: sumY / cells.length });
  }
  return components;
}

/**
 * Carve a straight corridor between two points. Used to repair any connectivity
 * the plug pass or erosion severed, so a broken world is impossible rather than
 * merely unlikely.
 */
/** One straight capsule, with the same edge noise the procedural tubes get. */
function carveCapsule(
  open: Uint8Array, ax: number, ay: number, bx: number, by: number, radius: number, seed: number,
): void {
  const reach = radius * 1.25 + 1;
  const minX = Math.max(1, Math.floor(Math.min(ax, bx) - reach));
  const maxX = Math.min(WORLD_COLS - 2, Math.ceil(Math.max(ax, bx) + reach));
  const minY = Math.max(1, Math.floor(Math.min(ay, by) - reach));
  const maxY = Math.min(WORLD_ROWS - 2, Math.ceil(Math.max(ay, by) + reach));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      // Clamped so the noise can roughen the corridor's edge but never pinch it shut, which
      // would strand exactly the space it was carved to connect.
      const edge = Math.max(1.15, radius * (1 + sfbm(seed + 6607, x * 0.19, y * 0.19, 2) * 0.2));
      if (distanceToSegment(x + 0.5, y + 0.5, ax, ay, bx, by) <= edge) open[index(x, y)] = 1;
    }
  }
}

/**
 * Carve a corridor joining two points.
 *
 * It wanders. A single straight capsule -- which is what this was -- reads as a survey line
 * cut through the world rather than as a cave, because it is the only thing in the generator
 * with no noise on it at all: the procedural tubes in `carveCaves` all get `sfbm` wobble and
 * this did not. On seeds where a repair ran long that produced perfectly straight hallways
 * hundreds of cells long, and the world looked pre-mined.
 *
 * The wander is a lateral offset from noise, tapered to zero at both ends with a sine so the
 * corridor still lands exactly on the cells it was asked to join, and it is carved as
 * overlapping capsules so connectivity cannot be broken by the displacement.
 */
export function carveCorridor(
  open: Uint8Array, ax: number, ay: number, bx: number, by: number, radius: number, seed = 0,
): void {
  const length = Math.hypot(bx - ax, by - ay);
  if (length < 1e-6) {
    carveCapsule(open, ax, ay, bx, by, radius, seed);
    return;
  }
  // Perpendicular to the run, and a sway that grows with length but stops being a detour.
  const acrossX = -(by - ay) / length;
  const acrossY = (bx - ax) / length;
  const sway = Math.min(7, length * 0.16);
  const steps = Math.max(1, Math.round(length / 3.5));
  const pointAt = (t: number): [number, number] => {
    const offset = sfbm(seed + 5501, t * 5.5, (seed % 61) * 0.37, 3) * sway * Math.sin(Math.PI * t);
    return [ax + (bx - ax) * t + acrossX * offset, ay + (by - ay) * t + acrossY * offset];
  };
  let [px, py] = pointAt(0);
  for (let step = 1; step <= steps; step++) {
    const [qx, qy] = pointAt(step / steps);
    carveCapsule(open, px, py, qx, qy, radius, seed);
    px = qx;
    py = qy;
  }
}

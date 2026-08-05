import { describe, expect, it } from "vitest";
import { Container } from "pixi.js";
import { BALL_SPEED } from "../src/config";
import { calculateClaimDamage } from "../src/claims";
import { createBall, predictPath, stepBall, sweepRoundedRect } from "../src/physics";
import type { Arena, Brick } from "../src/types";
import type { MaterialKind } from "../src/config";
import { materialOf } from "../src/materials";
import { collectCascade, REGROWTH_INTERVAL, stepMembranes, stepRegrowth } from "../src/arenaRules";

function arenaWith(bricks: Brick[]): Arena {
  const container = new Container();
  return {
    origin: { x: 10, y: 10 }, angle: 0, width: 7, depth: 8,
    province: "karst", ecotone: null, band: 1,
    bricks, balls: [], drops: [], membranes: [],
    regrowthBudget: 0, regrowthTimer: 0,
    resourceCount: 0, collected: 0, combo: 0,
    splitArmed: false, splitUsed: false, serveAim: 0, initialLiability: bricks.length, damageTaken: 0,
    spareBalls: 0,
    paddle: { u: 0, velocity: 0, width: 3.1, flash: 0, impact: 0 },
    container, board: new Container(), actors: new Container(), resolving: false, visualAge: 0,
  };
}

function brick(u: number, v: number, kind: MaterialKind = "chalk", facetAxis: 1 | -1 = 1): Brick {
  const definition = materialOf(kind);
  return {
    u, v, x: 0, y: 0, hp: definition.hp, maxHp: definition.hp, kind,
    resource: null, facetAxis,
    alive: true, persistent: false, worked: false, liable: definition.liable,
    footprint: { center: { x: u, y: v }, halfWidth: 0.5, halfHeight: 0.5, angle: 0 }, sourceCells: [], hitFlash: 0,
  };
}

describe("rounded brick collision", () => {
  it("returns a radial normal for a genuine corner contact", () => {
    const hit = sweepRoundedRect(-1.2, -1.2, 1, 1, 0, 0, 0.42, 0.42, 0.14, 0.255);
    expect(hit).not.toBeNull();
    expect(hit!.nx).toBeLessThan(-0.6);
    expect(hit!.ny).toBeLessThan(-0.6);
    expect(Math.hypot(hit!.nx, hit!.ny)).toBeCloseTo(1, 6);
  });

  it("reports both bricks at an exact seam and reflects once", () => {
    const bricks = [brick(-0.42, 3), brick(0.42, 3)];
    const arena = arenaWith(bricks);
    const ball = createBall(0, 2);
    ball.served = true;
    ball.vu = 0;
    ball.vv = BALL_SPEED;
    let contacts: Brick[] = [];
    stepBall(ball, arena, 0.12, (events) => { contacts = events.bricks; });
    expect(contacts).toHaveLength(2);
    expect(ball.vu).toBeCloseTo(0, 6);
    expect(ball.vv).toBeLessThan(0);
    expect(Math.hypot(ball.vu, ball.vv)).toBeCloseTo(BALL_SPEED, 6);
  });
});

describe("claim liability", () => {
  it("absorbs the chassis allowance before applying one damage per remaining brick", () => {
    expect(calculateClaimDamage(18, 24)).toBe(0);
    expect(calculateClaimDamage(29, 24)).toBe(5);
  });
});

describe("material contact rules", () => {
  it("turns the ball at a right angle off a facet plane", () => {
    // A facet is a mirror on a fixed diagonal, so an axis-aligned approach must
    // leave along the perpendicular axis rather than simply reversing.
    const arena = arenaWith([brick(0, 3, "facet", 1)]);
    const ball = createBall(0, 2);
    ball.served = true;
    ball.vu = 0;
    ball.vv = BALL_SPEED;
    let faceted = false;
    stepBall(ball, arena, 0.12, (events) => { if (events.faceted) faceted = true; });
    expect(faceted).toBe(true);
    // Incoming +v becomes outgoing -u (or +u for the opposite axis): a 90° turn.
    expect(Math.abs(ball.vu)).toBeCloseTo(BALL_SPEED, 4);
    expect(Math.abs(ball.vv)).toBeLessThan(BALL_SPEED * 0.01);
  });

  it("mirrors the opposite way on the opposite lattice axis", () => {
    const a = arenaWith([brick(0, 3, "facet", 1)]);
    const b = arenaWith([brick(0, 3, "facet", -1)]);
    const make = () => {
      const ball = createBall(0, 2);
      ball.served = true;
      ball.vu = 0;
      ball.vv = BALL_SPEED;
      return ball;
    };
    const ballA = make();
    const ballB = make();
    stepBall(ballA, a, 0.12, () => {});
    stepBall(ballB, b, 0.12, () => {});
    // Orientation decides which way the cascade runs. Same approach, opposite exit.
    expect(Math.sign(ballA.vu)).toBe(-Math.sign(ballB.vu));
  });

  it("reflects normally off non-facet stone", () => {
    const arena = arenaWith([brick(0, 3, "chalk")]);
    const ball = createBall(0, 2);
    ball.served = true;
    ball.vu = 0;
    ball.vv = BALL_SPEED;
    let faceted = false;
    stepBall(ball, arena, 0.12, (events) => { if (events.faceted) faceted = true; });
    expect(faceted).toBe(false);
    expect(ball.vv).toBeLessThan(0);
  });

  it("treats slate as durable and free to leave standing", () => {
    const slate = brick(0, 3, "slate");
    expect(slate.hp).toBe(4);
    expect(slate.liable).toBe(false);
    const chalk = brick(0, 3, "chalk");
    expect(chalk.hp).toBe(1);
    expect(chalk.liable).toBe(true);
    // Twelve surviving bricks of which eight are slate cost only four load.
    const arena = arenaWith([...Array.from({ length: 8 }, (_, i) => brick(i, 3, "slate")),
      ...Array.from({ length: 4 }, (_, i) => brick(i, 4, "chalk"))]);
    const liable = arena.bricks.filter((b) => b.liable).length;
    expect(arena.bricks).toHaveLength(12);
    expect(liable).toBe(4);
    expect(calculateClaimDamage(liable, 0)).toBe(4);
  });

  it("rebounds off a spore membrane without destroying it", () => {
    const arena = arenaWith([]);
    arena.membranes.push({ u: 0, v: 3, halfWidth: 0.65, halfHeight: 0.14, life: 4, maxLife: 4 });
    const ball = createBall(0, 2);
    ball.served = true;
    ball.vu = 0;
    ball.vv = BALL_SPEED;
    let hit: number = 0;
    stepBall(ball, arena, 0.12, (events) => { hit += events.membranes.length; });
    expect(hit).toBeGreaterThan(0);
    expect(ball.vv).toBeLessThan(0);
    expect(arena.membranes).toHaveLength(1);
  });
});

describe("bounded province rules", () => {
  it("cascades charged crystal into adjacent crystal, depth-limited", () => {
    const bricks = [
      brick(0, 3, "chargedFacet"),
      brick(1, 3, "chargedFacet"),
      brick(2, 3, "facet"),
      brick(3, 3, "facet"),
      brick(6, 3, "facet"),
      brick(0, 4, "chalk"),
    ];
    const arena = arenaWith(bricks);
    const cascade = collectCascade(arena, bricks[0]);
    const kinds = cascade.map((b) => b.kind);
    // Adjacent crystal is caught; plain chalk and distant crystal are not.
    expect(kinds).toContain("chargedFacet");
    expect(kinds).toContain("facet");
    expect(cascade).not.toContain(bricks[5]);
    expect(cascade).not.toContain(bricks[4]);
  });

  it("does not cascade from uncharged crystal", () => {
    const bricks = [brick(0, 3, "facet"), brick(1, 3, "facet")];
    expect(collectCascade(arenaWith(bricks), bricks[0])).toHaveLength(0);
  });

  it("regrows living material on a bounded budget and never exceeds it", () => {
    const living = brick(0, 3, "living");
    const dead = brick(1, 3, "living");
    dead.alive = false;
    const arena = arenaWith([living, dead]);
    arena.regrowthBudget = 1;
    arena.regrowthTimer = REGROWTH_INTERVAL;
    const first = stepRegrowth(arena, 0.1);
    expect(first).toHaveLength(1);
    expect(dead.alive).toBe(true);
    // Regrown material carries no resource: the seam was already taken.
    expect(dead.resource).toBeNull();
    expect(arena.regrowthBudget).toBe(0);
    dead.alive = false;
    arena.regrowthTimer = REGROWTH_INTERVAL;
    expect(stepRegrowth(arena, 0.1)).toHaveLength(0);
  });

  it("never regrows over persistent structure", () => {
    const living = brick(0, 3, "living");
    const landmark = brick(1, 3, "mechanism");
    landmark.alive = false;
    landmark.persistent = true;
    const arena = arenaWith([living, landmark]);
    arena.regrowthBudget = 5;
    arena.regrowthTimer = REGROWTH_INTERVAL;
    expect(stepRegrowth(arena, 0.1)).toHaveLength(0);
    expect(landmark.alive).toBe(false);
  });

  it("expires membranes after their lifetime", () => {
    const arena = arenaWith([]);
    arena.membranes.push({ u: 0, v: 3, halfWidth: 0.6, halfHeight: 0.14, life: 0.2, maxLife: 4 });
    expect(stepMembranes(arena, 0.1)).toHaveLength(0);
    expect(stepMembranes(arena, 0.2)).toHaveLength(1);
    expect(arena.membranes).toHaveLength(0);
  });
});

describe("trajectory prediction", () => {
  it("stops at the first obstacle when no bounces are predicted", () => {
    const arena = arenaWith([brick(0, 4, "chalk")]);
    const ball = createBall(0, 1);
    ball.vu = 0;
    ball.vv = BALL_SPEED;
    const path = predictPath(arena, ball, 0);
    // Start point plus the contact point, and no further legs.
    expect(path).toHaveLength(2);
    expect(path[1].y).toBeLessThan(4);
    expect(path[1].y).toBeGreaterThan(3);
  });

  it("continues through rebounds once optics are fitted", () => {
    const arena = arenaWith([brick(0, 4, "chalk")]);
    const ball = createBall(0, 1);
    ball.vu = 0;
    ball.vv = BALL_SPEED;
    expect(predictPath(arena, ball, 2).length).toBeGreaterThan(predictPath(arena, ball, 0).length);
  });

  it("predicts the rail rebound on an empty board", () => {
    const arena = arenaWith([]);
    const ball = createBall(0, 2);
    ball.vu = BALL_SPEED * 0.7;
    ball.vv = BALL_SPEED * 0.7;
    const path = predictPath(arena, ball, 1);
    expect(path.length).toBeGreaterThanOrEqual(2);
    // The first contact is the right rail, inside the half-width.
    expect(path[1].x).toBeLessThanOrEqual(arena.width / 2);
    expect(path[1].x).toBeGreaterThan(0);
  });

  /**
   * The line must agree with the solver, or it is worse than no line: a predicted
   * path through Mirrorreef that ignored the 90-degree turn would mislead.
   */
  it("honours facet planes so the line cannot disagree with the solver", () => {
    const facetArena = arenaWith([brick(0, 4, "facet", 1)]);
    const plainArena = arenaWith([brick(0, 4, "chalk")]);
    const make = () => {
      const ball = createBall(0, 1);
      ball.vu = 0;
      ball.vv = BALL_SPEED;
      return ball;
    };
    const faceted = predictPath(facetArena, make(), 1);
    const plain = predictPath(plainArena, make(), 1);
    const facetLeg = faceted[2];
    const plainLeg = plain[2];
    expect(facetLeg).toBeDefined();
    expect(plainLeg).toBeDefined();
    // A facet turns the ball sideways; plain stone sends it straight back down.
    expect(Math.abs(facetLeg.x - faceted[1].x)).toBeGreaterThan(1);
    expect(Math.abs(plainLeg.x - plain[1].x)).toBeLessThan(0.5);
  });

  it("returns a single point for a stationary ball", () => {
    const ball = createBall(0, 1);
    expect(predictPath(arenaWith([]), ball, 3)).toHaveLength(1);
  });
});

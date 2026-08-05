import { describe, expect, it } from "vitest";
import { Container } from "pixi.js";
import { BALL_SPEED } from "../src/config";
import { calculateClaimDamage } from "../src/claims";
import { ballSpeed, createBall, predictPath, stepBall, sweepRoundedRect } from "../src/physics";
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
    expect(ball.vv).toBeLessThan(0);
    // Not perfectly vertical, deliberately. A dead-vertical rally is a state the player cannot
    // break out of by playing well, so every non-facet reflection is clamped off both axes -- the
    // heading here is the minimum 12 degrees off vertical rather than the 0 physics would give.
    expect(Math.abs(ball.vu)).toBeCloseTo(BALL_SPEED * Math.sin(12 * Math.PI / 180), 4);
    expect(Math.hypot(ball.vu, ball.vv)).toBeCloseTo(BALL_SPEED, 6);
  });
});

describe("ball feel", () => {
  /**
   * The rules that separate a solver which is physically correct from one that plays well. Mirror
   * and renormalise permits two states the genre has refused since the arcade cabinets: a rally
   * skimming near-horizontally between the rails forever, and a dead-vertical column no amount of
   * skill breaks out of. Both were reachable here, and the vertical one was *guaranteed* -- catching
   * the ball dead centre produced exactly zero horizontal velocity.
   */
  const heading = (ball: { vu: number; vv: number }) =>
    Math.abs(Math.atan2(Math.abs(ball.vv), Math.abs(ball.vu))) * 180 / Math.PI;

  it("never lets a reflection travel near-horizontally", () => {
    const arena = arenaWith([brick(0, 3)]);
    // Aimed almost flat at a side rail, which is how a stalled rally starts.
    for (const flat of [0.5, 0.1, 0.02, 0]) {
      const ball = createBall(2.5, 3);
      ball.served = true;
      ball.vu = BALL_SPEED * Math.cos(flat * 0.02);
      ball.vv = BALL_SPEED * Math.sin(flat * 0.02);
      stepBall(ball, arena, 0.2, () => {});
      expect(heading(ball), `heading ${heading(ball).toFixed(1)} deg off horizontal`)
        .toBeGreaterThanOrEqual(22 - 1e-6);
    }
  });

  it("never lets the paddle return a perfectly vertical ball", () => {
    // Dead centre. This is the case that used to give vu exactly 0.
    const arena = arenaWith([]);
    const ball = createBall(0, 0.9);
    ball.served = true;
    ball.vu = 0;
    ball.vv = -BALL_SPEED;
    stepBall(ball, arena, 0.2, () => {});
    expect(ball.vv).toBeGreaterThan(0);
    expect(heading(ball)).toBeLessThanOrEqual(90 - 12 + 1e-6);
    expect(Math.abs(ball.vu)).toBeGreaterThan(0.1);
  });

  it("keeps speed exactly through every rebound", () => {
    const arena = arenaWith([brick(0, 3), brick(1, 3), brick(-1, 3)]);
    const ball = createBall(0.2, 2);
    ball.served = true;
    ball.vu = BALL_SPEED * 0.4;
    ball.vv = Math.sqrt(BALL_SPEED ** 2 - (BALL_SPEED * 0.4) ** 2);
    for (let step = 0; step < 40; step++) {
      stepBall(ball, arena, 1 / 120, () => {});
      const speed = Math.hypot(ball.vu, ball.vv);
      // The claim's ramp raises speed as bricks clear, so the bound is the ramped ceiling.
      expect(speed).toBeGreaterThan(BALL_SPEED * 0.99);
      expect(speed).toBeLessThan(BALL_SPEED * 1.46);
    }
  });

  it("speeds the ball up as the claim clears, and not before", () => {
    const bricks = [brick(0, 3), brick(1, 3), brick(-1, 3), brick(2, 3)];
    const arena = arenaWith(bricks);
    expect(ballSpeed(arena)).toBeCloseTo(BALL_SPEED, 6);
    for (const dead of bricks.slice(0, 2)) dead.alive = false;
    expect(ballSpeed(arena)).toBeGreaterThan(BALL_SPEED);
    for (const dead of bricks) dead.alive = false;
    expect(ballSpeed(arena)).toBeCloseTo(BALL_SPEED * 1.45, 6);
  });

  it("gives the paddle a curve, so the middle is forgiving and the edges bite", () => {
    // A linear face responds identically everywhere, which reads as mushy. The curve means a small
    // offset near the centre barely turns the ball while the same offset near the edge turns it a
    // lot -- which is what makes the paddle feel like an instrument.
    const outgoing = (offset: number) => {
      const arena = arenaWith([]);
      const ball = createBall(offset, 0.9);
      ball.served = true;
      ball.vu = 0;
      ball.vv = -BALL_SPEED;
      stepBall(ball, arena, 0.2, () => {});
      return Math.abs(ball.vu);
    };
    const width = 3.1 / 2;
    const nearCentre = outgoing(width * 0.25) - outgoing(0);
    const nearEdge = outgoing(width * 1.0) - outgoing(width * 0.75);
    expect(nearEdge).toBeGreaterThan(nearCentre * 2);
  });

  it("presents a row of bricks as one wall, not a line of lumps", () => {
    // Each brick is an independent rounded rect, so without seam handling a ball skimming along a
    // wall catches on the little arcs *between* bricks and scatters off interior corners that are
    // not surfaces. Grazing along the underside of a row must come off the flat face.
    const arena = arenaWith([brick(-1, 3), brick(0, 3), brick(1, 3), brick(2, 3)]);
    const ball = createBall(-1.5, 3 - 0.42 - 0.26);
    ball.served = true;
    ball.vu = BALL_SPEED * 0.985;
    ball.vv = BALL_SPEED * 0.17;
    const normals: Array<{ nx: number; ny: number }> = [];
    for (let step = 0; step < 60; step++) {
      const before = { vu: ball.vu, vv: ball.vv };
      stepBall(ball, arena, 1 / 240, () => {});
      if (before.vu !== ball.vu || before.vv !== ball.vv) normals.push({ nx: ball.vu, ny: ball.vv });
    }
    // It may bounce off the flat underside, but it must never be thrown backwards by a seam.
    for (const after of normals) {
      expect(after.nx, "a seam reversed the ball along the wall").toBeGreaterThan(0);
    }
  });

  it("pushes an overlapping ball out sideways rather than reversing it", () => {
    // The embedded case used to return the negated velocity as its normal, which reversed the ball
    // on the spot and read as a phantom bounce out of nowhere.
    const hit = sweepRoundedRect(0.3, 3, 0.1, 0, 0, 3, 0.42, 0.42, 0.14, 0.255);
    expect(hit).not.toBeNull();
    expect(hit!.t).toBe(0);
    expect(Math.abs(hit!.nx)).toBe(1);
    expect(hit!.ny).toBe(0);
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

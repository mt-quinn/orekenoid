// Transient world-space effects: material shards and impact rings.
//
// These are deliberately not part of the arena. An arena is destroyed when a claim
// resolves, but its last shards and rings should keep flying through the exit
// camera move, so they live on a layer that outlives it.

import { Container, Graphics } from "pixi.js";

interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; maxLife: number; graphic: Graphics;
  /**
   * Comes to rest instead of vanishing.
   *
   * Permanence, in the screenshake talk's sense: "why leave the battle empty after it's over?" A
   * claim the player has worked should show it. Settled debris is cleared when the next claim is
   * framed, not on a timer.
   */
  settles?: boolean;
  /** Drifts and fades rather than falling: dust rather than rock. */
  floats?: boolean;
}

interface Ring {
  radius: number; speed: number;
  life: number; maxLife: number; color: number; graphic: Graphics;
}

export class Effects {
  private readonly particles: Particle[] = [];
  private readonly rings: Ring[] = [];
  /** Debris and scorch that stay put. Held separately so one call can sweep the board. */
  private readonly settled: Graphics[] = [];

  constructor(readonly layer: Container) {}

  get count(): number {
    return this.particles.length + this.rings.length + this.settled.length;
  }

  /** Wipe what has come to rest. Called when a claim is framed, never on a timer. */
  clearSettled(): void {
    for (const graphic of this.settled) graphic.destroy();
    this.settled.length = 0;
  }

  /**
   * A burst of material shards at a world pixel position.
   *
   * Shards are irregular quads rather than dots so broken rock reads as rock. The
   * colour comes from the material's own edge, which is what ties the shard to the
   * brick it came from without a label.
   */
  spawnShards(x: number, y: number, colour: number, count: number, force = 1, settles = false): void {
    for (let index = 0; index < count; index++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = (70 + Math.random() * 140) * force;
      const shard = (2 + Math.random() * 4) * (0.8 + force * 0.3);
      const graphic = new Graphics()
        .poly([-shard, -1, shard * 0.7, -shard * 0.55, shard, 1.2, -shard * 0.3, shard * 0.65])
        .fill(colour);
      graphic.position.set(x, y);
      this.layer.addChild(graphic);
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.35 + Math.random() * 0.35,
        maxLife: 0.7,
        graphic,
        settles,
      });
    }
  }

  /**
   * Slow drifting dust. Reads as the air of a broken thing rather than as its pieces.
   *
   * Separate from shards because they answer different questions: shards say "that was rock", dust
   * says "that just happened here" and lingers a beat longer than the impact it came from.
   */
  spawnDust(x: number, y: number, colour: number, count: number, force = 1): void {
    for (let index = 0; index < count; index++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = (14 + Math.random() * 30) * force;
      const size = 3 + Math.random() * 7;
      const graphic = new Graphics().circle(0, 0, size).fill({ color: colour, alpha: 0.2 });
      graphic.position.set(x, y);
      this.layer.addChild(graphic);
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 12,
        life: 0.6 + Math.random() * 0.7,
        maxLife: 1.3,
        graphic,
        floats: true,
      });
    }
  }

  /**
   * A permanent mark where something was destroyed.
   *
   * The board keeps a record of the work done on it, so crossing a cleared region later shows what
   * happened there instead of clean empty space.
   */
  scorch(x: number, y: number, colour: number, radius: number): void {
    const graphic = new Graphics();
    for (let ring = 3; ring >= 1; ring--) {
      graphic.circle(0, 0, radius * (ring / 3)).fill({ color: colour, alpha: 0.09 * ring });
    }
    graphic.position.set(x, y);
    graphic.rotation = Math.random() * Math.PI;
    // Behind everything else on the layer, so debris and rings read on top of it.
    this.layer.addChildAt(graphic, 0);
    this.settled.push(graphic);
  }

  /** An expanding ring. `strength` scales both how fast and how long it travels. */
  spawnRing(x: number, y: number, colour: number, strength: number): void {
    const graphic = new Graphics();
    graphic.position.set(x, y);
    this.layer.addChild(graphic);
    this.rings.push({
      radius: 4,
      speed: 90 + strength * 70,
      life: 0.3 + strength * 0.16,
      maxLife: 0.48,
      color: colour,
      graphic,
    });
  }

  update(dt: number): void {
    for (let index = this.particles.length - 1; index >= 0; index--) {
      const particle = this.particles[index];
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      if (particle.floats) {
        // Dust: almost no drag, no gravity, and it swells slightly as it thins out.
        particle.vx *= Math.pow(0.5, dt);
        particle.vy *= Math.pow(0.5, dt);
        particle.graphic.scale.set(1 + (1 - particle.life / particle.maxLife) * 0.7);
      } else if (particle.settles) {
        // Debris that will come to rest gets almost no gravity and very heavy drag, so it stops
        // near the rock it came out of. World gravity would be wrong here: a claim can be framed at
        // any angle, so "down" in the world is not down on the board, and settled pieces would
        // slide off the board entirely on a rotated claim -- which is exactly what they did.
        particle.vx *= Math.pow(0.02, dt);
        particle.vy *= Math.pow(0.02, dt);
      } else {
        // Heavy horizontal drag plus a little gravity: shards fall like rock chips
        // rather than drifting like sparks.
        particle.vx *= Math.pow(0.1, dt);
        particle.vy = particle.vy * Math.pow(0.12, dt) + 44 * dt;
      }
      particle.life -= dt;
      particle.graphic.position.set(particle.x, particle.y);
      particle.graphic.alpha = Math.max(0, particle.life / particle.maxLife);
      if (particle.life <= 0) {
        if (particle.settles) {
          // Comes to rest rather than disappearing. Dimmed, because settled debris is scenery and
          // must never compete with the live ball for attention.
          particle.graphic.alpha = 0.34;
          this.settled.push(particle.graphic);
        } else {
          particle.graphic.destroy();
        }
        this.particles.splice(index, 1);
      }
    }
    for (let index = this.rings.length - 1; index >= 0; index--) {
      const ring = this.rings[index];
      ring.radius += ring.speed * dt;
      ring.life -= dt;
      ring.graphic.clear()
        .circle(0, 0, ring.radius)
        .stroke({ width: 2.5, color: ring.color, alpha: Math.max(0, ring.life / ring.maxLife) });
      if (ring.life <= 0) {
        ring.graphic.destroy();
        this.rings.splice(index, 1);
      }
    }
  }
}

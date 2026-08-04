// Transient world-space effects: material shards and impact rings.
//
// These are deliberately not part of the arena. An arena is destroyed when a claim
// resolves, but its last shards and rings should keep flying through the exit
// camera move, so they live on a layer that outlives it.

import { Container, Graphics } from "pixi.js";

interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; maxLife: number; graphic: Graphics;
}

interface Ring {
  radius: number; speed: number;
  life: number; maxLife: number; color: number; graphic: Graphics;
}

export class Effects {
  private readonly particles: Particle[] = [];
  private readonly rings: Ring[] = [];

  constructor(readonly layer: Container) {}

  get count(): number {
    return this.particles.length + this.rings.length;
  }

  /**
   * A burst of material shards at a world pixel position.
   *
   * Shards are irregular quads rather than dots so broken rock reads as rock. The
   * colour comes from the material's own edge, which is what ties the shard to the
   * brick it came from without a label.
   */
  spawnShards(x: number, y: number, colour: number, count: number): void {
    for (let index = 0; index < count; index++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 70 + Math.random() * 140;
      const shard = 2 + Math.random() * 4;
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
      });
    }
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
      // Heavy horizontal drag plus a little gravity: shards fall like rock chips
      // rather than drifting like sparks.
      particle.vx *= Math.pow(0.1, dt);
      particle.vy = particle.vy * Math.pow(0.12, dt) + 44 * dt;
      particle.life -= dt;
      particle.graphic.position.set(particle.x, particle.y);
      particle.graphic.alpha = Math.max(0, particle.life / particle.maxLife);
      if (particle.life <= 0) {
        particle.graphic.destroy();
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

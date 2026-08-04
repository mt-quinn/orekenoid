// Resource inventory and the crafting chain.
//
// Two rules from PROGRESSION_AND_ECONOMY.md are enforced structurally here rather
// than by convention:
//   - Crafting produces capacity, never verbs. Nothing in this file grants Survey
//     Resonance, sequential balls or the rail seed.
//   - Crafting may sharpen a verb but never grant one, so a recipe may declare a
//     `requiresVerb` prerequisite that no amount of material can substitute for.

import { FABRICATED_CHASSIS, type PaddleChassis, type ResourceId } from "./config";

export type VerbId = "surveyResonance" | "sequentialBall" | "railSeed";

export type RecipeEffect =
  | { type: "armor"; amount: number }
  | { type: "maxIntegrity"; amount: number }
  | { type: "repair"; amount: number }
  | { type: "paddleSpeedPercent"; amount: number }
  | { type: "paddleWidth"; amount: number }
  | { type: "travelSpeedPercent"; amount: number }
  | { type: "rotationPercent"; amount: number }
  | { type: "sharpenResonance"; amount: number }
  | { type: "blastCharges"; amount: number }
  | { type: "vacuum"; amount: number }
  | { type: "predictBounces"; amount: number }
  | { type: "fabricate"; chassisId: string };

export interface Recipe {
  id: string;
  name: string;
  tier: 1 | 2 | 3;
  cost: Partial<Record<ResourceId, number>>;
  effect: RecipeEffect;
  /** Maximum times this recipe may be crafted. Undefined means unlimited. */
  limit?: number;
  /** Each repeat multiplies the cost by this factor. */
  costGrowth?: number;
  /** Replaces another module rather than stacking with it. */
  replaces?: string;
  /** A verb that must already be earned. Material cannot substitute for it. */
  requiresVerb?: VerbId;
  detail: string;
}

export const RECIPES: readonly Recipe[] = [
  // --- Tier 1: Field Forge ----------------------------------------------
  {
    id: "copperPlate",
    name: "Copper Plate",
    tier: 1,
    cost: { copper: 10, coal: 4 },
    effect: { type: "armor", amount: 3 },
    limit: 3,
    costGrowth: 1.5,
    detail: "+3 armor",
  },
  {
    id: "ironPlate",
    name: "Iron Plate",
    tier: 1,
    cost: { iron: 12, coal: 6 },
    effect: { type: "armor", amount: 5 },
    limit: 3,
    costGrowth: 1.5,
    detail: "+5 armor",
  },
  {
    id: "hullPatch",
    name: "Hull Patch",
    tier: 1,
    cost: { copper: 6, coal: 2 },
    effect: { type: "repair", amount: 10 },
    detail: "restore 10 health",
  },
  {
    id: "hullExtension",
    name: "Hull Extension",
    tier: 1,
    cost: { iron: 14, coal: 6 },
    effect: { type: "maxIntegrity", amount: 6 },
    limit: 3,
    costGrowth: 1.4,
    detail: "+6 max health",
  },

  {
    id: "collectorCoil",
    name: "Collector Coil",
    tier: 1,
    cost: { copper: 12, coal: 5 },
    effect: { type: "vacuum", amount: 1.1 },
    limit: 2,
    costGrowth: 1.6,
    detail: "wider ore pull",
  },

  // --- Tier 2: Machined Modules ------------------------------------------
  {
    id: "emitterCoil",
    name: "Emitter Coil",
    tier: 2,
    cost: { cobalt: 10, sapphire: 4, coal: 4 },
    effect: { type: "paddleSpeedPercent", amount: 12 },
    limit: 1,
    detail: "+12% paddle speed",
  },
  {
    id: "driveTune",
    name: "Drive Tune",
    tier: 2,
    cost: { cobalt: 8, sapphire: 3, coal: 4 },
    effect: { type: "travelSpeedPercent", amount: 15 },
    limit: 1,
    detail: "+15% travel speed",
  },
  {
    id: "broadEmitter",
    name: "Broad Emitter",
    tier: 2,
    cost: { cobalt: 12, coal: 6 },
    effect: { type: "paddleWidth", amount: 0.4 },
    limit: 1,
    detail: "+0.4 paddle width",
  },
  {
    id: "gimbal",
    name: "Gimbal",
    tier: 2,
    cost: { cobalt: 8, emerald: 4, coal: 3 },
    effect: { type: "rotationPercent", amount: 25 },
    limit: 1,
    detail: "+25% survey rotation",
  },
  {
    id: "rubyEmitter",
    name: "Ruby Emitter",
    tier: 2,
    cost: { cobalt: 14, ruby: 6, coal: 8 },
    effect: { type: "paddleSpeedPercent", amount: 20 },
    limit: 1,
    replaces: "emitterCoil",
    detail: "+20% paddle speed, replaces Emitter Coil",
  },
  {
    id: "resonantLens",
    name: "Resonant Lens",
    tier: 2,
    cost: { cobalt: 10, diamond: 5, coal: 6 },
    effect: { type: "sharpenResonance", amount: 1 },
    limit: 1,
    requiresVerb: "surveyResonance",
    detail: "one extra grade of survey precision",
  },
  {
    id: "trajectoryOptics",
    name: "Trajectory Optics",
    tier: 2,
    cost: { cobalt: 10, emerald: 5, coal: 5 },
    effect: { type: "predictBounces", amount: 1 },
    limit: 1,
    detail: "trajectory line predicts 1 rebound",
  },
  {
    id: "deepOptics",
    name: "Deep Optics",
    tier: 2,
    cost: { cobalt: 14, ruby: 7, coal: 9 },
    effect: { type: "predictBounces", amount: 3 },
    limit: 1,
    replaces: "trajectoryOptics",
    detail: "predicts 3 rebounds, replaces Trajectory Optics",
  },
  {
    id: "fieldCollector",
    name: "Field Collector",
    tier: 2,
    cost: { cobalt: 12, emerald: 4, coal: 6 },
    effect: { type: "vacuum", amount: 2.1 },
    limit: 1,
    detail: "much wider ore pull",
  },
  {
    id: "cobaltPlate",
    name: "Cobalt Plate",
    tier: 2,
    cost: { cobalt: 16, coal: 8 },
    effect: { type: "armor", amount: 8 },
    limit: 2,
    costGrowth: 1.4,
    detail: "+8 armor",
  },
  {
    id: "mithrilPlate",
    name: "Mithril Plate",
    tier: 2,
    cost: { mithril: 14, coal: 10 },
    effect: { type: "armor", amount: 12 },
    limit: 2,
    costGrowth: 1.4,
    detail: "+12 armor",
  },
  {
    id: "blastCharge",
    name: "Blast Charge",
    tier: 2,
    cost: { saltpeter: 6, sulfur: 6, coal: 4 },
    effect: { type: "blastCharges", amount: 3 },
    detail: "3 charges: detonate surviving bricks",
  },

  // --- Tier 3: Chassis Fabrication ---------------------------------------
  {
    id: "fabricateLantern",
    name: "Fabricate Lantern",
    tier: 3,
    cost: { adamantite: 18, diamond: 10, coal: 12 },
    effect: { type: "fabricate", chassisId: "lantern" },
    limit: 1,
    detail: "9x19 deep shaft frame",
  },
  {
    id: "fabricateWeir",
    name: "Fabricate Weir",
    tier: 3,
    cost: { adamantite: 18, saltpeter: 10, coal: 12 },
    effect: { type: "fabricate", chassisId: "weir" },
    limit: 1,
    detail: "19x9 cavern-wall frame",
  },
  {
    id: "fabricatePrismatic",
    name: "Fabricate Prismatic",
    tier: 3,
    cost: { runite: 22, vitriol: 12, coal: 16 },
    effect: { type: "fabricate", chassisId: "prismatic" },
    limit: 1,
    detail: "13x13 lattice-aligned frame",
  },
  {
    id: "runitePlate",
    name: "Runite Plate",
    tier: 3,
    cost: { runite: 16, coal: 12 },
    effect: { type: "armor", amount: 18 },
    limit: 1,
    detail: "+18 armor",
  },
];

export const RECIPES_BY_ID = new Map(RECIPES.map((recipe) => [recipe.id, recipe]));

/** Blast charge detonation cap. Flagged in the doc as a tuning guess. */
export const BLAST_CHARGE_BRICKS = 8;

export interface ChassisUpgrades {
  armor: number;
  maxIntegrity: number;
  paddleSpeedPercent: number;
  paddleWidth: number;
  travelSpeedPercent: number;
  rotationPercent: number;
  /** Extra collection radius, in cells, on top of the drone's innate pull. */
  vacuum: number;
  /** How many rebounds the trajectory line predicts. Zero means the current leg only. */
  predictBounces: number;
}

const emptyUpgrades = (): ChassisUpgrades => ({
  armor: 0,
  maxIntegrity: 0,
  paddleSpeedPercent: 0,
  paddleWidth: 0,
  travelSpeedPercent: 0,
  rotationPercent: 0,
  vacuum: 0,
  predictBounces: 0,
});

export interface CraftResult {
  ok: boolean;
  reason?: string;
  recipe?: Recipe;
}

/**
 * The player's material holdings, crafted state, and per-chassis modules.
 *
 * Modules are stored per chassis and deliberately do not transfer. A fully
 * moduled Surveyor therefore stays competitive well past the point a Lantern is
 * fabricable: fabrication buys a different shape of claim, not a better one.
 */
export class Economy {
  /**
   * Carried material is at risk: it is lost on death.
   * Banked material is safe, and is the only pool crafting may draw from.
   * That split is the entire reason returning to the Landing has weight.
   */
  readonly resources = new Map<ResourceId, number>();
  readonly banked = new Map<ResourceId, number>();
  /** Craft counts keyed by `${chassisId}:${recipeId}` for per-chassis modules. */
  private readonly crafted = new Map<string, number>();
  private readonly upgradesByChassis = new Map<string, ChassisUpgrades>();
  readonly verbs = new Set<VerbId>();
  readonly fabricated = new Set<string>();
  resonanceGrades = 0;
  blastCharges = 0;
  totalSecured = 0;

  /** Banked holdings. Recipes are priced against this, never against cargo. */
  amount(resource: ResourceId): number {
    return this.banked.get(resource) ?? 0;
  }

  /** Cargo in hand, unbanked and therefore at risk. */
  carried(resource: ResourceId): number {
    return this.resources.get(resource) ?? 0;
  }

  get carriedTotal(): number {
    let total = 0;
    for (const count of this.resources.values()) total += count;
    return total;
  }

  add(resource: ResourceId, count = 1): void {
    this.resources.set(resource, this.carried(resource) + count);
    this.totalSecured += count;
  }

  /** Move everything in cargo into the bank. Returns how much was stored. */
  deposit(): number {
    let moved = 0;
    for (const [resource, count] of this.resources) {
      if (count <= 0) continue;
      this.banked.set(resource, this.amount(resource) + count);
      moved += count;
    }
    this.resources.clear();
    return moved;
  }

  /** Death empties cargo. Banked material and crafted capacity both survive. */
  loseCarried(): number {
    const lost = this.carriedTotal;
    this.resources.clear();
    return lost;
  }

  upgrades(chassisId: string): ChassisUpgrades {
    let existing = this.upgradesByChassis.get(chassisId);
    if (!existing) {
      existing = emptyUpgrades();
      this.upgradesByChassis.set(chassisId, existing);
    }
    return existing;
  }

  craftCount(chassisId: string, recipeId: string): number {
    const recipe = RECIPES_BY_ID.get(recipeId);
    // Fabrication is global; modules and plate are per chassis.
    const key = recipe?.tier === 3 ? `*:${recipeId}` : `${chassisId}:${recipeId}`;
    return this.crafted.get(key) ?? 0;
  }

  /** Cost of the next craft, including repeat growth. */
  costOf(chassisId: string, recipe: Recipe): Partial<Record<ResourceId, number>> {
    const repeats = this.craftCount(chassisId, recipe.id);
    const growth = recipe.costGrowth ?? 1;
    const multiplier = Math.pow(growth, repeats);
    const scaled: Partial<Record<ResourceId, number>> = {};
    for (const [resource, count] of Object.entries(recipe.cost) as Array<[ResourceId, number]>) {
      scaled[resource] = Math.ceil(count * multiplier);
    }
    return scaled;
  }

  canCraft(chassisId: string, recipeId: string): CraftResult {
    const recipe = RECIPES_BY_ID.get(recipeId);
    if (!recipe) return { ok: false, reason: "UNKNOWN RECIPE" };
    if (recipe.requiresVerb && !this.verbs.has(recipe.requiresVerb)) {
      return { ok: false, reason: "REQUIRES A CAPABILITY NO MATERIAL CAN BUY", recipe };
    }
    if (recipe.limit !== undefined && this.craftCount(chassisId, recipeId) >= recipe.limit) {
      return { ok: false, reason: "AT LIMIT", recipe };
    }
    if (recipe.replaces && this.craftCount(chassisId, recipe.replaces) === 0) {
      return { ok: false, reason: `REQUIRES ${RECIPES_BY_ID.get(recipe.replaces)?.name ?? recipe.replaces}`, recipe };
    }
    const cost = this.costOf(chassisId, recipe);
    for (const [resource, count] of Object.entries(cost) as Array<[ResourceId, number]>) {
      if (this.amount(resource) < count) return { ok: false, reason: "INSUFFICIENT MATERIAL", recipe };
    }
    return { ok: true, recipe };
  }

  /**
   * Apply a recipe. Returns the effect for the caller to reflect in live state
   * (repair touches current integrity, which the economy does not own).
   */
  craft(chassisId: string, recipeId: string): CraftResult & { effect?: RecipeEffect } {
    const check = this.canCraft(chassisId, recipeId);
    if (!check.ok || !check.recipe) return check;
    const recipe = check.recipe;
    const cost = this.costOf(chassisId, recipe);
    // Spent from the bank, which is the same pool the recipe was priced against.
    for (const [resource, count] of Object.entries(cost) as Array<[ResourceId, number]>) {
      this.banked.set(resource, this.amount(resource) - count);
    }
    const key = recipe.tier === 3 ? `*:${recipeId}` : `${chassisId}:${recipeId}`;
    this.crafted.set(key, (this.crafted.get(key) ?? 0) + 1);

    const upgrades = this.upgrades(chassisId);
    const effect = recipe.effect;
    switch (effect.type) {
      case "armor":
        upgrades.armor += effect.amount;
        break;
      case "maxIntegrity":
        upgrades.maxIntegrity += effect.amount;
        break;
      case "paddleSpeedPercent":
        // A replacement module supersedes rather than stacks.
        if (recipe.replaces) {
          const replaced = RECIPES_BY_ID.get(recipe.replaces);
          if (replaced?.effect.type === "paddleSpeedPercent") upgrades.paddleSpeedPercent -= replaced.effect.amount;
        }
        upgrades.paddleSpeedPercent += effect.amount;
        break;
      case "paddleWidth":
        upgrades.paddleWidth += effect.amount;
        break;
      case "travelSpeedPercent":
        upgrades.travelSpeedPercent += effect.amount;
        break;
      case "rotationPercent":
        upgrades.rotationPercent += effect.amount;
        break;
      case "vacuum":
        upgrades.vacuum += effect.amount;
        break;
      case "predictBounces":
        // Optics supersede rather than stack: the better lens replaces the lesser.
        if (recipe.replaces) {
          const replaced = RECIPES_BY_ID.get(recipe.replaces);
          if (replaced?.effect.type === "predictBounces") upgrades.predictBounces -= replaced.effect.amount;
        }
        upgrades.predictBounces += effect.amount;
        break;
      case "sharpenResonance":
        this.resonanceGrades += effect.amount;
        break;
      case "blastCharges":
        this.blastCharges += effect.amount;
        break;
      case "fabricate":
        this.fabricated.add(effect.chassisId);
        break;
      case "repair":
        break;
    }
    return { ok: true, recipe, effect };
  }

  grantVerb(verb: VerbId): boolean {
    if (this.verbs.has(verb)) return false;
    this.verbs.add(verb);
    return true;
  }

  availableChassis(starters: readonly PaddleChassis[]): PaddleChassis[] {
    return [...starters, ...FABRICATED_CHASSIS.filter((chassis) => this.fabricated.has(chassis.id))];
  }

  /** Recipes worth showing: unlocked tier, and not already exhausted. */
  visibleRecipes(chassisId: string): Recipe[] {
    return RECIPES.filter((recipe) => {
      if (recipe.limit !== undefined && this.craftCount(chassisId, recipe.id) >= recipe.limit) return false;
      return true;
    });
  }

  /**
   * Everything a save needs. Crafted upgrades are stored as *both* the craft
   * counts and the resulting module totals, deliberately: replaying `craft()` to
   * rebuild the totals would charge the player for their own modules a second
   * time, and craft counts alone are what repeat-cost growth is priced against.
   */
  snapshot(): EconomySnapshot {
    return {
      resources: Object.fromEntries(this.resources) as Partial<Record<ResourceId, number>>,
      banked: Object.fromEntries(this.banked) as Partial<Record<ResourceId, number>>,
      crafted: Object.fromEntries(this.crafted),
      upgrades: Object.fromEntries([...this.upgradesByChassis].map(([id, value]) => [id, { ...value }])),
      verbs: [...this.verbs],
      fabricated: [...this.fabricated],
      resonanceGrades: this.resonanceGrades,
      blastCharges: this.blastCharges,
      totalSecured: this.totalSecured,
    };
  }

  restore(snapshot: EconomySnapshot): void {
    this.resources.clear();
    this.banked.clear();
    this.crafted.clear();
    this.upgradesByChassis.clear();
    this.verbs.clear();
    this.fabricated.clear();
    for (const [resource, count] of Object.entries(snapshot.resources ?? {})) {
      if (typeof count === "number") this.resources.set(resource as ResourceId, count);
    }
    for (const [resource, count] of Object.entries(snapshot.banked ?? {})) {
      if (typeof count === "number") this.banked.set(resource as ResourceId, count);
    }
    for (const [key, count] of Object.entries(snapshot.crafted ?? {})) {
      if (typeof count === "number") this.crafted.set(key, count);
    }
    for (const [chassisId, upgrades] of Object.entries(snapshot.upgrades ?? {})) {
      this.upgradesByChassis.set(chassisId, { ...emptyUpgrades(), ...upgrades });
    }
    for (const verb of snapshot.verbs ?? []) this.verbs.add(verb);
    for (const chassisId of snapshot.fabricated ?? []) this.fabricated.add(chassisId);
    this.resonanceGrades = snapshot.resonanceGrades ?? 0;
    this.blastCharges = snapshot.blastCharges ?? 0;
    this.totalSecured = snapshot.totalSecured ?? 0;
  }
}

export interface EconomySnapshot {
  resources: Partial<Record<ResourceId, number>>;
  banked: Partial<Record<ResourceId, number>>;
  crafted: Record<string, number>;
  upgrades: Record<string, ChassisUpgrades>;
  verbs: VerbId[];
  fabricated: string[];
  resonanceGrades: number;
  blastCharges: number;
  totalSecured: number;
}

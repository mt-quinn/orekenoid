// Resource inventory, and the machine's six stations.
//
// The drone is not a list of purchased modules. It is six places on a machine, each of which
// has a grade, and each of which only ever goes up. Feeding a station raises its grade; the
// part at that station gets physically bigger, and the stat it governs goes with it.
//
// That shape is deliberate and it replaced a flat list of twenty-one recipes. A list invites
// the player to optimise a build: which plate, how many, in what order, and is this one
// superseded by that one. Stations invite the player to look at their machine and point at the
// part they want bigger. Nothing is ever a trade, nothing is ever a regret, and there is no
// arrangement to get wrong -- which is why grades are *absolute* rather than additive below. A
// grade is a state the machine is in, not a purchase stacked on earlier purchases.
//
// Two rules from PROGRESSION_AND_ECONOMY.md are still enforced structurally:
//   - Upgrading produces capacity, never verbs. Nothing here grants Survey Resonance,
//     sequential balls or the rail seed.
//   - Upgrading may sharpen a verb but never grant one, so a grade may declare a
//     `requiresVerb` prerequisite that no amount of material can substitute for.

import { FABRICATED_CHASSIS, type PaddleChassis, type ResourceId } from "./config";

export type VerbId = "surveyResonance" | "sequentialBall" | "railSeed";

/**
 * The six places on the machine.
 *
 * Ordered as the player reads the drone: hull outward, then the working face, then the mast
 * above, then the gear hanging off it. The forge shows them in this order.
 */
export type StationId = "plating" | "frame" | "emitter" | "mast" | "salvage" | "rack";

export const STATION_IDS: readonly StationId[] = ["plating", "frame", "emitter", "mast", "salvage", "rack"];

/**
 * What the machine is capable of. Every field is derived by summing the current grade of each
 * station, so this object is a view of the machine rather than a running total of purchases.
 */
export interface ChassisStats {
  armor: number;
  maxIntegrity: number;
  paddleSpeedPercent: number;
  paddleWidth: number;
  travelSpeedPercent: number;
  rotationPercent: number;
  /**
   * Share of a rescued drop the salvage drone keeps for itself, 0..1. Zero means no drone.
   *
   * This replaced a collection *radius*, which was the same mechanic twice: a pull that dragged
   * drops toward the paddle and a drone that catches what the paddle misses both answer "I was
   * not in the right place". The drop-nudging is gone entirely, innate pull included, so drops
   * now fall straight and the paddle catches by being where they land.
   */
  salvageTax: number;
  /** How many rebounds the trajectory line predicts. Zero means the current leg only. */
  predictBounces: number;
  /** Blast charges carried per expedition. Refilled at the bay, never bought by the unit. */
  blastCapacity: number;
  /** Extra grades of survey precision. Only reachable once Survey Resonance is earned. */
  resonanceGrades: number;
}

/**
 * Stats where a smaller number is the better machine.
 *
 * The salvage tax is the first: 50% kept by the grinder is worse than 15%. Declared here rather
 * than special-cased wherever it comes up, because "which direction is better" is a property of
 * the stat and not of any one screen -- the grade-ladder check reads it, and so should anything
 * that ever renders an arrow between two values.
 *
 * Zero is a special case in the other direction: it means the part is absent, not perfect.
 */
export const LOWER_IS_BETTER: ReadonlySet<keyof ChassisStats> = new Set(["salvageTax"]);

/** Kept as an alias because the rest of the game asks the machine what it can do, not how. */
export type ChassisUpgrades = ChassisStats;

export const emptyStats = (): ChassisStats => ({
  armor: 0,
  maxIntegrity: 0,
  paddleSpeedPercent: 0,
  paddleWidth: 0,
  travelSpeedPercent: 0,
  rotationPercent: 0,
  salvageTax: 0,
  predictBounces: 0,
  blastCapacity: 0,
  resonanceGrades: 0,
});

export interface StationGrade {
  name: string;
  cost: Partial<Record<ResourceId, number>>;
  /**
   * What the machine has *at* this grade -- absolute, not added to the grade below.
   *
   * This is what removes the whole supersede-versus-stack problem the old recipe list had:
   * a Ruby Emitter no longer subtracts an Emitter Coil it replaced, it simply states what an
   * emitter at grade three is worth.
   */
  confers: Partial<ChassisStats>;
  /** A verb that must already be earned. Material cannot substitute for it. */
  requiresVerb?: VerbId;
  /**
   * What this grade does, literally, as a transition. "ARMOR 20 -> 36", never "Layered cobalt.
   * Deep claims survivable." Absolute rather than a delta because a grade *is* a state, and
   * because seeing where the number lands is what the decision needs.
   */
  detail: string;
}

export interface Station {
  id: StationId;
  /** Shown as the station's heading in the bay. */
  name: string;
  /**
   * Where to look on the machine, and what the leader line in the bay points at.
   *
   * A location rather than a description. There used to be a `purpose` line here too -- "Soaks
   * the load a claim leaves standing" -- and it is gone: a player at the bay is asking what an
   * upgrade does and what it costs, and every other word on the card is in the way of that.
   */
  mount: string;
  grades: readonly StationGrade[];
}

/**
 * The six stations.
 *
 * The grade ladders are the old recipe list re-expressed, near enough one for one: the five
 * armour plates were always one station at five grades, and `rubyEmitter.replaces =
 * "emitterCoil"` was always grade three of the emitter. Material laddering follows the depth
 * bands, so a station's next grade is also a reason to go deeper.
 */
export const STATIONS: readonly Station[] = [
  {
    id: "plating",
    name: "HULL PLATING",
    mount: "flanks",
    grades: [
      {
        name: "Copper Plate",
        cost: { copper: 18, coal: 6 },
        confers: { armor: 8 },
        detail: "ARMOR 0 \u2192 8",
      },
      {
        name: "Iron Plate",
        cost: { iron: 24, coal: 10 },
        confers: { armor: 20 },
        detail: "ARMOR 8 \u2192 20",
      },
      {
        name: "Cobalt Plate",
        cost: { cobalt: 26, coal: 14 },
        confers: { armor: 36 },
        detail: "ARMOR 20 \u2192 36",
      },
      {
        name: "Mithril Plate",
        cost: { mithril: 28, coal: 18 },
        confers: { armor: 56 },
        detail: "ARMOR 36 \u2192 56",
      },
      {
        name: "Runite Plate",
        cost: { runite: 24, coal: 22 },
        confers: { armor: 80 },
        detail: "ARMOR 56 \u2192 80",
      },
    ],
  },
  {
    id: "frame",
    name: "FRAME",
    mount: "spine and thrusters",
    // Drive Tune folded in here rather than standing as a station of its own: one recipe is
    // not a ladder, and a stronger spine carrying bigger thrusters is one idea, not two.
    grades: [
      {
        name: "Reinforced Spine",
        cost: { iron: 14, coal: 6 },
        confers: { maxIntegrity: 6, travelSpeedPercent: 6 },
        detail: "MAX HEALTH 0 \u2192 +6   TRAVEL +6%",
      },
      {
        name: "Braced Spine",
        cost: { cobalt: 18, coal: 10 },
        confers: { maxIntegrity: 14, travelSpeedPercent: 15 },
        detail: "MAX HEALTH +6 \u2192 +14   TRAVEL +15%",
      },
      {
        name: "Truss Spine",
        cost: { mithril: 20, coal: 14 },
        confers: { maxIntegrity: 24, travelSpeedPercent: 25 },
        detail: "MAX HEALTH +14 \u2192 +24   TRAVEL +25%",
      },
    ],
  },
  {
    id: "emitter",
    name: "EMITTER",
    mount: "working face",
    grades: [
      {
        name: "Emitter Coil",
        cost: { cobalt: 10, sapphire: 4, coal: 4 },
        confers: { paddleSpeedPercent: 12 },
        detail: "PADDLE SPEED +12%   RECHARGE 2.6s",
      },
      {
        name: "Broad Emitter",
        cost: { cobalt: 14, coal: 6 },
        confers: { paddleSpeedPercent: 14, paddleWidth: 0.25 },
        detail: "PADDLE SPEED +14%   WIDTH +0.25   RECHARGE 2.1s",
      },
      {
        name: "Ruby Emitter",
        cost: { cobalt: 16, ruby: 6, coal: 8 },
        confers: { paddleSpeedPercent: 22, paddleWidth: 0.45 },
        detail: "PADDLE SPEED +22%   WIDTH +0.45   RECHARGE 1.6s",
      },
    ],
  },
  {
    id: "mast",
    name: "SURVEY MAST",
    mount: "above the hull",
    grades: [
      {
        name: "Gimbal",
        cost: { cobalt: 8, emerald: 4, coal: 3 },
        confers: { rotationPercent: 25 },
        detail: "SURVEY ROTATION +25%",
      },
      {
        name: "Trajectory Optics",
        cost: { cobalt: 10, emerald: 5, coal: 5 },
        confers: { rotationPercent: 25, predictBounces: 1 },
        detail: "ROTATION +25%   PREDICTS 1 BOUNCE",
      },
      {
        name: "Deep Optics",
        cost: { cobalt: 14, ruby: 7, coal: 9 },
        confers: { rotationPercent: 30, predictBounces: 3 },
        detail: "ROTATION +30%   PREDICTS 3 BOUNCES",
      },
      {
        // The one grade material cannot reach. Fitting a lens to a machine that cannot
        // resonate would be fitting a lens to a blind eye.
        name: "Resonant Lens",
        cost: { cobalt: 12, diamond: 5, coal: 6 },
        confers: { rotationPercent: 30, predictBounces: 3, resonanceGrades: 1 },
        requiresVerb: "surveyResonance",
        detail: "ROTATION +30%   SURVEY GRADE +1",
      },
    ],
  },
  {
    id: "salvage",
    name: "SALVAGE DRONE",
    mount: "below the paddle",
    grades: [
      {
        name: "Scavenger",
        cost: { copper: 12, coal: 5 },
        // The tax is the whole point: a drone that caught everything for free would delete the
        // reason to catch anything yourself. Half is steep enough that the paddle still matters.
        confers: { salvageTax: 0.5 },
        detail: "CATCHES MISSED ORE   KEEPS 50%",
      },
      {
        name: "Sorter",
        cost: { copper: 20, emerald: 3, coal: 8 },
        confers: { salvageTax: 0.3 },
        detail: "KEEPS 50% \u2192 30%",
      },
      {
        name: "Refiner",
        cost: { cobalt: 12, emerald: 5, coal: 10 },
        confers: { salvageTax: 0.15 },
        detail: "KEEPS 30% \u2192 15%",
      },
    ],
  },
  {
    id: "rack",
    name: "CHARGE RACK",
    mount: "hull rail",
    // Capacity rather than ammunition on purpose. Buying charges by the unit made the bay a
    // shop you restocked at, which is the kind of bookkeeping this game does not want. The
    // rack is a part of the machine; it refills itself when you come home.
    grades: [
      {
        name: "Charge Rack",
        cost: { saltpeter: 6, sulfur: 6, coal: 4 },
        confers: { blastCapacity: 2 },
        detail: "CHARGES 0 \u2192 2",
      },
      {
        name: "Twin Rack",
        cost: { saltpeter: 10, sulfur: 10, coal: 7 },
        confers: { blastCapacity: 4 },
        detail: "CHARGES 2 \u2192 4",
      },
      {
        name: "Bandolier",
        cost: { saltpeter: 14, sulfur: 14, coal: 11 },
        confers: { blastCapacity: 6 },
        detail: "CHARGES 4 \u2192 6",
      },
    ],
  },
];

export const STATIONS_BY_ID = new Map(STATIONS.map((station) => [station.id, station]));

/**
 * Hulls the fabrication berth can build.
 *
 * Not a station: this does not improve the machine you are standing next to, it builds a
 * different one. Each is gated on the reagent of a single ecotone, so a new hull is a journey
 * rather than a purchase.
 */
export interface Fabrication {
  chassisId: string;
  name: string;
  cost: Partial<Record<ResourceId, number>>;
  detail: string;
}

export const FABRICATIONS: readonly Fabrication[] = [
  {
    chassisId: "lantern",
    name: "Lantern",
    cost: { adamantite: 18, diamond: 10, coal: 12 },
    detail: "9x19 deep shaft frame",
  },
  {
    chassisId: "weir",
    name: "Weir",
    cost: { adamantite: 18, saltpeter: 10, coal: 12 },
    detail: "19x9 cavern-wall frame",
  },
  {
    chassisId: "prismatic",
    name: "Prismatic",
    cost: { runite: 22, vitriol: 12, coal: 16 },
    detail: "13x13 lattice-aligned frame",
  },
];

/** Blast charge detonation cap. Flagged in the doc as a tuning guess. */
export const BLAST_CHARGE_BRICKS = 8;

export interface UpgradeResult {
  ok: boolean;
  reason?: string;
  station?: Station;
  grade?: StationGrade;
  /** The grade number reached, one-based. */
  level?: number;
}

/** A chassis's grade per station. Absent means grade zero: nothing fitted there yet. */
export type StationGrades = Partial<Record<StationId, number>>;

/**
 * The player's material holdings and the state of every machine they own.
 *
 * Grades are stored per chassis and deliberately do not transfer. A fully built Surveyor
 * therefore stays competitive well past the point a Lantern is fabricable, and because a fresh
 * hull starts at grade zero everywhere, that fact is something the player can *see* -- the new
 * machine is visibly bare next to the veteran one.
 */
export class Economy {
  /**
   * Carried material is at risk: it is lost on death.
   * Banked material is safe, and is the only pool upgrades may draw from.
   * That split is the entire reason returning to the Landing has weight.
   */
  readonly resources = new Map<ResourceId, number>();
  readonly banked = new Map<ResourceId, number>();
  private readonly gradesByChassis = new Map<string, StationGrades>();
  readonly verbs = new Set<VerbId>();
  readonly fabricated = new Set<string>();
  /** Charges remaining this expedition. Refilled to the rack's capacity at the bay. */
  blastCharges = 0;
  totalSecured = 0;

  /** Banked holdings. Upgrades are priced against this, never against cargo. */
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

  /** Death empties cargo. Banked material and fitted grades both survive. */
  loseCarried(): number {
    const lost = this.carriedTotal;
    this.resources.clear();
    return lost;
  }

  // --- stations --------------------------------------------------------------

  private gradesFor(chassisId: string): StationGrades {
    let held = this.gradesByChassis.get(chassisId);
    if (!held) {
      held = {};
      this.gradesByChassis.set(chassisId, held);
    }
    return held;
  }

  /** How many grades this station has been raised. Zero means nothing is fitted there. */
  gradeOf(chassisId: string, station: StationId): number {
    return this.gradesFor(chassisId)[station] ?? 0;
  }

  /** What is currently fitted at this station, or null at grade zero. */
  fittedGrade(chassisId: string, station: StationId): StationGrade | null {
    const level = this.gradeOf(chassisId, station);
    return level > 0 ? STATIONS_BY_ID.get(station)!.grades[level - 1] : null;
  }

  /** What this station becomes next, or null when it is already at its top grade. */
  nextGrade(chassisId: string, station: StationId): StationGrade | null {
    const definition = STATIONS_BY_ID.get(station)!;
    return definition.grades[this.gradeOf(chassisId, station)] ?? null;
  }

  /**
   * The machine, as a set of numbers, summed across its stations.
   *
   * Recomputed rather than accumulated, which is the whole reason grades are absolute: there
   * is no running total to get out of step with the parts actually fitted.
   */
  upgrades(chassisId: string): ChassisStats {
    const stats = emptyStats();
    for (const station of STATION_IDS) {
      const grade = this.fittedGrade(chassisId, station);
      if (!grade) continue;
      for (const [key, value] of Object.entries(grade.confers) as Array<[keyof ChassisStats, number]>) {
        stats[key] += value;
      }
    }
    return stats;
  }

  /** Grades fitted on this machine, for the view layer to draw. */
  stationGrades(chassisId: string): StationGrades {
    return { ...this.gradesFor(chassisId) };
  }

  canUpgrade(chassisId: string, station: StationId): UpgradeResult {
    const definition = STATIONS_BY_ID.get(station);
    if (!definition) return { ok: false, reason: "UNKNOWN STATION" };
    const grade = this.nextGrade(chassisId, station);
    if (!grade) return { ok: false, reason: "FULLY BUILT", station: definition };
    if (grade.requiresVerb && !this.verbs.has(grade.requiresVerb)) {
      return { ok: false, reason: "REQUIRES A CAPABILITY NO MATERIAL CAN BUY", station: definition, grade };
    }
    for (const [resource, count] of Object.entries(grade.cost) as Array<[ResourceId, number]>) {
      if (this.amount(resource) < count) {
        return { ok: false, reason: "INSUFFICIENT MATERIAL", station: definition, grade };
      }
    }
    return { ok: true, station: definition, grade, level: this.gradeOf(chassisId, station) + 1 };
  }

  /** Raise one station by one grade. */
  upgrade(chassisId: string, station: StationId): UpgradeResult {
    const check = this.canUpgrade(chassisId, station);
    if (!check.ok || !check.grade) return check;
    // Spent from the bank, which is the same pool the grade was priced against.
    for (const [resource, count] of Object.entries(check.grade.cost) as Array<[ResourceId, number]>) {
      this.banked.set(resource, this.amount(resource) - count);
    }
    const grades = this.gradesFor(chassisId);
    grades[station] = (grades[station] ?? 0) + 1;
    // A bigger rack arrives full, so fitting one is immediately worth something.
    if (station === "rack") this.refillCharges(chassisId);
    return check;
  }

  // --- fabrication -----------------------------------------------------------

  canFabricate(chassisId: string): UpgradeResult {
    const entry = FABRICATIONS.find((candidate) => candidate.chassisId === chassisId);
    if (!entry) return { ok: false, reason: "UNKNOWN HULL" };
    if (this.fabricated.has(chassisId)) return { ok: false, reason: "ALREADY BUILT" };
    for (const [resource, count] of Object.entries(entry.cost) as Array<[ResourceId, number]>) {
      if (this.amount(resource) < count) return { ok: false, reason: "INSUFFICIENT MATERIAL" };
    }
    return { ok: true };
  }

  fabricate(chassisId: string): UpgradeResult {
    const check = this.canFabricate(chassisId);
    if (!check.ok) return check;
    const entry = FABRICATIONS.find((candidate) => candidate.chassisId === chassisId)!;
    for (const [resource, count] of Object.entries(entry.cost) as Array<[ResourceId, number]>) {
      this.banked.set(resource, this.amount(resource) - count);
    }
    this.fabricated.add(chassisId);
    return { ok: true };
  }

  // --- expedition state ------------------------------------------------------

  /** Charges come home full. There is nothing to buy and nothing to forget to buy. */
  refillCharges(chassisId: string): void {
    this.blastCharges = this.upgrades(chassisId).blastCapacity;
  }

  grantVerb(verb: VerbId): boolean {
    if (this.verbs.has(verb)) return false;
    this.verbs.add(verb);
    return true;
  }

  availableChassis(starters: readonly PaddleChassis[]): PaddleChassis[] {
    return [...starters, ...FABRICATED_CHASSIS.filter((chassis) => this.fabricated.has(chassis.id))];
  }

  /**
   * Everything a save needs.
   *
   * Grades alone are enough, which is the other quiet win of the station model: the old
   * snapshot had to store craft counts *and* the resulting module totals, because replaying
   * the crafts to rebuild the totals would have charged the player for their own modules a
   * second time. A grade is a state, so there is nothing to replay.
   */
  snapshot(): EconomySnapshot {
    return {
      resources: Object.fromEntries(this.resources) as Partial<Record<ResourceId, number>>,
      banked: Object.fromEntries(this.banked) as Partial<Record<ResourceId, number>>,
      grades: Object.fromEntries([...this.gradesByChassis].map(([id, value]) => [id, { ...value }])),
      verbs: [...this.verbs],
      fabricated: [...this.fabricated],
      blastCharges: this.blastCharges,
      totalSecured: this.totalSecured,
    };
  }

  restore(snapshot: EconomySnapshot): void {
    this.resources.clear();
    this.banked.clear();
    this.gradesByChassis.clear();
    this.verbs.clear();
    this.fabricated.clear();
    for (const [resource, count] of Object.entries(snapshot.resources ?? {})) {
      if (typeof count === "number") this.resources.set(resource as ResourceId, count);
    }
    for (const [resource, count] of Object.entries(snapshot.banked ?? {})) {
      if (typeof count === "number") this.banked.set(resource as ResourceId, count);
    }
    for (const [chassisId, grades] of Object.entries(snapshot.grades ?? {})) {
      const clamped: StationGrades = {};
      for (const station of STATION_IDS) {
        const level = grades[station];
        if (typeof level !== "number" || level <= 0) continue;
        // Clamped to the ladder that exists, so a save written against a longer ladder
        // degrades to the top grade rather than indexing off the end of it.
        clamped[station] = Math.min(Math.floor(level), STATIONS_BY_ID.get(station)!.grades.length);
      }
      this.gradesByChassis.set(chassisId, clamped);
    }
    for (const verb of snapshot.verbs ?? []) this.verbs.add(verb);
    for (const chassisId of snapshot.fabricated ?? []) this.fabricated.add(chassisId);
    this.blastCharges = snapshot.blastCharges ?? 0;
    this.totalSecured = snapshot.totalSecured ?? 0;
  }
}

export interface EconomySnapshot {
  resources: Partial<Record<ResourceId, number>>;
  banked: Partial<Record<ResourceId, number>>;
  grades: Record<string, StationGrades>;
  verbs: VerbId[];
  fabricated: string[];
  blastCharges: number;
  totalSecured: number;
}

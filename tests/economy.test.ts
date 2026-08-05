import { describe, expect, it } from "vitest";
import { Economy, FABRICATIONS, STATIONS, STATION_IDS, STATIONS_BY_ID } from "../src/economy";
import { PADDLE_CHASSIS, FABRICATED_CHASSIS } from "../src/config";

const SURVEYOR = "bx04-surveyor";
const ALL_ORE = ["copper", "iron", "cobalt", "mithril", "adamantite", "runite", "coal",
  "sapphire", "emerald", "ruby", "diamond", "sulfur", "saltpeter", "vitriol"] as const;

// Upgrades are priced against banked material, so test stock must be banked.
const stock = (economy: Economy, entries: Record<string, number>) => {
  for (const [resource, count] of Object.entries(entries)) economy.add(resource as never, count);
  economy.deposit();
};

const stockEverything = (economy: Economy, each = 999) =>
  stock(economy, Object.fromEntries(ALL_ORE.map((resource) => [resource, each])));

describe("the machine's stations", () => {
  it("starts every station at grade zero, with nothing fitted", () => {
    const economy = new Economy();
    for (const station of STATION_IDS) {
      expect(economy.gradeOf(SURVEYOR, station), station).toBe(0);
      expect(economy.fittedGrade(SURVEYOR, station), station).toBeNull();
      expect(economy.nextGrade(SURVEYOR, station), station).not.toBeNull();
    }
    expect(economy.upgrades(SURVEYOR).armor).toBe(0);
  });

  it("refuses a grade the player cannot afford, and fits it once they can", () => {
    const economy = new Economy();
    expect(economy.canUpgrade(SURVEYOR, "plating").ok).toBe(false);
    stock(economy, { copper: 18, coal: 6 });
    expect(economy.canUpgrade(SURVEYOR, "plating").ok).toBe(true);
    economy.upgrade(SURVEYOR, "plating");
    expect(economy.amount("copper")).toBe(0);
    expect(economy.amount("coal")).toBe(0);
    expect(economy.gradeOf(SURVEYOR, "plating")).toBe(1);
  });

  it("states a grade absolutely, so nothing stacks and nothing has to be subtracted", () => {
    // The whole reason grades replaced recipes. Under the old list, five armour plates were
    // five stackable purchases and a Ruby Emitter had to subtract the Emitter Coil it
    // superseded. A grade is a state: raising plating to 3 makes armour 36, not 8+20+36.
    const economy = new Economy();
    stockEverything(economy);
    economy.upgrade(SURVEYOR, "plating");
    expect(economy.upgrades(SURVEYOR).armor).toBe(8);
    economy.upgrade(SURVEYOR, "plating");
    expect(economy.upgrades(SURVEYOR).armor).toBe(20);
    economy.upgrade(SURVEYOR, "plating");
    expect(economy.upgrades(SURVEYOR).armor).toBe(36);
  });

  it("only ever goes up, and stops at the top of the ladder", () => {
    // Monotonic on purpose: no station can be lowered, swapped or refunded, so no fit is ever
    // a decision the player has to be able to reverse.
    const economy = new Economy();
    stockEverything(economy);
    // Granted so this test can reach the top of every ladder. The mast's last grade is gated on
    // Survey Resonance and correctly refuses without it, which is what the verb test covers.
    economy.grantVerb("surveyResonance");
    for (const station of STATION_IDS) {
      const ladder = STATIONS_BY_ID.get(station)!.grades.length;
      let previous = 0;
      for (let step = 0; step < ladder + 2; step++) {
        economy.upgrade(SURVEYOR, station);
        const level = economy.gradeOf(SURVEYOR, station);
        expect(level, station).toBeGreaterThanOrEqual(previous);
        previous = level;
      }
      expect(economy.gradeOf(SURVEYOR, station), station).toBe(ladder);
      expect(economy.canUpgrade(SURVEYOR, station).reason, station).toBe("FULLY BUILT");
    }
  });

  it("makes every grade a strict improvement on the one below it", () => {
    // A ladder that dipped anywhere would turn an upgrade into a trap, and the player has no
    // way to undo it.
    for (const station of STATIONS) {
      for (let at = 1; at < station.grades.length; at++) {
        const below = station.grades[at - 1].confers;
        const above = station.grades[at].confers;
        for (const [key, value] of Object.entries(below) as Array<[keyof typeof below, number]>) {
          expect(above[key] ?? 0, `${station.id} grade ${at + 1} regressed ${key}`)
            .toBeGreaterThanOrEqual(value);
        }
      }
    }
  });

  it("tops out near the armour the old stacked plates reached", () => {
    // The retune target: five grades instead of eleven separate plate crafts, landing in the
    // same place so the rest of the balance still holds.
    const economy = new Economy();
    stockEverything(economy);
    for (let step = 0; step < 5; step++) economy.upgrade(SURVEYOR, "plating");
    expect(economy.upgrades(SURVEYOR).armor).toBe(80);
  });

  /**
   * The load-bearing rule: upgrading may sharpen a verb but never grant one.
   * No quantity of material can substitute for understanding.
   */
  it("cannot buy a verb with material, only sharpen an earned one", () => {
    const economy = new Economy();
    stockEverything(economy);
    // The mast's top grade is the Resonant Lens, and it is the one part material cannot reach.
    for (let step = 0; step < 3; step++) economy.upgrade(SURVEYOR, "mast");
    const blocked = economy.canUpgrade(SURVEYOR, "mast");
    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toContain("NO MATERIAL CAN BUY");
    expect(economy.upgrades(SURVEYOR).resonanceGrades).toBe(0);

    economy.grantVerb("surveyResonance");
    expect(economy.canUpgrade(SURVEYOR, "mast").ok).toBe(true);
    economy.upgrade(SURVEYOR, "mast");
    expect(economy.upgrades(SURVEYOR).resonanceGrades).toBe(1);
  });

  it("never lets any station or hull grant a verb", () => {
    const economy = new Economy();
    stockEverything(economy);
    for (const station of STATION_IDS) {
      for (let step = 0; step < 6; step++) economy.upgrade(SURVEYOR, station);
    }
    for (const hull of FABRICATIONS) economy.fabricate(hull.chassisId);
    // Every station maxed and every hull built, with unlimited material, and still no verbs.
    expect(economy.verbs.size).toBe(0);
  });

  it("fills the charge rack on fitting, so a bigger rack is worth something immediately", () => {
    const economy = new Economy();
    stockEverything(economy);
    expect(economy.blastCharges).toBe(0);
    economy.upgrade(SURVEYOR, "rack");
    expect(economy.blastCharges).toBe(2);
    economy.blastCharges = 0;
    economy.upgrade(SURVEYOR, "rack");
    expect(economy.blastCharges).toBe(4);
  });

  it("refills charges to the rack's capacity, rather than selling them by the unit", () => {
    const economy = new Economy();
    stockEverything(economy);
    economy.upgrade(SURVEYOR, "rack");
    economy.blastCharges = 0;
    economy.refillCharges(SURVEYOR);
    expect(economy.blastCharges).toBe(2);
    // And a machine with no rack has nothing to refill.
    expect(economy.upgrades("lantern").blastCapacity).toBe(0);
    economy.refillCharges("lantern");
    expect(economy.blastCharges).toBe(0);
  });
});

describe("the fabrication berth", () => {
  /**
   * Grades deliberately do not transfer. A fabricated hull starts bare, so fabrication buys a
   * different shape of claim rather than a strictly better one -- and because it starts at
   * grade zero everywhere, the player can see that rather than being told it.
   */
  it("keeps grades per chassis and starts a fabricated hull bare", () => {
    const economy = new Economy();
    stockEverything(economy);
    economy.upgrade(SURVEYOR, "emitter");
    economy.upgrade(SURVEYOR, "emitter");
    expect(economy.upgrades(SURVEYOR).paddleWidth).toBeCloseTo(0.25, 6);

    economy.fabricate("lantern");
    expect(economy.fabricated.has("lantern")).toBe(true);
    for (const station of STATION_IDS) expect(economy.gradeOf("lantern", station), station).toBe(0);
    expect(economy.upgrades("lantern").paddleWidth).toBe(0);
    expect(economy.upgrades("lantern").armor).toBe(0);
  });

  it("adds fabricated hulls to the roster without replacing starters", () => {
    const economy = new Economy();
    expect(economy.availableChassis(PADDLE_CHASSIS)).toHaveLength(PADDLE_CHASSIS.length);
    stockEverything(economy);
    economy.fabricate("weir");
    const roster = economy.availableChassis(PADDLE_CHASSIS);
    expect(roster).toHaveLength(PADDLE_CHASSIS.length + 1);
    for (const starter of PADDLE_CHASSIS) expect(roster).toContain(starter);
    expect(roster.some((chassis) => chassis.id === "weir")).toBe(true);
  });

  it("builds each hull once", () => {
    const economy = new Economy();
    stockEverything(economy);
    expect(economy.fabricate("lantern").ok).toBe(true);
    expect(economy.fabricate("lantern").reason).toBe("ALREADY BUILT");
  });

  it("gates each hull on its own ecotone reagent", () => {
    const gates: Record<string, string> = { lantern: "diamond", weir: "saltpeter", prismatic: "vitriol" };
    for (const [chassisId, reagent] of Object.entries(gates)) {
      const entry = FABRICATIONS.find((candidate) => candidate.chassisId === chassisId)!;
      expect(Object.keys(entry.cost)).toContain(reagent);
    }
    expect(FABRICATED_CHASSIS).toHaveLength(3);
    expect(FABRICATIONS).toHaveLength(3);
  });
});

describe("cargo and the bank", () => {
  it("keeps cargo separate from the bank and loses only cargo on death", () => {
    const economy = new Economy();
    economy.add("copper", 20);
    expect(economy.carriedTotal).toBe(20);
    // Cargo cannot be spent: stations price against the bank.
    expect(economy.amount("copper")).toBe(0);
    expect(economy.canUpgrade(SURVEYOR, "plating").ok).toBe(false);

    expect(economy.deposit()).toBe(20);
    expect(economy.carriedTotal).toBe(0);
    expect(economy.amount("copper")).toBe(20);

    economy.add("iron", 9);
    expect(economy.loseCarried()).toBe(9);
    expect(economy.carriedTotal).toBe(0);
    // Banked material survives death untouched.
    expect(economy.amount("copper")).toBe(20);
  });

  it("keeps fitted grades through death", () => {
    const economy = new Economy();
    stock(economy, { copper: 18, coal: 6 });
    economy.upgrade(SURVEYOR, "plating");
    economy.add("mithril", 20);
    economy.loseCarried();
    expect(economy.gradeOf(SURVEYOR, "plating")).toBe(1);
    expect(economy.upgrades(SURVEYOR).armor).toBe(8);
  });
});

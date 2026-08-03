import { describe, expect, it } from "vitest";
import { Economy, RECIPES, RECIPES_BY_ID } from "../src/economy";
import { PADDLE_CHASSIS, FABRICATED_CHASSIS } from "../src/config";

// Recipes are priced against banked material, so test stock must be banked.
const stock = (economy: Economy, entries: Record<string, number>) => {
  for (const [resource, count] of Object.entries(entries)) economy.add(resource as never, count);
  economy.deposit();
};

describe("crafting chain", () => {
  it("refuses a recipe the player cannot afford", () => {
    const economy = new Economy();
    expect(economy.canCraft("bx04-surveyor", "copperPlate").ok).toBe(false);
    stock(economy, { copper: 10, coal: 4 });
    expect(economy.canCraft("bx04-surveyor", "copperPlate").ok).toBe(true);
  });

  it("spends materials and raises armor", () => {
    const economy = new Economy();
    stock(economy, { copper: 10, coal: 4 });
    economy.craft("bx04-surveyor", "copperPlate");
    expect(economy.amount("copper")).toBe(0);
    expect(economy.amount("coal")).toBe(0);
    expect(economy.upgrades("bx04-surveyor").armor).toBe(3);
  });

  it("grows repeat cost and enforces the limit", () => {
    const economy = new Economy();
    stock(economy, { copper: 200, coal: 200 });
    const first = economy.costOf("bx04-surveyor", RECIPES_BY_ID.get("copperPlate")!);
    economy.craft("bx04-surveyor", "copperPlate");
    const second = economy.costOf("bx04-surveyor", RECIPES_BY_ID.get("copperPlate")!);
    expect(second.copper!).toBeGreaterThan(first.copper!);
    economy.craft("bx04-surveyor", "copperPlate");
    economy.craft("bx04-surveyor", "copperPlate");
    expect(economy.canCraft("bx04-surveyor", "copperPlate").reason).toBe("AT LIMIT");
  });

  /**
   * The load-bearing rule: crafting may sharpen a verb but never grant one.
   * No quantity of material can substitute for understanding.
   */
  it("cannot buy a verb with material, only sharpen an earned one", () => {
    const economy = new Economy();
    stock(economy, { cobalt: 500, diamond: 500, coal: 500 });
    const blocked = economy.canCraft("bx04-surveyor", "resonantLens");
    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toContain("NO MATERIAL CAN BUY");
    economy.grantVerb("surveyResonance");
    expect(economy.canCraft("bx04-surveyor", "resonantLens").ok).toBe(true);
    economy.craft("bx04-surveyor", "resonantLens");
    expect(economy.resonanceGrades).toBe(1);
  });

  it("never lets any recipe grant a verb", () => {
    for (const recipe of RECIPES) {
      expect(recipe.effect.type).not.toBe("grantVerb");
    }
    const economy = new Economy();
    stock(economy, Object.fromEntries(
      ["copper", "iron", "cobalt", "mithril", "adamantite", "runite", "coal",
        "sapphire", "emerald", "ruby", "diamond", "sulfur", "saltpeter", "vitriol"]
        .map((resource) => [resource, 999]),
    ));
    for (const recipe of RECIPES) economy.craft("bx04-surveyor", recipe.id);
    // Every recipe crafted, with unlimited material, and still no verbs.
    expect(economy.verbs.size).toBe(0);
  });

  it("replaces rather than stacks the emitter it supersedes", () => {
    const economy = new Economy();
    stock(economy, { cobalt: 200, sapphire: 50, ruby: 50, coal: 200 });
    expect(economy.canCraft("bx04-surveyor", "rubyEmitter").ok).toBe(false);
    economy.craft("bx04-surveyor", "emitterCoil");
    expect(economy.upgrades("bx04-surveyor").paddleSpeedPercent).toBe(12);
    economy.craft("bx04-surveyor", "rubyEmitter");
    // 20 replaces 12; it does not sum to 32.
    expect(economy.upgrades("bx04-surveyor").paddleSpeedPercent).toBe(20);
  });

  /**
   * Modules deliberately do not transfer. A fabricated chassis starts bare, so
   * fabrication buys a different shape of claim rather than a strictly better one.
   */
  it("keeps modules per chassis and starts a fabricated chassis bare", () => {
    const economy = new Economy();
    stock(economy, { cobalt: 200, coal: 200, adamantite: 40, diamond: 40 });
    economy.craft("bx04-surveyor", "broadEmitter");
    expect(economy.upgrades("bx04-surveyor").paddleWidth).toBeCloseTo(0.4, 6);
    economy.craft("bx04-surveyor", "fabricateLantern");
    expect(economy.fabricated.has("lantern")).toBe(true);
    expect(economy.upgrades("lantern").paddleWidth).toBe(0);
    expect(economy.upgrades("lantern").armor).toBe(0);
  });

  it("adds fabricated chassis to the roster without replacing starters", () => {
    const economy = new Economy();
    expect(economy.availableChassis(PADDLE_CHASSIS)).toHaveLength(PADDLE_CHASSIS.length);
    stock(economy, { adamantite: 40, saltpeter: 40, coal: 40 });
    economy.craft("bx04-surveyor", "fabricateWeir");
    const roster = economy.availableChassis(PADDLE_CHASSIS);
    expect(roster).toHaveLength(PADDLE_CHASSIS.length + 1);
    for (const starter of PADDLE_CHASSIS) expect(roster).toContain(starter);
    expect(roster.some((chassis) => chassis.id === "weir")).toBe(true);
  });

  it("gates each fabrication on its own ecotone reagent", () => {
    const gates: Record<string, string> = {
      fabricateLantern: "diamond",
      fabricateWeir: "saltpeter",
      fabricatePrismatic: "vitriol",
    };
    for (const [recipeId, reagent] of Object.entries(gates)) {
      const recipe = RECIPES_BY_ID.get(recipeId)!;
      expect(Object.keys(recipe.cost)).toContain(reagent);
    }
    expect(FABRICATED_CHASSIS).toHaveLength(3);
  });

  it("keeps cargo separate from the bank and loses only cargo on death", () => {
    const economy = new Economy();
    economy.add("copper", 12);
    expect(economy.carriedTotal).toBe(12);
    // Cargo cannot be spent: recipes price against the bank.
    expect(economy.amount("copper")).toBe(0);
    expect(economy.canCraft("bx04-surveyor", "copperPlate").ok).toBe(false);

    expect(economy.deposit()).toBe(12);
    expect(economy.carriedTotal).toBe(0);
    expect(economy.amount("copper")).toBe(12);

    economy.add("iron", 9);
    expect(economy.loseCarried()).toBe(9);
    expect(economy.carriedTotal).toBe(0);
    // Banked material survives death untouched.
    expect(economy.amount("copper")).toBe(12);
  });

  it("keeps crafted capacity through death", () => {
    const economy = new Economy();
    stock(economy, { copper: 10, coal: 4 });
    economy.craft("bx04-surveyor", "copperPlate");
    economy.add("mithril", 20);
    economy.loseCarried();
    expect(economy.upgrades("bx04-surveyor").armor).toBe(3);
  });

  it("tracks blast charges as a consumable", () => {
    const economy = new Economy();
    stock(economy, { saltpeter: 6, sulfur: 6, coal: 4 });
    economy.craft("bx04-surveyor", "blastCharge");
    expect(economy.blastCharges).toBe(3);
  });
});

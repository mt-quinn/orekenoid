// The Refit Bay panel.
//
// A player at the forge is asking *what do I get*, not *what is it called*. So the
// magnitude and the stat are the largest thing on each card, the name is secondary,
// and the cost is a row of legible chips that highlight the specific material they
// are short of.
//
// Every recipe is always listed. Hiding recipes until the player held their
// materials collapsed the panel to four cards on an empty bank and concealed the
// shape of the whole chain — and an upgrade tree you cannot see is not a goal.
// Maxed items stay listed and say so rather than vanishing.

import { FABRICATED_CHASSIS, RESOURCES, type PaddleChassis, type ResourceId } from "./config";
import { RECIPES, type Economy, type Recipe } from "./economy";

/** What the panel needs to know about the machine it is upgrading. */
export interface ForgeContext {
  economy: Economy;
  chassis: PaddleChassis;
  soakCapacity: number;
  integrity: number;
  maxIntegrity: number;
}

/**
 * The three tiers, with the geology that gates each.
 *
 * Stated on the panel rather than left implicit: a player who cannot yet afford
 * tier 3 should still learn that it wants adamantite and ecotone reagents, because
 * that is a reason to travel.
 */
const TIERS: Array<{ tier: 1 | 2 | 3; label: string; note: string }> = [
  { tier: 1, label: "FIELD FORGE", note: "Copper, iron and coal" },
  { tier: 2, label: "MACHINED MODULES", note: "Cobalt and gems · fitted to this chassis" },
  { tier: 3, label: "CHASSIS FABRICATION", note: "Adamantite and ecotone reagents" },
];

/** The payoff lead for one recipe: a magnitude and the stat it moves. */
export function effectHeadline(recipe: Recipe): { value: string; unit: string } {
  const effect = recipe.effect;
  switch (effect.type) {
    case "armor": return { value: `+${effect.amount}`, unit: "ARMOR" };
    case "maxIntegrity": return { value: `+${effect.amount}`, unit: "MAX HEALTH" };
    case "repair": return { value: `+${effect.amount}`, unit: "HEALTH" };
    case "paddleSpeedPercent": return { value: `+${effect.amount}%`, unit: "PADDLE SPEED" };
    case "paddleWidth": return { value: `+${effect.amount}`, unit: "PADDLE WIDTH" };
    case "travelSpeedPercent": return { value: `+${effect.amount}%`, unit: "TRAVEL SPEED" };
    case "rotationPercent": return { value: `+${effect.amount}%`, unit: "ROTATION" };
    case "sharpenResonance": return { value: `+${effect.amount}`, unit: "SURVEY GRADE" };
    case "blastCharges": return { value: `×${effect.amount}`, unit: "BLAST CHARGES" };
    case "vacuum": return { value: `+${effect.amount}`, unit: "ORE PULL" };
    case "predictBounces": return { value: `${effect.amount}`, unit: "PREDICTED BOUNCES" };
    case "fabricate": {
      const chassis = FABRICATED_CHASSIS.find((entry) => entry.id === effect.chassisId);
      return { value: chassis ? `${chassis.frame.width}×${chassis.frame.depth}` : "NEW", unit: "NEW CHASSIS" };
    }
  }
}

/** Every recipe, in a stable order. Number-key order is this order. */
export function forgeRecipes(): Recipe[] {
  return [...RECIPES];
}

const swatch = (resource: ResourceId): string =>
  `#${RESOURCES[resource].colour.toString(16).padStart(6, "0")}`;

export class ForgeView {
  private readonly panel = document.querySelector<HTMLElement>("#crafting");
  private readonly list = document.querySelector<HTMLElement>("#craftingList");
  private readonly hint = document.querySelector<HTMLElement>("#craftingHint");
  private readonly stats = document.querySelector<HTMLElement>("#forgeStats");
  private readonly bank = document.querySelector<HTMLElement>("#forgeBank");

  setOpen(open: boolean): void {
    this.panel?.classList.toggle("open", open);
  }

  /** Rebuild the whole panel. `onCraft` receives a recipe id. */
  render(context: ForgeContext, onCraft: (recipeId: string) => void): void {
    if (!this.list) return;
    const recipes = forgeRecipes();
    const { economy, chassis } = context;

    // Number-key index runs across the whole panel rather than per tier, so the
    // digit on a card is the digit that presses it.
    let keyIndex = 0;
    const sections: string[] = [];
    for (const { tier, label, note } of TIERS) {
      const group = recipes.filter((recipe) => recipe.tier === tier);
      if (!group.length) continue;
      const cards = group.map((recipe) => {
        const index = keyIndex++;
        const key = index < 9 ? String(index + 1) : "";
        const check = economy.canCraft(chassis.id, recipe.id);
        const cost = economy.costOf(chassis.id, recipe);
        const headline = effectHeadline(recipe);
        const owned = economy.craftCount(chassis.id, recipe.id);
        const chips = (Object.entries(cost) as Array<[ResourceId, number]>)
          .map(([resource, count]) => {
            const definition = RESOURCES[resource];
            const have = economy.amount(resource);
            const short = have < count;
            // A short chip shows how much the player actually has, so the gap is a
            // number rather than a colour.
            return `<span class="chip${short ? " short" : ""}">
              <i style="background:${swatch(resource)}"></i>${count} ${definition.name}${short ? `<u>${have}</u>` : ""}
            </span>`;
          }).join("");
        // "Insufficient material" is already said by the cost chips, so only the
        // structural refusals get a banner.
        const blocked = !check.ok && check.reason !== "INSUFFICIENT MATERIAL" ? check.reason : "";
        const subnote = recipe.replaces || recipe.requiresVerb
          ? recipe.detail
          : owned > 0 && recipe.limit
            ? `OWNED ${owned}/${recipe.limit}`
            : "";
        return `<button class="craft-card${check.ok ? " affordable" : ""}${blocked ? " blocked" : ""}"
            type="button" data-recipe="${recipe.id}" ${check.ok ? "" : "disabled"}>
          ${key ? `<em class="craft-key">${key}</em>` : ""}
          <span class="craft-gain"><b>${headline.value}</b><i>${headline.unit}</i></span>
          <span class="craft-name">${recipe.name}</span>
          ${subnote ? `<span class="craft-note">${subnote}</span>` : ""}
          <span class="craft-cost">${chips}</span>
          ${blocked ? `<span class="craft-block">${blocked}</span>` : ""}
        </button>`;
      }).join("");
      sections.push(`<section class="forge-tier tier-${tier}">
        <h3>${label}<span>${note}</span></h3>
        <div class="craft-grid">${cards}</div>
      </section>`);
    }

    this.list.innerHTML = sections.join("")
      || '<p class="forge-empty">Nothing forgeable yet. Mine copper and coal, then bank it.</p>';
    for (const card of this.list.querySelectorAll<HTMLButtonElement>(".craft-card")) {
      card.addEventListener("click", () => onCraft(card.dataset.recipe ?? ""));
    }

    // Current chassis values, so the player sees what each card is improving.
    if (this.stats) {
      this.stats.innerHTML = `
        <span><i>ARMOR</i><b>${context.soakCapacity}</b></span>
        <span><i>HEALTH</i><b>${context.integrity}<u>/${context.maxIntegrity}</u></b></span>
        <span><i>CHASSIS</i><b class="chassis">${chassis.name}</b></span>`;
    }
    // The bank rail: deciding what to make requires knowing what is in stock.
    if (this.bank) {
      const held = [...economy.banked.entries()].filter(([, count]) => count > 0);
      this.bank.innerHTML = held.length
        ? `<b>BANK</b>${held
          .sort((a, b) => b[1] - a[1])
          .map(([resource, count]) =>
            `<span class="bank-item"><i style="background:${swatch(resource)}"></i>${RESOURCES[resource].name}<b>${count}</b></span>`)
          .join("")}`
        : '<b>BANK</b><span class="bank-empty">EMPTY</span>';
    }
    if (this.hint) {
      this.hint.textContent = recipes.length
        ? "Click or press a number. ESC closes."
        : "Bank material at the chest to forge.";
    }
  }
}

// The objective ladder.
//
// One rung at a time, in mechanical language: an imperative and a number. No
// metaphor, no narration, nothing the player cannot act on. The rungs are ordered
// most-advanced-first so the player is always shown the furthest thing they have
// actually reached, and the ladder is data rather than branching so the whole
// progression is reviewable in one screen of text.

import type { Economy } from "./economy";

export interface Objective {
  title: string;
  detail: string;
}

export function objectiveFor(economy: Economy): Objective {
  const verbs = economy.verbs.size;
  if (verbs >= 2) {
    return { title: "DESCEND PAST 900m", detail: "Adamantite and runite below." };
  }
  if (verbs === 1) {
    return { title: "SECOND CORNERSTONE", detail: "2 of 3 required." };
  }
  // The first armour craft is the first time banked material becomes capability,
  // so it gets its own rung rather than being folded into "secure ore".
  if (economy.amount("copper") >= 10 && economy.amount("coal") >= 4) {
    return { title: "FORGE ARMOR", detail: "Refit Bay · 10 copper + 4 coal." };
  }
  if (economy.totalSecured > 0) {
    return {
      title: "SECURE ORE",
      detail: `Copper ${economy.amount("copper")}/10 · Coal ${economy.amount("coal")}/4.`,
    };
  }
  return { title: "SECURE ORE", detail: "Break resource bricks. Catch the drops." };
}

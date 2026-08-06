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

/**
 * Where the drone is, relative to home.
 *
 * The ladder used to read the economy alone, which meant it could not say the one thing a player
 * carrying a hold full of ore most needs to hear. Two facts about *place* were missing: that there
 * is a home, and how far away it is.
 */
export interface Standing {
  /** Ore in the hold, unbanked. Lost on death, and unspendable until it is banked. */
  carried: number;
  /** How far the Refit Bay is, in metres. */
  homeMetres: number;
  /** True while docked, when banking and forging are both available. */
  atHome: boolean;
}

export function objectiveFor(economy: Economy, standing: Standing): Objective {
  const verbs = economy.verbs.size;
  // Above every other rung, because it is the only one that can be lost by carrying on.
  //
  // Nothing in the interface previously said that ore has to come home before it can be spent, and
  // nothing said there was a home to come to. This is the line whose whole job is "what now", so it
  // is where both facts belong -- named, with a distance, for as long as the hold is full.
  if (standing.carried > 0 && !standing.atHome) {
    return {
      title: "BANK THE HAUL",
      detail: `${standing.carried} in the hold · Refit Bay ${Math.round(standing.homeMetres)}m ·`
        + " ore cannot be spent until it is banked",
    };
  }
  if (verbs >= 2) {
    return { title: "DESCEND PAST 900m", detail: "Adamantite and runite below." };
  }
  if (verbs === 1) {
    return { title: "SECOND CORNERSTONE", detail: "2 of 3 required." };
  }
  // The first armour craft is the first time banked material becomes capability,
  // so it gets its own rung rather than being folded into "secure ore".
  if (economy.amount("copper") >= 10 && economy.amount("coal") >= 4) {
    // Banked and affordable, so the only thing left is to go and spend it -- which means saying
    // where, and how far.
    return {
      title: "FORGE ARMOR",
      detail: standing.atHome
        ? "You are docked · 10 copper + 4 coal"
        : `Refit Bay ${Math.round(standing.homeMetres)}m · 10 copper + 4 coal`,
    };
  }
  if (economy.totalSecured > 0) {
    return {
      title: "SECURE ORE",
      detail: `Copper ${economy.amount("copper")}/10 · Coal ${economy.amount("coal")}/4.`,
    };
  }
  return { title: "SECURE ORE", detail: "Break resource bricks. Catch the drops." };
}

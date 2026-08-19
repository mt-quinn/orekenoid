// The heads-up display.
//
// This file owns every DOM node in the game aperture and nothing else owns any.
// Two rules shaped it:
//
//   - **The HUD is mode-driven.** Surveying, the player is reading the world:
//     region, depth, resonance, health. Excavating, they are reading the stakes:
//     load, projected damage, health, balls. Anything that does not serve the
//     current decision recedes rather than competing.
//   - **Each number lives in exactly one place.** Load was previously stated four
//     times — a board bar, a telemetry line, a claim readout and a detail line —
//     which is three too many and made none of them authoritative.
//
// The HUD is told what to show; it never reads game state. That is what keeps the
// mode rules above enforceable rather than aspirational.

import { RESOURCES, type ResourceId } from "./config";
import { clamp } from "./maths";
import type { Objective } from "./objectives";

/** Everything the per-frame HUD shows. Built by the caller each frame. */
export interface HudModel {
  /** Drives `data-mode` on the viewport, which is what CSS keys the layout off. */
  mode: "survey" | "play" | "forge";
  inArena: boolean;
  region: { name: string; band: number; depthMetres: number };
  /** Clearable, liable bricks still standing. Zero outside an arena. */
  remainingLoad: number;
  /**
   * The opening is currently explaining what leaving rock behind costs.
   *
   * Lights the load and damage readouts while it says so. The sentence is about the difference between two
   * numbers that are already on screen, and a player who has just lost a ball should be looking at them
   * rather than reading a description of them.
   */
  teachingLiability: boolean;
  projectedDamage: number;
  integrity: number;
  maxIntegrity: number;
  soakCapacity: number;
  liveBalls: number;
  spareBalls: number;
  cargo: Array<[ResourceId, number]>;
  /** Cargo is only safe once banked, so the hold says so while it is at risk. */
  cargoAtRisk: boolean;
  /** 0..1, decaying, raised when ore lands. Punches the readout. */
  cargoPulse: number;
  /** Coarse dial grades, or null when Survey Resonance is absent or irrelevant. */
  resonance: { density: string; volatility: string; yield: string } | null;
  /** The one fact the player cannot read off the world. Survey only. */
  nearestCornerstone: { name: string; distanceMetres: number } | null;
  hints: string;
  objective: Objective;
}

export interface TutorialStep {
  id: string;
  keys: string;
  label: string;
  done: boolean;
}

/** A compass fix, already resolved to a screen-space bearing by the caller. */
export interface CompassFix {
  name: string;
  distanceMetres: number;
  /** Radians, screen space, zero pointing right. */
  bearing: number;
}

export class Hud {
  private readonly viewport = document.querySelector<HTMLElement>(".viewport");
  private readonly regionLabel = document.querySelector<HTMLElement>("#biomeLabel");
  private readonly bandLabel = document.querySelector<HTMLElement>("#bandLabel");
  private readonly depthLabel = document.querySelector<HTMLElement>("#depthLabel");
  private readonly objectiveTitle = document.querySelector<HTMLElement>("#objectiveTitle");
  private readonly objectiveDetail = document.querySelector<HTMLElement>("#objectiveDetail");
  private readonly claimLabel = document.querySelector<HTMLElement>("#claimValue");
  private readonly claimDetail = document.querySelector<HTMLElement>("#claimDetail");
  private readonly damageStat = document.querySelector<HTMLElement>("#damageStat");
  private readonly loadStat = document.querySelector<HTMLElement>("#loadStat");
  /** The armour figure, which is the other half of the arithmetic being taught. */
  private readonly soakField = document.querySelector<HTMLElement>("#soakValue");
  private readonly damageLabel = document.querySelector<HTMLElement>("#damageValue");
  private readonly integrityStat = document.querySelector<HTMLElement>("#integrityStat");
  private readonly healthLabel = document.querySelector<HTMLElement>("#healthValue");
  private readonly healthMax = document.querySelector<HTMLElement>("#healthMax");
  private readonly healthBar = document.querySelector<HTMLElement>("#healthBar");
  private readonly soakLabel = document.querySelector<HTMLElement>("#soakValue");
  private readonly ballPips = document.querySelector<HTMLElement>("#ballPips");
  private readonly arrivalCard = document.querySelector<HTMLElement>("#arrival");
  private readonly bankNotice = document.querySelector<HTMLElement>("#bankNotice");
  private readonly forgeCompass = document.querySelector<HTMLElement>("#forgeCompass");
  private readonly forgeCompassRange = document.querySelector<HTMLElement>("#forgeCompassRange");
  private compassLabel = "";
  private readonly telemetry = document.querySelector<HTMLElement>("#telemetry");
  private readonly instructions = document.querySelector<HTMLElement>("#instructions");
  private readonly toast = document.querySelector<HTMLElement>("#toast");
  private readonly resonancePanel = document.querySelector<HTMLElement>("#resonance");
  private readonly cargoStrip = document.querySelector<HTMLElement>("#cargo");
  /** Whether the strip is currently showing a catch, so the class is only touched when it changes. */
  private cargoLit = false;
  private readonly saveFlash = document.querySelector<HTMLElement>("#saveFlash");

  /** Cargo markup is only rebuilt when the hold actually changes. */
  private cargoSignature = "";
  private lastCargo = new Map<ResourceId, number>();

  // --- Per-frame ----------------------------------------------------------

  render(model: HudModel): void {
    this.applyMode(model.mode);

    if (this.regionLabel) this.regionLabel.textContent = model.region.name;
    // Band is a tier, not a sentence. Depth beside it already says "shallow".
    if (this.bandLabel) this.bandLabel.textContent = `B${model.region.band}`;
    if (this.depthLabel) this.depthLabel.textContent = `${Math.round(model.region.depthMetres)}m`;

    if (this.claimLabel) this.claimLabel.textContent = String(model.remainingLoad);
    if (this.claimDetail) this.claimDetail.textContent = "REMAINING";
    // Damage is an alarm, so it is absent at zero rather than reading "00".
    this.damageStat?.classList.toggle("active", model.projectedDamage > 0);
    this.loadStat?.classList.toggle("teaching", model.teachingLiability);
    this.damageStat?.classList.toggle("teaching", model.teachingLiability);
    this.soakField?.classList.toggle("teaching", model.teachingLiability);
    if (this.damageLabel) this.damageLabel.textContent = String(model.projectedDamage);

    if (this.healthLabel) this.healthLabel.textContent = String(model.integrity);
    if (this.healthMax) this.healthMax.textContent = `/ ${model.maxIntegrity}`;
    if (this.soakLabel) this.soakLabel.textContent = `ARMOR ${model.soakCapacity}`;
    const healthFraction = model.maxIntegrity ? model.integrity / model.maxIntegrity : 0;
    if (this.healthBar) this.healthBar.style.setProperty("--v", `${Math.round(healthFraction * 100)}%`);
    this.integrityStat?.style.setProperty("--max", String(model.maxIntegrity));
    if (this.integrityStat) {
      this.integrityStat.dataset.state = healthFraction <= 0.25 ? "critical" : healthFraction <= 0.5 ? "warn" : "ok";
    }

    if (this.ballPips) {
      this.ballPips.innerHTML =
        `${"<i></i>".repeat(model.liveBalls)}${'<i class="spare"></i>'.repeat(model.spareBalls)}`;
      // Only hide the row once a single ball with no spare is all that remains.
      const ballsStat = this.ballPips.parentElement;
      if (ballsStat) {
        ballsStat.dataset.trivial = String(!model.inArena || (model.liveBalls <= 1 && model.spareBalls === 0));
      }
    }

    this.cargoStrip?.classList.toggle("at-risk", model.cargoAtRisk);
    // Driven by the same pulse the catch effects use, so the figure and the ring on the board are
    // one event rather than two things that happen to coincide.
    const lit = model.cargoPulse > 0.05;
    if (lit !== this.cargoLit) {
      this.cargoLit = lit;
      this.cargoStrip?.classList.toggle("caught", lit);
    }
    this.renderCargo(model.cargo);
    this.renderResonance(model.resonance);

    if (this.telemetry) {
      this.telemetry.textContent = model.nearestCornerstone
        ? `${model.nearestCornerstone.name}  ${Math.round(model.nearestCornerstone.distanceMetres)}m`
        : "";
    }
    if (this.instructions) this.instructions.innerHTML = model.hints;
    if (this.objectiveTitle) this.objectiveTitle.textContent = model.objective.title;
    if (this.objectiveDetail) this.objectiveDetail.textContent = model.objective.detail;
  }

  /** Mode drives which half of the HUD is present. */
  private applyMode(mode: HudModel["mode"]): void {
    if (this.viewport) this.viewport.dataset.mode = mode;
  }

  /**
   * The reward readout. An empty hold shows nothing at all rather than the words
   * "NO CARGO", and a gain pulses so the catch registers without a toast.
   */
  private renderCargo(cargo: Array<[ResourceId, number]>): void {
    if (!this.cargoStrip) return;
    const held = cargo.filter(([, count]) => count > 0);
    const signature = held.map(([resource, count]) => `${resource}${count}`).join("|");
    if (signature === this.cargoSignature) return;
    this.cargoSignature = signature;
    this.cargoStrip.innerHTML = held
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([resource, count]) => {
        const definition = RESOURCES[resource];
        const colour = `#${definition.colour.toString(16).padStart(6, "0")}`;
        const gained = (this.lastCargo.get(resource) ?? 0) < count ? " gained" : "";
        return `<span class="cargo-item${gained}"><i style="background:${colour}"></i>${definition.name}<b>${count}</b></span>`;
      })
      .join("");
    this.lastCargo = new Map(held);
  }

  /**
   * Survey Resonance. Coarse grades for the three dials and never the contents --
   * direction is discoverable, contents are a wager.
   */
  private renderResonance(resonance: HudModel["resonance"]): void {
    if (!this.resonancePanel) return;
    if (!resonance) {
      this.resonancePanel.classList.remove("open");
      return;
    }
    this.resonancePanel.classList.add("open");
    this.resonancePanel.innerHTML = `
      <b>SURVEY RESONANCE</b>
      <span>DENSITY<i>${resonance.density}</i></span>
      <span>VOLATILITY<i>${resonance.volatility}</i></span>
      <span>YIELD<i>${resonance.yield}</i></span>`;
  }

  /**
   * Mark the aperture as deployed. One-way: the HUD instruments only exist after
   * the player has committed to a chassis, and the deployment screen never returns.
   */
  markDeployed(): void {
    this.viewport?.classList.add("deployed");
  }

  // --- Event-driven -------------------------------------------------------

  showToast(message: string): void {
    if (!this.toast) return;
    this.toast.textContent = message;
    // Removed and re-added across a frame so a repeated message replays its
    // animation instead of sitting there looking stale.
    this.toast.classList.remove("show");
    requestAnimationFrame(() => this.toast?.classList.add("show"));
    window.setTimeout(() => this.toast?.classList.remove("show"), 1800);
  }

  /**
   * A province rule, stated once on arrival, in mechanical terms. A rule the player
   * must re-read every frame is a rule the HUD has failed to teach.
   */
  showArrival(regionName: string, rule: string): void {
    if (!this.arrivalCard) return;
    this.arrivalCard.innerHTML = `<b>${regionName}</b><i>${rule}</i>`;
    this.arrivalCard.classList.add("show");
  }

  hideArrival(): void {
    this.arrivalCard?.classList.remove("show");
  }

  /**
   * The hold discharging.
   *
   * The strip goes from carrying a haul to carrying nothing in a single frame, which is the correct
   * data and a wasted moment -- the player just walked that ore home. A brief sweep as it empties
   * ties the strip clearing to the deposit landing, rather than leaving the reward entirely to a
   * toast somewhere else on screen.
   */
  flashCargoBanked(): void {
    if (!this.cargoStrip) return;
    this.cargoStrip.classList.remove("banked");
    void this.cargoStrip.offsetWidth;
    this.cargoStrip.classList.add("banked");
    window.setTimeout(() => this.cargoStrip?.classList.remove("banked"), 620);
  }

  showBankNotice(stored: number): void {
    if (!this.bankNotice) return;
    this.bankNotice.textContent = `+${stored} BANKED`;
    this.bankNotice.classList.remove("show");
    requestAnimationFrame(() => this.bankNotice?.classList.add("show"));
    window.setTimeout(() => this.bankNotice?.classList.remove("show"), 1400);
  }

  flashSave(message: string, error = false): void {
    if (!this.saveFlash) return;
    this.saveFlash.textContent = message;
    this.saveFlash.classList.toggle("error", error);
    this.saveFlash.classList.add("show");
    // A failure stays up four times as long: it is the one HUD message the player
    // may need to act on outside the game.
    window.setTimeout(() => this.saveFlash?.classList.remove("show"), error ? 4200 : 1100);
  }

  // --- Tutorial -----------------------------------------------------------

  // --- Compass ------------------------------------------------------------

  hideCompass(): void {
    this.forgeCompass?.classList.remove("show");
  }

  /**
   * Pin the compass to the viewport edge along a bearing.
   *
   * The arrow sits where the target would leave the screen, so it reads as a
   * direction to travel rather than a floating marker somewhere off in the dark.
   */
  showCompass(fix: CompassFix): void {
    if (!this.forgeCompass || !this.viewport) return;
    const bounds = this.viewport.getBoundingClientRect();
    const inset = 64;
    const halfWidth = Math.max(40, bounds.width / 2 - inset);
    const halfHeight = Math.max(40, bounds.height / 2 - inset);
    // Intersect the bearing with the inset rectangle.
    const scaleToEdge = Math.min(
      halfWidth / Math.max(1e-3, Math.abs(Math.cos(fix.bearing))),
      halfHeight / Math.max(1e-3, Math.abs(Math.sin(fix.bearing))),
    );
    const edgeX = bounds.width / 2 + Math.cos(fix.bearing) * scaleToEdge;
    const edgeY = bounds.height / 2 + Math.sin(fix.bearing) * scaleToEdge;
    this.forgeCompass.style.transform = `translate(${edgeX}px, ${edgeY}px) translate(-50%, -50%)`;
    // The triangle points up by default, so rotate a quarter turn past the bearing.
    this.forgeCompass.style.setProperty("--point", `${fix.bearing + Math.PI / 2}rad`);
    // Only written when it actually changes. This now runs every frame, and rewriting a text node
    // sixty times a second to say the same thing is the kind of cost that never shows up in a
    // profile as one line but does show up as a worse frame time on a phone.
    const label = `${fix.name} ${Math.round(fix.distanceMetres)}m`;
    if (this.forgeCompassRange && this.compassLabel !== label) {
      this.compassLabel = label;
      this.forgeCompassRange.textContent = label;
    }
    this.forgeCompass.classList.add("show");
  }
}

/** Coarse grades, never exact contents. Resonance adds precision, not identity. */
export const gradeOf = (value: number, grades: number): string => {
  const labels = grades >= 1
    ? ["VERY LOW", "LOW", "MODERATE", "HIGH", "VERY HIGH"]
    : ["LOW", "MODERATE", "HIGH"];
  return labels[clamp(Math.floor(value * labels.length), 0, labels.length - 1)];
};

/**
 * Province rules in mechanical terms, keyed by ecotone first then province.
 *
 * These are the arrival cards. Each states what the material *does*, never what it
 * looks like or where it came from.
 */
export const REGION_RULES: Record<string, string> = {
  karst: "CHALK 1 HIT · SLATE 4 HITS, NO LOAD",
  mirrorreef: "FACETS TURN THE BALL 90° · CHARGED CRYSTAL CHAINS",
  rootwarren: "LIVING ROCK REGROWS · SPORE BULBS LEAVE A BUMPER",
  brightFault: "MIRROR SLATE TURNS AND HOLDS · DIAMOND ONLY HERE",
  chalkWarren: "GROWTH EATS CHALK, NOT SLATE · SALTPETER ONLY HERE",
  bloomShelf: "GROWTH COVERS CRYSTAL · VITRIOL ONLY HERE",
};

// The deployment screen's expedition panel.
//
// Its job is to answer "is there a world waiting for me, and what state is it in?"
// before the player picks a paddle. The summary is deliberately concrete — depth,
// banked material, verbs, losses — because those are the facts that decide whether
// to continue or to start something new.
//
// Import is offered whether or not a save exists: a player arriving on a new machine
// with a save file in hand has nowhere else to put it.

import { CELL } from "./config";
import { readSave } from "./persistence";

export interface ExpeditionActions {
  onContinue: () => void;
  onImport: () => void;
  onAbandon: () => void;
  onExport: () => void;
  /** A chassis card was clicked. */
  onSelectChassis: (index: number) => void;
  /** The pointer entered a chassis card. */
  onHoverChassis: (index: number) => void;
  /** The pointer left a chassis card. The index is passed so the caller can tell
   *  a genuine exit from the leave that fires while entering a neighbour. */
  onUnhoverChassis: (index: number) => void;
  /** DEPLOY was pressed. */
  onDeploy: () => void;
}

export class ExpeditionView {
  private readonly screen = document.querySelector<HTMLElement>("#briefing");
  private readonly deployButton = document.querySelector<HTMLButtonElement>("#beginButton");
  private readonly deployLabel = document.querySelector<HTMLElement>("#beginLabel");
  private readonly chassisCards = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-chassis]"));
  private readonly panel = document.querySelector<HTMLElement>("#expedition");
  private readonly title = document.querySelector<HTMLElement>("#expeditionTitle");
  private readonly detail = document.querySelector<HTMLElement>("#expeditionDetail");
  private readonly continueButton = document.querySelector<HTMLButtonElement>("#continueButton");
  private readonly abandonButton = document.querySelector<HTMLButtonElement>("#abandonButton");

  bind(actions: ExpeditionActions): void {
    this.continueButton?.addEventListener("click", () => actions.onContinue());
    this.abandonButton?.addEventListener("click", () => actions.onAbandon());
    document.querySelector("#importButton")?.addEventListener("click", () => actions.onImport());
    // The Atlas footer carries the same two file actions, because that is where a
    // player already deep in an expedition will look for them.
    document.querySelector("#atlasImport")?.addEventListener("click", () => actions.onImport());
    document.querySelector("#atlasExport")?.addEventListener("click", () => actions.onExport());

    for (const card of this.chassisCards) {
      const index = Number(card.dataset.chassis);
      card.addEventListener("click", () => actions.onSelectChassis(index));
      card.addEventListener("pointerenter", () => actions.onHoverChassis(index));
      card.addEventListener("pointerleave", () => actions.onUnhoverChassis(index));
    }
    this.deployButton?.addEventListener("click", () => actions.onDeploy());
  }

  /** Reflect the chosen chassis, and arm DEPLOY. */
  showChassisSelected(index: number): void {
    for (const card of this.chassisCards) {
      card.setAttribute("aria-pressed", String(Number(card.dataset.chassis) === index));
    }
    if (this.deployLabel) this.deployLabel.textContent = "DEPLOY";
    if (this.deployButton) this.deployButton.disabled = false;
  }

  /**
   * The previews are built and laid out; show the screen.
   *
   * `data-render-state` is the signal the browser tests wait on, and the one the
   * boot failure path sets to "failed" -- so it is the single source of truth for
   * whether the renderer came up, not a decoration.
   */
  markReady(): void {
    this.screen?.classList.remove("loading");
    this.screen?.classList.add("ready");
    this.screen?.setAttribute("aria-busy", "false");
    this.screen?.setAttribute("data-render-state", "ready");
  }

  /** Dismiss the deployment screen. One-way: it never comes back. */
  dismiss(): void {
    this.screen?.classList.add("hidden");
  }

  /** Read the stored expedition and reflect it. Safe to call at any time. */
  refresh(): void {
    if (!this.panel) return;
    const stored = readSave();
    const data = stored.ok ? stored.data : undefined;
    this.panel.hidden = false;
    if (this.continueButton) this.continueButton.hidden = !data;
    if (this.abandonButton) this.abandonButton.hidden = !data;

    if (!data) {
      if (this.title) this.title.textContent = "NO SAVED EXPEDITION";
      if (this.detail) {
        // A genuine storage failure is worth showing verbatim; "no save yet" is not
        // an error and gets an instruction instead.
        this.detail.textContent = stored.reason === "No saved expedition."
          ? "Choose a paddle below, or import a save file."
          : (stored.reason ?? "");
      }
      return;
    }

    const minutes = Math.floor(data.elapsed / 60);
    const banked = Object.values(data.economy.banked ?? {})
      .reduce((total, count) => total + (count ?? 0), 0);
    const depth = Math.round((data.player.y / CELL) * 14);
    if (this.title) this.title.textContent = `EXPEDITION · ${data.seedLabel.toUpperCase()}`;
    if (this.detail) {
      this.detail.textContent = [
        `${minutes}m elapsed`,
        `${depth}m deep`,
        `${banked} banked`,
        `${data.economy.verbs?.length ?? 0} verbs`,
        `${data.progress.deaths} losses`,
      ].join(" · ");
    }
  }
}

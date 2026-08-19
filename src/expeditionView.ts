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
  /** Start a fresh expedition, replacing any saved one. */
  onNewGame: () => void;
  onExport: () => void;
  /** A chassis card was clicked. */
  /** The pointer entered a chassis card. */
  /** The pointer left a chassis card. The index is passed so the caller can tell
   *  a genuine exit from the leave that fires while entering a neighbour. */
}

export class ExpeditionView {
  private readonly screen = document.querySelector<HTMLElement>("#briefing");
  private readonly loadButton = document.querySelector<HTMLButtonElement>("#loadButton");
  private readonly loadDetail = document.querySelector<HTMLElement>("#loadDetail");
  private readonly newButton = document.querySelector<HTMLButtonElement>("#newButton");
  private readonly newDetail = document.querySelector<HTMLElement>("#newDetail");
  private readonly menu = document.querySelector<HTMLElement>("#menu");

  bind(actions: ExpeditionActions): void {
    this.loadButton?.addEventListener("click", () => actions.onContinue());
    this.newButton?.addEventListener("click", () => actions.onNewGame());
    document.querySelector("#importButton")?.addEventListener("click", () => actions.onImport());
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

  /**
   * Read the stored expedition and reflect it. Safe to call at any time.
   *
   * The save's details sit inside the LOAD GAME button rather than in a panel above it, because they are
   * a description of that button and nothing else. Without a save the button stays visible and disabled,
   * so the menu keeps its shape and the absence reads as "nothing to load" rather than as a missing
   * option the player has to wonder about.
   */
  refresh(): void {
    const stored = readSave();
    const data = stored.ok ? stored.data : undefined;
    if (this.menu) this.menu.hidden = false;

    if (this.loadButton) {
      this.loadButton.disabled = !data;
      this.loadButton.setAttribute("aria-disabled", String(!data));
    }
    if (this.newDetail) {
      // Said before it is done, not confirmed after. A player who has a save wants to know this button
      // costs them something before they press it.
      this.newDetail.textContent = data ? "Replaces the saved expedition" : "A fresh mine";
    }
    if (this.newButton) this.newButton.classList.toggle("hazard", Boolean(data));

    if (!this.loadDetail) return;
    if (!data) {
      // A genuine storage failure is worth showing verbatim; "no save yet" is not an error.
      this.loadDetail.textContent = stored.reason && stored.reason !== "No saved expedition."
        ? stored.reason
        : "No saved expedition";
      return;
    }

    const minutes = Math.floor(data.elapsed / 60);
    const banked = Object.values(data.economy.banked ?? {})
      .reduce((total, count) => total + (count ?? 0), 0);
    const depth = Math.round((data.player.y / CELL) * 14);
    this.loadDetail.textContent = [
      data.seedLabel.toUpperCase(),
      `${minutes}m elapsed`,
      `${depth}m deep`,
      `${banked} banked`,
      `${data.progress.deaths} losses`,
    ].join(" · ");
  }
}

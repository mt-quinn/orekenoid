// The Refit Bay, for fingers.
//
// The gantry is a picture of the drone hanging on a rig with six labelled places on it, drawn in the
// canvas and laid out against the 16:9 field it was authored for. It is the best thing in the game
// on a desktop and unusable on a phone: the stations are small absolute-positioned hit areas on a
// diagram that has been scaled to a third of its intended size.
//
// So touch gets a list. Same six stations, same economy, same `upgradeStation` call -- what changes
// is only the presentation: each station says what it is, what fitting the next grade would do, what
// that costs against what is banked, and offers one 46px button to do it. Plus a way out, which the
// canvas version does not need because it has a key.
//
// Deliberately *not* a replacement for the gantry. The desktop path is untouched; this is a second
// presentation of the same model, chosen by layout.

import { RESOURCES, type ResourceId } from "./config";
import type { StationId } from "./economy";
import type { GantryModel } from "./view/gantry";

export interface BayHandlers {
  onFit(station: StationId): void;
  onClose(): void;
}

export class BayView {
  private readonly panel = document.querySelector<HTMLElement>("#bay");
  private readonly chassisLabel = document.querySelector<HTMLElement>("#bayChassis");
  private readonly stats = document.querySelector<HTMLElement>("#bayStats");
  private readonly list = document.querySelector<HTMLElement>("#bayList");
  private readonly closeButton = document.querySelector<HTMLElement>("#bayClose");
  private handlers: BayHandlers | null = null;
  /**
   * What the list last drew, so an unchanged model does not rebuild the DOM.
   *
   * This renders on every economy change, and rebuilding six station cards to show the same six
   * station cards would throw away the pressed state of whatever button the player is holding.
   */
  private signature = "";

  bind(handlers: BayHandlers): void {
    this.handlers = handlers;
    this.closeButton?.addEventListener("click", () => handlers.onClose());
    // Delegated, because the cards are rebuilt whenever the economy moves and per-button listeners
    // would have to be rebound every time.
    this.list?.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLElement>("[data-fit]");
      if (!button || button.hasAttribute("disabled")) return;
      this.handlers?.onFit(button.dataset.fit as StationId);
    });
  }

  setOpen(open: boolean): void {
    if (!this.panel) return;
    if (this.panel.hidden === !open) return;
    this.panel.hidden = !open;
    // Forget the last render on close, so reopening always draws fresh rather than trusting a
    // signature from before whatever the player did out in the mine.
    if (!open) this.signature = "";
  }

  get open(): boolean {
    return this.panel ? !this.panel.hidden : false;
  }

  render(model: GantryModel): void {
    if (!this.list || !this.panel || this.panel.hidden) return;

    if (this.chassisLabel) this.chassisLabel.textContent = model.chassisName.toUpperCase();
    if (this.stats) {
      this.stats.innerHTML = [
        stat("ARMOR", String(model.armor)),
        stat("HEALTH", `${model.integrity}/${model.maxIntegrity}`),
        stat("PADDLE", model.paddleWidth.toFixed(1)),
      ].join("");
    }

    const signature = model.stations
      .map((station) => `${station.id}${station.level}${station.next?.name ?? "-"}`
        + (station.next?.cost.map((entry) => `${entry.resource}${entry.have}/${entry.need}`).join(",") ?? ""))
      .join("|");
    if (signature === this.signature) return;
    this.signature = signature;

    this.list.innerHTML = model.stations.map((station) => {
      const next = station.next;
      // Everything fitted, so there is nothing to sell here -- say so rather than showing an empty
      // card with a dead button.
      if (!next) {
        return `<article class="bay-card done">
          <header><b>${station.name}</b><i>${station.level}/${station.ladder}</i></header>
          <p class="bay-fitted">${station.fitted ?? "—"}</p>
          <p class="bay-max">FULLY FITTED</p>
        </article>`;
      }
      const short = next.cost.some((entry) => entry.have < entry.need);
      const refused = station.blocked;
      const cost = next.cost.map((entry) => {
        const definition = RESOURCES[entry.resource as ResourceId];
        const colour = `#${definition.colour.toString(16).padStart(6, "0")}`;
        const lacking = entry.have < entry.need;
        // The price, and the holding only when it is not enough. `have/need` read as a fraction --
        // "Copper 40/18" looks like forty of eighteen, which is nonsense at a glance and worst
        // exactly where it should be reassuring, on the entries the player can afford.
        return `<span class="bay-cost${lacking ? " short" : ""}">
          <i style="background:${colour}"></i>${definition.name}
          <b>${entry.need}</b>${lacking ? `<small>have ${entry.have}</small>` : ""}
        </span>`;
      }).join("");
      return `<article class="bay-card">
        <header><b>${station.name}</b><i>${station.level}/${station.ladder}</i></header>
        ${station.fitted ? `<p class="bay-fitted">${station.fitted}</p>` : ""}
        <p class="bay-next">${next.name}</p>
        <p class="bay-detail">${next.detail}</p>
        <div class="bay-costs">${cost}</div>
        <button type="button" data-fit="${station.id}"${short || refused ? " disabled" : ""}>
          ${refused ?? (short ? "NOT ENOUGH MATERIAL" : "FIT")}
        </button>
      </article>`;
    }).join("");
  }
}

const stat = (label: string, value: string) =>
  `<span class="bay-stat"><small>${label}</small><b>${value}</b></span>`;

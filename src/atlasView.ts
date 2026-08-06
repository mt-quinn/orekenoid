// The Atlas panel: everything around the map canvas.
//
// `atlas.ts` draws the map. This owns the panel, the icon palette, the annotation
// editor, and the hit-testing that turns a click into a marker. It is kept apart
// from the drawing because the interaction has one rule the renderer does not care
// about: **the player annotates; the game never does.** Nothing in this file writes
// a marker that the player did not place, and unsurveyed ground refuses one.

import {
  annotationAt,
  atlasToWorld,
  ATLAS_HEIGHT,
  ATLAS_ICONS,
  ATLAS_WIDTH,
  drawAtlas,
  type AtlasIcon,
  type AtlasSite,
} from "./atlas";
import { SOUNDS, type GameAudio } from "./audio";
import { WORLD_COLS, WORLD_ROWS } from "./config";
import type { MapAnnotation } from "./persistence";
import type { WorldModel } from "./world";

const HINT_IDLE = "Click the map to mark it. M closes.";
// The same offer without naming a key nobody is holding. Which one is shown is decided by whether the
// player has actually touched the screen, not by the layout: a tablet with a keyboard should keep M.
const HINT_IDLE_TOUCH = "Tap the map to mark it.";
const HINT_EDITING = "Type a note, or pick a different icon.";
const HINT_UNSURVEYED = "UNSURVEYED GROUND · GO AND LOOK";

/** What the Atlas needs from the game to draw and to persist a change. */
export interface AtlasHost {
  readonly world: WorldModel;
  readonly audio: GameAudio;
  /** The live annotation list. Mutated in place by this view. */
  annotations: MapAnnotation[];
  /** Landing, anchors, and any cornerstone the player has already been near. */
  atlasSites(): AtlasSite[];
  /** Drone position in cells, plus heading in radians. */
  atlasPlayer(): { x: number; y: number; heading: number };
  /** Called after any annotation change, so the expedition saves it. */
  onAnnotationsChanged(): void;
  /** The player asked to close the map. Routed through the host so it takes the same path M does. */
  onCloseRequested(): void;
}

export class AtlasView {
  private readonly panel = document.querySelector<HTMLElement>("#atlas");
  private readonly canvas = document.querySelector<HTMLCanvasElement>("#atlasCanvas");
  private readonly seedLabel = document.querySelector<HTMLElement>("#atlasSeed");
  private readonly iconBar = document.querySelector<HTMLElement>("#atlasIcons");
  private readonly hint = document.querySelector<HTMLElement>("#atlasHint");
  private readonly editor = document.querySelector<HTMLElement>("#atlasEditor");
  private readonly noteField = document.querySelector<HTMLInputElement>("#atlasNote");
  private readonly legend = document.querySelector<HTMLElement>("#atlasLegend");
  private readonly closeButton = document.querySelector<HTMLElement>("#atlasClose");
  /**
   * Whether to phrase things for fingers.
   *
   * Set by the host rather than sniffed here, so the Atlas and the rest of the interface agree about
   * which device the player is on -- and they agree because there is one source for that fact.
   */
  touch = false;

  private context: CanvasRenderingContext2D | null = null;
  private icon: AtlasIcon = ATLAS_ICONS[0];
  private editing: MapAnnotation | null = null;
  /** Only ever increments, so an id is never reused after a delete. */
  private sequence = 0;

  constructor(private readonly host: AtlasHost) {
    // Routed through the host rather than flipping the panel here, so closing by button and closing
    // by key run the identical path -- the game owns `atlasOpen`, and a view that hid itself behind
    // the game's back would leave the two disagreeing.
    this.closeButton?.addEventListener("click", () => this.host.onCloseRequested());
  }

  get isEditing(): boolean {
    return this.editing !== null;
  }

  get open(): boolean {
    return this.panel?.classList.contains("open") ?? false;
  }

  /** Called on load so new ids do not collide with restored ones. */
  seedSequence(count: number): void {
    this.sequence = count;
  }

  bind(): void {
    this.canvas?.addEventListener("click", (event) => this.handleClick(event));
    document.querySelector("#atlasSaveNote")?.addEventListener("click", () => this.commitNote());
    document.querySelector("#atlasDeleteNote")?.addEventListener("click", () => this.deleteMarker());
    this.noteField?.addEventListener("keydown", (event) => {
      // The note field owns its own keys. Without this, typing "m" would close the
      // map and typing a digit would try to craft.
      event.stopPropagation();
      if (event.key === "Enter") this.commitNote();
      if (event.key === "Escape") this.closeEditor();
    });
    this.renderIcons();
  }

  setOpen(open: boolean): void {
    this.panel?.classList.toggle("open", open);
    this.panel?.classList.toggle("touch", this.touch);
    this.panel?.setAttribute("aria-hidden", String(!open));
    this.closeEditor();
    if (open) {
      this.render();
      this.host.audio.play(SOUNDS.atlasOpen);
    } else {
      this.host.audio.play(SOUNDS.atlasClose);
    }
  }

  render(): void {
    if (!this.canvas) return;
    if (!this.context) this.context = this.canvas.getContext("2d");
    if (!this.context) return;
    drawAtlas(this.context, {
      world: this.host.world,
      annotations: this.host.annotations,
      sites: this.host.atlasSites(),
      player: this.host.atlasPlayer(),
    });
    if (this.seedLabel) {
      const surveyed = Math.round((this.host.world.discoveredCount / (WORLD_COLS * WORLD_ROWS)) * 100);
      this.seedLabel.textContent =
        `${this.host.world.seedLabel} · ${surveyed}% surveyed · ${this.host.annotations.length} marks`;
    }
    if (this.legend) {
      this.legend.innerHTML = [
        ["province-karst", "KARST"],
        ["province-mirrorreef", "MIRRORREEF"],
        ["province-rootwarren", "ROOTWARREN"],
        ["excavated", "EXCAVATED"],
        ["structure", "STRUCTURE"],
      ].map(([css, label]) => `<span><i class="swatch ${css}"></i>${label}</span>`).join("");
    }
  }

  private renderIcons(): void {
    if (!this.iconBar) return;
    this.iconBar.innerHTML = ATLAS_ICONS
      .map((icon) =>
        `<button type="button" role="radio" data-icon="${icon}" aria-checked="${icon === this.icon}">${icon}</button>`)
      .join("");
    for (const button of this.iconBar.querySelectorAll<HTMLButtonElement>("[data-icon]")) {
      button.addEventListener("click", () => {
        this.icon = (button.dataset.icon ?? ATLAS_ICONS[0]) as AtlasIcon;
        // Choosing an icon retargets the marker being edited, so picking one after
        // placing is the same gesture as picking one before.
        if (this.editing) {
          this.editing.icon = this.icon;
          this.host.onAnnotationsChanged();
          this.render();
        }
        this.renderIcons();
      });
    }
  }

  /**
   * Place, select, or refuse a marker.
   *
   * Clicking empty surveyed map places one; clicking an existing marker opens it
   * for editing; clicking the dark refuses, because a map the player has not walked
   * is not theirs to annotate yet.
   */
  private handleClick(event: MouseEvent): void {
    if (!this.canvas) return;
    const bounds = this.canvas.getBoundingClientRect();
    // Through the displayed rect rather than the backing store: the canvas is
    // scaled to fit the aperture, so these are not the same size.
    const canvasX = ((event.clientX - bounds.left) / bounds.width) * ATLAS_WIDTH;
    const canvasY = ((event.clientY - bounds.top) / bounds.height) * ATLAS_HEIGHT;

    const existing = annotationAt(this.host.annotations, canvasX, canvasY);
    if (existing) {
      this.openEditor(existing);
      return;
    }
    const cell = atlasToWorld(canvasX, canvasY);
    if (!this.host.world.isDiscovered(cell.x, cell.y)) {
      if (this.hint) this.hint.textContent = HINT_UNSURVEYED;
      this.host.audio.play(SOUNDS.markRefused);
      return;
    }
    const note: MapAnnotation = {
      id: `note-${++this.sequence}-${Math.round(cell.x)}-${Math.round(cell.y)}`,
      x: cell.x,
      y: cell.y,
      icon: this.icon,
      note: "",
    };
    this.host.annotations.push(note);
    this.openEditor(note);
    this.host.onAnnotationsChanged();
    this.render();
    this.host.audio.play(SOUNDS.markPlaced);
  }

  private openEditor(note: MapAnnotation): void {
    this.editing = note;
    this.icon = note.icon as AtlasIcon;
    this.renderIcons();
    if (this.editor) this.editor.hidden = false;
    if (this.hint) this.hint.textContent = HINT_EDITING;
    const field = this.noteField;
    if (!field) return;
    field.value = note.note;
    // Deferred a tick: the editor opens from inside the canvas click handler, and
    // the browser moves focus to the click target after the handler returns, which
    // would take it straight back off the field.
    window.setTimeout(() => {
      field.focus();
      field.select();
    }, 0);
  }

  closeEditor(): void {
    this.editing = null;
    if (this.editor) this.editor.hidden = true;
    if (this.hint) this.hint.textContent = this.touch ? HINT_IDLE_TOUCH : HINT_IDLE;
  }

  commitNote(): void {
    if (!this.editing) return;
    this.editing.note = (this.noteField?.value ?? "").trim();
    this.closeEditor();
    this.host.onAnnotationsChanged();
    this.render();
  }

  deleteMarker(): void {
    const target = this.editing;
    if (!target) return;
    this.host.annotations = this.host.annotations.filter((note) => note !== target);
    this.closeEditor();
    this.host.onAnnotationsChanged();
    this.render();
  }
}

// The size and shape of the stage, as a live value rather than a constant.
//
// This used to be `VIEW_WIDTH = 1280` and `VIEW_HEIGHT = 720` in `config.ts`, and the whole game
// was drawn against those two numbers. That is a fine way to build a game that only ever runs in a
// 16:9 window, and a fatal one otherwise: on a 390x844 phone the CSS letterbox resolves to roughly
// 378x213, about a ninth of the screen, and everything drawn in stage pixels shrinks with it.
//
// So the stage now takes the shape of whatever is holding it. Nothing else in the codebase should
// assume an aspect ratio; code that needs to place something against an edge asks `view` for the
// current edge instead of importing a number that was true in 2025.

/** The design size. Still meaningful as the reference the desktop layout was authored against. */
export const DESIGN_WIDTH = 1280;
export const DESIGN_HEIGHT = 720;

/**
 * How sharp to render.
 *
 * Phones ship 3x displays, and rendering a full-screen WebGL scene at 3x costs nine times the
 * fill rate of 1x for a difference most people cannot see on a 6" panel. Capped at 2, which is
 * the point of diminishing returns and keeps mid-range hardware inside its frame budget.
 */
export const MAX_RESOLUTION = 2;

export type Layout = "desktop" | "tablet" | "phone";

export interface ViewState {
  /** Stage size in CSS pixels: what world coordinates are drawn against. */
  width: number;
  height: number;
  /** Device pixel ratio actually in use, after capping. */
  resolution: number;
  layout: Layout;
  /** True when the stage is taller than it is wide. */
  portrait: boolean;
  /**
   * Safe-area insets in CSS pixels, read from the environment.
   *
   * A notch and a home indicator are not decoration -- anything drawn under them is genuinely
   * invisible, and a button under the home indicator is worse than invisible because the swipe
   * that dismisses the app starts there.
   */
  safe: { top: number; right: number; bottom: number; left: number };
}

/**
 * The live stage.
 *
 * Deliberately a single mutable object rather than a value passed down through constructors: it is
 * read from drawing code in a dozen modules on every frame, and threading it through all of them
 * would be a lot of plumbing to describe one fact that is the same everywhere.
 */
export const view: ViewState = {
  width: DESIGN_WIDTH,
  height: DESIGN_HEIGHT,
  resolution: 1,
  layout: "desktop",
  portrait: false,
  safe: { top: 0, right: 0, bottom: 0, left: 0 },
};

/** Handy shorthands, so callers read as geometry rather than as arithmetic. */
export const centreX = (): number => view.width / 2;
export const centreY = (): number => view.height / 2;

type Listener = (state: ViewState) => void;
const listeners = new Set<Listener>();

/**
 * Be told when the stage changes shape.
 *
 * Returns its own unsubscribe, because the Refit Bay and the HUD both outlive individual claims
 * but not the page, and a listener that cannot be removed is a leak waiting for someone to add a
 * second game instance to a test.
 */
export function onViewChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Decide which layout a stage of this size and this input hardware wants.
 *
 * Size alone is not enough: a small window on a desktop is still a desktop, because it has a
 * keyboard and a precise pointer. Coarse pointer plus no hover is the honest signal for "this is
 * a finger", and it is what separates a phone from a narrow browser window.
 */
export function classify(width: number, height: number, coarse: boolean): Layout {
  if (!coarse) return "desktop";
  // The short edge is the stable measure across orientations -- a phone turned sideways is still a
  // phone, and keying off width alone would call it a tablet the moment it rotated.
  const short = Math.min(width, height);
  return short < 600 ? "phone" : "tablet";
}

/**
 * Stamp the layout onto the shell so CSS can branch on it.
 *
 * Must run *before* measuring, and is deliberately classified from the window rather than from the
 * container: the container's size is a consequence of this attribute -- a phone shell drops its
 * padding and its 16:9 lock -- so measuring first and stamping second would decide the layout from
 * the size the old layout produced, and settle one resize behind reality forever.
 */
export function syncLayout(shell: HTMLElement): Layout {
  const coarse = window.matchMedia?.("(pointer: coarse)").matches === true;
  const layout = classify(window.innerWidth, window.innerHeight, coarse);
  shell.dataset.layout = layout;
  // Portrait is stamped separately from layout: a phone can be turned, and the rotate gate needs
  // to know which way it is being held without the layout itself changing.
  shell.dataset.orientation = window.innerHeight > window.innerWidth ? "portrait" : "landscape";
  return layout;
}

const readInset = (styles: CSSStyleDeclaration, name: string): number => {
  const raw = styles.getPropertyValue(name).trim();
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Take the shape of `host`, and tell everyone who cares.
 *
 * Returns true when something actually changed, so callers can skip the expensive downstream work
 * -- a resize observer fires for reasons that are not resizes, and re-laying out the Refit Bay
 * sixty times a second because the scrollbar twitched is not free.
 */
export function measure(host: HTMLElement): boolean {
  const rect = host.getBoundingClientRect();
  // Guard against being measured before layout. A hidden tab reports zero, and a stage of zero
  // width propagates as a division by zero into every fit calculation downstream.
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const coarse = typeof window !== "undefined"
    && window.matchMedia?.("(pointer: coarse)").matches === true;
  const resolution = Math.min(MAX_RESOLUTION, window.devicePixelRatio || 1);
  const layout = classify(width, height, coarse);
  const portrait = height > width;

  const styles = getComputedStyle(document.documentElement);
  const safe = {
    top: readInset(styles, "--safe-top"),
    right: readInset(styles, "--safe-right"),
    bottom: readInset(styles, "--safe-bottom"),
    left: readInset(styles, "--safe-left"),
  };

  const changed = view.width !== width
    || view.height !== height
    || view.resolution !== resolution
    || view.layout !== layout
    || view.portrait !== portrait
    || view.safe.top !== safe.top
    || view.safe.right !== safe.right
    || view.safe.bottom !== safe.bottom
    || view.safe.left !== safe.left;
  if (!changed) return false;

  view.width = width;
  view.height = height;
  view.resolution = resolution;
  view.layout = layout;
  view.portrait = portrait;
  view.safe = safe;
  for (const listener of listeners) listener(view);
  return true;
}

/** For tests, which need a known stage without a DOM. */
export function setViewForTest(patch: Partial<ViewState>): void {
  Object.assign(view, patch);
  for (const listener of listeners) listener(view);
}

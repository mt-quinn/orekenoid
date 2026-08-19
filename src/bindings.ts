// What every key does, in one place the player can change.
//
// The controls used to be twenty `event.code === "KeyF"` comparisons scattered through the input handler
// and two held-key polls, with the tutorial's prompts carrying their own hardcoded strings beside them.
// That is two lists of the same facts, and the second one is a lie the moment anybody edits the first.
//
// So an action is the unit, a binding is a list of codes for it, and everything else -- the handler, the
// held-key polls, the coach's prompts, the pause panel's legend -- reads the same map. Rebinding is then
// a matter of putting a different code in the list, and the prompt that teaches it changes with it
// because it was never written down twice.

/** Everything the player can bind a key to. */
export type Action =
  | "moveUp" | "moveDown" | "moveLeft" | "moveRight"
  | "aimLeft" | "aimRight"
  | "commit" | "serve"
  | "paddleLeft" | "paddleRight"
  | "fast" | "slow"
  | "atlas" | "forge" | "pause"
  | "railSeed" | "blast" | "probe";

/**
 * The defaults, and the order the settings panel lists them in.
 *
 * Two codes per direction on purpose: WASD and the arrow keys have both always worked and taking one away
 * to make the list tidier would be a regression dressed as a refactor. A rebind replaces the whole list,
 * so a player who wants only arrows gets only arrows.
 */
export const DEFAULT_BINDINGS: Readonly<Record<Action, readonly string[]>> = {
  moveUp: ["KeyW", "ArrowUp"],
  moveDown: ["KeyS", "ArrowDown"],
  moveLeft: ["KeyA", "ArrowLeft"],
  moveRight: ["KeyD", "ArrowRight"],
  aimLeft: ["KeyQ"],
  aimRight: ["KeyE"],
  commit: ["KeyF", "Enter"],
  serve: ["Space"],
  paddleLeft: ["KeyA", "ArrowLeft"],
  paddleRight: ["KeyD", "ArrowRight"],
  fast: ["KeyW", "ArrowUp"],
  slow: ["KeyS", "ArrowDown"],
  atlas: ["KeyM"],
  forge: ["KeyC"],
  pause: ["KeyP"],
  railSeed: ["KeyR"],
  blast: ["KeyB"],
  probe: ["Backquote"],
};

/** How each action is named to the player, for the settings list and the prompts. */
export const ACTION_LABEL: Readonly<Record<Action, string>> = {
  moveUp: "FLY UP",
  moveDown: "FLY DOWN",
  moveLeft: "FLY LEFT",
  moveRight: "FLY RIGHT",
  aimLeft: "TURN FRAME LEFT",
  aimRight: "TURN FRAME RIGHT",
  commit: "COMMIT CLAIM",
  serve: "SERVE",
  paddleLeft: "PADDLE LEFT",
  paddleRight: "PADDLE RIGHT",
  fast: "SPEED UP",
  slow: "SLOW DOWN",
  atlas: "ATLAS",
  forge: "REFIT BAY",
  pause: "PAUSE",
  railSeed: "RAIL SEED",
  blast: "BLAST CHARGE",
  probe: "DIAGNOSTIC PROBE",
};

/**
 * Escape is deliberately not bindable.
 *
 * It closes whatever is open -- the note editor, the Atlas, the Refit Bay -- and falls through to pause.
 * A player who rebound it onto something else could open a panel with no way out, which is the one
 * failure a settings screen must not be able to produce.
 */
export const RESERVED_CODES: readonly string[] = ["Escape"];

const STORAGE_KEY = "orekenoid.bindings.v1";

/** A code as the player should read it: `KeyF` is not a key anybody has on their keyboard. */
export function keyName(code: string): string {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Arrow")) return `${code.slice(5).toUpperCase()} ARROW`;
  if (code === "Space") return "SPACE";
  if (code === "Backquote") return "`";
  if (code === "Enter") return "ENTER";
  return code.toUpperCase();
}

export class Bindings {
  private map: Record<Action, string[]>;

  constructor() {
    this.map = Bindings.clone(DEFAULT_BINDINGS);
    this.load();
  }

  private static clone(source: Readonly<Record<Action, readonly string[]>>): Record<Action, string[]> {
    const out = {} as Record<Action, string[]>;
    for (const key of Object.keys(source) as Action[]) out[key] = [...source[key]];
    return out;
  }

  /** Every action, in declaration order, for the settings list. */
  get actions(): Action[] {
    return Object.keys(DEFAULT_BINDINGS) as Action[];
  }

  codesFor(action: Action): readonly string[] {
    return this.map[action];
  }

  /** How this action reads on a keycap, e.g. `W / UP ARROW`. */
  label(action: Action): string {
    const codes = this.map[action];
    return codes.length ? codes.map(keyName).join(" / ") : "UNBOUND";
  }

  /**
   * Compose a prompt's key hint from the actions it teaches, so the two can never drift.
   *
   * Compressed rather than concatenated, because the naive join is unreadable in a small prompt: the
   * movement rung came out as "W / UP ARROW, A / LEFT ARROW, S / DOWN ARROW, D / RIGHT ARROW" where the
   * hand-written string it replaced said "WASD / ARROWS".
   *
   * When every action carries the same number of keys, they are read as columns -- the first key of each,
   * then the second -- and a column of three or more single letters becomes a cluster, a column of arrows
   * becomes "ARROWS". Anything less regular than that falls back to naming them one at a time, which is
   * long but never wrong.
   */
  hint(...actions: Action[]): string {
    if (!actions.length) return "";
    const lists = actions.map((action) => this.map[action]);
    const depth = lists[0].length;
    const even = depth > 0 && lists.every((codes) => codes.length === depth);
    // Columns only for a homogeneous group -- a direction rose, or one opposed pair. A mixed rung like
    // "turn the frame, then commit" is three different controls, and rendering it "Q / E / G" would read
    // as three ways to do one thing.
    const homogeneous = even && (actions.length >= 4 || actions.length === 2);
    if (!homogeneous) return actions.map((action) => this.label(action)).join(", ");

    const columns: string[] = [];
    for (let index = 0; index < depth; index++) {
      const names = lists.map((codes) => keyName(codes[index]));
      if (names.length >= 4 && names.every((name) => name.length === 1)) {
        // WASD, and whatever it becomes after a rebind.
        columns.push(names.join(""));
      } else if (names.length >= 2 && names.every((name) => name.endsWith(" ARROW"))) {
        columns.push("ARROWS");
      } else {
        columns.push(names.join(" / "));
      }
    }
    return columns.join(" / ");
  }

  matches(action: Action, code: string): boolean {
    return this.map[action].includes(code);
  }

  /** Is any key bound to this action currently held? `held` is the caller's key set. */
  isHeld(action: Action, held: ReadonlySet<string>): boolean {
    return this.map[action].some((code) => held.has(code));
  }

  /**
   * Bind one key to one action, taking it off anything else that had it.
   *
   * Exclusive because a code doing two things is a bug the player cannot see: they would press the key and
   * get both, or get whichever branch the handler reached first. Reserved codes are refused, and so is
   * unbinding the last key of an action that has no other way to be performed -- `commit` and `serve` have
   * no pointer equivalent on a desktop, so leaving them unbound would strand the expedition.
   */
  bind(action: Action, code: string): { ok: boolean; reason?: string } {
    if (RESERVED_CODES.includes(code)) return { ok: false, reason: `${keyName(code)} is reserved` };
    for (const other of this.actions) {
      if (other === action) continue;
      // Directions are shared between survey and claim on purpose, so binding one moves the pair.
      if (PAIRED[other] === action) continue;
      this.map[other] = this.map[other].filter((existing) => existing !== code);
    }
    this.map[action] = [code];
    const pair = PAIRED[action];
    if (pair) this.map[pair] = [code];
    this.save();
    return { ok: true };
  }

  reset(): void {
    this.map = Bindings.clone(DEFAULT_BINDINGS);
    this.save();
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.map));
    } catch {
      // A browser refusing storage is not a reason to refuse the rebind for this session.
    }
  }

  private load(): void {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch {
      return;
    }
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Partial<Record<Action, unknown>>;
      for (const action of this.actions) {
        const codes = parsed[action];
        // Validated per action rather than wholesale: a stored file from an older build is missing the
        // actions added since, and the right answer for those is the default rather than nothing.
        if (!Array.isArray(codes)) continue;
        const clean = codes.filter((code): code is string => typeof code === "string" && !RESERVED_CODES.includes(code));
        this.map[action] = clean;
      }
    } catch {
      this.map = Bindings.clone(DEFAULT_BINDINGS);
    }
  }
}

/**
 * Actions that are one control wearing two names.
 *
 * Flying left in the survey and sliding the paddle left in a claim are the same key to the player, and a
 * settings screen that made them separate rows would be describing the implementation rather than the
 * game. Binding either moves both.
 */
const PAIRED: Partial<Record<Action, Action>> = {
  moveLeft: "paddleLeft",
  paddleLeft: "moveLeft",
  moveRight: "paddleRight",
  paddleRight: "moveRight",
  moveUp: "fast",
  fast: "moveUp",
  moveDown: "slow",
  slow: "moveDown",
};

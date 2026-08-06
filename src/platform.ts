// The parts of running on a phone that are not the game.
//
// Two jobs, both of which are invisible when they work and obvious when they do not.
//
// **Offline.** The game is a fixed bundle plus a seeded generator: no server, no content to fetch,
// no session. Offline is therefore the natural state rather than a feature, and a service worker is
// all it takes to make the install honest about that.
//
// **The wake lock.** A claim can run for minutes with the player's thumb resting still on the
// paddle, which every phone reads as idle and answers by dimming and then locking the screen. That
// is the single most annoying failure a mobile game can have, and it is one API call to prevent.

/** Registered after load so it never competes with the first paint for bandwidth. */
export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;
  // Vite serves modules unbundled in development, and a service worker caching those would serve
  // stale modules through an edit -- the one place where "works offline" is actively unhelpful.
  if (import.meta.env?.DEV) return;
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => {
      // A failed registration costs offline play and nothing else. Not worth interrupting anyone.
    });
  });
}

/**
 * Keep the screen awake while the game is being played.
 *
 * The lock is dropped by the browser whenever the page is hidden and cannot be re-taken from a
 * background task, so it has to be re-requested on the way back -- which is why this is a small
 * object with a `refresh` rather than a single call at startup.
 */
export class ScreenAwake {
  private sentinel: WakeLockSentinel | null = null;
  private wanted = false;

  get held(): boolean {
    return this.sentinel !== null;
  }

  attach(): void {
    // Re-taken on return, because a hidden page always loses the lock. Without this the screen
    // sleeps on the second claim of every session and never on the first, which is the kind of bug
    // that gets reported as "sometimes".
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && this.wanted) void this.request();
    });
  }

  /** Called when play starts or stops. Idempotent. */
  set(wanted: boolean): void {
    if (wanted === this.wanted) return;
    this.wanted = wanted;
    if (wanted) void this.request();
    else void this.release();
  }

  private async request(): Promise<void> {
    if (this.sentinel) return;
    // Unsupported on iOS Safari at the time of writing, which is precisely why this is a soft
    // failure: the game must not care whether it got the lock.
    const wakeLock = navigator.wakeLock;
    if (!wakeLock) return;
    try {
      const sentinel = await wakeLock.request("screen");
      this.sentinel = sentinel;
      sentinel.addEventListener("release", () => {
        this.sentinel = null;
      });
    } catch {
      // Denied, or the page was hidden between the check and the call. Nothing to recover.
    }
  }

  private async release(): Promise<void> {
    const sentinel = this.sentinel;
    this.sentinel = null;
    try {
      await sentinel?.release();
    } catch {
      // Already gone.
    }
  }
}

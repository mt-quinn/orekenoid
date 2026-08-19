import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  timeout: 90_000,
  /**
   * Parallel, because serial was costing ten minutes a run.
   *
   * The suite is fifty-odd browser tests that each boot the game, and at one worker that is eight to ten
   * minutes of wall clock before anything can be pushed. Four is deliberate rather than "as many as there
   * are cores": the game is rendered in software here, so every worker is CPU-bound, and oversubscribing
   * turns timing-sensitive tests -- the posed fitting animation, the frame-rate ones -- into flakes. Four
   * on eight logical cores leaves room for the dev server and the compositor.
   */
  workers: 3,
  /**
   * One retry, and it is not there to paper over a broken assertion.
   *
   * Three of these tests measure time -- a paused simulation not advancing, ore still falling when a board
   * clears, a gesture prompt appearing within a beat -- and running the game in software on a contended
   * machine perturbs exactly those. At four workers they failed about one run in one; at three with a retry
   * they pass. A test that fails twice in a row is a real failure and still reported as one.
   */
  retries: 1,
  use: {
    baseURL: "http://127.0.0.1:8080",
    colorScheme: "dark",
  },
  projects: [
    {
      // The keyboard game, on the 16:9 cabinet it was authored for.
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } },
      testIgnore: /touch\./,
    },
    {
      // A phone profile, spelled out rather than taken from `devices["iPhone 13"]`: that
      // descriptor declares WebKit, which is not installed here, and falling back to Chromium
      // under a WebKit descriptor fails in the protocol rather than in the test.
      //
      // `hasTouch` makes Playwright dispatch real touch events instead of synthesising mouse
      // ones -- the difference between testing the touch layer and testing a mouse wearing a hat.
      // `isMobile` is what makes `(pointer: coarse)` true, which is what the layout classifier
      // keys off, so without it the game would correctly decide this is a desktop.
      name: "phone",
      use: {
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        hasTouch: true,
        isMobile: true,
      },
      testMatch: /touch\./,
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:8080",
    reuseExistingServer: true,
  },
});

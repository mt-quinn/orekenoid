import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  timeout: 90_000,
  workers: 1,
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

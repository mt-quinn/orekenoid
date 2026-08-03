import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  timeout: 90_000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:8080",
    viewport: { width: 1440, height: 1000 },
    colorScheme: "dark",
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:8080",
    reuseExistingServer: true,
  },
});

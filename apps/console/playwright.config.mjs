import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: "./browser-tests", timeout: 30_000, workers: 1,
  use: { browserName: "chromium", channel: "chromium", headless: true, ignoreHTTPSErrors: true, viewport: { width: 390, height: 800 } } });

import { defineConfig } from "@playwright/test";

// Intentionally independent of the root config: no environment/Clerk setup,
// credentials, application server, or provider access is loaded.
export default defineConfig({
  testDir: ".",
  testMatch: /navigation\.spec\.ts/,
  outputDir: "../.artifacts/guide-navigation",
  workers: 1,
  retries: 0,
  timeout: 20_000,
  expect: { timeout: 5000 },
  reporter: "list",
  use: { headless: true, channel: "chrome", viewport: { width: 1280, height: 900 }, trace: "off", video: "off", screenshot: "off" },
});

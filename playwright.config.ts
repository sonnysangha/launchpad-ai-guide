import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { defineConfig, devices } from "@playwright/test";

if (existsSync(".env.local")) loadEnvFile(".env.local");
process.env.CLERK_PUBLISHABLE_KEY ??= process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e/.artifacts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3212",
    headless: true,
    trace: "off",
    video: "off",
    screenshot: "off",
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
    ...devices["Desktop Chrome"],
    // No user profile or shared browser connection is used.
    channel: process.env.PLAYWRIGHT_CHANNEL || "chrome",
  },
  projects: [
    { name: "clerk-setup", testMatch: /clerk\.setup\.ts/ },
    { name: "public", testMatch: /public\.spec\.ts/ },
    { name: "authenticated", testMatch: /launchpad\.spec\.ts/, dependencies: ["clerk-setup"] },
  ],
});

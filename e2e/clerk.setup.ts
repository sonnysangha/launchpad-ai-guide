import { clerkSetup } from "@clerk/testing/playwright";
import { test as setup } from "@playwright/test";

// Clerk requires a project setup so its test token reaches test workers.
setup("obtain official Clerk development testing token", async () => {
  if (!process.env.CLERK_SECRET_KEY?.startsWith("sk_test_") || !process.env.CLERK_PUBLISHABLE_KEY?.startsWith("pk_test_")) {
    throw new Error("These tests require this project's Clerk development keys in .env.local. Production keys are refused.");
  }
  await clerkSetup();
});

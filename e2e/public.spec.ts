import { expect, test } from "@playwright/test";

test("public landing and protected routes enforce authentication", async ({ page, request }) => {
  const landing = await page.goto("/", { waitUntil: "domcontentloaded" });
  expect(landing?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Good projects start");
  await expect(page.getByRole("link", { name: "Create your workspace" })).toBeVisible();
  await expect(page.getByText(/Fictional demo · Sample projects only/)).toBeVisible();

  for (const path of ["/onboarding", "/dashboard"]) {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/sign-in(?:[/?#]|$)/);
  }
  const result = await request.get("/api/workspace");
  expect(result.status()).toBe(401);
  expect(result.headers()["cache-control"]).toContain("no-store");
  expect(await result.text()).not.toContain("workspaceName");
});

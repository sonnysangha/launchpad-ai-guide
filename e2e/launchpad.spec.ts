import { randomBytes, randomUUID } from "node:crypto";
import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

type Fixture = { email: string; password: string };
type SavedTask = { id: string; title: string; description?: string; stage: string };
type Workspace = { id: string; workspaceName: string; projectName: string; workflow: string; tasks: SavedTask[] };

const runId = randomUUID().replaceAll("-", "");
const fixtures: Fixture[] = [];

function newFixture(): Fixture {
  const fixture = {
    email: `launchpad-e2e-${runId}-${fixtures.length}+clerk_test@example.com`,
    password: `Lp!${randomBytes(24).toString("base64url")}9a`,
  };
  fixtures.push(fixture);
  return fixture;
}

async function enterPassword(page: Page, password: string) {
  // Use Clerk's documented input path; scrub a fill failure before it can log
  // the generated credential. Traces and videos are also disabled.
  const input = page.locator("input[name=password]");
  await expect(input).toBeVisible();
  try { await input.fill(password); }
  catch { throw new Error("The test password could not be entered; value omitted."); }
  await expect.poll(async () => (await input.inputValue()) === password).toBe(true);
}

async function completeVerification(page: Page, destination: "onboarding" | "dashboard") {
  const code = page.getByRole("textbox", { name: "Enter verification code" });
  await expect.poll(async () => {
    const pathname = new URL(page.url()).pathname;
    if (pathname === `/${destination}`) return "done";
    return await code.isVisible() ? "verify" : `waiting:${pathname}`;
  }, { timeout: 30_000 }).toMatch(/^(done|verify)$/);
  if (await code.isVisible()) await code.pressSequentially("424242");
  await expect(page).toHaveURL(new RegExp(`/${destination}(?:[?#]|$)`), { timeout: 30_000 });
}

async function signUp(page: Page, fixture: Fixture) {
  await setupClerkTestingToken({ page });
  await page.goto("/sign-up", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".cl-signUp-root")).toBeVisible();
  for (const [name, value] of [["firstName", "Launchpad"], ["lastName", "Test"], ["username", `lp${randomBytes(8).toString("hex")}`]]) {
    const input = page.locator(`input[name=${name}]`);
    if (await input.isVisible()) await input.fill(value);
  }
  await page.locator("input[name=emailAddress]").fill(fixture.email);
  await enterPassword(page, fixture.password);
  const legal = page.locator("input[name=legalAccepted]");
  if (await legal.isVisible()) await legal.check();
  // The OTP input can render before Clerk has prepared the verification.
  // Register before clicking so even a fast development response is observed.
  await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/prepare_verification") && response.status() === 200),
    page.getByRole("button", { name: "Continue", exact: true }).click(),
  ]);
  await completeVerification(page, "onboarding");
}

async function signInThroughForm(page: Page, fixture: Fixture) {
  await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
  await page.locator("input[name=identifier]").fill(fixture.email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/sign-in\/factor-one(?:[?#]|$)/);
  await expect(page.getByRole("heading", { name: "Enter your password", exact: true })).toBeVisible();
  await enterPassword(page, fixture.password);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  try { await completeVerification(page, "dashboard"); }
  catch (error) {
    console.error("Sign-in failure labels", {
      path: new URL(page.url()).pathname,
      headings: await page.getByRole("heading").allTextContents(),
      errors: await page.locator(".cl-formFieldErrorText, .cl-alertText").allTextContents(),
    });
    throw error;
  }
}

async function workspaceFor(page: Page): Promise<Workspace | null> {
  const response = await page.evaluate(async () => {
    const result = await fetch("/api/workspace", { credentials: "same-origin" });
    return { status: result.status, body: await result.json() };
  });
  expect(response.status).toBe(200);
  return response.body.workspace;
}

async function createThroughForm(page: Page, workspaceName: string, projectName: string, workflow: "Campaign" | "Client Delivery") {
  await page.locator('[data-guide-target="project-home"]').click();
  await page.getByLabel("Business or workspace name", { exact: true }).fill(workspaceName);
  await page.getByLabel("Project name", { exact: true }).fill(projectName);
  await page.getByRole("radio", { name: new RegExp(workflow) }).check();
  expect(await workspaceFor(page)).toBeNull();
  const saved = page.waitForResponse(response => new URL(response.url()).pathname === "/api/workspace" && response.request().method() === "POST");
  await page.getByRole("button", { name: "Create my workspace", exact: true }).click();
  expect((await saved).status()).toBe(201);
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { level: 1, name: projectName })).toBeVisible();
}

async function openGuide(page: Page) {
  const guide = page.getByRole("region", { name: "Avatar guide", exact: true });
  if (!await guide.isVisible()) await page.getByRole("button", { name: "Open avatar guide", exact: true }).click();
  await expect(guide).toBeVisible();
  return guide;
}

async function expectTab(page: Page, name: "Setup" | "Preview" | "Board" | "List") {
  const tab = page.getByRole("tab", { name, exact: true });
  const panel = page.getByRole("tabpanel", { name, exact: true });
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await expect(tab).toHaveAttribute("tabindex", "0");
  await expect(panel).toBeVisible();
  await expect(page.getByRole("tabpanel")).toHaveCount(1);
  expect(await tab.getAttribute("aria-controls")).toBe(await panel.getAttribute("id"));
  return panel;
}

test.afterAll(async ({ browser }) => {
  // Restrict both API lookup and deletion to this run's exact test addresses.
  // The official sign-in helper is used only for teardown, never the tested login.
  for (const fixture of fixtures) {
    const url = new URL("https://api.clerk.com/v1/users");
    url.searchParams.append("email_address", fixture.email);
    const headers = { Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}` };
    const lookup = await fetch(url, { headers });
    if (!lookup.ok) throw new Error(`Test-user cleanup lookup failed (${lookup.status}); no broad cleanup was attempted.`);
    const users = await lookup.json() as { id: string; email_addresses: { email_address: string }[] }[];
    for (const user of users) {
      if (!user.email_addresses.some(item => item.email_address === fixture.email)) throw new Error("Cleanup refused an unexpected user.");
      const context = await browser.newContext({ baseURL: "http://127.0.0.1:3212" });
      try {
        const page = await context.newPage();
        await page.goto("/", { waitUntil: "domcontentloaded" });
        await clerk.signIn({ page, emailAddress: fixture.email });
        await page.goto("/", { waitUntil: "domcontentloaded" });
        const status = await page.evaluate(async () => (await fetch("/api/reset", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmation: "RESET" }),
        })).status);
        if (status !== 200) throw new Error(`Own test-workspace cleanup failed (${status}); test user preserved for targeted cleanup.`);
      } finally {
        await context.close();
      }
      const deleted = await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(user.id)}`, { method: "DELETE", headers });
      if (!deleted.ok) throw new Error(`Exact test-user cleanup failed (${deleted.status}).`);
    }
  }
});

test("real Clerk signup, confirmed persistence, returning login, isolation, help, and own-data reset", async ({ page, browser }, testInfo) => {
  const first = newFixture();
  const second = newFixture();
  const secondContext = await browser.newContext({ baseURL: "http://127.0.0.1:3212" });
  const otherPage = await secondContext.newPage();
  const workspaceName = "Studio North · browser test";
  const projectName = "Juniper brand refresh";
  const newTask = { title: "Design homepage", description: "Create the Juniper launch page with a clear signup action.", stage: "Build" };
  let createdTaskId: string;
  let roomRequests = 0;
  const countRoom = (request: { url(): string; method(): string }) => {
    if (new URL(request.url()).pathname === "/api/room" && request.method() === "POST") roomRequests++;
  };
  // This ordinary suite must never allocate a real room, even if an interaction
  // unexpectedly starts one. The explicit fault-injection step overrides this guard.
  const refuseLiveRoom = (route: Route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Live rooms are disabled in the ordinary browser suite." }) });
  page.on("request", countRoom);
  otherPage.on("request", countRoom);
  await page.route("**/api/room", refuseLiveRoom);
  await otherPage.route("**/api/room", refuseLiveRoom);
  try {
    await test.step("real UI signup routes an incomplete user to onboarding", async () => {
      await signUp(page, first);
      await expect(page.getByRole("button", { name: "Open user menu", exact: true })).toBeVisible();
      await expectTab(page, "Setup");
      await expect(page.getByRole("region", { name: "Interactive demo modes" })).toHaveCount(0);
      expect(await workspaceFor(page)).toBeNull();
      await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
      await expect(page).toHaveURL(/\/onboarding$/);
      await expect(page.getByRole("button", { name: "Open user menu", exact: true })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath("onboarding-desktop.png"), fullPage: true, animations: "disabled" });
      await page.setViewportSize({ width: 390, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath("onboarding-mobile.png"), fullPage: true, animations: "disabled" });
      await page.setViewportSize({ width: 1280, height: 720 });
    });

    await test.step("project views preserve the draft and sidebar navigation opens real workspace sections", async () => {
      const setup = await expectTab(page, "Setup");
      await setup.getByLabel("Business or workspace name", { exact: true }).fill("Draft studio");
      await setup.getByLabel("Project name", { exact: true }).fill("Draft project");
      const setupTab = page.getByRole("tab", { name: "Setup", exact: true });
      await setupTab.focus();
      await setupTab.press("ArrowRight");
      const preview = await expectTab(page, "Preview");
      await expect(page.getByRole("tab", { name: "Preview", exact: true })).toBeFocused();
      await preview.locator('[data-guide-target="stage-review"]').click();
      await expect(preview.locator('[data-guide-target="stage-review"]')).toHaveAttribute("data-guide-active", "true");
      expect(await workspaceFor(page)).toBeNull();
      await page.screenshot({ path: testInfo.outputPath("project-preview-desktop.png"), fullPage: true, animations: "disabled" });
      await page.getByRole("tab", { name: "Preview", exact: true }).press("Home");
      await expectTab(page, "Setup");
      await expect(setupTab).toBeFocused();
      await setupTab.press("ArrowLeft");
      await expectTab(page, "Preview");
      await page.locator('[data-guide-target="nav-roles"]').click();
      await expect(page.getByRole("heading", { level: 1, name: "People", exact: true })).toBeVisible();
      await expect(page.getByRole("table", { name: "Workspace members" }).getByRole("row")).toHaveCount(2);
      await expect(page.getByRole("tablist", { name: "Project views" })).toHaveCount(0);
      await page.locator('[data-guide-target="role-contributor"]').click();
      await expect(page.getByText(/A Contributor would produce the project work/)).toBeVisible();
      await page.locator('[data-guide-target="role-reviewer"]').click();
      await expect(page.getByText(/A Reviewer would check the work/)).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath("people-desktop.png"), fullPage: true, animations: "disabled" });
      await page.locator('[data-guide-target="nav-handbook"]').click();
      await expect(page.getByRole("heading", { level: 1, name: "Help center", exact: true })).toBeVisible();
      const question = page.locator("article").filter({ has: page.getByRole("button", { name: "Can I invite a teammate or client?", exact: true }) });
      await question.getByRole("button").click();
      await expect(question.getByRole("button")).toHaveAttribute("aria-expanded", "true");
      await expect(question.getByText(/Invitations and shared accounts are not supported/)).toBeVisible();
      await expect(question.getByText(/Understand the sample roles · v1.0.0/)).toBeVisible();
      await question.getByRole("button").click();
      await expect(question.getByRole("button")).toHaveAttribute("aria-expanded", "false");
      await page.getByRole("searchbox", { name: "Search handbook" }).fill("definitely-no-answer");
      await expect(page.getByRole("heading", { name: "No matching answers" })).toBeVisible();
      await page.getByRole("button", { name: "Clear handbook search", exact: true }).click();
      await expect(question.getByRole("button")).toBeVisible();
      await expect(page.getByRole("searchbox", { name: "Search handbook" })).toBeFocused();
      await page.locator('[data-guide-target="project-home"]').click();
      await expectTab(page, "Setup");
      await expect(setup.getByLabel("Business or workspace name", { exact: true })).toHaveValue("Draft studio");
      await expect(setup.getByLabel("Project name", { exact: true })).toHaveValue("Draft project");
      await setup.getByLabel("Business or workspace name", { exact: true }).fill("");
      await setup.getByLabel("Project name", { exact: true }).fill("");
      expect(roomRequests).toBe(0);
    });

    await test.step("widget opening, collapsing, and all mode choices never request a room", async () => {
      const launcher = page.getByRole("button", { name: "Open avatar guide", exact: true });
      await expect(launcher).toHaveAttribute("aria-expanded", "false");
      await expect(page.getByRole("region", { name: "Avatar guide", exact: true })).toHaveCount(0);
      let guide = await openGuide(page);
      await expect(guide.getByRole("heading", { name: "Launchpad guide", exact: true })).toBeFocused();
      await expect(guide.getByRole("button", { name: "Start a conversation", exact: true })).toBeVisible();
      const settleWidget = async () => {
        await expect(guide).toHaveCSS("opacity", "1");
        await expect.poll(() => guide.evaluate(element => {
          const rect = element.getBoundingClientRect();
          const bottom = window.innerWidth <= 520 ? 12 : 20;
          const right = window.innerWidth <= 520 ? 12 : 22;
          return Math.abs(window.innerHeight - rect.bottom - bottom) < 2 && Math.abs(document.documentElement.getBoundingClientRect().right - rect.right - right) < 2;
        })).toBe(true);
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      };
      await settleWidget();
      await page.screenshot({ path: testInfo.outputPath("widget-expanded-desktop.png"), fullPage: false, animations: "disabled" });
      await page.setViewportSize({ width: 390, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await settleWidget();
      await page.screenshot({ path: testInfo.outputPath("widget-expanded-mobile.png"), fullPage: false, animations: "disabled" });
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.keyboard.press("Escape");
      await expect(launcher).toBeFocused();
      await page.screenshot({ path: testInfo.outputPath("widget-collapsed-desktop.png"), fullPage: false, animations: "disabled" });
      for (const [value, widgetLabel] of [["tour", "Feature tour"], ["qa", "Product Q&A"], ["setup", "Guided setup"]]) {
        guide = await openGuide(page);
        const mode = guide.getByLabel("Conversation type", { exact: true });
        await mode.selectOption(value);
        await expect(mode).toHaveValue(value);
        await expect(guide.getByText(`${widgetLabel} · AI assistant`, { exact: true })).toBeVisible();
        await guide.getByRole("button", { name: "Collapse guide", exact: true }).click();
        await expect(launcher).toBeVisible();
        expect(roomRequests).toBe(0);
      }
      await page.locator('[data-guide-target="nav-handbook"]').click();
      await page.getByRole("button", { name: "Ask your guide", exact: true }).click();
      guide = page.getByRole("region", { name: "Avatar guide", exact: true });
      await expect(guide.getByText("Guided setup · AI assistant", { exact: true })).toBeVisible();
      await guide.getByLabel("Conversation type", { exact: true }).selectOption("qa");
      await expect(guide.getByText("Product Q&A · AI assistant", { exact: true })).toBeVisible();
      await guide.getByLabel("Conversation type", { exact: true }).selectOption("setup");
      await guide.getByRole("button", { name: "Collapse guide", exact: true }).click();
      await page.locator('[data-guide-target="project-home"]').click();
      expect(roomRequests).toBe(0);
      expect(await workspaceFor(page)).toBeNull();
    });

    await test.step("invalid drafts and missing confirmation do not persist", async () => {
      await page.getByRole("button", { name: "Create my workspace", exact: true }).click();
      await expect(page.getByLabel("Business or workspace name", { exact: true })).toHaveAttribute("aria-invalid", "true");
      await expect(page.getByLabel("Project name", { exact: true })).toHaveAttribute("aria-invalid", "true");
      const status = await page.evaluate(async () => (await fetch("/api/workspace", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceName: "Unconfirmed", projectName: "Not saved", workflow: "campaign", confirmed: false }),
      })).status);
      expect(status).toBe(400);
      expect(await workspaceFor(page)).toBeNull();
    });

    await test.step("failed guide startup retains End retry and blocks saving until room cleanup succeeds", async () => {
      // Fault injection only: no real room, media, token, or successful avatar is simulated.
      // A truncated successful response represents an allocated room whose token was not delivered.
      let cleanupRequests = 0;
      let workspaceWrites = 0;
      let cleanupAllowed = false;
      const countWrites = (request: { url(): string; method(): string }) => {
        if (new URL(request.url()).pathname === "/api/workspace" && request.method() === "POST") workspaceWrites++;
      };
      page.on("request", countWrites);
      const incompleteRoom = (route: Route) => route.fulfill({
        status: 200, contentType: "application/json", body: JSON.stringify({ roomName: "launchpad-e2e-failed-start" }),
      });
      const cleanupRoom = (route: Route) => {
        cleanupRequests++;
        return route.fulfill({ status: cleanupAllowed ? 200 : 503, contentType: "application/json", body: JSON.stringify(cleanupAllowed ? { ended: true } : { error: "Test cleanup failure" }) });
      };
      await page.route("**/api/room", incompleteRoom);
      await page.route("**/api/room/end", cleanupRoom);
      try {
        await page.getByLabel("Business or workspace name", { exact: true }).fill(workspaceName);
        await page.getByLabel("Project name", { exact: true }).fill(projectName);
        await expect(page.getByLabel("Business or workspace name", { exact: true })).toHaveAttribute("aria-invalid", "false");
        await expect(page.getByLabel("Project name", { exact: true })).toHaveAttribute("aria-invalid", "false");
        const guide = await openGuide(page);
        await guide.getByRole("button", { name: "Start a conversation", exact: true }).click();
        await expect(guide.getByRole("alert")).toContainText("could not be closed");
        await expect(guide.getByRole("button", { name: "End conversation", exact: true })).toBeVisible();
        const attemptsBeforeCreate = cleanupRequests;
        await page.getByRole("button", { name: "Create my workspace", exact: true }).click();
        await expect(page.locator(".form-error")).toBeVisible();
        expect(cleanupRequests).toBeGreaterThan(attemptsBeforeCreate);
        expect(workspaceWrites).toBe(0);
        expect(await workspaceFor(page)).toBeNull();
        await expect(page).toHaveURL(/\/onboarding$/);
        await expect(page.getByLabel("Business or workspace name", { exact: true })).toHaveValue(workspaceName);
        await expect(page.getByLabel("Project name", { exact: true })).toHaveValue(projectName);
        cleanupAllowed = true;
        await guide.getByRole("button", { name: "End conversation", exact: true }).click();
        await expect(guide.getByRole("status")).toHaveText("Conversation ended");
        await expect(guide.getByRole("button", { name: "Start again", exact: true })).toBeVisible();
        expect(workspaceWrites).toBe(0);
      } finally {
        page.off("request", countWrites);
        await page.unroute("**/api/room", incompleteRoom);
        await page.unroute("**/api/room/end", cleanupRoom);
      }
    });

    await test.step("explicit Create persists a workspace, sample project, and four-stage board", async () => {
      await createThroughForm(page, workspaceName, projectName, "Client Delivery");
      const saved = await workspaceFor(page);
      expect(saved).toMatchObject({ workspaceName, projectName, workflow: "client_delivery" });
      expect(saved!.tasks.length).toBeGreaterThan(0);
      for (const stage of ["Brief", "Build", "Review", "Handoff"]) await expect(page.getByRole("heading", { level: 2, name: stage, exact: true })).toBeVisible();
      await page.reload();
      await expect(page.getByRole("heading", { level: 1, name: projectName })).toBeVisible();
      await expect(page.getByRole("button", { name: "Open user menu", exact: true })).toBeVisible();
      expect((await workspaceFor(page))!.id).toBe(saved!.id);
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await page.screenshot({ path: testInfo.outputPath("saved-dashboard.png"), fullPage: true, animations: "disabled" });
      await page.setViewportSize({ width: 390, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath("dashboard-mobile.png"), fullPage: true, animations: "disabled" });
      await page.setViewportSize({ width: 1280, height: 720 });
    });

    await test.step("Board and List share saved tasks, search, filters, and accessible details", async () => {
      const before = await workspaceFor(page);
      const tasks = page.getByRole("button", { name: /^Open task:/ });
      const count = await tasks.count();
      expect(count).toBeGreaterThan(0);
      const firstTask = tasks.first();
      const title = (await firstTask.getAttribute("aria-label"))!.replace("Open task: ", "");
      await firstTask.click();
      const dialog = page.getByRole("dialog", { name: title, exact: true });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("heading", { name: title, exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dialog).not.toBeVisible();
      await expect(firstTask).toBeFocused();
      await page.getByRole("searchbox", { name: "Search tasks" }).fill("definitely-no-task");
      await expect(page.getByText("No tasks match your search and filter.", { exact: true })).toBeVisible();
      await expect(tasks).toHaveCount(0);
      await page.getByRole("button", { name: "Clear search and filter", exact: true }).click();
      await expect(tasks).toHaveCount(count);
      await page.getByLabel("Filter tasks by stage", { exact: true }).selectOption("Review");
      await expect(page.locator(".board-column")).toHaveCount(1);
      await expect(page.locator(".board-column").getByRole("heading", { name: "Review", exact: true })).toBeVisible();
      await page.getByLabel("Filter tasks by stage", { exact: true }).selectOption("All stages");
      await page.getByRole("tab", { name: "List", exact: true }).click();
      await expectTab(page, "List");
      await expect(page.getByRole("button", { name: /^Open task:/ })).toHaveCount(count);
      await page.locator('[data-guide-target="stage-review"]').click();
      await expect(page.locator('[data-guide-target="stage-review"]')).toHaveAttribute("data-guide-active", "true");
      const reviewCount = before!.tasks.filter(task => task.stage === "Review").length;
      await expect(page.getByRole("button", { name: /^Open task:/ })).toHaveCount(reviewCount);
      await page.getByRole("tab", { name: "Board", exact: true }).click();
      await expect(page.getByLabel("Filter tasks by stage", { exact: true })).toHaveValue("Review");
      await expect(page.getByRole("button", { name: /^Open task:/ })).toHaveCount(reviewCount);
      await page.getByLabel("Filter tasks by stage", { exact: true }).selectOption("All stages");
      await page.getByRole("tab", { name: "List", exact: true }).click();
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await page.screenshot({ path: testInfo.outputPath("project-list-desktop.png"), fullPage: true, animations: "disabled" });
      await page.setViewportSize({ width: 390, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath("project-list-mobile.png"), fullPage: true, animations: "disabled" });
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.getByRole("tab", { name: "Board", exact: true }).click();
      expect(await workspaceFor(page)).toEqual(before);
    });

    await test.step("New task creates a real saved card, survives reload, and appears in both project views", async () => {
      expect((await workspaceFor(page))!.tasks).toHaveLength(6);
      await page.getByRole("button", { name: "New task", exact: true }).click();
      const form = page.getByRole("form", { name: "New task", exact: true });
      await expect(form).toBeVisible();
      await form.getByLabel("Task name", { exact: true }).fill(newTask.title);
      await form.getByLabel("Description", { exact: true }).fill(newTask.description);
      await form.getByLabel("Stage", { exact: true }).selectOption(newTask.stage);
      await page.screenshot({ path: testInfo.outputPath("new-task-form-desktop.png"), fullPage: true, animations: "disabled" });
      await page.setViewportSize({ width: 390, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      // The host's full-page capture can repeat mobile viewport tiles.
      // Capture this form as the user sees it in one viewport.
      await page.screenshot({ path: testInfo.outputPath("new-task-form-mobile.png"), fullPage: false, animations: "disabled" });
      await page.setViewportSize({ width: 1280, height: 720 });
      const savedResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/tasks" && response.request().method() === "POST");
      await form.getByRole("button", { name: "Add task", exact: true }).click();
      const response = await savedResponse;
      expect(response.status()).toBe(201);
      const receipt = await response.json() as { task: SavedTask; created: boolean };
      expect(receipt).toMatchObject({ task: newTask, created: true });
      expect(receipt.task.id).toMatch(/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i);
      const submitted = response.request().postDataJSON() as { requestId: string; title: string; description: string; stage: string };
      expect(submitted.requestId).toMatch(/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i);
      createdTaskId = receipt.task.id;
      await expect(form).toHaveCount(0);
      const createdCard = page.getByRole("button", { name: `Open task: ${newTask.title}`, exact: true });
      await expect(createdCard).toBeVisible();
      await expect(page.getByRole("button", { name: /^Open task:/ })).toHaveCount(7);
      await page.screenshot({ path: testInfo.outputPath("created-task-board.png"), fullPage: true, animations: "disabled" });
      const persisted = await workspaceFor(page);
      expect(persisted!.tasks).toHaveLength(7);
      expect(persisted!.tasks.find(task => task.id === createdTaskId)).toEqual(receipt.task);
      const retry = await page.evaluate(async input => {
        const result = await fetch("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
        return { status: result.status, body: await result.json() };
      }, submitted);
      expect(retry).toEqual({ status: 200, body: { task: receipt.task, created: false } });
      expect(await workspaceFor(page)).toEqual(persisted);
      await page.reload();
      await expect(createdCard).toBeVisible();
      await expect(page.getByRole("button", { name: /^Open task:/ })).toHaveCount(7);
      await page.getByRole("searchbox", { name: "Search tasks", exact: true }).fill(newTask.title);
      await expect(page.getByRole("button", { name: /^Open task:/ })).toHaveCount(1);
      await page.getByRole("tab", { name: "List", exact: true }).click();
      await expectTab(page, "List");
      await expect(page.getByRole("button", { name: /^Open task:/ })).toHaveCount(1);
      await expect(createdCard).toBeVisible();
      await createdCard.click();
      const details = page.getByRole("dialog", { name: newTask.title, exact: true });
      await expect(details.getByText(newTask.description, { exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(details).not.toBeVisible();
      await page.getByRole("searchbox", { name: "Search tasks", exact: true }).fill("");
      await expect(page.getByRole("button", { name: /^Open task:/ })).toHaveCount(7);
      await page.screenshot({ path: testInfo.outputPath("created-task-list.png"), fullPage: true, animations: "disabled" });
      await page.getByRole("tab", { name: "Board", exact: true }).click();
      expect(await workspaceFor(page)).toEqual(persisted);
    });

    await test.step("Move task changes only the saved stage, replays safely, and rejects stale or reused requests", async () => {
      const before = (await workspaceFor(page))!;
      const index = before.tasks.findIndex(task => task.id === createdTaskId);
      await page.getByRole("button", { name: "Move task", exact: true }).click();
      const form = page.getByRole("form", { name: "Move task", exact: true });
      await expect(form).toBeVisible();
      await form.getByLabel("Task", { exact: true }).selectOption(createdTaskId);
      await expect(form.getByText(`Currently in ${newTask.stage}`, { exact: true })).toBeVisible();
      await form.getByRole("button", { name: "Review", exact: true }).click();
      const movedResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/tasks/stage" && response.request().method() === "POST");
      await form.getByRole("button", { name: "Move task", exact: true }).click();
      const response = await movedResponse;
      expect(response.status()).toBe(200);
      const receipt = await response.json() as { task: SavedTask; fromStage: string; replayed: boolean };
      expect(receipt).toEqual({ task: { ...before.tasks[index], stage: "Review" }, fromStage: newTask.stage, replayed: false });
      const submitted = response.request().postDataJSON() as { requestId: string; taskId: string; fromStage: string; stage: string };
      expect(submitted).toMatchObject({ taskId: createdTaskId, fromStage: newTask.stage, stage: "Review" });
      await expect(form).toHaveCount(0);
      const moved = (await workspaceFor(page))!;
      expect(moved.tasks.map(task => task.id)).toEqual(before.tasks.map(task => task.id));
      expect(moved.tasks.map((task, i) => i === index ? { ...task, stage: newTask.stage } : task)).toEqual(before.tasks);
      const post = (input: unknown) => page.evaluate(async body => {
        const result = await fetch("/api/tasks/stage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        return { status: result.status, body: await result.json() };
      }, input);
      expect(await post(submitted)).toEqual({ status: 200, body: { ...receipt, replayed: true } });
      expect((await post({ ...submitted, stage: "Handoff" })).body.code).toBe("TASK_REQUEST_CONFLICT");
      const stale = await post({ requestId: randomUUID(), taskId: createdTaskId, fromStage: newTask.stage, stage: "Handoff" });
      expect(stale.status).toBe(409);
      expect(stale.body.code).toBe("TASK_STAGE_CHANGED");
      const missing = await post({ requestId: randomUUID(), taskId: randomUUID(), fromStage: "Brief", stage: "Build" });
      expect(missing.status).toBe(404);
      expect(missing.body.code).toBe("TASK_NOT_FOUND");
      expect(await workspaceFor(page)).toEqual(moved);
      await page.reload();
      await page.getByRole("tab", { name: "List", exact: true }).click();
      await page.getByRole("group", { name: "Filter tasks by stage" }).getByRole("button", { name: /^Review/ }).click();
      await expect(page.getByRole("button", { name: `Open task: ${newTask.title}`, exact: true })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath("moved-task-list.png"), fullPage: true, animations: "disabled" });
      await page.getByRole("group", { name: "Filter tasks by stage" }).getByRole("button", { name: /^All tasks/ }).click();
      await page.getByRole("tab", { name: "Board", exact: true }).click();
      expect(await workspaceFor(page)).toEqual(moved);
    });

    await test.step("a failed task save retains the draft and Cancel leaves saved data unchanged", async () => {
      const before = await workspaceFor(page);
      await page.getByRole("button", { name: "New task", exact: true }).click();
      const form = page.getByRole("form", { name: "New task", exact: true });
      await form.getByLabel("Task name", { exact: true }).fill("Record launch video");
      await form.getByLabel("Description", { exact: true }).fill("This unsaved draft must survive a failed request.");
      await form.getByLabel("Stage", { exact: true }).selectOption("Review");
      const failTaskCreation = (route: Route) => route.fulfill({ status: 503, contentType: "application/json",
        body: JSON.stringify({ code: "TEST_UNAVAILABLE", error: "Task creation is temporarily unavailable. Try again." }) });
      await page.route("**/api/tasks", failTaskCreation);
      try {
        await form.getByRole("button", { name: "Add task", exact: true }).click();
        await expect(form.getByRole("alert")).toBeVisible();
        await expect(form.getByLabel("Task name", { exact: true })).toHaveValue("Record launch video");
        await expect(form.getByLabel("Description", { exact: true })).toHaveValue("This unsaved draft must survive a failed request.");
        await expect(form.getByLabel("Stage", { exact: true })).toHaveValue("Review");
        await expect(form.getByLabel("Task name", { exact: true })).toBeDisabled();
        await expect(form.getByLabel("Description", { exact: true })).toBeDisabled();
        await expect(form.getByLabel("Stage", { exact: true })).toBeDisabled();
        await expect(form.getByRole("button", { name: "Retry save", exact: true })).toBeEnabled();
      } finally { await page.unroute("**/api/tasks", failTaskCreation); }
      expect(await workspaceFor(page)).toEqual(before);
      await form.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(form).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Open task: Record launch video", exact: true })).toHaveCount(0);
      expect(await workspaceFor(page)).toEqual(before);
    });

    await test.step("UI logout and password login return directly to the saved dashboard", async () => {
      await page.getByRole("button", { name: "Open user menu", exact: true }).click();
      await page.getByText("Sign out", { exact: true }).click();
      await page.waitForFunction(() => {
        const sdk = (window as Window & { Clerk?: { loaded: boolean; user: unknown; session: unknown } }).Clerk;
        return sdk?.loaded && sdk.user === null && sdk.session === null;
      });
      await expect(page).toHaveURL(/\/$/);
      await signInThroughForm(page, first);
      await page.goto("/onboarding", { waitUntil: "domcontentloaded" });
      await expect(page).toHaveURL(/\/dashboard$/);
      await expect(page.getByRole("heading", { level: 1, name: projectName })).toBeVisible();
      await expect(page.getByRole("button", { name: `Open task: ${newTask.title}`, exact: true })).toBeVisible();
    });

    await test.step("Help reopens the saved-project widget without starting a paid session", async () => {
      const priorRequests = roomRequests;
      const before = await workspaceFor(page);
      await page.getByRole("button", { name: "Help", exact: true }).click();
      const help = page.getByRole("region", { name: "Avatar guide", exact: true });
      await expect(help).toBeVisible();
      await expect(help.getByText("Product Q&A · AI assistant", { exact: true })).toBeVisible();
      await expect(help.getByRole("button", { name: "Start a conversation", exact: true })).toBeVisible();
      await help.getByRole("button", { name: "Collapse guide", exact: true }).click();
      await expect(help).toHaveCount(0);
      await openGuide(page);
      await help.getByLabel("Conversation type", { exact: true }).selectOption("setup");
      await expect(help.getByText("Guided setup · AI assistant", { exact: true })).toBeVisible();
      await help.getByRole("button", { name: "Collapse guide", exact: true }).click();
      expect(roomRequests).toBe(priorRequests);
      expect(await workspaceFor(page)).toEqual(before);
    });

    await test.step("a second real signup cannot see the first user's workspace", async () => {
      await signUp(otherPage, second);
      expect(await workspaceFor(otherPage)).toBeNull();
      await expect(otherPage.getByText(workspaceName, { exact: true })).toHaveCount(0);
      const missingWorkspace = await otherPage.evaluate(async input => {
        const result = await fetch("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
        return { status: result.status, body: await result.json() };
      }, { ...newTask, requestId: randomUUID() });
      expect(missingWorkspace.status).toBe(404);
      expect(missingWorkspace.body.code).toBe("WORKSPACE_NOT_FOUND");
      await createThroughForm(otherPage, "Separate fictional studio", "Autumn campaign", "Campaign");
      const otherWorkspace = (await workspaceFor(otherPage))!;
      expect(otherWorkspace.id).not.toBe((await workspaceFor(page))!.id);
      expect(otherWorkspace.tasks).toHaveLength(6);
      expect(otherWorkspace.tasks.some(task => task.id === createdTaskId || task.title === newTask.title)).toBe(false);
      await expect(otherPage.getByRole("button", { name: `Open task: ${newTask.title}`, exact: true })).toHaveCount(0);
      const foreignMove = await otherPage.evaluate(async input => {
        const result = await fetch("/api/tasks/stage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
        return { status: result.status, body: await result.json() };
      }, { requestId: randomUUID(), taskId: createdTaskId, fromStage: "Review", stage: "Handoff" });
      expect(foreignMove.status).toBe(404);
      expect(foreignMove.body.code).toBe("TASK_NOT_FOUND");
      expect((await workspaceFor(page))!.tasks.find(task => task.id === createdTaskId)?.stage).toBe("Review");
    });

    await test.step("confirmed reset removes only the first user's sample workspace", async () => {
      const otherId = (await workspaceFor(otherPage))!.id;
      await page.locator("summary").filter({ hasText: "Reset demo workspace" }).click();
      await page.getByLabel("Type RESET to confirm", { exact: true }).fill("RESET");
      await page.getByRole("button", { name: "Reset my demo workspace", exact: true }).click();
      await expect(page).toHaveURL(/\/onboarding$/);
      expect(await workspaceFor(page)).toBeNull();
      expect((await workspaceFor(otherPage))!.id).toBe(otherId);
      await otherPage.reload();
      await expect(otherPage.getByRole("heading", { level: 1, name: "Autumn campaign" })).toBeVisible();
      expect(roomRequests).toBe(1); // Only the incomplete-response fault injection above.
    });
  } finally {
    page.off("request", countRoom);
    otherPage.off("request", countRoom);
    await secondContext.close();
  }
});

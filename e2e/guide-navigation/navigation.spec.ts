import { resolve } from "node:path";
import { build } from "esbuild";
import { expect, test, type Page, type Route } from "@playwright/test";

let javascript = "";
let stylesheet = "";

test.beforeAll(async () => {
  const bundle = await build({
    entryPoints: [resolve("e2e/guide-navigation/fixture.tsx")],
    bundle: true, write: false, outfile: "guide-navigation.js",
    platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"test"' },
  });
  javascript = bundle.outputFiles.find(file => file.path.endsWith(".js"))!.text;
  stylesheet = bundle.outputFiles.find(file => file.path.endsWith(".css"))!.text;
});

async function openFixture(page: Page, saved: boolean) {
  // An unexpected request is blocked; the fixture never contacts a provider.
  await page.route("**/*", route => route.abort());
  await page.setContent(`<!doctype html><html><head></head><body><div id="fixture-root" data-saved="${saved}"></div></body></html>`);
  await page.addStyleTag({ content: stylesheet });
  await page.addScriptTag({ content: javascript });
  await expect(page.getByRole("heading", { name: "Help center", exact: true })).toBeVisible();
  await expect(page.locator('[data-guide-target="nav-workflow"]')).toHaveCount(0);
}

for (const saved of [true, false]) {
  test(`Help opens the project, ${saved ? "List" : "Preview"}, and actual Review tasks before acknowledging`, async ({ page }) => {
    await openFixture(page, saved);
    await page.getByRole("button", { name: "Demonstrate Review" }).click();
    await expect(page.getByTestId("action-result")).toContainText('"applied":true');
    await expect(page.getByTestId("action-clicks")).toHaveText('["project-home","nav-workflow","stage-review"]');
    await expect(page.getByRole("tab", { name: saved ? "List" : "Preview", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator('[data-guide-target="stage-review"]')).toHaveAttribute("data-guide-active", "true");
    const table = page.getByRole("table", { name: saved ? "Project task list" : "Unsaved sample task preview" });
    await expect(table.locator("tbody tr")).toHaveCount(1);
    await expect(table.getByRole("button", { name: "Open task: Review with the project team" })).toBeVisible();
    await expect(page.getByTestId("action-labels")).toContainText(`Open ${saved ? "List" : "Preview"}`);
    await expect(page.getByTestId("action-labels")).not.toContainText("workflow");
    await expect(page.locator(".guide-action-layer")).toHaveAttribute("data-guide-action-phase", "applied");
  });
}

test("manual navigation cancels pending guide clicks and a later explicit request still works", async ({ page }) => {
  await openFixture(page, true);
  await page.getByRole("button", { name: "Demonstrate Review" }).click();
  await expect(page.locator(".guide-action-layer")).toHaveAttribute("data-guide-action-phase", "moving");
  await page.getByRole("button", { name: /^People/ }).click();
  await expect(page.getByTestId("action-result")).toContainText('"error":"cancelled"');
  await expect(page.getByRole("heading", { name: "People", exact: true })).toBeVisible();
  await expect(page.locator(".guide-action-layer")).toHaveCount(0);
  await page.waitForTimeout(500);
  await expect(page.getByRole("heading", { name: "People", exact: true })).toBeVisible();
  await expect(page.getByTestId("action-clicks")).not.toContainText("stage-review");
  await page.getByRole("button", { name: "Demonstrate Review" }).click();
  await expect(page.getByTestId("action-result")).toContainText('"applied":true');
  await expect(page.getByRole("tab", { name: "List", exact: true })).toHaveAttribute("aria-selected", "true");
});

test("stage demonstration clears an existing task search through its real control", async ({ page }) => {
  await openFixture(page, true);
  await page.locator('[data-guide-target="project-home"]').click();
  await page.getByRole("searchbox", { name: "Search tasks" }).fill("unmatched-search-fixture");
  await page.getByRole("button", { name: "Help center", exact: true }).click();
  await expect(page.locator('[data-guide-target="nav-workflow"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Demonstrate Review" }).click();
  await expect(page.getByTestId("action-result")).toContainText('"applied":true');
  await expect(page.getByTestId("action-clicks")).toHaveText('["project-home","nav-workflow","task-search-clear","stage-review"]');
  await expect(page.getByRole("searchbox", { name: "Search tasks" })).toHaveValue("");
  const table = page.getByRole("table", { name: "Project task list" });
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await expect(table.getByRole("button", { name: "Open task: Review with the project team" })).toBeVisible();
  // The synthetic clear click must not take keyboard focus from the user's control.
  await expect(page.getByRole("searchbox", { name: "Search tasks" })).not.toBeFocused();
});

test("the guide cannot click through a modal and can continue after it closes", async ({ page }) => {
  await openFixture(page, true);
  await page.getByRole("button", { name: "Open modal", exact: true }).click();
  await page.getByRole("button", { name: "Demonstrate Review behind dialog", exact: true }).click();
  await expect(page.getByTestId("action-result")).toContainText('"error":"target_unavailable"');
  await expect(page.getByTestId("action-clicks")).toHaveText("[]");
  await expect(page.getByRole("dialog", { name: "Modal interaction fixture" })).toBeVisible();
  await page.getByRole("button", { name: "Close modal", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Help center", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Demonstrate Review", exact: true }).click();
  await expect(page.getByTestId("action-result")).toContainText('"applied":true');
});

test("Board and List fit a 320px viewport with a usable task search", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await openFixture(page, true);
  await page.locator('[data-guide-target="project-home"]').click();
  for (const name of ["Board", "List"]) {
    await page.getByRole("tab", { name, exact: true }).click();
    const search = page.getByRole("searchbox", { name: "Search tasks" });
    await expect(search).toBeVisible();
    // Keep a readable query field rather than the previous 56px mobile input.
    expect((await search.boundingBox())!.width).toBeGreaterThanOrEqual(160);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await search.fill("Review with");
    await expect(page.getByRole("button", { name: "Open task: Review with the project team", exact: true })).toBeVisible();
    await search.fill("");
  }
});

for (const size of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
  test(`actual widget stays anchored in the layout viewport at ${size.width}px`, async ({ page }) => {
    await page.setViewportSize(size);
    const requests: string[] = [];
    page.on("request", request => requests.push(request.url()));
    await page.route("**/*", route => route.abort());
    await page.setContent('<!doctype html><html><head></head><body><div id="fixture-root" data-widget="true"></div></body></html>');
    await page.addStyleTag({ content: stylesheet });
    await page.addScriptTag({ content: javascript });
    await page.getByRole("button", { name: "Open avatar guide", exact: true }).click();
    const panel = page.locator(".guide-widget-panel");
    await expect(panel).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
    const measure = () => panel.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const root = document.documentElement.getBoundingClientRect();
      // Chrome's root clientWidth includes the stable scrollbar gutter in
      // standards mode. Its bounding right edge is the actual content edge.
      return { right: root.right - rect.right, bottom: innerHeight - rect.bottom, outerRight: innerWidth - rect.right, gutter: innerWidth - root.right, height: rect.height, rootWidth: root.width, clientWidth: document.documentElement.clientWidth, bodyRight: document.body.getBoundingClientRect().right, position: getComputedStyle(element.parentElement!).position, computedRight: getComputedStyle(element.parentElement!).right };
    });
    const before = await measure();
    expect(before.position).toBe("fixed");
    expect(before.right).toBeCloseTo(size.width > 520 ? 22 : 12, 0);
    expect(before.bottom).toBeCloseTo(size.width > 520 ? 20 : 12, 0);
    expect(before.height).toBeLessThanOrEqual(520);
    await page.getByLabel("Conversation type").selectOption("tour");
    await page.evaluate(() => window.scrollTo({ top: 650, behavior: "instant" }));
    const after = await measure();
    expect(after.right).toBeCloseTo(before.right, 0);
    expect(after.bottom).toBeCloseTo(before.bottom, 0);
    await expect(page.getByRole("button", { name: "Start a conversation", exact: true })).toBeVisible();
    expect(requests).toEqual([]);
  });
}

const taskRequest = { requestId: "69949b99-57e8-4010-83ec-77a9ff6e80e1", title: "Design homepage", stage: "Build", description: "Create homepage" };
const savedTask = { id: "b8f4a8f5-ed89-4406-bcfe-e2a3854a6a71", title: taskRequest.title, stage: taskRequest.stage, description: taskRequest.description };

async function openTaskFixture(page: Page, handleSave: (route: Route) => Promise<void>, { handleMove = route => route.abort(), similar = false }: { handleMove?: (route: Route) => Promise<void>; similar?: boolean } = {}) {
  // A synthetic HTTPS origin lets the actual component use a same-origin fetch.
  // The document and save/move receipts are fulfilled locally; all other network is blocked.
  await page.route("**/*", route => route.abort());
  await page.route("https://launchpad.test/", route => route.fulfill({ contentType: "text/html", body: `<!doctype html><html><head></head><body><div id="fixture-root" data-task-create="true" data-similar="${similar}"></div></body></html>` }));
  await page.route("https://launchpad.test/api/tasks", handleSave);
  await page.route("https://launchpad.test/api/tasks/stage", handleMove);
  await page.goto("https://launchpad.test/");
  await page.addStyleTag({ content: stylesheet });
  await page.addScriptTag({ content: javascript });
  await expect(page.getByRole("heading", { name: "Help center", exact: true })).toBeVisible();
}

test("task creation visibly operates the real controls and waits for the committed receipt", async ({ page }, testInfo) => {
  const requests: unknown[] = [];
  let release!: () => void;
  const receipt = new Promise<void>(resolve => { release = resolve; });
  await openTaskFixture(page, async route => {
    expect(route.request().method()).toBe("POST");
    requests.push(route.request().postDataJSON());
    await receipt;
    await route.fulfill({ status: 201, json: { task: savedTask } });
  });
  await page.getByRole("button", { name: "Create via guide", exact: true }).click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toEqual(taskRequest);
  await expect(page.getByTestId("task-result")).toHaveText("null");
  await expect(page.getByRole("button", { name: "Adding…", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Open task: Design homepage", exact: true })).toHaveCount(0);
  release();
  await expect(page.getByTestId("task-result")).toContainText('"applied":true');
  await expect(page.getByTestId("task-clicks")).toHaveText('["project-home","nav-overview","task-new","task-save"]');
  await expect(page.getByRole("form", { name: "New task", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open task: Design homepage", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("task-created-desktop.png"), fullPage: true });
  await page.getByRole("button", { name: "Open task: Design homepage", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Create homepage");
  await expect(page.getByRole("dialog")).toContainText("Build");
});

test("task creation preserves a person's already-open draft", async ({ page }) => {
  const requests: unknown[] = [];
  await openTaskFixture(page, async route => { requests.push(route.request().postDataJSON()); await route.abort(); });
  await page.locator('[data-guide-target="project-home"]').click();
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await page.getByLabel("Task name", { exact: true }).fill("My manual task");
  await page.getByRole("button", { name: "Create via guide", exact: true }).click();
  await expect(page.getByTestId("task-result")).toContainText('"error":"busy"');
  await expect(page.getByLabel("Task name", { exact: true })).toHaveValue("My manual task");
  await expect(page.getByTestId("task-clicks")).toHaveText("[]");
  expect(requests).toEqual([]);
});

test("task creation interrupted while moving toward Save performs no write", async ({ page }) => {
  const requests: unknown[] = [];
  await openTaskFixture(page, async route => { requests.push(route.request().postDataJSON()); await route.abort(); });
  await page.getByRole("button", { name: "Create via guide", exact: true }).click();
  // Observe every animation frame: expect's backoff can skip a 300ms movement.
  await page.waitForFunction(() => document.querySelector('.guide-action-layer[data-guide-action-target="task-save"][data-guide-action-phase="moving"]') !== null, undefined, { polling: "raf" });
  await page.getByRole("button", { name: "Interrupt creation", exact: true }).click();
  await expect(page.getByTestId("task-result")).toContainText('"error":"interrupted"');
  await expect(page.getByTestId("task-clicks")).not.toContainText("task-save");
  await page.waitForTimeout(450);
  expect(requests).toEqual([]);
  await expect(page.getByLabel("Task name", { exact: true })).toHaveValue("Design homepage");
});

test("task creation retains an uncertain save and retries the identical request without duplicate cards", async ({ page }) => {
  const requests: unknown[] = [];
  await openTaskFixture(page, async route => {
    requests.push(route.request().postDataJSON());
    await route.fulfill(requests.length === 1 ? { status: 503, json: { error: "Temporary failure" } } : { status: 201, json: { task: savedTask } });
  });
  await page.getByRole("button", { name: "Create via guide", exact: true }).click();
  await expect(page.getByTestId("task-result")).toContainText('"error":"outcome_unknown"');
  await expect(page.getByRole("alert")).toContainText("Retry this task safely");
  await expect(page.getByLabel("Task name", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("Task name", { exact: true })).toHaveValue("Design homepage");
  await page.getByRole("button", { name: "Retry save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Open task: Design homepage", exact: true })).toHaveCount(1);
  expect(requests).toEqual([taskRequest, taskRequest]);
});

test("task creation form and its controls fit 320px and 390px screens", async ({ page }) => {
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await openTaskFixture(page, route => route.abort());
    await page.locator('[data-guide-target="project-home"]').click();
    await page.getByRole("button", { name: "New task", exact: true }).click();
    const form = page.getByRole("form", { name: "New task", exact: true });
    await expect(form).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const control of [page.getByLabel("Task name", { exact: true }), page.getByLabel("Stage", { exact: true }), page.getByRole("button", { name: "Add task", exact: true })]) {
      const box = (await control.boundingBox())!;
      expect(box.width).toBeGreaterThan(60);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    }
  }
});

// The fixture's saved copy of the second client-delivery sample task (LP-02).
const sampleTask = { id: "5d8f2a6e-3c1b-4f7a-9e2d-000000000002", title: "Gather brand references", stage: "Brief", description: "Collect the visual direction for this fictional client project.", tag: "Creative" };
const moveRequest = { requestId: "3f0d7b52-8a51-4c3e-b7c4-2f4f1c9e8a10", taskId: sampleTask.id, fromStage: "Brief", stage: "Review" };
const moveReceipt = { task: { ...sampleTask, stage: "Review" }, fromStage: "Brief", replayed: false };
const noSave = (route: Route) => route.abort();
const column = (page: Page, stage: string) => page.locator(`section.board-column-${stage.toLowerCase()}`);
const setMoveRequest = (page: Page, request: object) => page.evaluate(value => { document.getElementById("fixture-root")!.dataset.moveRequest = JSON.stringify(value); }, request);

test("task move visibly operates the real controls and waits for the committed receipt", async ({ page }, testInfo) => {
  const requests: unknown[] = [];
  let release!: () => void;
  const receipt = new Promise<void>(resolve => { release = resolve; });
  await openTaskFixture(page, noSave, { handleMove: async route => {
    expect(route.request().method()).toBe("POST");
    requests.push(route.request().postDataJSON());
    await receipt;
    // A stored sample task keeps its tag and description in the receipt.
    await route.fulfill({ status: 200, json: moveReceipt });
  } });
  await page.getByRole("button", { name: "Move via guide", exact: true }).click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toEqual(moveRequest);
  await expect(page.getByTestId("move-result")).toHaveText("null");
  await expect(page.locator('[data-guide-target="task-move-save"]')).toHaveText("Moving…");
  await expect(page.locator('[data-guide-target="task-move-save"]')).toBeDisabled();
  await expect(page.getByLabel("Task", { exact: true })).toHaveValue(sampleTask.id);
  await expect(column(page, "Brief").getByRole("button", { name: `Open task: ${sampleTask.title}`, exact: true })).toBeVisible();
  release();
  await expect(page.getByTestId("move-result")).toContainText('"applied":true');
  expect(JSON.parse(await page.getByTestId("move-result").textContent() ?? "null")).toEqual({ version: 1, requestId: moveRequest.requestId, applied: true, task: { id: sampleTask.id, title: sampleTask.title, fromStage: "Brief", stage: "Review" } });
  await expect(page.getByTestId("task-clicks")).toHaveText('["project-home","nav-overview","task-move","task-move-to-review","task-move-save"]');
  await expect(page.getByRole("form", { name: "Move task", exact: true })).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "Moved “Gather brand references” from Brief to Review." })).toBeVisible();
  const card = column(page, "Review").getByRole("button", { name: `Open task: ${sampleTask.title}`, exact: true });
  await expect(card).toBeVisible();
  await expect(card.locator(".task-number")).toHaveText("LP-02");
  await expect(card.locator(".task-tag")).toHaveText("Creative");
  await expect(column(page, "Brief").getByRole("button", { name: `Open task: ${sampleTask.title}`, exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("task-moved-desktop.png"), fullPage: true });
  await card.click();
  await expect(page.getByRole("dialog")).toContainText("LP-02");
  await expect(page.getByRole("dialog")).toContainText("Review");
  await expect(page.getByRole("dialog")).not.toContainText("Editing, assignments");
});

test("task move never takes over an open New task form, Move panel, or task details", async ({ page }) => {
  const requests: unknown[] = [];
  const handleMove = async (route: Route) => { requests.push(route.request().postDataJSON()); await route.abort(); };
  await openTaskFixture(page, noSave, { handleMove });
  await page.locator('[data-guide-target="project-home"]').click();
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await page.getByLabel("Task name", { exact: true }).fill("My manual task");
  await expect(page.locator('[data-guide-target="task-move"]')).toBeDisabled();
  await page.getByRole("button", { name: "Move via guide", exact: true }).click();
  await expect(page.getByTestId("move-result")).toContainText('"error":"busy"');
  await expect(page.getByLabel("Task name", { exact: true })).toHaveValue("My manual task");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  await page.locator('[data-guide-target="task-move"]').click();
  await page.getByLabel("Task", { exact: true }).selectOption({ label: "LP-03 · Create the first concept" });
  await expect(page.locator('[data-guide-target="task-new"]')).toBeDisabled();
  await page.getByRole("button", { name: "Move via guide", exact: true }).click();
  await expect(page.getByTestId("move-result")).toContainText('"error":"busy"');
  await expect(page.getByLabel("Task", { exact: true })).toHaveValue("5d8f2a6e-3c1b-4f7a-9e2d-000000000003");
  await page.getByRole("button", { name: "Close move task", exact: true }).click();

  await page.getByRole("button", { name: "Open task: Create the first concept", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  // The fixture trigger sits behind the modal; dispatch its handler directly.
  await page.getByRole("button", { name: "Move via guide", exact: true }).dispatchEvent("click");
  await expect(page.getByTestId("move-result")).toContainText('"error":"busy"');
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByTestId("task-clicks")).toHaveText("[]");
  expect(requests).toEqual([]);
});

test("task move interrupted while moving toward Move task performs no write", async ({ page }) => {
  const requests: unknown[] = [];
  await openTaskFixture(page, noSave, { handleMove: async route => { requests.push(route.request().postDataJSON()); await route.abort(); } });
  await page.getByRole("button", { name: "Move via guide", exact: true }).click();
  // Observe every animation frame: expect's backoff can skip a 300ms movement.
  await page.waitForFunction(() => document.querySelector('.guide-action-layer[data-guide-action-target="task-move-save"][data-guide-action-phase="moving"]') !== null, undefined, { polling: "raf" });
  await page.getByRole("button", { name: "Interrupt move", exact: true }).click();
  await expect(page.getByTestId("move-result")).toContainText('"error":"interrupted"');
  await expect(page.getByTestId("task-clicks")).not.toContainText("task-move-save");
  await page.waitForTimeout(450);
  expect(requests).toEqual([]);
  await expect(page.getByLabel("Task", { exact: true })).toHaveValue(sampleTask.id);
  await expect(page.locator('[data-guide-target="task-move-to-review"]')).toHaveAttribute("aria-pressed", "true");
  await expect(column(page, "Brief").getByRole("button", { name: `Open task: ${sampleTask.title}`, exact: true })).toBeVisible();
});

test("task move retains an uncertain save and retries the identical request without a duplicate card", async ({ page }) => {
  const requests: unknown[] = [];
  await openTaskFixture(page, noSave, { handleMove: async route => {
    requests.push(route.request().postDataJSON());
    await route.fulfill(requests.length === 1 ? { status: 503, json: { error: "Temporary failure" } } : { status: 200, json: { ...moveReceipt, replayed: true } });
  } });
  await page.getByRole("button", { name: "Move via guide", exact: true }).click();
  await expect(page.getByTestId("move-result")).toContainText('"error":"outcome_unknown"');
  await expect(page.getByRole("alert")).toContainText("Retry this move safely");
  await expect(page.getByLabel("Task", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("Task", { exact: true })).toHaveValue(sampleTask.id);
  for (const stage of ["brief", "build", "review", "handoff"]) await expect(page.locator(`[data-guide-target="task-move-to-${stage}"]`)).toBeDisabled();
  await expect(column(page, "Brief").getByRole("button", { name: `Open task: ${sampleTask.title}`, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Retry move", exact: true }).click();
  await expect(column(page, "Review").getByRole("button", { name: `Open task: ${sampleTask.title}`, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: `Open task: ${sampleTask.title}`, exact: true })).toHaveCount(1);
  expect(requests).toEqual([moveRequest, moveRequest]);
});

test("unresolvable move requests make no clicks or requests", async ({ page }) => {
  for (const [similar, request, expected] of [
    [false, { title: "Unknown fixture task" }, { error: "not_found" }],
    [false, { title: "gather BRAND references", stage: "Brief" }, { error: "already_in_stage" }],
    [false, { title: "Gather brand references", fromStage: "Build" }, { error: "not_found" }],
    [true, { title: "Design homepage", stage: "Handoff" }, { error: "ambiguous", stages: ["Brief", "Review"] }],
  ] as const) {
    const requests: unknown[] = [];
    await openTaskFixture(page, noSave, { similar, handleMove: async route => { requests.push(route.request().postDataJSON()); await route.abort(); } });
    await setMoveRequest(page, request);
    await page.getByRole("button", { name: "Move via guide", exact: true }).click();
    await expect(page.getByTestId("move-result")).toContainText('"applied":false');
    expect(JSON.parse(await page.getByTestId("move-result").textContent() ?? "null")).toEqual({ version: 1, requestId: moveRequest.requestId, applied: false, ...expected });
    await page.waitForTimeout(200);
    await expect(page.getByTestId("task-clicks")).toHaveText("[]");
    await expect(page.getByRole("heading", { name: "Help center", exact: true })).toBeVisible();
    expect(requests).toEqual([]);
  }
});

test("guided create and move are mutually exclusive while either save is in flight", async ({ page }) => {
  let release!: () => void;
  let receipt = new Promise<void>(resolve => { release = resolve; });
  const creates: unknown[] = [];
  const moves: unknown[] = [];
  const handleSave = async (route: Route) => { creates.push(route.request().postDataJSON()); await receipt; await route.fulfill({ status: 201, json: { task: savedTask } }); };
  const handleMove = async (route: Route) => { moves.push(route.request().postDataJSON()); await receipt; await route.fulfill({ status: 200, json: moveReceipt }); };
  await openTaskFixture(page, handleSave, { handleMove });
  await page.getByRole("button", { name: "Move via guide", exact: true }).click();
  await expect.poll(() => moves.length).toBe(1);
  await expect(page.locator('[data-guide-target="task-new"]')).toBeDisabled();
  // This trusted click arrives after Move was sent, so it cannot cancel that write.
  await page.getByRole("button", { name: "Create via guide", exact: true }).click();
  await expect(page.getByTestId("task-result")).toContainText('"error":"busy"');
  await expect(page.getByTestId("task-clicks")).not.toContainText("task-new");
  release();
  await expect(page.getByTestId("move-result")).toContainText('"applied":true');
  expect(creates).toEqual([]);

  receipt = new Promise<void>(resolve => { release = resolve; });
  await page.getByRole("button", { name: "Create via guide", exact: true }).click();
  await expect.poll(() => creates.length).toBe(1);
  await expect(page.locator('[data-guide-target="task-move"]')).toBeDisabled();
  // A fresh request ID: the first one already has a committed, replayable receipt.
  await setMoveRequest(page, { requestId: "8c2b1f4e-6d3a-4b9c-a1e5-7f0d2c4b6a98", title: "Create the first concept", stage: "Review" });
  await page.getByRole("button", { name: "Move via guide", exact: true }).click();
  await expect(page.getByTestId("move-result")).toContainText('"error":"busy"');
  release();
  await expect(page.getByTestId("task-result")).toContainText('"applied":true');
  expect(moves).toEqual([moveRequest]);
});

test("Move to another stage in task details opens the panel and reveals the moved card", async ({ page }) => {
  const requests: unknown[] = [];
  await openTaskFixture(page, noSave, { handleMove: async route => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, json: { task: { ...sampleTask, stage: "Handoff" }, fromStage: "Brief", replayed: false } });
  } });
  await page.locator('[data-guide-target="project-home"]').click();
  await page.getByRole("button", { name: `Open task: ${sampleTask.title}`, exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("You can move it to another stage yourself or ask the guide.");
  await page.getByRole("button", { name: "Move to another stage", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByLabel("Task", { exact: true })).toHaveValue(sampleTask.id);
  await expect(page.locator('[data-guide-target="task-move-to-brief"]')).toBeDisabled();
  await expect(page.locator('[data-guide-target="task-move-to-build"]')).toBeFocused();
  await page.getByRole("searchbox", { name: "Search tasks" }).fill("unmatched-search-fixture");
  await page.locator('[data-guide-target="task-move-to-handoff"]').click();
  await page.locator('[data-guide-target="task-move-save"]').click();
  await expect(page.getByRole("searchbox", { name: "Search tasks" })).toHaveValue("");
  await expect(column(page, "Handoff").getByRole("button", { name: `Open task: ${sampleTask.title}`, exact: true })).toBeVisible();
  await expect(page.locator('[data-guide-target="task-move"]')).toBeFocused();
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ taskId: sampleTask.id, fromStage: "Brief", stage: "Handoff" });
});

test("Move task panel and its controls fit 320px and 390px screens", async ({ page }, testInfo) => {
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await openTaskFixture(page, noSave);
    await page.locator('[data-guide-target="project-home"]').click();
    const controls = () => [page.locator('[data-guide-target="task-new"]'), page.locator('[data-guide-target="task-move"]')];
    for (const control of controls()) {
      const box = (await control.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    }
    await page.locator('[data-guide-target="task-move"]').click();
    await expect(page.getByRole("form", { name: "Move task", exact: true })).toBeVisible();
    await page.getByLabel("Task", { exact: true }).selectOption(sampleTask.id);
    await page.locator('[data-guide-target="task-move-to-review"]').click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const control of [page.getByLabel("Task", { exact: true }), ...["brief", "build", "review", "handoff"].map(stage => page.locator(`[data-guide-target="task-move-to-${stage}"]`)), page.locator('[data-guide-target="task-move-save"]')]) {
      const box = (await control.boundingBox())!;
      expect(box.width).toBeGreaterThan(60);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    }
    await page.screenshot({ path: testInfo.outputPath(`task-move-panel-${width}.png`) });
    await page.getByRole("button", { name: "Close move task", exact: true }).click();
    await page.getByRole("button", { name: `Open task: ${sampleTask.title}`, exact: true }).click();
    const shortcut = page.getByRole("button", { name: "Move to another stage", exact: true });
    await expect(shortcut).toBeVisible();
    const box = (await shortcut.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`task-details-move-${width}.png`) });
  }
});

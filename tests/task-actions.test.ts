import assert from "node:assert/strict";
import test from "node:test";
import { moveTaskReceiptSchema, parseCreateTask, parseMoveTask, resolveMoveTask, savedTaskSchema, taskReferenceKey } from "../src/lib/task-actions";
import type { Task } from "../src/lib/contracts";
import { parseGuideAction } from "../src/lib/guide-actions";

const request = { version: 1, requestId: "c26a362f-c4d8-4b75-985a-56ce444fc4d3", title: "Design homepage", description: "", stage: "Brief" };

test("task RPC accepts bounded creation fields without exposing them to read-only actions", () => {
  assert.deepEqual(parseCreateTask(JSON.stringify(request)), request);
  assert.equal(parseGuideAction(JSON.stringify(request)), null);
  for (const payload of [
    { ...request, ownerId: "another-owner" }, { ...request, selector: "#reset" },
    { ...request, requestId: "not-a-uuid" }, { ...request, stage: "Published" },
    { ...request, title: "\u0000Title" }, { ...request, title: "a\ud800" },
    { ...request, description: "x".repeat(501) }, { ...request, version: true },
  ]) assert.equal(parseCreateTask(JSON.stringify(payload)), null);
  assert.equal(parseCreateTask("{"), null);
  assert.equal(parseCreateTask(" ".repeat(4097)), null);
});

test("task RPC preserves complete Unicode within the transport limit", () => {
  const payload = { ...request, title: "🎨".repeat(120), description: "✨".repeat(500) };
  assert.deepEqual(parseCreateTask(JSON.stringify(payload)), payload);
});

const move = { version: 1, requestId: "0b7c43c5-7ad8-4f7e-9d56-0d9b6a0c3c11", title: "Design homepage", fromStage: null, stage: "Review" };

test("move RPC accepts only a bounded title and stages, never IDs, selectors, or creation fields", () => {
  assert.deepEqual(parseMoveTask(JSON.stringify(move)), move);
  assert.deepEqual(parseMoveTask(JSON.stringify({ ...move, fromStage: "Brief" })), { ...move, fromStage: "Brief" });
  assert.equal(parseGuideAction(JSON.stringify(move)), null);
  const { stage: _stage, ...missingStage } = move;
  const { fromStage: _fromStage, ...missingFromStage } = move;
  for (const payload of [
    missingStage, missingFromStage, { ...move, stage: null }, { ...move, ownerId: "another-owner" }, { ...move, selector: "#reset" },
    { ...move, taskId: "b8f4a8f5-ed89-4406-bcfe-e2a3854a6a71" }, { ...move, requestId: "not-a-uuid" },
    { ...move, stage: "Published" }, { ...move, fromStage: "review" }, { ...move, title: "\u0000Title" }, { ...move, title: "a\ud800" },
    { ...move, title: "x" }, { ...move, title: "x".repeat(121) }, { ...move, version: true }, { ...move, version: 2 },
  ]) assert.equal(parseMoveTask(JSON.stringify(payload)), null, JSON.stringify(payload));
  assert.equal(parseMoveTask("{"), null);
  assert.equal(parseMoveTask(JSON.stringify({ ...move, title: "Design homepage" + " ".repeat(4096) })), null);
});

test("create and move payloads are not interchangeable", () => {
  assert.equal(parseMoveTask(JSON.stringify(request)), null);
  assert.equal(parseCreateTask(JSON.stringify(move)), null);
  assert.equal(parseMoveTask(JSON.stringify({ ...request, fromStage: "Brief" })), null);
});

test("spoken titles share one reference key regardless of case, spacing, or punctuation", () => {
  assert.equal(taskReferenceKey("Design Home-page!"), taskReferenceKey("design homepage"));
  assert.equal(taskReferenceKey("Design Home-page!"), "designhomepage");
  assert.equal(taskReferenceKey("Ｑ３ Launch"), "q3launch");
  assert.equal(taskReferenceKey("Café brief"), taskReferenceKey("CAFÉ  BRIEF"));
  assert.notEqual(taskReferenceKey("Design homepage"), taskReferenceKey("Design homepages"));
});

const task = (id: number, title: string, stage: Task["stage"]): Task => ({ id: `00000000-0000-4000-8000-00000000000${id}`, title, stage });

test("move resolution names exactly one owned task or explains why it cannot", () => {
  const tasks = [task(1, "Design homepage", "Review"), task(2, "design home page", "Brief"), task(3, "Write launch copy", "Build")];
  assert.deepEqual(resolveMoveTask(tasks, { title: "Write Launch Copy!", fromStage: null, stage: "Review" }), { ok: true, task: tasks[2] });
  assert.deepEqual(resolveMoveTask(tasks, { title: "Design homepage", fromStage: null, stage: "Build" }), { ok: false, error: "ambiguous", stages: ["Brief", "Review"] });
  assert.deepEqual(resolveMoveTask(tasks, { title: "Design homepage", fromStage: "Brief", stage: "Build" }), { ok: true, task: tasks[1] });
  assert.deepEqual(resolveMoveTask(tasks, { title: "Design homepage", fromStage: "Handoff", stage: "Build" }), { ok: false, error: "not_found" });
  assert.deepEqual(resolveMoveTask(tasks, { title: "Unknown task", fromStage: null, stage: "Build" }), { ok: false, error: "not_found" });
  assert.deepEqual(resolveMoveTask(tasks, { title: "Write launch copy", fromStage: null, stage: "Build" }), { ok: false, error: "already_in_stage" });
  // Titles without letters or digits never match each other.
  const symbols = [task(4, "🚀🚀", "Brief")];
  assert.deepEqual(resolveMoveTask(symbols, { title: "✅✅", fromStage: null, stage: "Review" }), { ok: false, error: "not_found" });
});

test("move receipts accept a stored sample task with its tag and reject incomplete or injected tasks", () => {
  const stored = { id: "b8f4a8f5-ed89-4406-bcfe-e2a3854a6a71", title: "Gather brand references", stage: "Review", description: "Collect the visual direction.", tag: "Creative" };
  assert.deepEqual(moveTaskReceiptSchema.parse({ task: stored, fromStage: "Brief", replayed: false }).task, stored);
  assert.equal(savedTaskSchema.safeParse(stored).success, true);
  const { stage: _stage, ...stageless } = stored;
  for (const receipt of [
    { task: stageless, fromStage: "Brief", replayed: false }, { task: { ...stored, tag: "x".repeat(41) }, fromStage: "Brief", replayed: false },
    { task: { ...stored, ownerId: "another-owner" }, fromStage: "Brief", replayed: false }, { task: { ...stored, id: "preview-client_delivery-2" }, fromStage: "Brief", replayed: false },
    { task: stored, fromStage: "Brief" }, { task: stored, fromStage: "Published", replayed: false },
  ]) assert.equal(moveTaskReceiptSchema.safeParse(receipt).success, false, JSON.stringify(receipt));
});

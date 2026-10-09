import assert from "node:assert/strict";
import { test } from "node:test";
import { parseGuideAction, guideActionMarker, guideActionTab, isGuideActionMarker } from "../src/lib/guide-actions";

test("guide actions cannot invoke arbitrary controls, selectors, or data mutations", () => {
  const base = { version: 1, actionId: "test-action", kind: "navigate", target: "overview" };
  for (const extra of [
    { target: "create" }, { target: "reset" }, { kind: "click", target: "button" },
    { target: '[type="submit"]' }, { selector: "#reset" }, { script: "document.body.click()" },
    { kind: "stage", target: "delete" }, { kind: "role", target: "admin" },
    { kind: "faq", target: "create" }, { version: 2 }, { actionId: "../unsafe" },
  ]) assert.equal(parseGuideAction(JSON.stringify({ ...base, ...extra })), null);
  for (const payload of ["null", "[]", "{", "x".repeat(2049)]) assert.equal(parseGuideAction(payload), null);
});

test("accepted guide actions point to fixed view controls and their owning panel", () => {
  for (const [kind, target, marker, panel] of [
    ["navigate", "overview", "nav-overview", "overview"],
    ["stage", "review", "stage-review", "workflow"],
    ["role", "reviewer", "role-reviewer", "roles"],
    ["faq", "handoff", "faq-handoff", "handbook"],
  ]) {
    const action = parseGuideAction(JSON.stringify({ version: 1, actionId: "test-action", kind, target }));
    assert.ok(action);
    assert.equal(guideActionMarker(action), marker);
    assert.equal(guideActionTab(action), panel);
  }
});

test("task move controls count as manual takeover but stay outside the read-only registry", () => {
  const markers = ["task-move", "task-move-to-brief", "task-move-to-build", "task-move-to-review", "task-move-to-handoff", "task-move-save"];
  for (const marker of [...markers, "project-home", "task-new", "task-save", "nav-overview", "stage-review"]) assert.equal(isGuideActionMarker(marker), true, marker);
  for (const marker of ["task-move-to-published", "task-move-to-review-now", "task-delete", "task-move-to", "move-review"]) assert.equal(isGuideActionMarker(marker), false, marker);
  for (const payload of [
    { kind: "task", target: "move" }, { kind: "task_control", target: "task-move" }, { kind: "navigate", target: "task-move" },
    { kind: "stage", target: "task-move-to-review" }, { kind: "task-move", target: "save" }, { kind: "faq", target: "move" },
  ]) assert.equal(parseGuideAction(JSON.stringify({ version: 1, actionId: "test-action", ...payload })), null, JSON.stringify(payload));
});

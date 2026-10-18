import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMatchingSearch,
  buildResultsSearch,
  usesSharedWorkspaceView,
  validateWorkflowSearch,
} from "../src/lib/workflow-route.ts";

test("Dashboard continuation restores the saved review step without selecting shared UI", () => {
  const search = buildMatchingSearch("workspace-1", 3);
  assert.equal(search.step, 3);
  assert.equal(usesSharedWorkspaceView(true, search), false);
});

test("existing bookmarks with no step keep the original Matching and Results screens", () => {
  const matching = validateWorkflowSearch({ workspace: "workspace-1" });
  const results = validateWorkflowSearch(buildResultsSearch("workspace-1"));
  assert.equal(usesSharedWorkspaceView(true, matching), false);
  assert.equal(usesSharedWorkspaceView(true, results), false);
});

test("every workflow step including old step numbering stays in the original workflow", () => {
  for (const step of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const search = validateWorkflowSearch({ workspace: "workspace-1", step: String(step) });
    assert.equal(usesSharedWorkspaceView(true, search), false);
    assert.ok(search.step >= 1 && search.step <= 3);
  }
});

test("shared reader requires an explicit view, a workspace and an enabled feature", () => {
  const shared = validateWorkflowSearch({ workspace: "workspace-1", view: "shared" });
  assert.equal(usesSharedWorkspaceView(true, shared), true);
  assert.equal(usesSharedWorkspaceView(false, shared), false);
  assert.equal(usesSharedWorkspaceView(true, validateWorkflowSearch({ view: "shared" })), false);
  assert.equal(usesSharedWorkspaceView(true, validateWorkflowSearch({ workspace: "workspace-1", view: "unknown" })), false);
});

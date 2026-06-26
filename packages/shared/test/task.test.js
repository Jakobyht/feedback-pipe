import test from "node:test";
import assert from "node:assert/strict";
import { createTaskFromFeedback, validateTask } from "../src/index.js";

test("forwards feedback verbatim without judgement", () => {
  const message = "The dark mode settings page has unreadable text";
  const task = createTaskFromFeedback({
    workspaceId: "acme",
    message,
    pageUrl: "/settings",
    repoHint: "frontend-app"
  });

  assert.equal(validateTask(task).ok, true);
  assert.equal(task.workspaceId, "acme");
  assert.equal(task.message, message);
  assert.equal(task.pageUrl, "/settings");
  assert.equal(task.repoHint, "frontend-app");
  // The pipe must not invent priority or acceptance criteria.
  assert.equal(task.priority, undefined);
  assert.equal(task.acceptanceCriteria, undefined);
});

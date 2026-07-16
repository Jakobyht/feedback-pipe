import test from "node:test";
import assert from "node:assert/strict";
import { buildAgentPrompt, createTaskFromFeedback, validateTask } from "../src/index.js";

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

test("prompt contains the raw message and nothing invented", () => {
  const task = createTaskFromFeedback({
    workspaceId: "acme",
    message: "Search is broken",
    pageUrl: "/search"
  });

  const prompt = buildAgentPrompt(task);
  assert.ok(prompt.includes("Search is broken"));
  assert.ok(prompt.includes("Page: /search"));
  // No repoHint was given, so no repo hint line may appear.
  assert.ok(!prompt.includes("Repo hint"));
});

test("rejects feedback without a message", () => {
  assert.throws(
    () => createTaskFromFeedback({ workspaceId: "acme", message: "   " }),
    /message must be a non-empty string/
  );
});

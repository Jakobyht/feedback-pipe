// End-to-end test of the pipe: starts the real server as a subprocess against
// a temporary "repo", posts feedback over HTTP, and observes what the fake
// agent actually did. Verifies the three invariants: authenticated inbound,
// verbatim forwarding, and one agent at a time per working tree.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serverPath = fileURLToPath(new URL("../src/server.js", import.meta.url));
const API_KEY = "test-key";

// The fake agent records when it starts and ends. If two agents ever run at
// the same time, the start/end lines interleave.
const FAKE_AGENT =
  'sh -c \'echo "start $APE_TASK_ID" >> "$APE_REPO_PATH/agent.log"; sleep 0.2; echo "end $APE_TASK_ID" >> "$APE_REPO_PATH/agent.log"\'';

async function startPipe(repoDir) {
  const child = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      PIPE_API_KEY: API_KEY,
      PIPE_REPO: repoDir,
      PIPE_PORT: "0",
      PIPE_AGENT_COMMAND: FAKE_AGENT
    },
    stdio: ["ignore", "pipe", "inherit"]
  });

  const port = await new Promise((resolve, reject) => {
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/listening on http:\/\/[^:]+:(\d+)/);
      if (match) resolve(Number(match[1]));
    });
    child.on("exit", () => reject(new Error(`pipe exited early:\n${output}`)));
  });

  return { child, url: `http://127.0.0.1:${port}` };
}

function postFeedback(url, body, key = API_KEY) {
  return fetch(`${url}/feedback`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`
    },
    body: JSON.stringify(body)
  });
}

async function waitFor(predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("condition not met in time");
}

test("pipe forwards verbatim, authenticates, and runs one agent at a time", async (t) => {
  const repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "pipe-test-"));
  const { child, url } = await startPipe(repoDir);
  t.after(() => child.kill());
  t.after(() => fs.rm(repoDir, { recursive: true, force: true }));

  // Wrong key is rejected without leaking anything.
  const denied = await postFeedback(url, { message: "hi" }, "wrong-key");
  assert.equal(denied.status, 401);

  // Missing message is rejected before any agent is involved.
  const invalid = await postFeedback(url, { pageUrl: "/cart" });
  assert.equal(invalid.status, 422);

  // Two quick submissions: both accepted immediately.
  const message = "The checkout button does nothing on mobile";
  const first = await postFeedback(url, { message, pageUrl: "/cart" });
  const second = await postFeedback(url, { message: "Second piece of feedback" });
  assert.equal(first.status, 202);
  assert.equal(second.status, 202);
  const { taskId, status } = await first.json();
  assert.equal(status, "forwarded");

  // The prompt file contains the user's words verbatim.
  const promptFile = path.join(repoDir, ".ape", "tasks", taskId, "task.md");
  await waitFor(() => fs.access(promptFile).then(() => true, () => false));
  const prompt = await fs.readFile(promptFile, "utf8");
  assert.ok(prompt.includes(message));

  // Task files never enter git history.
  const gitignore = await fs.readFile(path.join(repoDir, ".ape", ".gitignore"), "utf8");
  assert.equal(gitignore, "*\n");

  // Both agents ran, strictly one after the other: start/end never interleave.
  const logFile = path.join(repoDir, "agent.log");
  await waitFor(async () => {
    const log = await fs.readFile(logFile, "utf8").catch(() => "");
    return log.trim().split("\n").length === 4;
  });
  const lines = (await fs.readFile(logFile, "utf8")).trim().split("\n");
  assert.match(lines[0], /^start (task_\w+)$/);
  assert.equal(lines[1], lines[0].replace("start", "end"));
  assert.match(lines[2], /^start (task_\w+)$/);
  assert.equal(lines[3], lines[2].replace("start", "end"));
  assert.notEqual(lines[0], lines[2]);
});

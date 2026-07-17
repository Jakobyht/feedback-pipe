#!/usr/bin/env node
// The pipe: one local program, one direction toward the sender. It receives
// feedback, hands the user's words verbatim to the entity's own agent (e.g.
// Claude Code), and never reports back — the feedback sender does not care
// about the result. It is the wire, not the worker.
//
// One invariant the pipe does enforce: one working tree, one writer. Agent
// runs are queued and started one at a time, because two agents editing the
// same checkout corrupt each other's work. Watching an agent exit so the next
// one can start is not "reporting back" — nothing ever flows to the sender.
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { timingSafeEqual } from "node:crypto";
import { URL } from "node:url";
import { buildAgentPrompt, createTaskFromFeedback, validateTask } from "@ape/shared";

const port = Number(process.env.PIPE_PORT || 8181);
const host = process.env.PIPE_HOST || "127.0.0.1";
const apiKey = process.env.PIPE_API_KEY;
const repoPath = process.env.PIPE_REPO ? path.resolve(process.env.PIPE_REPO) : null;
// Defaults to Claude Code in headless mode. Override PIPE_AGENT_COMMAND to use
// a different agent.
const agentCommand =
  process.env.PIPE_AGENT_COMMAND ||
  'claude -p "$(cat "$APE_TASK_PROMPT_FILE")" --permission-mode acceptEdits';
const workspaceId = process.env.PIPE_WORKSPACE || "default";
const MAX_BODY_BYTES = 256 * 1024;

if (!apiKey) fail("Missing PIPE_API_KEY (the inbound key this entity uses).");
if (!repoPath) fail("Missing PIPE_REPO (the repository the agent works on).");

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/health") {
    return sendJson(res, 200, { ok: true, repo: repoPath, workspace: workspaceId });
  }

  if (req.method === "POST" && url.pathname === "/feedback") {
    if (!authorized(req)) return sendJson(res, 401, { error: "unauthorized" });

    let body;
    try {
      body = await readJson(req);
    } catch (error) {
      const tooLarge = error.code === "PAYLOAD_TOO_LARGE";
      return sendJson(res, tooLarge ? 413 : 400, {
        error: tooLarge ? "payload_too_large" : "invalid_json"
      });
    }

    let task;
    try {
      task = createTaskFromFeedback({
        workspaceId,
        message: body.message,
        pageUrl: body.pageUrl,
        repoHint: body.repoHint,
        metadata: body.metadata || {}
      });
    } catch (error) {
      return sendJson(res, 422, { error: error.message });
    }

    const validation = validateTask(task);
    if (!validation.ok) return sendJson(res, 422, { errors: validation.errors });

    await forwardToAgent(task);
    // The pipe's job toward the sender ends here. It does not look back.
    return sendJson(res, 202, { taskId: task.id, status: "forwarded" });
  }

  sendJson(res, 404, { error: "not_found" });
});

server.listen(port, host, () => {
  console.log(`Feedback pipe listening on http://${host}:${server.address().port}`);
  console.log(`Repo: ${repoPath}`);
  console.log(`Agent: ${agentCommand}`);
  console.log("POST /feedback with Authorization: Bearer <PIPE_API_KEY>");
});

// One writer per working tree: agent runs are chained, not parallel.
let agentLane = Promise.resolve();

async function forwardToAgent(task) {
  const apeDir = path.join(repoPath, ".ape");
  const taskDir = path.join(apeDir, "tasks", task.id);
  await fs.mkdir(taskDir, { recursive: true });
  // Task files are working material, not repo content — keep them out of git.
  await fs.writeFile(path.join(apeDir, ".gitignore"), "*\n", { flag: "wx" }).catch(() => {});
  await fs.writeFile(path.join(taskDir, "task.json"), JSON.stringify(task, null, 2));
  const promptFile = path.join(taskDir, "task.md");
  await fs.writeFile(promptFile, buildAgentPrompt(task));

  agentLane = agentLane.then(() => runAgent(task, promptFile, taskDir));
}

function runAgent(task, promptFile, taskDir) {
  return new Promise((resolve) => {
    const child = spawn(agentCommand, {
      cwd: repoPath,
      shell: true,
      stdio: "ignore",
      env: {
        ...process.env,
        APE_TASK_FILE: path.join(taskDir, "task.json"),
        APE_TASK_PROMPT_FILE: promptFile,
        APE_TASK_ID: task.id,
        APE_REPO_PATH: repoPath
      }
    });
    console.log(`[${task.id}] agent started`);
    child.on("error", (error) => {
      console.error(`[${task.id}] failed to launch agent: ${error.message}`);
      resolve();
    });
    child.on("exit", (code, signal) => {
      if (code === 0) console.log(`[${task.id}] agent finished`);
      else console.error(`[${task.id}] agent exited with ${signal ? `signal ${signal}` : `code ${code}`}`);
      resolve();
    });
  });
}

function authorized(req) {
  const given = Buffer.from(req.headers.authorization || "");
  const expected = Buffer.from(`Bearer ${apiKey}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error("payload too large");
      error.code = "PAYLOAD_TOO_LARGE";
      throw error;
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "content-type": "application/json" });
  res.end(JSON.stringify(payload, null, 2));
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

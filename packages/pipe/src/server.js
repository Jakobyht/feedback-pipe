#!/usr/bin/env node
// The pipe: one local program. It listens for feedback, forwards the user's
// words verbatim to the entity's own agent (e.g. codex), and reports status.
// It has no model and makes no judgement about the code.
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { URL } from "node:url";
import { buildAgentPrompt, createTaskFromFeedback, validateTask } from "@ape/shared";

const port = Number(process.env.PIPE_PORT || 8181);
const host = process.env.PIPE_HOST || "127.0.0.1";
const apiKey = process.env.PIPE_API_KEY;
const repoPath = process.env.PIPE_REPO ? path.resolve(process.env.PIPE_REPO) : null;
const agentCommand = process.env.PIPE_AGENT_COMMAND;
const workspaceId = process.env.PIPE_WORKSPACE || "default";

if (!apiKey) fail("Missing PIPE_API_KEY (the inbound key this entity uses).");
if (!repoPath) fail("Missing PIPE_REPO (the repository the agent works on).");
if (!agentCommand) fail("Missing PIPE_AGENT_COMMAND (the entity's own agent, e.g. codex).");

const tasks = new Map();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/health") {
    return sendJson(res, 200, { ok: true, repo: repoPath, workspace: workspaceId });
  }

  if (req.method === "GET" && url.pathname.startsWith("/tasks/")) {
    if (!authorized(req)) return sendJson(res, 401, { error: "unauthorized" });
    const id = url.pathname.slice("/tasks/".length);
    const record = tasks.get(id);
    if (!record) return sendJson(res, 404, { error: "not_found" });
    return sendJson(res, 200, record);
  }

  if (req.method === "POST" && url.pathname === "/feedback") {
    if (!authorized(req)) return sendJson(res, 401, { error: "unauthorized" });

    const body = await readJson(req).catch(() => null);
    if (!body) return sendJson(res, 400, { error: "invalid_json" });

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

    tasks.set(task.id, { task, status: "received", updates: [] });
    // Hand off to the agent without blocking the response.
    runAgent(task).catch((error) => setStatus(task.id, "failed", error.message));

    return sendJson(res, 202, { taskId: task.id, status: "received" });
  }

  sendJson(res, 404, { error: "not_found" });
});

server.listen(port, host, () => {
  console.log(`Feedback pipe listening on http://${host}:${port}`);
  console.log(`Repo: ${repoPath}`);
  console.log(`Agent: ${agentCommand}`);
  console.log("POST /feedback with Authorization: Bearer <PIPE_API_KEY>");
});

async function runAgent(task) {
  const taskDir = path.join(repoPath, ".ape", "tasks", task.id);
  await fs.mkdir(taskDir, { recursive: true });
  const taskFile = path.join(taskDir, "task.json");
  const promptFile = path.join(taskDir, "task.md");
  await fs.writeFile(taskFile, JSON.stringify(task, null, 2));
  await fs.writeFile(promptFile, buildAgentPrompt(task));
  setStatus(task.id, "agent_started", "Handed feedback to the agent");

  await runShell(agentCommand, {
    cwd: repoPath,
    env: {
      APE_TASK_FILE: taskFile,
      APE_TASK_PROMPT_FILE: promptFile,
      APE_TASK_ID: task.id,
      APE_REPO_PATH: repoPath
    }
  });

  setStatus(task.id, "agent_complete", "Agent finished");
}

function setStatus(taskId, status, detail) {
  const record = tasks.get(taskId);
  if (!record) return;
  record.status = status;
  record.updates.push({ status, detail: detail || null, at: new Date().toISOString() });
  console.log(`[${taskId}] ${status}${detail ? ` — ${detail}` : ""}`);
}

function runShell(command, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd: options.cwd,
      shell: true,
      stdio: "inherit",
      env: { ...process.env, ...(options.env || {}) }
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Agent command exited with ${code}`));
    });
  });
}

function authorized(req) {
  return (req.headers.authorization || "") === `Bearer ${apiKey}`;
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
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

#!/usr/bin/env node
// The pipe: one local program, one direction. It receives feedback and hands
// the user's words verbatim to the entity's own agent (e.g. Claude Code), then
// it is done. It does not wait for the agent, track it, or report back — the
// feedback sender does not care about the result. It is the wire, not the worker.
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
if (!agentCommand) fail("Missing PIPE_AGENT_COMMAND (the entity's own agent, e.g. Claude Code).");

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/health") {
    return sendJson(res, 200, { ok: true, repo: repoPath, workspace: workspaceId });
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

    await forwardToAgent(task);
    // The pipe's job ends here. It does not look back.
    return sendJson(res, 202, { taskId: task.id, status: "forwarded" });
  }

  sendJson(res, 404, { error: "not_found" });
});

server.listen(port, host, () => {
  console.log(`Feedback pipe listening on http://${host}:${port}`);
  console.log(`Repo: ${repoPath}`);
  console.log(`Agent: ${agentCommand}`);
  console.log("POST /feedback with Authorization: Bearer <PIPE_API_KEY>");
});

async function forwardToAgent(task) {
  const taskDir = path.join(repoPath, ".ape", "tasks", task.id);
  await fs.mkdir(taskDir, { recursive: true });
  await fs.writeFile(path.join(taskDir, "task.json"), JSON.stringify(task, null, 2));
  const promptFile = path.join(taskDir, "task.md");
  await fs.writeFile(promptFile, buildAgentPrompt(task));

  // Fire and forget: launch the agent and detach. We do not await it,
  // track its exit, or read its output.
  const child = spawn(agentCommand, {
    cwd: repoPath,
    shell: true,
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      APE_TASK_FILE: path.join(taskDir, "task.json"),
      APE_TASK_PROMPT_FILE: promptFile,
      APE_TASK_ID: task.id,
      APE_REPO_PATH: repoPath
    }
  });
  child.on("error", (error) => console.error(`[${task.id}] failed to launch agent: ${error.message}`));
  child.unref();
  console.log(`[${task.id}] forwarded to agent`);
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

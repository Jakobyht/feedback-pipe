// The review-before-merge agent is the safety story for untrusted feedback:
// the agent's output must land on its OWN branch as a reviewable change and
// NEVER touch the default branch. This drives the real script against real git
// repos (a bare repo as "origin") with a stub coding agent, and asserts both:
// a change becomes a pushed branch with main untouched, and a no-op change
// pushes nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./review-agent.sh", import.meta.url));
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const gitDir = (dir, ...args) => execFileSync("git", ["--git-dir", dir, ...args], { encoding: "utf8" }).trim();

function setupRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "review-agent-"));
  const origin = path.join(root, "origin.git");
  const work = path.join(root, "work");
  execFileSync("git", ["init", "--quiet", "--bare", origin]);
  execFileSync("git", ["clone", "--quiet", origin, work]);
  git(work, "config", "user.email", "t@t.co");
  git(work, "config", "user.name", "t");
  fs.writeFileSync(path.join(work, "app.txt"), "v1\n");
  git(work, "add", "app.txt");
  git(work, "commit", "--quiet", "-m", "init");
  git(work, "branch", "-M", "main");
  git(work, "push", "--quiet", "-u", "origin", "main");
  return { root, origin, work };
}

function runAgent(work, taskId, agentScript) {
  // The pipe writes prompts under the gitignored .ape/, never into tracked
  // paths — mirror that by keeping the prompt file outside the repo tree.
  const promptFile = path.join(path.dirname(work), `prompt-${taskId}.txt`);
  fs.writeFileSync(promptFile, "The login button is misaligned on mobile\n");
  execFileSync("bash", [script], {
    env: {
      ...process.env,
      APE_REPO_PATH: work,
      APE_TASK_ID: taskId,
      APE_TASK_PROMPT_FILE: promptFile,
      PIPE_CODING_AGENT: agentScript
    },
    encoding: "utf8"
  });
}

test("a change lands on its own branch and main is untouched", () => {
  const { root, origin, work } = setupRepo();
  const mainBefore = gitDir(origin, "rev-parse", "main");

  // A stub agent that edits a file, as a real coding agent would.
  const agent = path.join(root, "edit-agent.sh");
  fs.writeFileSync(agent, '#!/usr/bin/env bash\necho "patched" >> app.txt\n');
  fs.chmodSync(agent, 0o755);

  runAgent(work, "task_change", agent);

  const branches = gitDir(origin, "for-each-ref", "--format=%(refname:short)", "refs/heads").split("\n");
  assert.ok(branches.includes("feedback/task_change"), "feedback branch was pushed to origin");
  assert.equal(gitDir(origin, "rev-parse", "main"), mainBefore, "main on origin is unchanged");

  const diff = gitDir(origin, "diff", `main..feedback/task_change`);
  assert.match(diff, /\+patched/, "the branch carries the agent's change for review");

  // The working checkout is returned to a clean main, ready for the next task.
  assert.equal(git(work, "rev-parse", "--abbrev-ref", "HEAD"), "main", "checkout back on main");
  assert.equal(git(work, "status", "--porcelain"), "", "working tree clean");
  fs.rmSync(root, { recursive: true, force: true });
});

test("a no-op change pushes nothing", () => {
  const { root, origin, work } = setupRepo();

  const agent = path.join(root, "noop-agent.sh");
  fs.writeFileSync(agent, "#!/usr/bin/env bash\ntrue\n");
  fs.chmodSync(agent, 0o755);

  runAgent(work, "task_noop", agent);

  const branches = gitDir(origin, "for-each-ref", "--format=%(refname:short)", "refs/heads").split("\n");
  assert.deepEqual(branches, ["main"], "no branch pushed when the agent changes nothing");
  assert.equal(git(work, "status", "--porcelain"), "", "working tree clean");
  fs.rmSync(root, { recursive: true, force: true });
});

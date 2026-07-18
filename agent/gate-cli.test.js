import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The CLI is the workflow's decision point: a valid triage exits 0 and writes
// the allow/deny output; a malformed one exits non-zero AND writes a safe
// "no code change" default, so a broken triage can never green-light a PR.
const cli = fileURLToPath(new URL("./gate-cli.mjs", import.meta.url));

function run(triageText) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-cli-"));
  const triageFile = path.join(dir, "triage.json");
  const outFile = path.join(dir, "out.txt");
  fs.writeFileSync(triageFile, triageText);
  fs.writeFileSync(outFile, "");
  let code = 0;
  try {
    execFileSync(process.execPath, [cli, triageFile], {
      env: { ...process.env, GITHUB_OUTPUT: outFile },
      stdio: "pipe"
    });
  } catch (error) {
    code = error.status ?? 1;
  }
  const outputs = Object.fromEntries(
    fs.readFileSync(outFile, "utf8").trim().split("\n").filter(Boolean).map((l) => l.split("=", 2))
  );
  fs.rmSync(dir, { recursive: true, force: true });
  return { code, outputs };
}

test("a verified bug exits 0 and allows a code change", () => {
  const { code, outputs } = run(
    JSON.stringify({
      category: "bug",
      confidence: "verified",
      action: "code-change",
      summary: "x",
      reproduction: "do y then z",
      affectedArea: "src/a.ts"
    })
  );
  assert.equal(code, 0);
  assert.equal(outputs.allow_code_change, "true");
  assert.equal(outputs.category, "bug");
});

test("a question exits 0 but forbids a code change", () => {
  const { code, outputs } = run(
    JSON.stringify({ category: "question", action: "reply-only", summary: "?", reproduction: "n/a", affectedArea: "unknown" })
  );
  assert.equal(code, 0);
  assert.equal(outputs.allow_code_change, "false");
  assert.equal(outputs.category, "question");
});

test("an inconsistent triage exits non-zero with a safe default output", () => {
  const { code, outputs } = run(
    JSON.stringify({ category: "question", action: "code-change", summary: "sneaky", reproduction: "n/a", affectedArea: "unknown" })
  );
  assert.notEqual(code, 0);
  assert.equal(outputs.allow_code_change, "false", "a rejected triage never green-lights a PR");
});

test("unparseable triage fails closed", () => {
  const { code, outputs } = run("this is not json");
  assert.notEqual(code, 0);
  assert.equal(outputs.allow_code_change, "false");
});

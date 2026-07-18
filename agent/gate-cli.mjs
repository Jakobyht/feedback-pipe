#!/usr/bin/env node
// The gate, as the GitHub Action runs it. Reads the triage the agent produced,
// evaluates it deterministically, and reports the verdict to the workflow:
//   - exit 1 if the triage is malformed/inconsistent (the agent must redo it);
//   - otherwise exit 0 and emit `allow_code_change` + `category` as step
//     outputs, which is what lets (or forbids) the code-change job to run.
//
// Usage: node agent/gate-cli.mjs <triage-file>
import fs from "node:fs";
import { evaluateTriage, parseTriageBlock, categoryLabel } from "./triage-gate.mjs";

const file = process.argv[2] || "triage.json";

let text;
try {
  text = fs.readFileSync(file, "utf8");
} catch (error) {
  fail(`could not read triage file ${file}: ${error.message}`);
}

const parsed = parseTriageBlock(text);
if (!parsed.ok) fail(parsed.error);

const verdict = evaluateTriage(parsed.triage);
const category = parsed.triage?.category;

emitOutput("allow_code_change", String(verdict.allowCodeChange));
emitOutput("category", CATEGORIES_INCLUDES(category) ? category : "invalid");
emitOutput("label", categoryLabel(category));

summary(
  [
    `### Feedback triage`,
    ``,
    `- **category:** \`${category}\``,
    `- **valid:** ${verdict.valid}`,
    `- **code change allowed:** ${verdict.allowCodeChange}`,
    verdict.errors.length ? `\n**Rejected:**\n${verdict.errors.map((e) => `- ${e}`).join("\n")}` : ""
  ].join("\n")
);

if (!verdict.valid) {
  console.error(`Triage rejected:\n${verdict.errors.map((e) => `  - ${e}`).join("\n")}`);
  process.exit(1);
}

console.log(`Triage valid. category=${category} allowCodeChange=${verdict.allowCodeChange}`);
process.exit(0);

function CATEGORIES_INCLUDES(c) {
  return typeof c === "string" && c.length > 0;
}

function emitOutput(name, value) {
  const out = process.env.GITHUB_OUTPUT;
  if (out) fs.appendFileSync(out, `${name}=${value}\n`);
}

function summary(md) {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (path) fs.appendFileSync(path, `${md}\n`);
}

function fail(message) {
  console.error(message);
  // A missing/unparseable triage is a hard failure: emit a safe default first
  // so any downstream `if` that reads the output sees "no code change".
  emitOutput("allow_code_change", "false");
  emitOutput("category", "invalid");
  process.exit(1);
}

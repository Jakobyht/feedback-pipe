import test from "node:test";
import assert from "node:assert/strict";
import { evaluateTriage, parseTriageBlock, categoryLabel } from "./triage-gate.mjs";

// The gate is the whole safety story: an AI reads untrusted feedback and judges
// it, but only DETERMINISTIC code decides whether that judgement may touch the
// repo. These tests pin the one guarantee — a PR is reachable ONLY through a
// fully-specified, verified bug — and that the model cannot route around it.

const verifiedBug = {
  category: "bug",
  confidence: "verified",
  action: "code-change",
  summary: "Login button does nothing on mobile Safari",
  reproduction: "On iOS Safari, tap 'Log in' on /login — no request fires; works on desktop.",
  affectedArea: "src/components/Login.tsx"
};

test("a fully-specified verified bug is the ONLY path to a code change", () => {
  const r = evaluateTriage(verifiedBug);
  assert.equal(r.valid, true, r.errors.join("; "));
  assert.equal(r.allowCodeChange, true);
});

test("an UNVERIFIED bug cannot change code", () => {
  const r = evaluateTriage({ ...verifiedBug, confidence: "unverified", action: "reply-only" });
  assert.equal(r.valid, true, "unverified + reply-only is a well-formed triage");
  assert.equal(r.allowCodeChange, false, "but it may not open a PR");
});

test("a bug that claims code-change while unverified is REJECTED", () => {
  const r = evaluateTriage({ ...verifiedBug, confidence: "unverified" });
  assert.equal(r.valid, false);
  assert.equal(r.allowCodeChange, false);
  assert.match(r.errors.join(" "), /requires confidence "verified"/);
});

test("a question cannot be routed into a code change", () => {
  const r = evaluateTriage({
    category: "question",
    action: "code-change",
    summary: "How do I reset my password?",
    reproduction: "n/a",
    affectedArea: "unknown"
  });
  assert.equal(r.valid, false);
  assert.equal(r.allowCodeChange, false);
  assert.match(r.errors.join(" "), /only allowed for category "bug"/);
});

test("information and question are reply-only and valid", () => {
  for (const category of ["information", "question", "feature"]) {
    const r = evaluateTriage({
      category,
      action: "reply-only",
      confidence: "n/a",
      summary: `A ${category} note`,
      reproduction: "n/a",
      affectedArea: "unknown"
    });
    assert.equal(r.valid, true, `${category}: ${r.errors.join("; ")}`);
    assert.equal(r.allowCodeChange, false, `${category} never opens a PR`);
  }
});

test("a verified bug with placeholder reproduction cannot change code", () => {
  const r = evaluateTriage({ ...verifiedBug, reproduction: "n/a" });
  assert.equal(r.valid, false, "a code change with no real repro is rejected");
  assert.equal(r.allowCodeChange, false);
  assert.match(r.errors.join(" "), /real reproduction steps/);
});

test("a verified bug with an unknown affected area cannot change code", () => {
  const r = evaluateTriage({ ...verifiedBug, affectedArea: "unknown" });
  assert.equal(r.valid, false);
  assert.equal(r.allowCodeChange, false);
  assert.match(r.errors.join(" "), /concrete affected area/);
});

test("missing required fields are rejected", () => {
  assert.equal(evaluateTriage({}).valid, false);
  assert.equal(evaluateTriage({ ...verifiedBug, summary: "  " }).valid, false);
  assert.equal(evaluateTriage(null).valid, false);
  assert.equal(evaluateTriage("nope").valid, false);
});

test("an unknown category is rejected", () => {
  const r = evaluateTriage({ ...verifiedBug, category: "urgent!!!" });
  assert.equal(r.valid, false);
  assert.match(r.errors.join(" "), /category must be one of/);
});

test("needs-info category and action must agree", () => {
  const bad = evaluateTriage({
    category: "needs-info",
    action: "reply-only",
    summary: "Not enough detail",
    reproduction: "n/a",
    affectedArea: "unknown"
  });
  assert.equal(bad.valid, false);
  const good = evaluateTriage({
    category: "needs-info",
    action: "needs-info",
    summary: "Which page did this happen on?",
    reproduction: "n/a",
    affectedArea: "unknown"
  });
  assert.equal(good.valid, true, good.errors.join("; "));
  assert.equal(good.allowCodeChange, false);
});

test("parseTriageBlock extracts a fenced json block and never throws", () => {
  const out = parseTriageBlock('Here is my triage:\n```json\n{"category":"bug"}\n```\nthanks');
  assert.equal(out.ok, true);
  assert.equal(out.triage.category, "bug");
  assert.equal(parseTriageBlock("not json at all {oops").ok, false);
  assert.equal(parseTriageBlock(42).ok, false);
});

test("categoryLabel maps to a namespaced label, unknown → invalid", () => {
  assert.equal(categoryLabel("bug"), "triage/bug");
  assert.equal(categoryLabel("question"), "triage/question");
  assert.equal(categoryLabel("nonsense"), "triage/invalid");
});

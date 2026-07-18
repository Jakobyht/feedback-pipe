# GitHub-native flow (no server to run)

There are two ways to run the pipe. The **local HTTP pipe** (`packages/pipe`)
is a program you host. This document describes the **GitHub-native** flow, where
there is **no server to keep running** — GitHub Actions is the runtime and your
coding agent authenticates to Claude over OAuth.

```
app → feedback store (Firebase / Supabase / your backend)
    → a function creates a GitHub issue labeled `agent-ready`
    → GitHub Action wakes Claude Code (OAuth token, no API key)
    → DETERMINISTIC triage gate
    → a draft PR — but only for a verified bug
```

Nothing here is always-on except GitHub. No `PIPE_URL`, no tunnel, no host.

## The parts

1. **Intake** — a new feedback record becomes a GitHub issue labeled
   `agent-ready`. Pick your stack:
   - Firebase: [`examples/firebase`](../examples/firebase) (a Firestore trigger).
   - Supabase or any backend: create the issue with a server-side GitHub token;
     apply the labels `user-feedback` and `agent-ready`.
2. **The agent** — [`.github/workflows/feedback-agent.yml`](../.github/workflows/feedback-agent.yml)
   triggers on the `agent-ready` label and runs Claude Code in two phases with a
   gate between them.
3. **The policy** — [`agent/POLICY.md`](../agent/POLICY.md) tells the agent how
   to triage and the one rule it must obey.
4. **The gate** — [`agent/triage-gate.mjs`](../agent/triage-gate.mjs) +
   [`gate-cli.mjs`](../agent/gate-cli.mjs) decide, in code, what the agent's
   judgement is allowed to do.

## The deterministic guarantee

The agent is a model; its triage is a judgement. What that judgement may **do**
is not the model's call — it is decided by `agent/triage-gate.mjs`, which is
pure, deterministic, and unit-tested (`agent/triage-gate.test.js`):

- Every issue is classified into exactly one **category**
  (`bug` · `question` · `information` · `feature` · `needs-info` · `invalid`)
  and the triage must fill **every required field** or it is rejected.
- A **code change (a PR) is reachable only** for a `bug` the agent marked
  `verified`, with real reproduction steps and a concrete affected area — and
  the gate re-checks that combination. Questions, information, feature ideas,
  and unverified or vague reports are **reply-only**; the model cannot relabel
  its way into editing the repo.
- The workflow runs the gate **before** any code phase, so a rejected or
  non-bug triage never reaches the code-change step. A malformed triage fails
  closed (`allow_code_change=false`).
- Even an allowed fix lands as a **draft PR** a human approves; the default
  branch is never changed automatically, and diffs touching sensitive paths
  (`.env`, keys, CI) are flagged.

This is the same principle the whole pipe rests on: **the AI judges; code
decides.**

## Wire it into a target repo

1. Copy `agent/` and `.github/workflows/feedback-agent.yml` into the repo the
   agent should fix.
2. Generate an OAuth token from your Claude subscription and add it as a repo
   secret named `CLAUDE_CODE_OAUTH_TOKEN`:
   ```bash
   claude setup-token
   # add the printed token: repo → Settings → Secrets and variables → Actions
   ```
3. Set up intake so feedback creates an `agent-ready` issue (see
   [`examples/firebase`](../examples/firebase)).
4. Submit one piece of feedback and watch: an `agent-ready` issue appears, the
   workflow triages it, applies a `triage/*` label + comment, and — only for a
   verified bug — opens a draft PR.

## Which flow should I use?

- **GitHub-native (this doc):** you don't want to run a server; your app already
  has a backend that can create an issue (Firebase/Supabase/etc.). Recommended
  for most apps.
- **Local HTTP pipe (`packages/pipe`):** you want the agent to run on a specific
  machine you control, reached directly over HTTP. See the top-level README.

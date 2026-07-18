# The agent side: writing a worker that is safe *and* correct

The pipe is the wire; it makes no judgement about the code (see
[architecture.md](architecture.md)). Every decision — what to change, whether
the change is any good, whether it may ship — lives in the **worker**: the
command you set as `PIPE_AGENT_COMMAND`. This guide is how to build a good one.

`examples/agents/review-agent.sh` already gives you the **transport-side**
safety: every task lands on a throwaway branch as a reviewable pull request,
with a tripwire on sensitive-path diffs, under least privilege. That guarantees
*reviewability*. It does not, by itself, guarantee the change is *correct* —
`review-agent.sh` commits whatever the agent produced. This doc adds the
**worker-side** half: verify before you ship, fail honestly, and let a referee
the agent cannot influence be the thing that admits the change.

## What "correct" means for a worker

Three properties, in the same spirit as the pipe's own "one working tree, one
writer" invariant:

- **SAFETY** — no change reaches the branch users deploy from unless it passes
  the project's gates (lint, tests, build). *Nothing unverified ships.*
- **LIVENESS** — every task ends in an inspectable state: a gate-passing PR, or
  an explicit failure with a reason. *No feedback is silently dropped.*
- **INTEGRITY** — the gate that admits a change is computed by something the
  agent cannot talk its way past. *The referee is not the player.*

## The one structural move that buys all three

Feedback is untrusted and the agent is fallible, so **do not let the worker be
its own judge.** Split the work in two:

1. **The worker** (what the pipe runs) opens a **pull request** and runs the
   gates itself as a courtesy — but ships even a "passing" change only as a PR,
   never a merge, never a push to the default branch.
2. **A CI check on the pull request re-runs the same gates** in a clean
   environment, and **branch protection makes those checks *required*.** Now a
   change can reach the default branch only if the gates pass — evaluated by CI,
   not asserted by the agent. That is INTEGRITY, and it makes the unsafe state
   (an unverified change on the default branch) *unrepresentable* rather than
   merely discouraged.

`review-agent.sh` already does step 1's "PR, not a push". Add required CI checks
on that PR and you have SAFETY by construction. If you then want zero humans in
the loop, enable auto-merge — **but only after the checks are required**:

> ⚠ Auto-merge with **no required checks** merges every PR the instant it is
> mergeable, *regardless of CI*. The safe order is always: make the checks
> required **first**, enable auto-merge **second**. Never the reverse.

Without auto-merge you are simply in the safe default: a human merges the PR,
and the human is the gate.

## The prompt the worker should carry

Whatever agent you run (Claude Code, Codex, Aider), give it a phased instruction
with hard gates and an honest-failure rule. The shape that has held up:

```
You are a feedback-fixing agent for <APP>. Ship via pull request only —
never push to or merge the default branch yourself.

Resolve this user feedback: <the verbatim message the pipe handed you>

1. INVESTIGATE — read the code, find the ROOT CAUSE, not the symptom.
2. IMPLEMENT — the smallest correct change that matches local conventions.
3. VERIFY — <lint>, <tests>, <build> must all pass. Re-read your full diff
   for unintended edits. If a gate fails because of your change, fix it.
4. SHIP — open a pull request; summarize root cause, fix, and what you ran.
   Do NOT merge and do NOT push to the default branch.
5. If any gate cannot pass, or the fix needs a human decision, or it touches
   something high-risk (auth, payments, migrations) unsafely: open NO pull
   request. Stop and report exactly what is missing. An honest failure is
   always better than a broken change.
```

Steps 4 and 5 are the load-bearing ones: "PR only" is what lets the required
checks be the real gate, and "honest failure, never a silent drop" is what
gives you LIVENESS. Everything else is tunable per app.

## Why this doesn't violate the pipe's philosophy

None of this lives in the pipe. The pipe still forwards the user's words
verbatim, runs one worker at a time, and reports nothing back. Verification,
PRs, required checks, and merge policy are all decisions *inside the worker and
the repository it targets* — exactly where the pipe says every decision belongs.
The wire stays a wire.

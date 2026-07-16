# Architecture

## One program

The pipe is a single local program that runs on the machine where the entity's
coding agent lives. There is no cloud component and no separate runner.

```
HTTP POST /feedback (Bearer key)
        |
        v
   [ pipe ]  -- writes task.md (verbatim feedback) --> repo/.ape/tasks/<id>/
        |
        v
   queues the task; runs PIPE_AGENT_COMMAND in the repo, one at a time
        |
        v
   the agent edits the code (the pipe never reports anything back)
```

## The argument, stated precisely

The design rests on three claims. Each claim's premise is stated so you can
check where it applies and where it does not.

**Claim 1 — the process boundary is the universal agent interface.**
Every coding agent (Claude Code, Codex, Aider, anything future) is a program
you can start with a working directory and a piece of text. You do not own the
agent's internals, so the only interface guaranteed to exist is the OS process
boundary: spawn it, hand it text. Anything richer (a plugin API, a socket
protocol) would be agent-specific and break universality.
*Consequence:* the pipe must run on the same machine as the agent.

**Claim 2 — no relay is needed *when the sender can reach that machine*.**
Since feedback can be POSTed directly to the machine the agent lives on,
no relay, queue service, or central brain is required. This premise is not
free: it holds when the pipe's machine is reachable from wherever your app's
backend runs (same host, same network, or exposed through an HTTPS reverse
proxy or tunnel — see the integration guide). If the machine is unreachable,
you add plain transport in front (a proxy, a tunnel); the pipe itself never
changes shape.

**Claim 3 — one direction toward the sender.**
The feedback sender does not consume a result, so no return path exists.
`POST /feedback` responds `202 { taskId, status: "forwarded" }` as soon as the
task is written and queued, and nothing ever flows back to the sender after
that — no status endpoint, no callback, no webhook.

## The invariant the pipe must enforce

One direction does **not** mean the pipe may be blind. There is one thing it
has to know: **one working tree, one writer.** Two agents editing the same
checkout at the same time corrupt each other's work (conflicting edits, git
index locks). So the pipe queues tasks and starts the next agent only after
the previous one exits. Watching an agent exit is bookkeeping for the queue,
not reporting — the sender still learns nothing.

If you need parallelism, run more pipes, each pointed at its own checkout.
The unit of serialization is the working tree, and one pipe owns exactly one.

## Trust boundaries

- **Inbound:** `PIPE_API_KEY` authenticates feedback submission. Understand
  what it grants: the feedback text goes verbatim into an agent that can edit
  the repository, so **holding the inbound key is effectively write access to
  the codebase**. Treat it like a deploy key, and review what the agent
  produces (e.g. via pull requests) rather than trusting the input.
- **Agent → model provider:** the agent's own key (e.g. `ANTHROPIC_API_KEY`),
  read locally from the agent's environment. The pipe never handles it.

The pipe forwards the user's words verbatim. It does not assign priority,
invent acceptance criteria, or rewrite the feedback. The agent makes every
decision about the code.

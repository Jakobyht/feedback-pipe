# Feedback Pipe

A single local program that forwards user feedback to an entity's **own** coding
agent (e.g. Claude Code). It has no model and makes no judgement about the code —
it is the wire, not the worker.

```
feedback (HTTP, authenticated)  ->  pipe  ->  runs the entity's agent in the repo
```

## The integration contract (all of it)

Your app makes **one authenticated HTTP POST** with the user's feedback.
That is the entire integration — no SDK, no schema, no callback to handle.

```
POST /feedback
Authorization: Bearer <PIPE_API_KEY>
Content-Type: application/json

{ "message": "The checkout button does nothing on mobile" }   <- only required field
```

Response: `202 { "taskId": "...", "status": "forwarded" }`. Put this call
wherever your app already handles a submitted feedback message — your form
handler, your `/feedback` route, your support endpoint. Copy-paste snippets for
JavaScript, Node, Python, Ruby, PHP, Go, Java, and curl are in
[docs/integration.md](docs/integration.md).

## What it is and is not

- **Is:** an HTTP endpoint on the machine where the agent runs. It receives
  feedback, writes the user's words verbatim into a prompt file, and runs the
  entity's agent in their repository — one agent at a time, because two agents
  editing the same checkout would corrupt each other's work.
- **Is not:** an AI. It contains no model, no priority guessing, no rewriting of
  the feedback. The agent decides everything.
- **One direction:** the pipe never reports back to the sender. It answers
  `202` when the task is queued, and what the agent does next (edit code, open
  a PR, etc.) is entirely the agent's concern.

## Two keys (two trust boundaries)

1. **Inbound key (`PIPE_API_KEY`)** — proves the caller may submit feedback to
   this pipe. You generate one per entity and put it in their config. Because
   feedback is handed verbatim to an agent that edits the repository, this key
   is effectively **write access to the codebase** — treat it like a deploy key.
2. **Model key** — the agent's own provider key (e.g. `ANTHROPIC_API_KEY`). It
   lives only in the agent's environment. The pipe never sees it.

## Download and run

Requires Node 20+ and your coding agent (Claude Code by default) on the same
machine.

```bash
git clone https://github.com/Jakobyht/feedback-pipe.git
cd feedback-pipe
npm install
cp .env.example .env      # set PIPE_API_KEY and PIPE_REPO
npm run pipe
```

`npm run pipe` loads `.env` automatically. The agent defaults to Claude Code, so
you usually only need to set `PIPE_API_KEY` and `PIPE_REPO`. (You can still pass
any of these inline as environment variables instead of using `.env`.)

Submit feedback:

```bash
curl -sS http://localhost:8181/feedback \
  -H 'authorization: Bearer <your PIPE_API_KEY>' \
  -H 'content-type: application/json' \
  -d '{"message":"The checkout button does nothing on mobile","pageUrl":"/cart"}'
```

## Environment variables

| Variable | Required | Meaning |
|---|---|---|
| `PIPE_API_KEY` | yes | Inbound key callers must send (any long random string) |
| `PIPE_REPO` | yes | Absolute path to the repository the agent works on |
| `PIPE_AGENT_COMMAND` | no | The agent to run (defaults to Claude Code headless). Gets `APE_TASK_PROMPT_FILE`, `APE_TASK_FILE`, `APE_TASK_ID`, `APE_REPO_PATH` |
| `PIPE_PORT` | no | Listen port (default 8181) |
| `PIPE_HOST` | no | Bind address (default `127.0.0.1`; `0.0.0.0` accepts remote calls) |
| `PIPE_WORKSPACE` | no | Label attached to tasks (default `default`) |

Task files are written to `<repo>/.ape/tasks/<id>/`; the pipe drops a
`.ape/.gitignore` so they never enter git history.

## Production: review-before-merge + HTTPS

For local use the default agent edits the working tree directly. In production
the feedback is **untrusted end-user input**, so the agent must produce
*reviewable* output instead of touching the default branch. Point the pipe at
the included review agent:

```bash
PIPE_AGENT_COMMAND=/absolute/path/to/examples/agents/review-agent.sh
```

It runs each task on its own branch and opens a **draft pull request** a human
approves — the default branch is never changed automatically
([examples/agents/review-agent.sh](examples/agents/review-agent.sh), tested by
`examples/agents/review-agent.test.js`).

**Agent auth is OAuth, not a key in the pipe.** The agent inherits the pipe's
environment, so run `claude login` (OAuth / subscription) once on the host and
the pipe holds no model credential of its own — only its inbound `PIPE_API_KEY`.

The pipe is a long-running process (not serverless), reached over HTTPS via a
reverse proxy or tunnel. Turnkey configs — Caddy (auto-TLS), a Cloudflare
Tunnel, and a systemd unit — plus a full checklist are in
[deploy/README.md](deploy/README.md).

## Design

The reasoning behind the shape of the system — why one program is enough, what
premise that rests on, and the one invariant the pipe enforces (one working
tree, one writer) — is in [docs/architecture.md](docs/architecture.md).

## Packages

- `packages/pipe`: the local HTTP pipe.
- `packages/shared`: feedback → task packet and the agent prompt builder.

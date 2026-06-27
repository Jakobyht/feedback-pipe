# Feedback Pipe

A single local program that forwards user feedback to an entity's **own** coding
agent (e.g. Claude Code). It has no model and makes no judgement about the code —
it is the wire, not the worker.

```
feedback (HTTP, authenticated)  ->  pipe  ->  spawns the entity's agent in the repo
```

## What it is and is not

- **Is:** an HTTP endpoint on the machine where the agent runs. It receives
  feedback, writes the user's words verbatim into a prompt file, and starts the
  entity's agent in their repository.
- **Is not:** an AI. It contains no model, no priority guessing, no rewriting of
  the feedback. The agent decides everything.

## Two keys (two trust boundaries)

1. **Inbound key (`PIPE_API_KEY`)** — proves the caller may submit feedback to
   this pipe. You generate one per entity and put it in their config.
2. **Model key** — the agent's own provider key (e.g. `OPENAI_API_KEY`). It lives
   only in the agent's environment. The pipe never sees it.

## Run it

```bash
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

The pipe responds `202 { taskId, status: "forwarded" }` the moment it launches
the agent, and then it is done. It is a one-way pipe: it does not wait for the
agent, track it, or report the result back. What the agent does next (edit code,
open a PR, etc.) is entirely the agent's concern.

## Environment variables

| Variable | Required | Meaning |
|---|---|---|
| `PIPE_API_KEY` | yes | Inbound key this entity authenticates with |
| `PIPE_REPO` | yes | Repository the agent works on |
| `PIPE_AGENT_COMMAND` | yes | The entity's agent (e.g. Claude Code). Gets `APE_TASK_PROMPT_FILE`, `APE_TASK_FILE`, `APE_TASK_ID`, `APE_REPO_PATH` |
| `PIPE_PORT` | no | Listen port (default 8181) |
| `PIPE_WORKSPACE` | no | Label attached to tasks (default "default") |

## Packages

- `packages/pipe`: the local HTTP pipe.
- `packages/shared`: feedback → task packet and the agent prompt builder.

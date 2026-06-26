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
   spawns PIPE_AGENT_COMMAND in the repo (the entity's own agent)
        |
        v
   agent edits the code; pipe records status
```

## Why one program is enough

The only universal way to drive a program you do not own (the agent) is the OS
process boundary: start it as a subprocess and pass it text. That call must
happen locally, on the agent's machine. Since the feedback can be POSTed
directly to that same machine, no relay, no WebSocket, and no central brain are
required.

## Trust boundaries

- **Inbound:** `PIPE_API_KEY` authenticates feedback submission.
- **Agent → model provider:** the agent's own key, read locally. The pipe never
  handles it.

The pipe forwards the user's words verbatim. It does not assign priority, invent
acceptance criteria, or rewrite the feedback. The agent makes every decision
about the code.

## One direction only

The pipe is fire-and-forget. It hands the feedback to the agent and is done — it
does not wait for the agent, track whether it succeeded, or report anything back.
The feedback sender does not care about the result, so there is no return path.
`POST /feedback` responds `202 { taskId, status: "forwarded" }` the moment the
agent has been launched.

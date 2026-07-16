# Deploying the Feedback Pipe for production

The pipe runs on a **persistent machine that has your repo checkout, your coding
agent, and push access to GitHub** — a small VM, a Mac mini, or any always-on
host. It is a long-running process, so it cannot live in a serverless function
(Vercel/Lambda). Your app's backend reaches it over HTTPS.

Two things production needs beyond `npm run pipe`:

1. **Reachable over HTTPS** — so your app (often on another host) can call it,
   with the key and feedback encrypted in transit.
2. **The agent in review-before-merge mode** — because feedback is untrusted
   end-user input handed to a code-editing agent. See
   [`../examples/agents/review-agent.sh`](../examples/agents/review-agent.sh):
   every task lands on its own branch as a pull request a human approves, and
   the default branch is never touched automatically. Point the pipe at it:

   ```bash
   PIPE_AGENT_COMMAND=/opt/feedback-pipe/examples/agents/review-agent.sh
   ```

## Agent auth: OAuth, no API key in the pipe

The agent inherits the pipe process's environment, so authenticate it **once**
on the host and the pipe carries nothing sensitive of its own:

```bash
# As the user the pipe runs as:
claude login        # OAuth / Claude subscription — no ANTHROPIC_API_KEY needed
```

(Prefer key auth? Set `ANTHROPIC_API_KEY` in the host environment instead.)
Either way, the model credential lives with the agent, never in the pipe's
config — the pipe only holds `PIPE_API_KEY` (its inbound key) and `PIPE_REPO`.

## Keep it running (systemd)

[`feedback-pipe.service`](./feedback-pipe.service) restarts the pipe on crash
and boot, binds it to loopback, and wires in the review agent:

```bash
sudo cp deploy/feedback-pipe.service /etc/systemd/system/
printf 'PIPE_API_KEY=%s\nPIPE_REPO=%s\n' "$(openssl rand -hex 32)" /opt/your-repo \
  | sudo tee /etc/feedback-pipe.env >/dev/null
sudo chmod 600 /etc/feedback-pipe.env
sudo systemctl daemon-reload && sudo systemctl enable --now feedback-pipe
```

## Expose it over HTTPS — pick one

### A. Your own domain (Caddy, automatic TLS)

You have a domain and can point an A/AAAA record at the host. [`Caddyfile`](./Caddyfile)
gets and renews a real certificate automatically:

```bash
# edit the domain in deploy/Caddyfile first
caddy run --config deploy/Caddyfile
```

Then set the tutor's `PIPE_URL=https://pipe.example.com`.

### B. No domain (Cloudflare Tunnel)

No DNS or open ports required — the tunnel dials out and gives you an HTTPS URL:

```bash
cloudflared tunnel --url http://127.0.0.1:8181
# prints https://<random>.trycloudflare.com  → use that as PIPE_URL
```

(For a stable hostname, create a named tunnel; the quick tunnel above is ideal
for a first end-to-end test.)

## Verify the whole path

```bash
curl -s https://pipe.example.com/health        # {"ok":true,...}
curl -sS https://pipe.example.com/feedback \
  -H "authorization: Bearer $PIPE_API_KEY" -H 'content-type: application/json' \
  -d '{"message":"end-to-end test from production"}'
# → 202 {taskId, "forwarded"}; then a feedback/<taskId> PR appears for review.
```

## Checklist

- [ ] Pipe running under systemd, bound to `127.0.0.1`.
- [ ] `PIPE_AGENT_COMMAND` points at `review-agent.sh` (review-before-merge).
- [ ] Agent authenticated on the host (`claude login`), no key in the pipe.
- [ ] HTTPS in front (Caddy domain **or** Cloudflare Tunnel).
- [ ] Tutor's `PIPE_URL` set to the HTTPS address; `/health` returns `ok`.
- [ ] A test feedback produces a draft PR, and `main` is untouched.

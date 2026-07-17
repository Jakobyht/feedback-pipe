# Integration Guide

How to install the pipe, run it, and send feedback to it from your own app.

The pipe is one-directional: your app sends a feedback message; the pipe hands
it to your coding agent and is done. There is no result to wait for. Tasks are
queued and the agent runs on them one at a time, because two agents editing the
same checkout would corrupt each other's work.

---

## 1. Install

Requires **Node.js 20+** and your coding agent installed on the same machine
(default is **Claude Code**, i.e. the `claude` command).

```bash
git clone https://github.com/Jakobyht/feedback-pipe.git
cd feedback-pipe
npm install
```

## 2. Configure

Copy the template and edit it. `.env` is per-machine and is never committed.

```bash
cp .env.example .env
```

| Variable | Required | Meaning |
|---|---|---|
| `PIPE_API_KEY` | yes | The secret callers must send. Any string; use a long random one. |
| `PIPE_REPO` | yes | Absolute path to the repository the agent works on. |
| `PIPE_AGENT_COMMAND` | no | The agent to run. Defaults to Claude Code headless. |
| `PIPE_PORT` | no | Listen port (default `8181`). |
| `PIPE_HOST` | no | Bind address (default `127.0.0.1`; use `0.0.0.0` to accept remote calls). |
| `PIPE_WORKSPACE` | no | A label attached to forwarded tasks (default `default`). |

You can also set these inline instead of using `.env`:

```bash
PIPE_API_KEY=secret PIPE_REPO=/path/to/repo npm run pipe
```

## 3. Run

```bash
npm run pipe
```

It prints `Feedback pipe listening on http://127.0.0.1:8181`. That is the only
command needed to keep it running. To check it is alive:

```bash
curl -s http://localhost:8181/health
```

---

## 4. The API

One endpoint. Send a `POST` with your key and a JSON body.

- **URL:** `POST http://<host>:8181/feedback`
- **Header:** `Authorization: Bearer <PIPE_API_KEY>`
- **Body:** JSON. Only `message` is required.

```json
{
  "message": "The checkout button does nothing on mobile",
  "pageUrl": "/cart",
  "repoHint": "frontend",
  "metadata": { "userId": "123" }
}
```

- **Response:** `202 { "taskId": "...", "status": "forwarded" }`
- `401` if the key is wrong, `400` for invalid JSON, `422` if `message` is
  missing, `413` if the body exceeds 256 KB.

---

## 5. Send feedback from your code

**Where does this go?** Into the function your app *already* has for handling a
submitted feedback message — your form handler, your `/feedback` route, your
support endpoint. Right where you currently save or log that message, add one
HTTP call to the pipe. That single request is the whole integration.

> **Security:** prefer calling the pipe from your **backend**, so `PIPE_API_KEY`
> stays on the server. If you call it from a browser, the key is visible to users
> — in that case put your own server in front of the pipe.

### Shell / curl (for testing only)

Run this in a terminal to confirm the pipe works before touching your app. You do
**not** put `curl` in your code — use the language snippet below for that.

```bash
curl -sS http://localhost:8181/feedback \
  -H "authorization: Bearer $PIPE_API_KEY" \
  -H 'content-type: application/json' \
  -d '{"message":"The checkout button does nothing on mobile","pageUrl":"/cart"}'
```

### JavaScript (browser)

```js
// NOTE: exposes the key to users. Prefer routing through your own backend.
async function sendFeedback(message) {
  await fetch("https://pipe.example.com/feedback", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer YOUR_PIPE_API_KEY"
    },
    body: JSON.stringify({ message, pageUrl: location.pathname })
  });
}
```

### Node.js (backend)

```js
// Node 18+ has fetch built in.
export async function sendFeedback(message, pageUrl) {
  const res = await fetch("http://localhost:8181/feedback", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.PIPE_API_KEY}`
    },
    body: JSON.stringify({ message, pageUrl })
  });
  if (!res.ok) throw new Error(`pipe returned ${res.status}`);
}
```

### Python

```python
import os
import requests

def send_feedback(message, page_url=None):
    requests.post(
        "http://localhost:8181/feedback",
        headers={"Authorization": f"Bearer {os.environ['PIPE_API_KEY']}"},
        json={"message": message, "pageUrl": page_url},
        timeout=5,
    ).raise_for_status()
```

### Ruby

```ruby
require "net/http"
require "json"

def send_feedback(message, page_url = nil)
  uri = URI("http://localhost:8181/feedback")
  req = Net::HTTP::Post.new(
    uri,
    "Content-Type" => "application/json",
    "Authorization" => "Bearer #{ENV['PIPE_API_KEY']}"
  )
  req.body = { message: message, pageUrl: page_url }.to_json
  Net::HTTP.start(uri.host, uri.port) { |http| http.request(req) }
end
```

### PHP

```php
<?php
function send_feedback(string $message, ?string $pageUrl = null): void {
    $ch = curl_init("http://localhost:8181/feedback");
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => [
            "Content-Type: application/json",
            "Authorization: Bearer " . getenv("PIPE_API_KEY"),
        ],
        CURLOPT_POSTFIELDS => json_encode(["message" => $message, "pageUrl" => $pageUrl]),
        CURLOPT_RETURNTRANSFER => true,
    ]);
    curl_exec($ch);
    curl_close($ch);
}
```

### Go

```go
package feedback

import (
	"bytes"
	"encoding/json"
	"net/http"
	"os"
)

func Send(message, pageURL string) error {
	body, _ := json.Marshal(map[string]string{"message": message, "pageUrl": pageURL})
	req, err := http.NewRequest("POST", "http://localhost:8181/feedback", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+os.Getenv("PIPE_API_KEY"))
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	return resp.Body.Close()
}
```

### Java (11+)

```java
import java.net.URI;
import java.net.http.*;

public class Feedback {
    static final HttpClient CLIENT = HttpClient.newHttpClient();

    public static void send(String message, String pageUrl) throws Exception {
        String json = "{\"message\":" + quote(message) + ",\"pageUrl\":" + quote(pageUrl) + "}";
        HttpRequest req = HttpRequest.newBuilder()
            .uri(URI.create("http://localhost:8181/feedback"))
            .header("Content-Type", "application/json")
            .header("Authorization", "Bearer " + System.getenv("PIPE_API_KEY"))
            .POST(HttpRequest.BodyPublishers.ofString(json))
            .build();
        CLIENT.send(req, HttpResponse.BodyHandlers.ofString());
    }

    private static String quote(String s) {
        return s == null ? "null" : "\"" + s.replace("\"", "\\\"") + "\"";
    }
}
```

---

## 6. Going remote (calling the pipe from another machine)

By default the pipe binds to `127.0.0.1`, reachable only from the same machine.
To accept calls from your app elsewhere:

1. Set `PIPE_HOST=0.0.0.0`.
2. Put it behind HTTPS (a reverse proxy such as Caddy or nginx), because the key
   and feedback travel in cleartext over plain HTTP.
3. Point your app's URL at the proxy (e.g. `https://pipe.example.com/feedback`).

The `PIPE_API_KEY` is the only thing guarding the endpoint, so keep it secret and
make it long and random. Remember what it grants: feedback goes verbatim to an
agent that can edit the repository, so whoever holds the key effectively has
write access to the codebase. Treat it like a deploy key, and review what the
agent produces (e.g. via pull requests) rather than trusting the input.

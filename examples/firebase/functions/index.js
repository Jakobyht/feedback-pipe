// Firebase Cloud Function: a new `feedback` document → a GitHub issue labeled
// `agent-ready`. This is the Firebase equivalent of a Supabase Edge Function —
// use it when your app already runs on Firebase (like the AI language tutor).
//
// The `agent-ready` label is the trigger for the feedback-agent workflow
// (.github/workflows/feedback-agent.yml) in your target repo: it wakes Claude,
// which triages the issue and — only for a verified bug — opens a PR.
//
// Secrets/config (set with `firebase functions:secrets:set` / params):
//   GITHUB_FEEDBACK_TOKEN  a fine-grained PAT with Issues: read & write on the repo
//   GITHUB_OWNER           the repo owner/org
//   GITHUB_REPO            the repo name
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { defineSecret, defineString } from "firebase-functions/params";
import { setGlobalOptions } from "firebase-functions/v2";

const githubToken = defineSecret("GITHUB_FEEDBACK_TOKEN");
const owner = defineString("GITHUB_OWNER");
const repo = defineString("GITHUB_REPO");

setGlobalOptions({ region: "us-central1", maxInstances: 5 });

export const createGithubIssue = onDocumentCreated(
  { document: "feedback/{id}", secrets: [githubToken] },
  async (event) => {
    const doc = event.data;
    const data = doc?.data();
    // Only act once, and only on real content.
    const message = typeof data?.message === "string" ? data.message.trim() : "";
    if (!message || data?.status === "forwarded") return;

    const title = (message.split("\n")[0] || "User feedback").slice(0, 80);
    const body = [
      "User feedback submitted through the app.",
      "",
      message.slice(0, 20000),
      "",
      typeof data.pageUrl === "string" && data.pageUrl ? `Page: ${data.pageUrl}` : null,
      typeof data.userEmail === "string" && data.userEmail ? `Reporter: ${data.userEmail}` : null
    ]
      .filter((line) => line !== null)
      .join("\n");

    const response = await fetch(`https://api.github.com/repos/${owner.value()}/${repo.value()}/issues`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${githubToken.value()}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json",
        "user-agent": "feedback-pipe-firebase"
      },
      // `user-feedback` for humans to filter on; `agent-ready` is the workflow trigger.
      body: JSON.stringify({ title, body, labels: ["user-feedback", "agent-ready"] })
    });

    if (!response.ok) {
      // Throwing schedules a retry (the trigger is at-least-once). Do NOT write
      // status:"forwarded" so the retry can succeed.
      throw new Error(`GitHub issue creation failed: ${response.status} ${await response.text()}`);
    }

    const issue = await response.json();
    // Idempotency + a link back: mark the doc so a retry/duplicate is a no-op.
    await doc.ref.set({ githubIssueUrl: issue.html_url, status: "forwarded" }, { merge: true });
  }
);

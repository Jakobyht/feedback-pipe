# Firebase → GitHub (feedback intake)

The Firebase equivalent of the Supabase intake: an app writes a `feedback`
document, and a Cloud Function turns it into a GitHub issue labeled
`agent-ready` — which triggers the [feedback-agent workflow](../../.github/workflows/feedback-agent.yml).

Use this when your app already runs on Firebase (e.g. the AI language tutor).

```
app → Firestore `feedback/{id}` → Cloud Function → GitHub issue [agent-ready]
    → GitHub Action → Claude (OAuth) → deterministic gate → PR (verified bugs only)
```

## 1. The feedback collection

Your app writes one document per submission. Only `message` is required:

```js
// client (already signed in with Firebase Auth)
import { getFirestore, collection, addDoc, serverTimestamp } from "firebase/firestore";
await addDoc(collection(getFirestore(), "feedback"), {
  message,                               // required
  pageUrl: location.pathname,            // optional
  userEmail: auth.currentUser?.email ?? null, // optional
  createdAt: serverTimestamp()
});
```

## 2. Firestore rules — write-only for users

Users may submit feedback but never read the collection back (it becomes GitHub
issues, which are handled server-side):

```
match /feedback/{id} {
  allow create: if request.auth != null
                && request.resource.data.message is string
                && request.resource.data.message.size() > 0
                && request.resource.data.message.size() < 20000;
  allow read, update, delete: if false;   // only the Admin SDK (the function) touches it
}
```

## 3. Deploy the function

```bash
cd examples/firebase/functions
npm install

# A fine-grained PAT with Issues: read & write on the target repo:
firebase functions:secrets:set GITHUB_FEEDBACK_TOKEN
# Owner/repo the issues are created in:
firebase functions:config:set   # (or set GITHUB_OWNER / GITHUB_REPO params on deploy)

firebase deploy --only functions:createGithubIssue
```

The GitHub token lives only in Firebase secrets — never in your app or browser.
The browser only ever writes a Firestore document.

## 4. Then: the agent side

Copy `agent/` and `.github/workflows/feedback-agent.yml` into the **target repo**
and add the `CLAUDE_CODE_OAUTH_TOKEN` secret (`claude setup-token`). See the
[GitHub-native flow doc](../../docs/github-native.md) for the full wire-up and
the deterministic guarantees.

## Test the whole path

Insert one feedback doc (Firebase console or the app). Expected: a GitHub issue
labeled `agent-ready` appears, the workflow runs, the issue gets a `triage/*`
label and a triage comment, and — only if it's a verified bug — a draft PR.

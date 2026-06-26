// The pipe does not judge feedback. It forwards the user's words verbatim,
// with whatever context arrived, to the user's own agent. No priority,
// no invented acceptance criteria, no rewriting.
export function createTaskFromFeedback({ workspaceId, message, pageUrl, repoHint, metadata = {} }) {
  return {
    id: `task_${cryptoRandomId()}`,
    workspaceId: requireNonEmptyString(workspaceId, "workspaceId"),
    message: requireNonEmptyString(message, "message"),
    pageUrl: typeof pageUrl === "string" && pageUrl.trim() ? pageUrl.trim() : null,
    repoHint: typeof repoHint === "string" && repoHint.trim() ? repoHint.trim() : null,
    metadata,
    createdAt: new Date().toISOString()
  };
}

export function validateTask(task) {
  const errors = [];

  if (!task || typeof task !== "object") errors.push("task must be an object");
  if (!task?.id || typeof task.id !== "string") errors.push("task.id is required");
  if (!task?.workspaceId || typeof task.workspaceId !== "string") errors.push("task.workspaceId is required");
  if (!task?.message || typeof task.message !== "string") errors.push("task.message is required");

  return {
    ok: errors.length === 0,
    errors
  };
}

// The agent receives the raw feedback plus whatever context arrived.
// The pipe adds no interpretation — the agent decides everything.
export function buildAgentPrompt(task) {
  const lines = [
    "User feedback about this repository:",
    "",
    task.message,
    "",
    task.pageUrl ? `Page: ${task.pageUrl}` : null,
    task.repoHint ? `Repo hint: ${task.repoHint}` : null
  ];

  return lines.filter((line) => line !== null).join("\n");
}

export function createEnvelope(type, payload) {
  return {
    type,
    payload,
    sentAt: new Date().toISOString()
  };
}

export function safeJsonParse(input) {
  try {
    return { ok: true, value: JSON.parse(input) };
  } catch (error) {
    return { ok: false, error };
  }
}

function requireNonEmptyString(value, fieldName) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }

  return value.trim();
}

function cryptoRandomId() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

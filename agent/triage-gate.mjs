// The deterministic gate around an AI triage of user feedback.
//
// The agent (Claude, via the GitHub Action) READS an `agent-ready` issue and
// judges it: what kind of feedback is this, and — if it claims a bug — is the
// bug real? Those are judgements a model makes. But WHAT THE AGENT IS ALLOWED
// TO DO with that judgement is policy, and policy is decided here, in code, not
// by the model. Same rule as the tutor's core: the AI judges booleans; a
// deterministic checker decides what happens.
//
// The one guarantee this enforces: a CODE CHANGE (a PR) is permitted ONLY for a
// bug the agent marked `verified`, with real reproduction steps and a known
// affected area. Everything else — questions, information, feature ideas,
// unverified or vague reports — is reply-only. The model cannot talk its way
// into editing the repo; it must fill in every required field, and the fields
// must be internally consistent, or the gate rejects the triage outright.

export const CATEGORIES = ["bug", "question", "information", "feature", "needs-info", "invalid"];
export const ACTIONS = ["code-change", "reply-only", "needs-info"];
export const CONFIDENCE = ["verified", "unverified", "n/a"];

const isNonEmpty = (v) => typeof v === "string" && v.trim().length > 0;
const isPlaceholder = (v) => {
  const t = String(v).trim().toLowerCase();
  return t === "" || t === "n/a" || t === "na" || t === "none" || t === "unknown" || t === "tbd";
};

/**
 * Evaluate a triage object. Returns { valid, errors, allowCodeChange }.
 *  - valid: the triage is well-formed and internally consistent.
 *  - allowCodeChange: valid AND it is a verified bug with a code-change action,
 *    reproduction, and an affected area. This is the ONLY path to a PR.
 * Pure and deterministic: same input → same verdict, no I/O, no model.
 */
export function evaluateTriage(triage) {
  const errors = [];

  if (!triage || typeof triage !== "object") {
    return { valid: false, errors: ["triage must be an object"], allowCodeChange: false };
  }

  const { category, action, confidence, summary, reproduction, affectedArea } = triage;

  // --- required, well-typed fields (the "must fill in all these things" rule) ---
  if (!CATEGORIES.includes(category)) errors.push(`category must be one of: ${CATEGORIES.join(", ")}`);
  if (!ACTIONS.includes(action)) errors.push(`action must be one of: ${ACTIONS.join(", ")}`);
  if (!isNonEmpty(summary)) errors.push("summary is required");
  if (typeof reproduction !== "string") errors.push("reproduction is required (use \"n/a\" if not applicable)");
  if (typeof affectedArea !== "string") errors.push("affectedArea is required (use \"unknown\" if not known)");

  // confidence is required for a bug; for other categories it may be "n/a".
  if (category === "bug") {
    if (!["verified", "unverified"].includes(confidence)) {
      errors.push('for a bug, confidence must be "verified" or "unverified"');
    }
  } else if (confidence !== undefined && !CONFIDENCE.includes(confidence)) {
    errors.push(`confidence, if set, must be one of: ${CONFIDENCE.join(", ")}`);
  }

  // --- consistency: the model may not pair an action with the wrong category ---
  // A code change is ONLY ever valid for a verified bug. This is the core gate.
  if (action === "code-change") {
    if (category !== "bug") errors.push('action "code-change" is only allowed for category "bug"');
    if (confidence !== "verified") errors.push('action "code-change" requires confidence "verified"');
    if (isPlaceholder(reproduction)) errors.push('a code change requires real reproduction steps, not a placeholder');
    if (isPlaceholder(affectedArea)) errors.push('a code change requires a concrete affected area, not "unknown"');
  }

  // needs-info the category and needs-info the action must agree.
  if (category === "needs-info" && action !== "needs-info") {
    errors.push('category "needs-info" requires action "needs-info"');
  }
  if (action === "needs-info" && !["needs-info", "bug", "question", "feature"].includes(category)) {
    errors.push(`action "needs-info" is not valid for category "${category}"`);
  }

  const valid = errors.length === 0;
  const allowCodeChange =
    valid &&
    category === "bug" &&
    confidence === "verified" &&
    action === "code-change" &&
    !isPlaceholder(reproduction) &&
    !isPlaceholder(affectedArea);

  return { valid, errors, allowCodeChange };
}

/**
 * Pull the triage object out of agent output. The agent is asked to emit a
 * single fenced ```json block; this extracts and parses it. Returns
 * { ok, triage } or { ok:false, error } — never throws.
 */
export function parseTriageBlock(text) {
  if (typeof text !== "string") return { ok: false, error: "no text to parse" };
  const fence = text.match(/```json\s*([\s\S]*?)```/i);
  const raw = fence ? fence[1] : text;
  try {
    return { ok: true, triage: JSON.parse(raw) };
  } catch (error) {
    return { ok: false, error: `triage is not valid JSON: ${error.message}` };
  }
}

/** The labels the workflow applies from a category, so the taxonomy is one place. */
export function categoryLabel(category) {
  return CATEGORIES.includes(category) ? `triage/${category}` : "triage/invalid";
}

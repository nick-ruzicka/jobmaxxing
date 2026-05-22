// Centralized fit-score and time-window thresholds. Tuning any of these is now
// a one-line edit here instead of a hunt across generate-briefing.mjs and
// sync-score-feedback.mjs.

// --- Briefing candidate selection (fit_score, 0–10 scale) ---
// Discovered roles at/above this surface as "apply" + "verify-location" candidates.
export const BRIEFING_APPLY_THRESHOLD = 6;
// High-fit roles at/above this surface as "you might've missed" candidates.
export const BRIEFING_MISSED_THRESHOLD = 7;
// Mid-band [min, max] roles the agent may re-score after a deeper read.
export const BRIEFING_RECALIBRATE_MIN = 4;
export const BRIEFING_RECALIBRATE_MAX = 6;

// --- Time windows (days) ---
// Non-terminal applications older than this count as "stale".
export const STALE_APPLICATION_DAYS = 3;
// Chat files older than this are pruned on each briefing run.
export const CHAT_PRUNING_DAYS = 30;

// --- Score-feedback reconciliation (eval score, 0–5 scale) ---
// An eval score at/above this conflicts with a reject status (flagged as CONFLICT).
export const FEEDBACK_CONFLICT_THRESHOLD = 4.0;

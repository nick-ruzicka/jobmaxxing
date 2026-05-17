// Client-side helper for emitting career-ops events.
//
// In components / hooks, call:
//   await emitEvent("role.viewed", { role_id });
//
// Network failures are swallowed (we never want a missed event to break the
// UI), but logged so devs notice during local development.

export type EventType =
  | "role.viewed"
  | "role.dismissed"
  | "role.pinned"
  | "role.starred"
  | "role.hidden"
  | "role.applied"
  | "role.archetype_classified"
  | "role.archetype_corrected"
  | "score.viewed"
  | "score.overridden"
  | "score.confirmed"
  | "resume.selected"
  | "resume.tweaked"
  | "context.preference_set"
  | "context.archetype_tuned"
  | "onboarding.step_completed"
  | "onboarding.example_provided"
  | "backtest.rule_proposed"
  | "backtest.rule_accepted"
  | "backtest.rule_rejected";

export interface EventPayload {
  role_id?: string;
  archetype?: string;
  [key: string]: unknown;
}

export interface PersistedEvent {
  id: string;
  timestamp: string;
  type: EventType;
  source: string;
  payload: EventPayload;
  role_id?: string;
  archetype?: string;
}

export async function emitEvent(
  type: EventType,
  payload: EventPayload,
): Promise<PersistedEvent | null> {
  try {
    const res = await fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, payload, source: "dashboard" }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.warn(`[events] emit ${type} failed: ${res.status} ${err}`);
      return null;
    }
    const data = await res.json();
    return data.event ?? null;
  } catch (err) {
    console.warn(`[events] emit ${type} threw:`, err);
    return null;
  }
}

export async function fetchEvents(opts: {
  type?: EventType;
  role_id?: string;
  since?: string;
  until?: string;
  limit?: number;
} = {}): Promise<PersistedEvent[]> {
  const params = new URLSearchParams();
  if (opts.type) params.set("type", opts.type);
  if (opts.role_id) params.set("role_id", opts.role_id);
  if (opts.since) params.set("since", opts.since);
  if (opts.until) params.set("until", opts.until);
  if (opts.limit) params.set("limit", String(opts.limit));
  try {
    const res = await fetch(`/api/events?${params.toString()}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.events ?? [];
  } catch {
    return [];
  }
}

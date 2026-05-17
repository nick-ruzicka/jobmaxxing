// React hooks for career-ops event emission and reading.
//
// Importable from any client component:
//   useRoleView(role_id) — fires role.viewed once per mount
//   useRoleAction() — returns a callback for explicit user actions
//   useRecentEvents(opts) — fetches matching events on mount and on opts change

"use client";

import { useEffect, useState } from "react";

import {
  emitEvent,
  fetchEvents,
  type EventType,
  type EventPayload,
  type PersistedEvent,
} from "../lib/events";

/**
 * Fire role.viewed on mount, once per role_id+source pair.
 */
export function useRoleView(role_id: string | null | undefined): void {
  useEffect(() => {
    if (!role_id) return;
    emitEvent("role.viewed", { role_id });
  }, [role_id]);
}

/**
 * Returns a stable callback for emitting role-action events.
 *
 * const action = useRoleAction();
 * action("role.pinned", role_id);
 */
export function useRoleAction(): (type: EventType, role_id: string, extra?: EventPayload) => Promise<PersistedEvent | null> {
  return (type, role_id, extra = {}) => emitEvent(type, { role_id, ...extra });
}

/**
 * Fetch the most recent N events matching opts on mount.
 */
export function useRecentEvents(
  opts: {
    type?: EventType;
    role_id?: string;
    since?: string;
    until?: string;
    limit?: number;
  } = {},
): { events: PersistedEvent[]; loading: boolean; error: string | null } {
  const [events, setEvents] = useState<PersistedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const stableKey = JSON.stringify(opts);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchEvents(opts)
      .then((evs) => {
        if (!cancelled) setEvents(evs);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stableKey]);

  return { events, loading, error };
}

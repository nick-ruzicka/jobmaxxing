// Events API: POST to persist a new event, GET to query existing ones.
//
// Backed by data/career-ops-events/*.jsonl (gitignored as default, but the
// Task G G5 spec deliberately reserved data/career-ops-events/ as committable
// so the feedback loop survives fresh clones).

import { buildEvent } from "../../../../scripts/lib/career-ops-events.mjs";
import { writeEvent } from "../../../../scripts/lib/event-writer.mjs";
import { readEvents, byType } from "../../../../scripts/lib/event-aggregator.mjs";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { type, payload, source } = body || {};
    if (!type || typeof type !== "string") {
      return Response.json({ error: "type required" }, { status: 400 });
    }
    const event = buildEvent({
      type,
      payload: payload ?? {},
      source: source || "dashboard",
    });
    writeEvent(event);
    return Response.json({ ok: true, event });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const params = url.searchParams;

  if (params.get("aggregate") === "byType") {
    return Response.json({ counts: byType({}) });
  }

  const events = readEvents({
    type: params.get("type") || undefined,
    role_id: params.get("role_id") || undefined,
    since: params.get("since") || undefined,
    until: params.get("until") || undefined,
  });
  const limit = parseInt(params.get("limit") || "500", 10);
  const trimmed = events.slice(-limit);
  return Response.json({ events: trimmed, total: events.length });
}

// POST /api/apply-handoff — create a handoff bundle for the Chrome extension.
// GET  /api/apply-handoff?id=<id> — extension reads back the bundle once.
//
// Per Task G G8: API + popup-display only. The selector-based extension fill
// stays where it is; this just gives the extension the archetype context and
// resume HTML to display so the user knows which resume is in play.

import {
  createHandoff,
  readHandoff,
} from "../../../../scripts/lib/apply-handoff-store.mjs";
import { emitEvent } from "../../../../scripts/lib/event-writer.mjs";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { role_id, archetype, apply_url, resume_html, profile } = body || {};
    if (!apply_url || typeof apply_url !== "string") {
      return Response.json({ error: "apply_url is required" }, { status: 400 });
    }
    const id = createHandoff({
      role_id: role_id ?? null,
      archetype: archetype ?? null,
      apply_url,
      resume_html: resume_html ?? "",
      profile: profile ?? null,
    });
    if (role_id && archetype) {
      try {
        emitEvent({
          type: "resume.selected",
          payload: { role_id, archetype, resume_path: `apply-handoff:${id}` },
          source: "dashboard",
        });
      } catch {
        // event emission shouldn't block the handoff
      }
    }
    return Response.json({ ok: true, handoff_id: id, apply_url });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) {
    return Response.json({ error: "id required" }, { status: 400 });
  }
  // peek=true so the extension can refetch on its own page reloads inside
  // the TTL window. The store self-prunes; no manual cleanup needed.
  const payload = readHandoff(id, { peek: true });
  if (!payload) {
    return Response.json({ error: "handoff not found or expired" }, { status: 404 });
  }
  return Response.json({ handoff: payload });
}

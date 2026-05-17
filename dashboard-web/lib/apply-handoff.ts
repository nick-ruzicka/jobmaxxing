// Client-side helper for creating an Apply handoff and opening the apply URL
// with the handoff id in tow. Any UI component (future Apply button on
// /pipeline) can call this directly.
//
// Usage:
//   await startApplyHandoff({
//     role_id: url,
//     archetype: "gtm-engineering",
//     apply_url: "https://jobs.ashbyhq.com/foo/...",
//     resume_html: "<article>...</article>",
//     profile: {...},
//   });

export interface ApplyHandoffPayload {
  role_id?: string;
  archetype?: string;
  apply_url: string;
  resume_html?: string;
  profile?: Record<string, unknown>;
}

export async function startApplyHandoff(
  payload: ApplyHandoffPayload,
  { newTab = true }: { newTab?: boolean } = {},
): Promise<{ handoff_id: string; apply_url: string } | null> {
  try {
    const res = await fetch("/api/apply-handoff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.warn(`[apply-handoff] POST failed: ${res.status}`);
      return null;
    }
    const data = (await res.json()) as { handoff_id: string; apply_url: string };
    const targetUrl = appendHandoffParam(data.apply_url, data.handoff_id);
    if (typeof window !== "undefined") {
      if (newTab) window.open(targetUrl, "_blank", "noopener,noreferrer");
      else window.location.href = targetUrl;
    }
    return { handoff_id: data.handoff_id, apply_url: targetUrl };
  } catch (err) {
    console.warn("[apply-handoff] threw:", err);
    return null;
  }
}

function appendHandoffParam(url: string, handoffId: string): string {
  try {
    const u = new URL(url);
    u.searchParams.set("career_ops_handoff", handoffId);
    return u.toString();
  } catch {
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}career_ops_handoff=${encodeURIComponent(handoffId)}`;
  }
}

// /api/context/resume?archetype=<id> — serve a parsed resume HTML for viewing
// in /context. Only allows the 5 known archetype IDs (defense-in-depth — these
// HTML files are committed and safe to serve, but we still gate by allowlist).

import { readFileSync, existsSync } from "fs";
import { join } from "path";

const ALLOWED = new Set([
  "gtm-engineering",
  "ai-operations",
  "fde",
  "web3-bd",
  "web3-bizops",
]);

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const archetype = url.searchParams.get("archetype") || "";
  if (!ALLOWED.has(archetype)) {
    return Response.json({ error: "unknown archetype" }, { status: 400 });
  }
  const path = join(
    process.cwd(),
    "..",
    "autoapply",
    "resumes",
    "parsed",
    `${archetype}.html`,
  );
  if (!existsSync(path)) {
    return Response.json({ error: "resume not found" }, { status: 404 });
  }
  const body = readFileSync(path, "utf8");
  // Wrap in a minimal page so it's viewable directly in a browser tab.
  const wrapped = `<!doctype html>
<html><head><meta charset="utf-8"><title>${archetype} resume</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; max-width: 760px; margin: 2rem auto; padding: 0 1rem; color: #1f1f1f; }
  .nav-bar { display: flex; align-items: center; gap: 0.75rem; padding-bottom: 0.5rem; margin-bottom: 1.25rem; border-bottom: 1px solid #ddd; font-size: 0.9em; }
  .nav-bar a { color: #555; text-decoration: none; }
  .nav-bar a:hover { color: #1f1f1f; text-decoration: underline; }
  .nav-bar .sep { color: #ccc; }
  .nav-bar .archetype-label { color: #1f1f1f; font-weight: 600; }
  h1 { margin-top: 0; }
  .resume-header { border-bottom: 1px solid #ddd; padding-bottom: 0.5rem; margin-bottom: 1rem; }
  .contact { list-style: none; padding: 0; display: flex; flex-wrap: wrap; gap: 0.5rem; font-size: 0.85em; color: #555; }
  .contact li { display: inline; }
  .contact li + li::before { content: "•"; margin-right: 0.5em; color: #aaa; }
  .role { margin-bottom: 1.25rem; }
  .role-company { margin-bottom: 0.25rem; }
  .company-descriptor { color: #777; font-weight: 400; font-size: 0.9em; }
  .role-location { float: right; color: #777; font-weight: 400; font-size: 0.9em; }
  .role-title { margin-top: 0; color: #555; font-size: 0.95em; }
  .role-dates { float: right; }
  .bullets { padding-left: 1.25rem; }
  .bullet { margin-bottom: 0.4rem; font-size: 0.92em; }
  .skills-category-label { font-weight: 600; }
  .skill { display: inline; }
  .skill + .skill::before { content: ", "; }
  ul.skills { list-style: none; padding: 0; margin: 0.25rem 0; }
  ul.skills > li { display: inline; }
  ul.skills > li.skills-category-label::after { content: ": "; }
  section.experience h2, section.education h2, section.skills-section h2 { font-size: 1.1em; border-bottom: 1px solid #eee; margin-top: 1.5rem; padding-bottom: 0.25rem; }
</style>
</head><body>
<nav class="nav-bar">
  <a href="/context">&larr; Back to Context</a>
  <span class="sep">·</span>
  <span class="archetype-label">${archetype} resume</span>
</nav>
${body}
</body></html>`;

  return new Response(wrapped, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

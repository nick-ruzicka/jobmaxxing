/**
 * strip-html.mjs — convert raw HTML to plain text for downstream NLP
 *
 * Used by enrich-roles.mjs to turn fetched job-description HTML into the
 * ~5KB plain-text slice we feed Claude. Two-stage strip:
 *
 *   1. Remove <script> and <style> element BODIES first. Inline scripts and
 *      stylesheets are common in Greenhouse/Ashby/BuiltIn pages — leaving
 *      their bodies as text pushes real JD content past the truncation
 *      window and pollutes downstream regex extraction (Fix #5 follow-up).
 *   2. Then strip all remaining tags, decode the small set of HTML entities
 *      job-board pages actually use, and collapse whitespace.
 *
 * Test coverage: scripts/lib/strip-html.test.mjs
 */

export function stripHtml(html) {
  if (html == null) return "";
  return String(html)
    // Drop <script>…</script> and <style>…</style> bodies before tag strip.
    // `\b` after the tag name prevents matching <scripted> etc.; the inner
    // `[\s\S]*?` is non-greedy so adjacent script/style blocks don't merge.
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

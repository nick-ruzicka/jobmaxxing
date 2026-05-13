/**
 * extract-comp.mjs — deterministic compensation extraction from a job-posting page.
 *
 * `extractComp(html, url)` runs a confidence-ordered waterfall over the *raw* HTML:
 *   A. JSON-LD JobPosting `baseSalary`           → comp_source "jsonld_basesalary"
 *   B. comp prose inside the JSON-LD `description`→ comp_source "jsonld_description"
 *   C. comp prose in the rendered page text       → comp_source "jd_prose"
 *   D. BuiltIn fa-sack-dollar strip (estimate)    → comp_source "jd_estimate"  (when no baseSalary)
 *   E. qualitative-only ("competitive salary")    → comp_source "qualitative_only"  (comp_range null)
 *   F. nothing                                    → comp_source "none"
 *
 * Built for Fix #5a (BuiltIn JSON-LD parser — entity-encoded `type="application/ld&#x2B;json"`,
 * `@graph`-nested JobPosting, single-value scalar baseSalary) but the same function covers
 * Greenhouse (Fix 5d — server-rendered prose, no JSON-LD), Ashby (Fix 5c — range in `description`),
 * the Getro/Consider VC boards and revopscareers (Fix 5b/5e — JSON-LD in raw HTML).
 *
 * See audit/comp-extraction-audit-2026-05-13.md.  Pure module, ESM, no deps.
 */

/** @typedef {"jsonld_basesalary"|"jsonld_description"|"jd_prose"|"jd_estimate"|"page_structured"|"claude_extracted"|"qualitative_only"|"none"} CompSource */

// ---------------------------------------------------------------------------
// Tiny HTML helpers
// ---------------------------------------------------------------------------

/** Decode the handful of HTML entities that show up inside script-tag attributes
 *  (BuiltIn writes `type="application/ld&#x2B;json"`). */
export function decodeEntities(s) {
  return String(s)
    .replace(/&#x2[bB];/g, "+")
    .replace(/&#43;/g, "+")
    .replace(/&#x2[fF];/g, "/")
    .replace(/&#47;/g, "/")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/** Strip tags + script/style bodies, collapse whitespace. */
export function stripTags(html) {
  return decodeEntities(
    String(html)
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

export function hostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// JSON-LD parsing
// ---------------------------------------------------------------------------

/** Pull every parseable `<script type="application/ld+json">` body out of `html`,
 *  tolerating the entity-encoded type attr and a trailing `;`. */
export function jsonLdBlocks(html) {
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(String(html)))) {
    const attrs = decodeEntities(m[1]).toLowerCase();
    const body = m[2].trim();
    const looksLdJson =
      attrs.includes("application/ld+json") || attrs.includes("application/json+ld");
    if (!looksLdJson && !/"@type"\s*:\s*"JobPosting"/.test(body)) continue;
    let parsed = null;
    try {
      parsed = JSON.parse(body);
    } catch {
      try {
        parsed = JSON.parse(body.replace(/;\s*$/, ""));
      } catch {
        parsed = null;
      }
    }
    if (parsed != null) out.push(parsed);
  }
  return out;
}

/** Walk an arbitrary JSON-LD value (objects, arrays, `@graph`) and collect every JobPosting node. */
export function findJobPostings(data) {
  const out = [];
  const stack = [data];
  const seen = new Set();
  while (stack.length) {
    const o = stack.pop();
    if (Array.isArray(o)) {
      for (const v of o) stack.push(v);
      continue;
    }
    if (!o || typeof o !== "object") continue;
    if (seen.has(o)) continue;
    seen.add(o);
    if (Array.isArray(o["@graph"])) for (const v of o["@graph"]) stack.push(v);
    for (const v of Object.values(o)) if (v && typeof v === "object") stack.push(v);
    const t = o["@type"];
    if (t === "JobPosting" || (Array.isArray(t) && t.includes("JobPosting"))) out.push(o);
  }
  return out;
}

const CURRENCY_SYMBOL = { USD: "$", CAD: "C$", AUD: "A$", GBP: "£", EUR: "€" };
function money(n, currency) {
  const sym = CURRENCY_SYMBOL[currency] || (currency ? `${currency} ` : "$");
  return `${sym}${Math.round(Number(n)).toLocaleString("en-US")}`;
}
function period(unit) {
  switch (String(unit || "").toUpperCase()) {
    case "YEAR": return "/yr";
    case "MONTH": return "/mo";
    case "WEEK": return "/wk";
    case "DAY": return "/day";
    case "HOUR": return "/hr";
    default: return "";
  }
}
function isPos(x) {
  if (x == null) return false;
  const n = Number(x);
  return Number.isFinite(n) && n > 0;
}

/** Normalise a schema.org `baseSalary` (MonetaryAmount) to a display string, or null
 *  when there's no usable number (all-null / PERIOD_NOT_DEFINED). */
export function formatBaseSalary(bs) {
  if (!bs || typeof bs !== "object") return null;
  const currency = bs.currency || (bs.value && bs.value.currency) || "USD";
  const v = bs.value;
  if (v && typeof v === "object") {
    const { minValue, maxValue, value } = v;
    const per = period(v.unitText || bs.unitText);
    const suffix = per ? ` ${per}` : "";
    if (isPos(minValue) && isPos(maxValue) && Number(minValue) !== Number(maxValue)) {
      return `${money(minValue, currency)} – ${money(maxValue, currency)}${suffix}`;
    }
    const single = isPos(value) ? value : isPos(minValue) ? minValue : isPos(maxValue) ? maxValue : null;
    if (single != null) return `${money(single, currency)}${suffix}`;
    return null;
  }
  if (isPos(v)) return `${money(v, currency)}${period(bs.unitText) ? ` ${period(bs.unitText)}` : ""}`;
  return null;
}

// ---------------------------------------------------------------------------
// Prose / page-structured comp extraction
// ---------------------------------------------------------------------------

const COMP_CONTEXT_RE =
  /(compensation|salary\s*range|pay\s*(?:transparency\s*)?(?:range|:)|base\s*(?:salary|pay)|annual\s*salary|expected\s*pay|target\s*compensation|salary\s*:|on[-\s]?target\s*earnings|\bOTE\b|cash\s*compensation|estimated\s*base\s*salary|tier\s*\d\s*pay\s*range|pay\s*band|salary\s*band|hourly\s*rate)/i;

// $ amount or range, with optional K/M and /yr|/hr suffix. Currency-prefix variants too (C$, A$, £, €).
const MONEY_RE =
  /(?:US\$|USD|C\$|A\$|CAD|AUD|£|€|\$)\s?\d{1,3}(?:[,.]\d{3})*(?:\.\d+)?(?:\s?[KkMm])?(?:\s?(?:-|–|—|to)\s?(?:\$|US\$|C\$|A\$|£|€)?\s?\d{1,3}(?:[,.]\d{3})*(?:\.\d+)?(?:\s?[KkMm])?)?(?:\s?\/\s?(?:year|annum|yr|month|mo|week|wk|hour|hr))?/g;
// "$120K - $150K" / "$120,000 — $150,000" / "$3,000–$5,000/month" — also bare "120K-150K" near a comp keyword.
const BARE_KRANGE_RE = /\b\d{2,3}\s?[KkMm]\s?(?:-|–|—|to)\s?\$?\s?\d{2,3}\s?[KkMm]\b/g;

function looksLikeSalary(s) {
  // require a salary-ish magnitude: a K/M-suffixed number, a 5–6 digit number, or "n,nnn" (>= 1,000)
  return /\d{2,3}\s?[KkMm]\b/.test(s) || /\d{2,3}[,.]\d{3}/.test(s) || /\b[1-9]\d?,\d{3}\b/.test(s);
}

/** First $-amount/range that sits within ~90 chars of a compensation keyword. */
export function compInProse(text) {
  if (!text) return null;
  const candidates = [];
  for (const re of [MONEY_RE, BARE_KRANGE_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      const s = m[0].trim().replace(/\s+/g, " ");
      if (!looksLikeSalary(s)) continue;
      const ctx = text.slice(Math.max(0, m.index - 90), m.index + s.length + 90);
      if (COMP_CONTEXT_RE.test(ctx)) candidates.push({ s, idx: m.index });
    }
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.idx - b.idx);
  return candidates[0].s;
}

const QUALITATIVE_RE =
  /(competitive\s+(?:salary|compensation|pay|total\s+rewards|cash\s+compensation)|industry[-\s]?standard\s+salar|market[-\s]?based\s+pay|market[-\s]?competitive\s+(?:salary|compensation)|top\s+of\s+market|highly\s+competitive\s+compensation)/i;

// ---------------------------------------------------------------------------
// BuiltIn fa-sack-dollar strip
// ---------------------------------------------------------------------------

/** BuiltIn renders the comp band as `<span class="… fa-sack-dollar …"></span> 85K-130K Annually`.
 *  Return the FIRST such band (later ones are "similar jobs" sidebar cards for other companies). */
export function builtinSalaryStrip(html) {
  const h = String(html);
  const idx = h.search(/fa-sack-dollar|sack-dollar/i);
  if (idx < 0) return null;
  const around = stripTags(h.slice(idx, idx + 500));
  const m = around.match(/\b(\d{2,3})\s?K\s?(?:-|–|—|to)\s?(\d{2,3})\s?K\b/i);
  if (!m) return null;
  return `$${m[1]}K – $${m[2]}K`;
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * @param {string} html  raw page HTML
 * @param {string} url   the page URL (used for host-specific strategies)
 * @returns {{ comp_range: string|null, comp_source: CompSource }}
 */
export function extractComp(html, url) {
  const host = hostnameOf(url);
  const isBuiltIn = host === "builtin.com" || host.endsWith(".builtin.com");

  const jobPostings = jsonLdBlocks(html).flatMap(findJobPostings);
  const descriptions = jobPostings
    .map((jp) => (typeof jp.description === "string" ? stripTags(jp.description) : ""))
    .filter(Boolean);

  // A. JSON-LD baseSalary — highest confidence.
  for (const jp of jobPostings) {
    const fmt = formatBaseSalary(jp.baseSalary);
    if (fmt) return { comp_range: fmt, comp_source: "jsonld_basesalary" };
  }

  // B. Comp prose inside the JSON-LD description (the full JD). Runs *before* the BuiltIn
  //    estimate strip on purpose — explicit "Compensation: $X-$Y" beats an algorithmic estimate.
  for (const d of descriptions) {
    const c = compInProse(d);
    if (c) return { comp_range: c, comp_source: "jsonld_description" };
  }

  // C. Comp prose in the rendered page text (Greenhouse server-rendered <div>s, etc.).
  const pageText = stripTags(html);
  const proseHit = compInProse(pageText);
  if (proseHit) return { comp_range: proseHit, comp_source: "jd_prose" };

  // D. BuiltIn estimate strip — only reached when there was no baseSalary and no comp prose,
  //    so the strip is BuiltIn's algorithmic estimate. Label it.
  if (isBuiltIn) {
    const strip = builtinSalaryStrip(html);
    if (strip) return { comp_range: `${strip} (est.)`, comp_source: "jd_estimate" };
  }

  // E. Qualitative-only — tag it so it isn't re-fetched, but keep comp_range empty.
  const haystack = `${descriptions.join(" ")} ${pageText}`;
  if (QUALITATIVE_RE.test(haystack)) return { comp_range: null, comp_source: "qualitative_only" };

  // F. Nothing.
  return { comp_range: null, comp_source: "none" };
}

// ---------------------------------------------------------------------------
// Backfill decision helpers (pure — used by enrich-roles.mjs --backfill-comp)
// ---------------------------------------------------------------------------

const EMPTY_COMP = new Set([
  "", "not listed", "none", "n/a", "na", "not specified", "not disclosed", "unknown", "null",
]);

/** Does `s` look like an actual comp value (a $ amount or a K-range), vs "Not listed"/qualitative? */
export function isRealComp(s) {
  if (typeof s !== "string") return false;
  const c = s.trim();
  if (!c || EMPTY_COMP.has(c.toLowerCase())) return false;
  return /[$£€]\s?\d/.test(c) || /\b\d{2,3}\s?[KkMm]\b/.test(c) || /\d{2,3}[,.]\d{3}/.test(c);
}

/**
 * Should we (re-)run extraction for this enrichment entry during a comp backfill?
 *  - skip enrichment ERROR rows ({error, timestamp})
 *  - re-run if comp_range is currently empty/"Not listed"
 *  - re-run if comp_range is real but came from Claude (comp_source absent or "claude_extracted")
 *    AND only to *upgrade* it to a structured `jsonld_basesalary` value (caller enforces that with applyExtraction)
 *  - skip if comp_range is already real and from a structured/deterministic source
 */
export function shouldBackfill(entry) {
  if (!entry || typeof entry !== "object") return true;
  if ("error" in entry) return false;
  const cr = entry.comp_range;
  if (!isRealComp(cr)) return true; // "Not listed" / missing → always try
  const src = entry.comp_source;
  return src == null || src === "claude_extracted"; // Claude-sourced → eligible for an upgrade
}

/**
 * Merge an extraction result into an enrichment entry. Returns `{ changed, entry }`.
 *  - never overwrites an existing real comp_range unless the new source is "jsonld_basesalary"
 *  - "qualitative_only" tags the row (comp_range stays "Not listed") so it isn't re-fetched
 *  - "none" leaves the row untouched
 */
export function applyExtraction(entry, extracted, nowIso = new Date().toISOString()) {
  const e = { ...(entry || {}) };
  const { comp_range, comp_source } = extracted || {};
  const hadReal = isRealComp(e.comp_range);

  if (comp_source === "none") return { changed: false, entry: e };

  if (comp_source === "qualitative_only") {
    const changed = e.comp_range !== "Not listed" || e.comp_source !== "qualitative_only";
    e.comp_range = "Not listed";
    e.comp_source = "qualitative_only";
    if (changed) e.comp_backfilled_at = nowIso;
    return { changed, entry: e };
  }

  if (!comp_range || !isRealComp(comp_range)) return { changed: false, entry: e };

  // Don't clobber a good Claude value with a prose/estimate guess — only an upgrade to structured baseSalary.
  if (hadReal && comp_source !== "jsonld_basesalary") return { changed: false, entry: e };

  const changed = e.comp_range !== comp_range || e.comp_source !== comp_source;
  e.comp_range = comp_range;
  e.comp_source = comp_source;
  if (changed) e.comp_backfilled_at = nowIso;
  return { changed, entry: e };
}

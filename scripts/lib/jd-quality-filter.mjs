// jd-quality-filter.mjs — pre-classifier gate that rejects unusable JD scrapes.
//
// 240+ of the existing enrichments contain things like broken HTML, course
// offerings, press releases, or content pieces — Claude's verdict catches
// them but only after a full analysis call. This filter runs the same intent
// from cheap heuristics before the Claude call, preventing classifier
// contamination and saving tokens.
//
// Public:
//   assessJdQuality({title, company, description, requirements?}) → {ok, reason}
//
// Reasons:
//   ok                              — usable JD
//   rejected_short                  — description below MIN_LENGTH (likely scrape failure)
//   rejected_no_section_markers     — no "responsibilities/qualifications/etc."
//   rejected_course                 — looks like a course or training offering
//   rejected_press_release          — looks like a press release / news item

export const MIN_LENGTH = 200;

const SECTION_MARKERS = [
  "responsibilities",
  "requirements",
  "qualifications",
  "what you'll do",
  "what you will do",
  "what you’ll do", // curly apostrophe — common in CMS-rendered JDs
  "about the role",
  "about you",
  "about the position",
  "you will",
  "we are looking for",
  "we're looking for",
  "we’re looking for",
  "who you are",
  "the role",
  "key responsibilities",
];

// Course-offering markers. Patterns are intentionally specific — we don't want
// to flag JDs that just mention "training" as a perk.
const COURSE_PATTERNS = [
  /\bcourse\s+by\s+[A-Z]/, // "course by StackOptimise"
  /\b\d+%?\s+(?:off|discount)\b/i, // "50% off", "30 percent off"
  /\bcertification\s+course\b/i,
  /\btraining\s+program\s+offering\b/i,
  /\benroll\s+now\b/i,
  /\blifetime\s+access\b/i,
  /\bfull\s+course\b/i,
  /\bonline\s+course\b/i,
  /\bself-paced\s+(?:course|program)\b/i,
];

const PRESS_RELEASE_PATTERNS = [
  /\bpress release\b/i,
  /\btoday announced\b/i,
  /\bis pleased to announce\b/i,
  /\bannounced today\b/i,
  /\b(?:today,)?\s*\w+\s+announces\s+(?:its\s+|the\s+)/i,
];

/**
 * Assess whether a JD looks usable.
 *
 * @param {object} jd - { title, company, description, requirements? }
 * @returns {{ok: boolean, reason: string}}
 */
export function assessJdQuality(jd) {
  if (!jd || typeof jd !== "object") {
    return { ok: false, reason: "rejected_short" };
  }

  const text = ((jd.description || "") + " " + (jd.requirements || "")).trim();

  if (text.length < MIN_LENGTH) {
    return { ok: false, reason: "rejected_short" };
  }

  const lowered = text.toLowerCase();

  // Check course / training patterns first — these often have section
  // markers (e.g. "what you'll learn") that would otherwise pass the check.
  for (const p of COURSE_PATTERNS) {
    if (p.test(text)) return { ok: false, reason: "rejected_course" };
  }

  for (const p of PRESS_RELEASE_PATTERNS) {
    if (p.test(text)) return { ok: false, reason: "rejected_press_release" };
  }

  if (!SECTION_MARKERS.some((m) => lowered.includes(m))) {
    return { ok: false, reason: "rejected_no_section_markers" };
  }

  return { ok: true, reason: "ok" };
}

/**
 * Retroactively mark existing enrichments based on Claude's verdict field.
 * The live pipeline uses assessJdQuality() against actual JD text — this
 * helper is for already-enriched data where the raw JD isn't stored.
 *
 * Returns one of the rejected_* reasons, or null if the verdict doesn't
 * indicate a quality problem.
 *
 * @param {string} verdict - the verdict field from a stored enrichment
 * @returns {string | null}
 */
export function assessVerdictForExisting(verdict) {
  if (!verdict || typeof verdict !== "string") return null;
  const v = verdict.toLowerCase();

  // Course markers (more specific — check first)
  if (
    v.includes("course") &&
    (v.includes("training") || v.includes("certification") || v.includes("not a job"))
  ) {
    return "rejected_course";
  }
  if (v.includes("training program") && v.includes("not a job")) {
    return "rejected_course";
  }

  // Press release markers
  if (
    v.includes("press release") ||
    v.includes("not a job posting - it's a press") ||
    v.includes("blog post about") ||
    v.includes("blog article about") ||
    v.includes("content piece") ||
    v.includes("not a job posting but rather")
  ) {
    return "rejected_press_release";
  }

  // Broken/unusable markers (mapped to rejected_no_section_markers because
  // they semantically match "no parseable JD content")
  const brokenMarkers = [
    "unusable",
    "broken html",
    "broken",
    "corrupted html",
    "completely truncated",
    "completely cut off",
    "isn't a real job",
    "isn't a job posting",
    "is not a job posting",
    "not a real job",
    "no actual content",
    "no actual job",
    "just html",
    "just web metadata",
    "just website code",
    "schema markup",
  ];
  if (brokenMarkers.some((m) => v.includes(m))) {
    return "rejected_no_section_markers";
  }

  return null;
}

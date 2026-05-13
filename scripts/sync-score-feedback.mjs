#!/usr/bin/env node

/**
 * sync-score-feedback.mjs — reconcile data/score-overrides.json against data/applications.md.
 *
 * NOT append-only. It computes the *desired* set of auto-generated overrides from the current
 * applications.md, diffs against the file, and applies adds / removes / updates — but ONLY for
 * entries marked source:"auto:applications". Entries with source:"manual" are never touched
 * (an entry with no source field is treated as a legacy auto entry and adopted).
 *
 * Rules (status + eval score, both from the applications.md row; aggregated per company):
 *   - eval score ≤ 1.5/5            → block  (and penalize, score: <eval>)
 *   - eval score ≤ 2.5/5            → penalize (score: <eval>)
 *   - status is a REJECT status     → penalize (score: <eval> if ≤ 2.5, else null = "cap at 4")
 *       Reject wins over a high eval — a company you rejected is never boosted, even if it once
 *       scored ≥ 4.0/5 (flagged in the diff as a CONFLICT so you can see it).
 *   - eval score ≥ 4.0/5 (and NOT a reject status) → boost (score: <eval>)
 *   - anything else                 → no auto override
 *
 * REJECT statuses: "Rejected", "Discarded" (+ "Skipped" if TREAT_SKIPPED_AS_REJECT below).
 *
 * The reason field is structured so a future reviewer has something to revisit FROM:
 *   "auto:applications | status=<s> | date=<d> | notes=<applications.md notes col, or '—'> | claude=<fit>/10"
 *   (claude=… only when an enrichment fit_score exists for one of that company's roles)
 *
 * Default is DRY RUN — prints the diff, writes nothing. Pass --write to apply.
 *   node scripts/sync-score-feedback.mjs            # dry run (default)
 *   node scripts/sync-score-feedback.mjs --write    # apply the reconciliation
 *
 * Wired into scripts/run-scan.sh (with --write) so it runs each scan cycle.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { normalizeCompany, companyKey } from "./lib/normalize-company.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const APP_PATH = join(ROOT, "data", "applications.md");
const OVERRIDES_PATH = join(ROOT, "data", "score-overrides.json");
const SEEN_PATH = join(ROOT, "data", "seen-urls.json");
const ENRICH_PATH = join(ROOT, "data", "enrichments.json");

const WRITE = process.argv.includes("--write");

// Flip to true to also treat "Skipped" applications as a soft reject (→ penalize).
// Off by default — matches the historical effective behaviour (the old sync only matched
// "SKIP" exact, which never matched applications.md's "Skipped").
const TREAT_SKIPPED_AS_REJECT = false;

const REJECT_STATUSES = ["rejected", "discarded", ...(TREAT_SKIPPED_AS_REJECT ? ["skipped", "skip"] : [])];
const SKIPPED_STATUSES = ["skipped", "skip"];
const SOURCE_AUTO = "auto:applications";

// ---------------------------------------------------------------------------
function loadJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(readFileSync(path, "utf-8")); } catch { return fallback; }
}

// Parse applications.md → [{ num, date, company, role, score:(num|null), status, notes }]
// Rows are inconsistent (some omit the trailing Notes column) — index by position, keep blanks.
function parseApplications() {
  if (!existsSync(APP_PATH)) return [];
  const md = readFileSync(APP_PATH, "utf-8");
  const rows = [];
  for (const line of md.split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 6) continue;
    const [num, date, company, role, scoreStr, status, , , notes] = cells;
    if (!company || company === "Company" || /^-+$/.test(company)) continue; // header / separator
    const m = (scoreStr || "").match(/(\d+\.?\d*)\s*\/\s*5/);
    rows.push({
      num: num || "",
      date: date || "",
      company,
      role: role || "",
      score: m ? parseFloat(m[1]) : null,
      status: status || "",
      notes: (notes || "").trim(),
    });
  }
  return rows;
}

// company name → max enrichment fit_score across that company's roles in seen-urls (or null)
function buildClaudeFitMap() {
  const seen = loadJson(SEEN_PATH, {});
  const enrich = loadJson(ENRICH_PATH, {});
  const byKey = {};
  for (const [url, meta] of Object.entries(seen)) {
    const ck = companyKey(meta.company || "");
    if (!ck) continue;
    const e = enrich[url];
    const fit = e && typeof e.fit_score === "number" ? e.fit_score : null;
    if (fit === null) continue;
    byKey[ck] = byKey[ck] === undefined ? fit : Math.max(byKey[ck], fit);
  }
  return byKey;
}

// ---------------------------------------------------------------------------
// Aggregate applications.md → desired override state, keyed by companyKey.
function computeDesired(appRows, claudeFit) {
  const byKey = {};
  for (const r of appRows) {
    const ck = companyKey(r.company);
    if (!ck || ck.length < 2) continue;
    if (!byKey[ck]) byKey[ck] = { company: r.company, rows: [] };
    byKey[ck].rows.push(r);
    // keep the prettiest company label (longest, since "Rezolve AI" > "rezolveai")
    if (r.company.length > byKey[ck].company.length) byKey[ck].company = r.company;
  }

  const desired = {}; // ck -> { bucket: "boost"|"penalize"|"block-penalize"|null, score, reason, company, conflict?, skippedOnly? }
  for (const [ck, agg] of Object.entries(byKey)) {
    const scores = agg.rows.map((r) => r.score).filter((s) => s !== null);
    const maxScore = scores.length ? Math.max(...scores) : null;
    const statuses = agg.rows.map((r) => (r.status || "").toLowerCase());
    const anyReject = statuses.some((s) => REJECT_STATUSES.includes(s));
    const anySkipped = statuses.some((s) => SKIPPED_STATUSES.includes(s));
    // representative row = the one that drove the decision (lowest-score, or first reject, or first)
    const repRow =
      agg.rows.find((r) => r.score !== null && r.score === Math.min(...scores)) ||
      agg.rows.find((r) => REJECT_STATUSES.includes((r.status || "").toLowerCase())) ||
      agg.rows.find((r) => SKIPPED_STATUSES.includes((r.status || "").toLowerCase())) ||
      agg.rows[0];
    const fit = claudeFit[ck];
    const fitStr = typeof fit === "number" ? `${fit}/10` : "?";
    const notesStr = repRow.notes ? repRow.notes.replace(/\s+/g, " ").slice(0, 240) : "—";
    const mkReason = (tag) =>
      `auto:applications | ${tag} | status=${repRow.status || "—"} | date=${repRow.date || "—"} | notes=${notesStr} | claude=${fitStr}`;

    let entry;
    if (maxScore !== null && maxScore <= 1.5) {
      entry = { bucket: "block-penalize", score: maxScore, reason: mkReason(`eval ${maxScore}/5 (block)`) };
    } else if (maxScore !== null && maxScore <= 2.5) {
      entry = { bucket: "penalize", score: maxScore, reason: mkReason(`eval ${maxScore}/5`) };
    } else if (anyReject) {
      const conflict = maxScore !== null && maxScore >= 4.0;
      entry = {
        bucket: "penalize",
        score: maxScore !== null && maxScore <= 2.5 ? maxScore : null,
        reason: mkReason(`rejected${conflict ? ` (eval ${maxScore}/5 — CONFLICT)` : ""}`),
        conflict,
      };
    } else if (maxScore !== null && maxScore >= 4.0) {
      entry = { bucket: "boost", score: maxScore, reason: mkReason(`eval ${maxScore}/5`) };
    } else {
      entry = { bucket: null }; // no auto override (incl. plain "Skipped" when not treated as reject)
      if (anySkipped) entry.skippedOnly = true;
    }
    entry.company = agg.company;
    entry.repStatus = repRow.status || "—";
    desired[ck] = entry;
  }
  return desired;
}

// ---------------------------------------------------------------------------
// Apply desired state onto the current overrides object. Returns { next, changes }.
function reconcile(current, desired) {
  const isAuto = (e) => !e || !e.source || e.source === SOURCE_AUTO;
  const next = {
    boost: { ...(current.boost || {}) },
    penalize: { ...(current.penalize || {}) },
    block: [...(current.block || [])],
  };
  const changes = []; // { op, bucket, key, company, detail }

  // 1. Remove auto entries no longer wanted in each bucket.
  for (const [ck, e] of Object.entries(next.boost)) {
    if (!isAuto(e)) continue;
    if (desired[ck]?.bucket !== "boost") {
      delete next.boost[ck];
      changes.push({ op: "remove", bucket: "boost", key: ck, company: e.company || ck,
        detail: desired[ck]?.bucket === "penalize" ? "now penalized (status is a reject status)" : "no longer ≥ 4.0/5" });
    }
  }
  for (const [ck, e] of Object.entries(next.penalize)) {
    if (!isAuto(e)) continue;
    const want = desired[ck]?.bucket;
    if (want !== "penalize" && want !== "block-penalize") {
      delete next.penalize[ck];
      const nowStatus = desired[ck]?.repStatus || "(not in applications.md)";
      changes.push({ op: "remove", bucket: "penalize", key: ck, company: e.company || ck,
        detail: `stale — current status "${nowStatus}"  (was: ${JSON.stringify(e.reason)})` });
    }
  }
  for (const ck of [...next.block]) {
    // block has no per-entry source; treat all as auto (manual blocks are rare — revisit if needed)
    if (desired[ck]?.bucket !== "block-penalize") {
      next.block = next.block.filter((k) => k !== ck);
      changes.push({ op: "remove", bucket: "block", key: ck, company: ck, detail: "no longer ≤ 1.5/5" });
    }
  }

  // 2. Add / update auto entries to match desired.
  for (const [ck, d] of Object.entries(desired)) {
    if (!d.bucket) continue;
    if (d.bucket === "boost") {
      const cur = next.boost[ck];
      if (cur && !isAuto(cur)) continue; // manual — leave alone
      const entry = { company: d.company, score: d.score, reason: d.reason, source: SOURCE_AUTO };
      if (!cur) changes.push({ op: "add", bucket: "boost", key: ck, company: d.company, detail: `score ${d.score}/5` });
      else if (JSON.stringify({ ...cur, source: undefined }) !== JSON.stringify({ ...entry, source: undefined }))
        changes.push({ op: "update", bucket: "boost", key: ck, company: d.company, detail: `reason/score refresh` });
      next.boost[ck] = entry;
    } else if (d.bucket === "penalize" || d.bucket === "block-penalize") {
      const cur = next.penalize[ck];
      if (cur && !isAuto(cur)) {
        // manual penalize stays; but a manual entry shouldn't normally exist for an auto-penalized co
      } else {
        const entry = { company: d.company, score: d.score, reason: d.reason, source: SOURCE_AUTO };
        if (!cur) changes.push({ op: "add", bucket: "penalize", key: ck, company: d.company, detail: d.conflict ? `⚠ CONFLICT: eval ≥ 4.0/5 but status is a reject status` : `score ${d.score === null ? "null (cap 4)" : d.score + "/5"}` });
        else if (JSON.stringify({ ...cur, source: undefined }) !== JSON.stringify({ ...entry, source: undefined }))
          changes.push({ op: "update", bucket: "penalize", key: ck, company: d.company, detail: d.conflict ? `⚠ CONFLICT: eval ≥ 4.0/5 but status is a reject status` : `reason/score refresh` });
        next.penalize[ck] = entry;
      }
      if (d.bucket === "block-penalize" && !next.block.includes(ck)) {
        next.block.push(ck);
        changes.push({ op: "add", bucket: "block", key: ck, company: d.company, detail: `eval ≤ 1.5/5` });
      }
    }
  }

  // stable ordering
  const sortObj = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
  next.boost = sortObj(next.boost);
  next.penalize = sortObj(next.penalize);
  next.block.sort();
  return { next, changes };
}

// ---------------------------------------------------------------------------
const appRows = parseApplications();
const claudeFit = buildClaudeFitMap();
const desired = computeDesired(appRows, claudeFit);
const current = loadJson(OVERRIDES_PATH, { boost: {}, penalize: {}, block: [] });
const { next, changes } = reconcile(current, desired);

const companyCount = new Set(appRows.map((r) => companyKey(r.company))).size;
const autoCount = (o) => Object.values(o || {}).filter((e) => !e || !e.source || e.source === SOURCE_AUTO).length;
const manualCount = (o) => Object.values(o || {}).filter((e) => e && e.source === "manual").length;

console.log(`\n=== sync-score-feedback — RECONCILE ${WRITE ? "(WRITE)" : "(dry run — use --write to apply)"} ===`);
console.log(`applications.md: ${appRows.length} rows / ${companyCount} companies`);
console.log(`current overrides: boost=${Object.keys(current.boost || {}).length} penalize=${Object.keys(current.penalize || {}).length} block=${(current.block || []).length}  (manual: boost=${manualCount(current.boost)} penalize=${manualCount(current.penalize)})`);
console.log(`TREAT_SKIPPED_AS_REJECT = ${TREAT_SKIPPED_AS_REJECT}\n`);

if (changes.length === 0) {
  console.log("No changes — overrides already in sync.\n");
} else {
  const byOpBucket = {};
  for (const c of changes) (byOpBucket[`${c.op} ${c.bucket}`] ||= []).push(c);
  for (const [k, list] of Object.entries(byOpBucket)) {
    console.log(`${k.toUpperCase()} (${list.length}):`);
    for (const c of list) console.log(`  ${c.key.padEnd(28)} ${(c.company || "").padEnd(28)} ${c.detail || ""}`);
    console.log("");
  }
  const adds = changes.filter((c) => c.op === "add").length;
  const rms = changes.filter((c) => c.op === "remove").length;
  const ups = changes.filter((c) => c.op === "update").length;
  // count only fresh conflicts (the "⚠ CONFLICT" marker on add/update) — not the word
  // "CONFLICT" echoed inside an old reason string in a removal message
  const conflicts = changes.filter((c) => (c.op === "add" || c.op === "update") && /⚠ CONFLICT/.test(c.detail || "")).length;
  console.log(`Summary: +${adds} added, -${rms} removed, ~${ups} updated${conflicts ? `, ${conflicts} CONFLICT` : ""}`);
}

// "Skipped" candidates that would become penalties if TREAT_SKIPPED_AS_REJECT were on
const skippedOnly = Object.entries(desired).filter(([, d]) => d.skippedOnly).map(([ck, d]) => `${ck} (${d.company})`);
if (!TREAT_SKIPPED_AS_REJECT && skippedOnly.length) {
  console.log(`\nNote: ${skippedOnly.length} "Skipped" applications are NOT penalized (TREAT_SKIPPED_AS_REJECT is off).`);
  console.log(`      Flip it on to also penalize: ${skippedOnly.join(", ")}`);
}

if (WRITE) {
  writeFileSync(OVERRIDES_PATH, JSON.stringify(next, null, 2) + "\n");
  console.log(`\nWrote ${OVERRIDES_PATH}\n`);
} else {
  if (process.argv.includes("--show-result")) {
    console.log("--- resulting score-overrides.json (preview) ---");
    console.log(JSON.stringify(next, null, 2));
  }
  console.log(`\n(dry run — nothing written; pass --show-result to preview the file)\n`);
}

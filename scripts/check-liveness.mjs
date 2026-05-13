#!/usr/bin/env node

/**
 * check-liveness.mjs — Verify if roles are still posted
 *
 * Checks Tier 1 (Ashby/Greenhouse) roles via API to see if they're still live.
 * Marks closed roles in seen-urls.json with `closed: true`.
 *
 * Usage:
 *   node scripts/check-liveness.mjs           # dry run
 *   node scripts/check-liveness.mjs --apply   # write changes
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SEEN_PATH = join(ROOT, "data", "seen-urls.json");

const dryRun = !process.argv.includes("--apply");

const seen = JSON.parse(readFileSync(SEEN_PATH, "utf-8"));

let checked = 0;
let stillLive = 0;
let closed = 0;
let errors = 0;

console.log(`\n=== Liveness Check ===\n`);

for (const [url, meta] of Object.entries(seen)) {
  // Only check Tier 1 roles (Ashby + Greenhouse) — we can verify via API
  if (!url.includes("ashbyhq.com") && !url.includes("greenhouse.io")) continue;
  // Skip already-closed roles
  if (meta.closed) continue;
  // Skip roles with active application status
  // (those are tracked separately)

  checked++;

  try {
    if (url.includes("ashbyhq.com")) {
      const parts = new URL(url).pathname.split("/").filter(Boolean);
      if (parts.length < 2) continue;
      const [slug, jobId] = parts;
      const res = await fetch(
        `https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (!res.ok) {
        if (res.status === 404) {
          meta.closed = true;
          meta.closedDate = new Date().toISOString().slice(0, 10);
          closed++;
          process.stdout.write(`  CLOSED  ${meta.company || slug} — ${(meta.title || "").slice(0, 40)}\n`);
        } else {
          errors++;
        }
        continue;
      }
      const data = await res.json();
      const found = (data.jobs || []).some((j) => j.id === jobId);
      if (!found) {
        meta.closed = true;
        meta.closedDate = new Date().toISOString().slice(0, 10);
        closed++;
        process.stdout.write(`  CLOSED  ${meta.company || slug} — ${(meta.title || "").slice(0, 40)}\n`);
      } else {
        stillLive++;
      }
    }

    if (url.includes("greenhouse.io")) {
      const parts = new URL(url).pathname.split("/").filter(Boolean);
      const jobsIdx = parts.indexOf("jobs");
      if (jobsIdx < 0 || !parts[jobsIdx + 1]) continue;
      const slug = parts[jobsIdx - 1];
      const jobId = parts[jobsIdx + 1];
      const res = await fetch(
        `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs/${jobId}`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (!res.ok) {
        meta.closed = true;
        meta.closedDate = new Date().toISOString().slice(0, 10);
        closed++;
        process.stdout.write(`  CLOSED  ${meta.company || slug} — ${(meta.title || "").slice(0, 40)}\n`);
      } else {
        stillLive++;
      }
    }
  } catch {
    errors++;
  }
}

console.log(`\n  Checked: ${checked}`);
console.log(`  Still live: ${stillLive}`);
console.log(`  Closed: ${closed}`);
console.log(`  Errors: ${errors}`);

if (dryRun) {
  console.log(`\n  DRY RUN — run with --apply to save.\n`);
} else {
  writeFileSync(SEEN_PATH, JSON.stringify(seen, null, 2) + "\n");
  console.log(`\n  Changes saved.\n`);
}

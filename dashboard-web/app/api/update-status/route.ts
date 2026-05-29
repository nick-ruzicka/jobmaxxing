/**
 * POST /api/update-status
 *
 * Updates role application status in data/applications.md. Now supports bulk
 * with the same confirmation + atomicity pattern as /api/update-override and
 * /api/update-user-context. This is what enables agent use cases like
 * "disqualify all hybrid roles in SF or Philly" — agent calls query_roles
 * with a location filter, then bulk-marks each result as Skipped.
 *
 * Body — accepts either a single change OR a bulk array:
 *
 *   Single (sugar, backward-compatible with the prior shape):
 *     {
 *       url: string,                 // canonical role URL (required for match)
 *       status: string,              // RoleStatus value
 *       company?: string,            // used for matching when url-by-url
 *                                     //   lookup falls through to fuzzy match
 *       title?: string               // same; helps disambiguate
 *     }
 *
 *   Bulk:
 *     {
 *       entries: [ <single-shape>, ... ],
 *       confirmed_bulk: true         // REQUIRED when entries.length >= 2
 *     }
 *
 * Bulk safety:
 *   When >=2 entries are submitted, `confirmed_bulk: true` MUST be present.
 *   The user-facing reconfirmation flow lives in the agent panel (see Step 7
 *   confirmation UX); this flag is the server-side gate that prevents a
 *   silent 50-row mutation.
 *
 * Atomicity:
 *   data/applications.md is read once, all entries are matched + updated in
 *   memory (or upserted as new rows), then the file is written once. If
 *   any entry fails, NOTHING is written.
 *
 * Returns:
 *   200 { ok: true, updated: number, applied: [{url, status, matched: bool}, ...] }
 *   400 { error: "needs_bulk_confirmation", count, preview }
 *   400 { error, message, entry_index? }
 *   500 { error }
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

export const dynamic = "force-dynamic";

interface SingleInput {
  url?: string;
  status?: string;
  company?: string;
  title?: string;
}

interface ValidatedEntry {
  url: string;
  status: string;
  company: string;
  title: string;
}

function validateInput(input: SingleInput): ValidatedEntry | string {
  if (!input.url || typeof input.url !== "string") return "url is required";
  if (!input.status || typeof input.status !== "string") return "status is required";
  return {
    url: input.url,
    status: input.status,
    company: input.company ?? "",
    title: input.title ?? "",
  };
}

function appPath(): string {
  return join(process.cwd(), "..", "data", "applications.md");
}

/** Mutate `lines` (in-place) to set the status for a single entry. Returns
 *  { matched: boolean } so the caller can decide whether to upsert a new row.
 *  Match strategy mirrors the prior implementation: case-insensitive
 *  substring match on company + title columns. */
function applyEntryToLines(
  lines: string[],
  entry: ValidatedEntry,
): { matched: boolean } {
  const companyLower = entry.company.toLowerCase().trim();
  const titleLower = entry.title.toLowerCase().trim();

  for (let i = 2; i < lines.length; i++) {
    if (!lines[i].startsWith("|")) continue;
    const cols = lines[i].split("|").map((c) => c.trim());
    if (cols.length < 8) continue;

    const rowCompany = (cols[3] || "").toLowerCase().trim();
    const rowRole = (cols[4] || "").toLowerCase().trim();

    if (
      rowCompany &&
      companyLower &&
      (rowCompany === companyLower ||
        rowCompany.includes(companyLower.slice(0, 10)) ||
        companyLower.includes(rowRole.slice(0, 10))) &&
      (rowRole.includes(titleLower.slice(0, 15)) || titleLower.includes(rowRole.slice(0, 15)))
    ) {
      cols[6] = ` ${entry.status} `;
      lines[i] = "| " + cols.filter(Boolean).join(" | ") + " |";
      return { matched: true };
    }
  }
  return { matched: false };
}

/** Append a new row for an entry the matcher didn't find. Modifies `lines`
 *  in-place. Uses the next sequential row number based on existing rows. */
function upsertEntryToLines(lines: string[], entry: ValidatedEntry): void {
  const dataRows = lines.filter((l) => l.startsWith("| 0") || l.match(/^\| \d/));
  const nextNum = String(dataRows.length + 1).padStart(3, "0");
  const today = new Date().toISOString().slice(0, 10);
  const newRow = `| ${nextNum} | ${today} | ${entry.company || "Unknown"} | ${entry.title || "Unknown"} | —/5 | ${entry.status} | — | — | |`;

  let insertIdx = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].startsWith("|") && lines[i].match(/\d/)) {
      insertIdx = i + 1;
      break;
    }
  }
  lines.splice(insertIdx, 0, newRow);
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  // Normalize single-shape sugar into a bulk shape.
  let inputs: SingleInput[];
  let isBulkInput: boolean;
  if (Array.isArray(body.entries)) {
    inputs = body.entries as SingleInput[];
    isBulkInput = true;
  } else {
    inputs = [body as SingleInput];
    isBulkInput = false;
  }

  if (inputs.length === 0) {
    return Response.json(
      { error: "no_entries", message: "Request had no entries to apply." },
      { status: 400 },
    );
  }

  // Bulk safety: require confirmed_bulk when len >= 2.
  if (inputs.length >= 2 && body.confirmed_bulk !== true) {
    const preview = inputs.map((inp, i) => {
      const result = validateInput(inp);
      return typeof result === "string"
        ? { index: i, error: result, input: inp }
        : { index: i, url: result.url, company: result.company, title: result.title, status: result.status };
    });
    return Response.json(
      {
        error: "needs_bulk_confirmation",
        message: `Bulk action with ${inputs.length} entries requires confirmed_bulk: true. Re-call with confirmed_bulk: true after the user reconfirms.`,
        count: inputs.length,
        preview,
      },
      { status: 400 },
    );
  }

  // Validate every input first — atomicity rule.
  const validated: ValidatedEntry[] = [];
  for (let i = 0; i < inputs.length; i++) {
    const result = validateInput(inputs[i]);
    if (typeof result === "string") {
      return Response.json(
        {
          error: "invalid_entry",
          message: result,
          entry_index: isBulkInput ? i : undefined,
        },
        { status: 400 },
      );
    }
    validated.push(result);
  }

  // Initialize applications.md if missing.
  if (!existsSync(appPath())) {
    writeFileSync(
      appPath(),
      "# Applications Tracker\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|------|---------|------|-------|--------|-----|--------|-------|\n",
    );
  }

  // Read once, mutate in memory, write once. Per-entry: try to match an
  // existing row; if no match AND the status isn't "Discovered", upsert a
  // new row. Status "Discovered" doesn't get an upsert because it would
  // just clutter the tracker with rows the user didn't actively touch.
  let lines: string[];
  try {
    lines = readFileSync(appPath(), "utf-8").split("\n");
  } catch (err) {
    return Response.json(
      { error: "read_failed", message: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }

  const applied: Array<{ url: string; status: string; matched: boolean; upserted: boolean }> = [];
  for (const entry of validated) {
    const { matched } = applyEntryToLines(lines, entry);
    let upserted = false;
    if (!matched && entry.status !== "Discovered") {
      upsertEntryToLines(lines, entry);
      upserted = true;
    }
    applied.push({ url: entry.url, status: entry.status, matched, upserted });
  }

  try {
    writeFileSync(appPath(), lines.join("\n"));
  } catch (err) {
    return Response.json(
      { error: "write_failed", message: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }

  return Response.json({
    ok: true,
    updated: applied.filter((a) => a.matched || a.upserted).length,
    applied,
  });
}

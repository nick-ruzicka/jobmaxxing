/**
 * POST /api/update-override
 *
 * Updates data/score-overrides.json — the file the scoring layer reads to
 * apply manual user adjustments to roles. Built to be the write-through
 * destination for the AI agent's `update_score_override` tool (AI feature
 * audit Step 7) AND a usable endpoint for the dashboard if it grows manual-
 * edit UI later.
 *
 * Body — accepts either a single change OR a bulk array:
 *
 *   Single (sugar):
 *     {
 *       company_slug: string,
 *       kind: "boost" | "penalize" | "block",
 *       score?: number,                 // required for boost; null for penalize
 *       reason?: string,
 *       company?: string,               // display name; defaults to slug
 *       source?: string                 // provenance tag; defaults to "manual"
 *     }
 *
 *   Bulk (multiple changes in one atomic write):
 *     {
 *       entries: [ <single-shape>, ... ],
 *       confirmed_bulk: true            // REQUIRED when entries.length >= 2
 *     }
 *
 * Bulk safety:
 *   When >=2 entries are submitted, `confirmed_bulk: true` MUST be present.
 *   Without it, the endpoint returns 400 + a preview of the proposed changes
 *   so the agent (or dashboard) can re-ask the user before re-submitting
 *   with the flag set. Single-entry calls don't need the flag.
 *
 * Atomicity:
 *   All entries are validated first; if any fails, nothing is written. After
 *   validation, all changes are applied in memory and the file is written
 *   once. A bulk-failure mid-write is impossible.
 *
 * Behavior per entry:
 *   1. Slug + kind required; score required for boost.
 *   2. Remove the slug from any other category before adding — a company
 *      can be in only one of boost/penalize/block. Migrating between
 *      categories is the common edit; this keeps the file consistent.
 *   3. Write the entry in the requested category with the standard shape
 *      { company, score?, reason, source }.
 *
 * Returns:
 *   200 { ok: true, applied: [...], moves: [...] } — applied lists each slug
 *        that was set; moves lists slugs that changed category (e.g.
 *        { slug, from: "boost", to: "penalize" }).
 *   400 { error: "needs_bulk_confirmation", count, preview } — bulk submitted
 *        without confirmed_bulk flag.
 *   400 { error, message, entry_index? } — malformed request (entry_index set
 *        when a specific bulk entry failed validation).
 *   500 { error } — read/write failed.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

export const dynamic = "force-dynamic";

interface OverrideEntry {
  company: string;
  /** Present for boost (numeric); null for penalize; omitted for block. */
  score?: number | null;
  reason?: string;
  source?: string;
}

interface OverridesFile {
  boost: Record<string, OverrideEntry>;
  penalize: Record<string, OverrideEntry>;
  block: Record<string, OverrideEntry>;
  // The file also carries free-form _comment / _documentation keys for the
  // example template; we preserve them on read+write.
  _comment?: string;
  _documentation?: string;
}

const KINDS = ["boost", "penalize", "block"] as const;
type Kind = typeof KINDS[number];
const ALL_KINDS_INCL_DELETE = [...KINDS, "delete"] as const;
type KindOrDelete = typeof ALL_KINDS_INCL_DELETE[number];

function projectRoot(): string {
  return join(process.cwd(), "..");
}

function overridesPath(): string {
  return join(projectRoot(), "data", "score-overrides.json");
}

function readOverrides(): OverridesFile {
  const path = overridesPath();
  if (!existsSync(path)) {
    return { boost: {}, penalize: {}, block: {} };
  }
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    return {
      boost: raw.boost ?? {},
      penalize: raw.penalize ?? {},
      block: raw.block ?? {},
      _comment: raw._comment,
      _documentation: raw._documentation,
    };
  } catch {
    return { boost: {}, penalize: {}, block: {} };
  }
}

function writeOverrides(data: OverridesFile): void {
  // Preserve _comment / _documentation as the first keys so the template
  // structure stays intact for adopters of the framework.
  const serialized: Record<string, unknown> = {};
  if (data._comment !== undefined) serialized._comment = data._comment;
  if (data._documentation !== undefined) serialized._documentation = data._documentation;
  serialized.boost = data.boost;
  serialized.penalize = data.penalize;
  serialized.block = data.block;
  writeFileSync(overridesPath(), JSON.stringify(serialized, null, 2) + "\n");
}

interface SingleInput {
  company_slug?: string;
  kind?: string;
  score?: number | null;
  reason?: string;
  company?: string;
  source?: string;
}

interface ValidatedEntry {
  slug: string;
  kind: KindOrDelete;
  /** Undefined when kind === "delete" — there's no entry to write, just a
   *  slug to remove from all categories. */
  entry?: OverrideEntry;
}

/** Validates a single input shape into a ValidatedEntry, or returns an
 *  error string on the first problem. Supports kind="delete" for CRUD
 *  symmetry — removes the slug from whichever category it currently lives
 *  in (no-op if it doesn't exist anywhere). */
function validateInput(input: SingleInput): ValidatedEntry | string {
  const slug = input.company_slug?.trim().toLowerCase();
  if (!slug || !/^[a-z0-9_-]+$/i.test(slug)) {
    return "company_slug is required and must be alphanumeric (_-) only.";
  }
  if (
    !input.kind ||
    !(ALL_KINDS_INCL_DELETE as readonly string[]).includes(input.kind)
  ) {
    return `kind must be one of: ${ALL_KINDS_INCL_DELETE.join(", ")}`;
  }
  const kind = input.kind as KindOrDelete;
  if (kind === "delete") {
    return { slug, kind };
  }
  if (kind === "boost" && typeof input.score !== "number") {
    return "score is required when kind=boost.";
  }
  if (kind === "boost" && (input.score! < 0 || input.score! > 10)) {
    return "score must be between 0 and 10.";
  }
  const entry: OverrideEntry = {
    company: input.company?.trim() || slug,
    reason: input.reason?.trim() || "(no reason given)",
    source: input.source?.trim() || "manual",
  };
  if (kind === "boost") entry.score = input.score!;
  if (kind === "penalize") entry.score = input.score ?? null;
  return { slug, kind, entry };
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  // ── Normalize single-shape sugar into a bulk shape ────────────────────
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

  // ── Bulk safety: require confirmed_bulk when len >= 2 ─────────────────
  // The single-confirm pattern in the chat panel is too easy to fat-finger
  // on a 5-change action. Forcing the agent to come back with confirmed_bulk
  // means the user got to read the preview and reconfirm explicitly.
  if (inputs.length >= 2 && body.confirmed_bulk !== true) {
    // Build a preview without writing anything. Each entry still goes
    // through validation so the preview is honest.
    const preview = inputs.map((inp, i) => {
      const result = validateInput(inp);
      return typeof result === "string"
        ? { index: i, error: result, input: inp }
        : { index: i, slug: result.slug, kind: result.kind, entry: result.entry };
    });
    return Response.json(
      {
        error: "needs_bulk_confirmation",
        message: `Bulk action with ${inputs.length} entries requires confirmed_bulk: true. Re-call this endpoint with confirmed_bulk: true after the user reconfirms.`,
        count: inputs.length,
        preview,
      },
      { status: 400 },
    );
  }

  // ── Validate all entries first (atomicity: don't write a partial set) ─
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

  // ── Read, mutate in memory, write once ────────────────────────────────
  let data: OverridesFile;
  try {
    data = readOverrides();
  } catch (err) {
    return Response.json(
      { error: "read_failed", message: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }

  const moves: Array<{ slug: string; from: Kind; to: KindOrDelete }> = [];
  const deletions: Array<{ slug: string; from: Kind }> = [];
  for (const { slug, kind, entry } of validated) {
    if (kind === "delete") {
      // Remove from whichever category the slug currently lives in.
      for (const k of KINDS) {
        if (data[k][slug]) {
          deletions.push({ slug, from: k });
          delete data[k][slug];
        }
      }
      continue;
    }
    // Remove the slug from any other category before placing it. A company
    // can be in only one of boost/penalize/block.
    for (const k of KINDS) {
      if (k === kind) continue;
      if (data[k][slug]) {
        moves.push({ slug, from: k, to: kind });
        delete data[k][slug];
      }
    }
    data[kind][slug] = entry!;
  }

  try {
    writeOverrides(data);
  } catch (err) {
    return Response.json(
      { error: "write_failed", message: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }

  return Response.json({
    ok: true,
    applied: validated.map((v) => ({ slug: v.slug, kind: v.kind })),
    moves,
    deletions,
  });
}

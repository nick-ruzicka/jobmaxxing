/**
 * POST /api/update-user-context
 *
 * Updates config/user-context.yaml — the per-user scoring/agent preferences
 * file. Built to be the write-through destination for the AI agent's
 * `update_user_context` tool (AI feature audit Step 7), with a strict
 * path whitelist so the agent can't accidentally overwrite sensitive fields
 * like compensation or hard_nos.
 *
 * Body — accepts either a single change OR a bulk array:
 *
 *   Single (sugar):
 *     {
 *       path: string[],         // e.g. ["archetype_fit", "web3-bd", "qualified"]
 *       value: unknown
 *     }
 *
 *   Bulk (multiple changes in one atomic write):
 *     {
 *       entries: [
 *         { path: string[], value: unknown },
 *         ...
 *       ],
 *       confirmed_bulk: true    // REQUIRED when entries.length >= 2
 *     }
 *
 * Bulk safety:
 *   When >=2 entries are submitted, `confirmed_bulk: true` MUST be present.
 *   Without it, the endpoint returns 400 + a preview of the proposed changes
 *   so the agent can re-ask the user before re-submitting with the flag set.
 *
 * Atomicity:
 *   All entries are validated first; if any fails, the file is not touched.
 *   After validation, all changes are applied in memory and the file is
 *   written once. A bulk-failure mid-write is impossible.
 *
 * Supported paths in v1 (anything else returns 400 path_not_supported):
 *   archetype_fit.<archetype_id>.qualified         (boolean)
 *   archetype_fit.<archetype_id>.confidence_floor  (number 0-1)
 *   agent.voice                                    (string: direct|warm|analytical|custom:<text>)
 *   agent.redact                                   (string[])
 *
 * The whitelist is the v1 productization-safety boundary. Compensation,
 * location_preferences, and hard_nos are deliberately NOT writable from this
 * endpoint — those edits need explicit user consent and should happen in a
 * dedicated UI flow (or by hand-editing). See AI audit §5b.
 *
 * Behavior:
 *   1. Normalize single-shape into entries[].
 *   2. If entries.length >= 2, require confirmed_bulk.
 *   3. Validate every path against the v1 whitelist + value type-check.
 *   4. Back up the current user-context.yaml to user-context.yaml.bak.
 *   5. Parse YAML, apply all changes in memory, re-dump, write once.
 *
 * Returns:
 *   200 { ok: true, applied: [{path, value}, ...] }
 *   400 { error: "needs_bulk_confirmation", count, preview } — bulk submitted
 *        without confirmed_bulk flag.
 *   400 { error, message, entry_index? } — malformed / not whitelisted /
 *        type mismatch (entry_index set when a specific bulk entry failed).
 *   500 { error } — read/write failed.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { load as yamlLoad, dump as yamlDump } from "js-yaml";

export const dynamic = "force-dynamic";

function projectRoot(): string {
  return join(process.cwd(), "..");
}

function userContextPath(): string {
  return join(projectRoot(), "config", "user-context.yaml");
}

function backupPath(): string {
  return userContextPath() + ".bak";
}

// ─── Path whitelist ─────────────────────────────────────────────────────────
// Each entry is a matcher + a type validator. Patterns use a `*` placeholder
// for any single path segment. Validators run on the proposed value before
// it touches the file.

type Validator = (v: unknown) => string | null;

interface WhitelistEntry {
  pattern: string[]; // each segment is either a literal or "*"
  validate: Validator;
}

const isBoolean: Validator = (v) =>
  typeof v === "boolean" ? null : "value must be a boolean";

const isConfidenceFloor: Validator = (v) =>
  typeof v === "number" && v >= 0 && v <= 1
    ? null
    : "value must be a number between 0 and 1";

const isVoice: Validator = (v) => {
  if (typeof v !== "string") return "value must be a string";
  if (v === "direct" || v === "warm" || v === "analytical") return null;
  if (v.startsWith("custom:")) return null;
  return "voice must be one of: direct, warm, analytical, custom:<text>";
};

const isStringArray: Validator = (v) => {
  if (!Array.isArray(v)) return "value must be an array";
  if (!v.every((x) => typeof x === "string")) return "value must be an array of strings";
  return null;
};

const WHITELIST: WhitelistEntry[] = [
  { pattern: ["archetype_fit", "*", "qualified"], validate: isBoolean },
  { pattern: ["archetype_fit", "*", "confidence_floor"], validate: isConfidenceFloor },
  { pattern: ["agent", "voice"], validate: isVoice },
  { pattern: ["agent", "redact"], validate: isStringArray },
];

function findWhitelistEntry(path: string[]): WhitelistEntry | null {
  return (
    WHITELIST.find((w) => {
      if (w.pattern.length !== path.length) return false;
      return w.pattern.every((seg, i) => seg === "*" || seg === path[i]);
    }) ?? null
  );
}

// ─── YAML mutation ──────────────────────────────────────────────────────────

type YamlObject = Record<string, unknown>;

function isPlainObject(v: unknown): v is YamlObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Set a deep path in a plain object, creating intermediate objects as
 *  needed. Returns true on success. */
function setDeep(obj: YamlObject, path: string[], value: unknown): boolean {
  let cursor: YamlObject = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    const next = cursor[key];
    if (next === undefined || next === null) {
      cursor[key] = {};
      cursor = cursor[key] as YamlObject;
    } else if (isPlainObject(next)) {
      cursor = next;
    } else {
      // Path collides with a non-object value — refuse rather than corrupt.
      return false;
    }
  }
  cursor[path[path.length - 1]] = value;
  return true;
}

// ─── Per-entry validation ──────────────────────────────────────────────────

interface SingleInput {
  path?: unknown;
  value?: unknown;
  /** When true, DELETE the key at `path` instead of setting it. `value` is
   *  ignored in this mode. CRUD parity with update-override's "delete" kind. */
  delete?: boolean;
}

interface ValidatedChange {
  path: string[];
  /** Present unless `delete === true`. */
  value?: unknown;
  delete?: boolean;
}

/** Validates a single input into a ValidatedChange or returns an error
 *  string. Includes the path-whitelist check + value type-check (skipped
 *  for delete operations). */
function validateInput(input: SingleInput): ValidatedChange | string {
  if (
    !Array.isArray(input.path) ||
    input.path.length === 0 ||
    !input.path.every((s): s is string => typeof s === "string" && s.length > 0)
  ) {
    return "path must be a non-empty array of string segments.";
  }
  const path = input.path as string[];
  const entry = findWhitelistEntry(path);
  if (!entry) {
    return `The path ${JSON.stringify(path)} is not yet writable via this endpoint. Supported v1 paths: archetype_fit.<id>.qualified, archetype_fit.<id>.confidence_floor, agent.voice, agent.redact.`;
  }
  if (input.delete === true) {
    return { path, delete: true };
  }
  const valueErr = entry.validate(input.value);
  if (valueErr) return valueErr;
  return { path, value: input.value };
}

/** Delete a deep path from a plain object. Returns true if the key was
 *  removed; false if the path didn't exist (treated as a no-op success).
 *  Intermediate non-object collisions are also treated as no-ops. */
function deleteDeep(obj: YamlObject, path: string[]): boolean {
  let cursor: YamlObject = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const next = cursor[path[i]];
    if (!isPlainObject(next)) return false;
    cursor = next;
  }
  const last = path[path.length - 1];
  if (last in cursor) {
    delete cursor[last];
    return true;
  }
  return false;
}

// ─── Handler ───────────────────────────────────────────────────────────────

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

  // Bulk safety: require confirmed_bulk when len >= 2. The single-confirm
  // pattern in the chat panel is too easy to fat-finger on a 5-change action.
  if (inputs.length >= 2 && body.confirmed_bulk !== true) {
    const preview = inputs.map((inp, i) => {
      const result = validateInput(inp);
      return typeof result === "string"
        ? { index: i, error: result, input: inp }
        : { index: i, path: result.path, value: result.value };
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

  // Validate every input first — atomicity rule.
  const validated: ValidatedChange[] = [];
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

  // Read existing file.
  const path_ = userContextPath();
  if (!existsSync(path_)) {
    return Response.json(
      {
        error: "no_user_context",
        message:
          "config/user-context.yaml does not exist. Copy from user-context.example.yaml first.",
      },
      { status: 400 },
    );
  }

  let rawYaml: string;
  let parsed: YamlObject;
  try {
    rawYaml = readFileSync(path_, "utf-8");
    const loaded = yamlLoad(rawYaml);
    if (!isPlainObject(loaded)) {
      return Response.json(
        {
          error: "malformed_yaml",
          message: "user-context.yaml did not parse to an object.",
        },
        { status: 500 },
      );
    }
    parsed = loaded;
  } catch (err) {
    return Response.json(
      {
        error: "yaml_parse_failed",
        message: err instanceof Error ? err.message : "parse failed",
      },
      { status: 500 },
    );
  }

  // Backup current file BEFORE mutating. Single-level safety net — any
  // subsequent write overwrites the previous .bak.
  try {
    writeFileSync(backupPath(), rawYaml);
  } catch (err) {
    return Response.json(
      {
        error: "backup_failed",
        message: err instanceof Error ? err.message : "backup failed",
      },
      { status: 500 },
    );
  }

  // Apply all changes in memory. Delete operations are no-ops on missing
  // paths (idempotent) — the agent can safely propose "remove this key"
  // even when the key isn't set yet, and we won't error out.
  const deletions: Array<{ path: string[]; existed: boolean }> = [];
  for (let i = 0; i < validated.length; i++) {
    const change = validated[i];
    if (change.delete === true) {
      const existed = deleteDeep(parsed, change.path);
      deletions.push({ path: change.path, existed });
      continue;
    }
    if (!setDeep(parsed, change.path, change.value)) {
      return Response.json(
        {
          error: "path_collision",
          message: `Path ${JSON.stringify(change.path)} collides with an existing non-object value; refusing to overwrite. The .bak file has the pre-mutation state.`,
          entry_index: isBulkInput ? i : undefined,
        },
        { status: 400 },
      );
    }
  }

  // Write back. js-yaml's dump reformats — comments in the original file
  // may not survive. Documented in the example yaml and the v1 schema docs.
  let serialized: string;
  try {
    serialized = yamlDump(parsed, { lineWidth: 100, noRefs: true });
  } catch (err) {
    return Response.json(
      {
        error: "yaml_dump_failed",
        message: err instanceof Error ? err.message : "dump failed",
      },
      { status: 500 },
    );
  }

  try {
    writeFileSync(path_, serialized);
  } catch (err) {
    return Response.json(
      {
        error: "write_failed",
        message: err instanceof Error ? err.message : "write failed",
      },
      { status: 500 },
    );
  }

  return Response.json({
    ok: true,
    applied: validated
      .filter((v) => v.delete !== true)
      .map((v) => ({ path: v.path, value: v.value })),
    deletions,
  });
}

/**
 * companies-load.mjs — read & write config/companies.yml using the structured schema.
 *
 * Schema:
 *   companies:
 *     - canonical_name: EliseAI
 *       ats: ashby
 *       slug: eliseai
 *       source: manual
 *       added_date: 2026-05-12
 *       notes: "Series B AI-native NYC"
 *       last_seen_active: 2026-05-13   # optional, scraper-populated
 *       paused: false                  # optional
 *       needs_slug_verification: false # optional
 *
 * No external YAML dependency — we hand-roll a minimal parser/serializer for this
 * specific shape (top-level `companies:` list of flat key:value maps). Matches the
 * existing project pattern (scan-jobs.mjs has its own hand-rolled YAML reader).
 *
 * Supported value types: strings (quoted with single or double quotes, or bare),
 * booleans (true|false), and bare ISO dates. Nested maps and lists inside entries
 * are not supported — keep the schema flat.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { validateCompaniesList, SUPPORTED_ATS } from "./companies-schema.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = join(__dirname, "..", "..", "config", "companies.yml");

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

function stripInlineComment(line) {
  // Strip `# comment` but only outside of quoted strings. Bounded: we don't support
  // hashes inside unquoted values (no entry uses them).
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === "#" && !inSingle && !inDouble) {
      // Comment must be preceded by whitespace (or be at column 0) to be a comment,
      // otherwise it's part of the value.
      if (i === 0 || /\s/.test(line[i - 1])) return line.slice(0, i);
    }
  }
  return line;
}

function parseScalar(raw) {
  const s = raw.trim();
  if (s === "") return "";
  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "null" || s === "~") return null;
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
    return s
      .slice(1, -1)
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }
  if (s.startsWith("'") && s.endsWith("'") && s.length >= 2) {
    return s.slice(1, -1).replace(/''/g, "'");
  }
  // Bare numbers — we don't have any in this schema, but parse for safety.
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  return s;
}

/**
 * Parse a companies.yml document. Returns an array of validated entries.
 * Throws on schema/format errors.
 *
 * @param {string} text  YAML source
 * @returns {object[]}
 */
export function parseCompaniesYaml(text) {
  const lines = text.split(/\r?\n/);
  const entries = [];
  let current = null;
  let inCompanies = false;
  let entriesIndent = -1; // indent level of "- " (list-item marker)
  let kvIndent = -1; // indent level of "key: value" lines inside an entry

  for (let lineNo = 0; lineNo < lines.length; lineNo++) {
    const rawLine = lines[lineNo];
    const stripped = stripInlineComment(rawLine);
    if (!stripped.trim()) continue;

    const indent = stripped.match(/^(\s*)/)[1].length;
    const content = stripped.slice(indent);

    // Top-level: looking for `companies:`
    if (!inCompanies) {
      if (indent === 0 && content.startsWith("companies:")) {
        inCompanies = true;
      }
      // Ignore everything else above the companies: key (top-level comments etc.)
      continue;
    }

    // Inside companies: section
    if (content.startsWith("- ")) {
      // New list entry
      if (entriesIndent === -1) entriesIndent = indent;
      if (indent !== entriesIndent) {
        throw new Error(
          `line ${lineNo + 1}: inconsistent list-item indent (expected ${entriesIndent}, got ${indent})`,
        );
      }
      if (current) entries.push(current);
      current = {};
      // The "- " is followed by a key: value pair on the same line.
      const rest = content.slice(2).trimStart();
      kvIndent = indent + 2; // continuation kv lines must be indented past the dash
      const kv = parseKeyValueLine(rest, lineNo + 1);
      if (kv) current[kv.key] = kv.value;
      continue;
    }

    if (indent === 0 && content !== "") {
      // We've fallen off the companies: section (top-level sibling key, e.g., a
      // future version of the file). Stop.
      break;
    }

    // Continuation key: value line inside an entry.
    if (!current) {
      throw new Error(`line ${lineNo + 1}: key:value line outside any list entry`);
    }
    if (kvIndent === -1) kvIndent = indent;
    if (indent !== kvIndent) {
      throw new Error(
        `line ${lineNo + 1}: inconsistent key indent (expected ${kvIndent}, got ${indent})`,
      );
    }
    const kv = parseKeyValueLine(content, lineNo + 1);
    if (kv) current[kv.key] = kv.value;
  }
  if (current) entries.push(current);

  return validateCompaniesList(entries);
}

function parseKeyValueLine(content, lineNo) {
  const colonIdx = content.indexOf(":");
  if (colonIdx === -1) {
    throw new Error(`line ${lineNo}: expected "key: value", got: ${JSON.stringify(content)}`);
  }
  const key = content.slice(0, colonIdx).trim();
  const valueRaw = content.slice(colonIdx + 1);
  if (!key) throw new Error(`line ${lineNo}: empty key`);
  return { key, value: parseScalar(valueRaw) };
}

// ---------------------------------------------------------------------------
// Serializer
// ---------------------------------------------------------------------------

const FIELD_ORDER = [
  "canonical_name",
  "ats",
  "slug",
  "source",
  "added_date",
  "last_seen_active",
  "paused",
  "needs_slug_verification",
  "notes",
];

function serializeScalar(v) {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  // Strings: quote if they contain a colon, hash, leading/trailing whitespace, or are
  // ambiguous with bools/numbers. Otherwise emit bare. Use double quotes; escape `"` and `\`.
  const s = String(v);
  const needsQuoting =
    /[:#]/.test(s) ||
    /^\s|\s$/.test(s) ||
    s === "" ||
    s === "true" ||
    s === "false" ||
    s === "null" ||
    s === "~" ||
    /^-?\d+$/.test(s) ||
    s.startsWith("-") ||
    s.startsWith("[") ||
    s.startsWith("{") ||
    s.startsWith("'") ||
    s.startsWith('"');
  if (!needsQuoting) return s;
  return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

/**
 * Serialize a list of validated entries to YAML text. Deterministic field order via
 * FIELD_ORDER (unknown fields trailing, alphabetically). Stable for git diffs.
 *
 * @param {object[]} entries
 * @returns {string}
 */
export function serializeCompaniesYaml(entries) {
  validateCompaniesList(entries);

  let out = "# config/companies.yml — Tracked companies for Tier-1 ATS scanning.\n";
  out += "#\n";
  out += `# Supported ATS: ${SUPPORTED_ATS.join(", ")}.\n`;
  out += "# Schema: see scripts/lib/companies-schema.mjs.\n";
  out += "# Loader/writer: scripts/lib/companies-load.mjs.\n";
  out += "#\n";
  out += "# DO NOT hand-edit while a scrape run is in progress — the auto-promotion\n";
  out += "# engine will rewrite this file atomically. Hand-edits during a write window\n";
  out += "# may be overwritten.\n\n";
  out += "companies:\n";

  for (const e of entries) {
    const keys = [
      ...FIELD_ORDER.filter((k) => e[k] !== undefined),
      ...Object.keys(e)
        .filter((k) => !FIELD_ORDER.includes(k))
        .sort(),
    ];
    let first = true;
    for (const k of keys) {
      const prefix = first ? "  - " : "    ";
      out += `${prefix}${k}: ${serializeScalar(e[k])}\n`;
      first = false;
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// IO
// ---------------------------------------------------------------------------

/**
 * Read companies.yml from disk. Returns { entries, path }.
 * If `path` is omitted, uses config/companies.yml relative to this file.
 *
 * @param {string} [path]
 */
export function readCompaniesFile(path = DEFAULT_PATH) {
  if (!existsSync(path)) {
    return { entries: [], path };
  }
  const text = readFileSync(path, "utf-8");
  const entries = parseCompaniesYaml(text);
  return { entries, path };
}

/**
 * Atomic write. Writes to a temp file then renames over the target — never leaves
 * a half-written file if the process crashes mid-write.
 *
 * @param {object[]} entries
 * @param {string} [path]
 */
export function writeCompaniesFile(entries, path = DEFAULT_PATH) {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = path + ".tmp-" + process.pid + "-" + Date.now();
  writeFileSync(tmp, serializeCompaniesYaml(entries));
  renameSync(tmp, path);
}

/**
 * Convenience: return arrays of slugs grouped by ATS. Maintains the shape that the
 * existing scan-jobs.mjs loadCompanies() returned, so the call-site change is
 * minimal.
 *
 * @param {string} [path]
 * @returns {{ ashby: string[], greenhouse: string[], lever: string[], all: object[] }}
 */
export function loadCompaniesGrouped(path = DEFAULT_PATH) {
  const { entries } = readCompaniesFile(path);
  const active = entries.filter((e) => !e.paused);
  return {
    ashby: active.filter((e) => e.ats === "ashby").map((e) => e.slug),
    greenhouse: active.filter((e) => e.ats === "greenhouse").map((e) => e.slug),
    lever: active.filter((e) => e.ats === "lever").map((e) => e.slug),
    all: entries, // includes paused — caller filters as needed
  };
}

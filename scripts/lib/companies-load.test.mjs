import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  parseCompaniesYaml,
  serializeCompaniesYaml,
  readCompaniesFile,
  writeCompaniesFile,
  loadCompaniesGrouped,
} from "./companies-load.mjs";

function tmp() {
  return mkdtempSync(join(tmpdir(), "companies-load-test-"));
}

test("parseCompaniesYaml — minimal one-entry file", () => {
  const yaml = `
companies:
  - canonical_name: EliseAI
    ats: ashby
    slug: eliseai
    source: manual
    added_date: 2026-05-12
`;
  const out = parseCompaniesYaml(yaml);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], {
    canonical_name: "EliseAI",
    ats: "ashby",
    slug: "eliseai",
    source: "manual",
    added_date: "2026-05-12",
  });
});

test("parseCompaniesYaml — multiple entries, mixed ATS", () => {
  const yaml = `
companies:
  - canonical_name: EliseAI
    ats: ashby
    slug: eliseai
    source: manual
    added_date: 2026-05-12
  - canonical_name: Plaid
    ats: lever
    slug: plaid
    source: manual
    added_date: 2026-05-14
  - canonical_name: Hebbia
    ats: greenhouse
    slug: hebbia
    source: manual
    added_date: 2026-05-12
`;
  const out = parseCompaniesYaml(yaml);
  assert.equal(out.length, 3);
  assert.equal(out[0].ats, "ashby");
  assert.equal(out[1].ats, "lever");
  assert.equal(out[2].ats, "greenhouse");
});

test("parseCompaniesYaml — quoted notes with colon", () => {
  const yaml = `
companies:
  - canonical_name: Notion
    ats: ashby
    slug: notion
    source: manual
    added_date: 2026-05-12
    notes: "AI: GTM tooling for everyone"
`;
  const out = parseCompaniesYaml(yaml);
  assert.equal(out[0].notes, "AI: GTM tooling for everyone");
});

test("parseCompaniesYaml — strips inline comments", () => {
  const yaml = `
companies:
  - canonical_name: EliseAI  # housing+healthcare
    ats: ashby
    slug: eliseai            # 112 jobs
    source: manual
    added_date: 2026-05-12
`;
  const out = parseCompaniesYaml(yaml);
  assert.equal(out[0].slug, "eliseai");
  assert.equal(out[0].canonical_name, "EliseAI");
});

test("parseCompaniesYaml — booleans", () => {
  const yaml = `
companies:
  - canonical_name: TestCo
    ats: ashby
    slug: testco
    source: manual
    added_date: 2026-05-12
    paused: true
    needs_slug_verification: false
`;
  const out = parseCompaniesYaml(yaml);
  assert.equal(out[0].paused, true);
  assert.equal(out[0].needs_slug_verification, false);
});

test("parseCompaniesYaml — surfaces validation errors", () => {
  const yaml = `
companies:
  - canonical_name: TestCo
    ats: workday
    slug: testco
    source: manual
    added_date: 2026-05-12
`;
  assert.throws(() => parseCompaniesYaml(yaml), /ats must be one of/);
});

test("parseCompaniesYaml — surfaces malformed-yaml errors with line numbers", () => {
  const yaml = `
companies:
  - canonical_name: TestCo
    ats: ashby
    slug testco
    source: manual
    added_date: 2026-05-12
`;
  assert.throws(() => parseCompaniesYaml(yaml), /expected "key: value"/);
});

test("parseCompaniesYaml — handles empty file gracefully", () => {
  assert.deepEqual(parseCompaniesYaml(""), []);
  assert.deepEqual(parseCompaniesYaml("# just a comment\n\n"), []);
});

test("serializeCompaniesYaml — round-trips", () => {
  const entries = [
    {
      canonical_name: "EliseAI",
      ats: "ashby",
      slug: "eliseai",
      source: "manual",
      added_date: "2026-05-12",
      notes: "Series B AI-native NYC",
    },
  ];
  const yaml = serializeCompaniesYaml(entries);
  const reparsed = parseCompaniesYaml(yaml);
  assert.deepEqual(reparsed, entries);
});

test("serializeCompaniesYaml — round-trips with special characters", () => {
  const entries = [
    {
      canonical_name: "Notion",
      ats: "ashby",
      slug: "notion",
      source: "manual",
      added_date: "2026-05-12",
      notes: 'AI: "the GTM stack", everywhere',
    },
  ];
  const yaml = serializeCompaniesYaml(entries);
  const reparsed = parseCompaniesYaml(yaml);
  assert.deepEqual(reparsed, entries);
});

test("serializeCompaniesYaml — deterministic field ordering", () => {
  const entries = [
    {
      slug: "eliseai", // intentionally out of FIELD_ORDER
      added_date: "2026-05-12",
      ats: "ashby",
      source: "manual",
      canonical_name: "EliseAI",
    },
  ];
  const yaml = serializeCompaniesYaml(entries);
  // canonical_name comes first per FIELD_ORDER
  const lines = yaml.split("\n").filter((l) => l.startsWith("  -") || l.startsWith("    "));
  assert.ok(lines[0].includes("canonical_name"));
  assert.ok(lines[1].includes("ats"));
  assert.ok(lines[2].includes("slug"));
});

test("writeCompaniesFile + readCompaniesFile — atomic write round-trip", () => {
  const dir = tmp();
  try {
    const path = join(dir, "companies.yml");
    const entries = [
      {
        canonical_name: "EliseAI",
        ats: "ashby",
        slug: "eliseai",
        source: "manual",
        added_date: "2026-05-12",
      },
    ];
    writeCompaniesFile(entries, path);
    assert.ok(existsSync(path));
    const { entries: read } = readCompaniesFile(path);
    assert.deepEqual(read, entries);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("writeCompaniesFile — leaves no .tmp- artifact on success", async () => {
  const { readdirSync } = await import("fs");
  const dir = tmp();
  try {
    const path = join(dir, "companies.yml");
    writeCompaniesFile(
      [
        {
          canonical_name: "EliseAI",
          ats: "ashby",
          slug: "eliseai",
          source: "manual",
          added_date: "2026-05-12",
        },
      ],
      path,
    );
    const files = readdirSync(dir);
    assert.deepEqual(files, ["companies.yml"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readCompaniesFile — non-existent path returns empty list", () => {
  const dir = tmp();
  try {
    const result = readCompaniesFile(join(dir, "nope.yml"));
    assert.deepEqual(result.entries, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadCompaniesGrouped — groups by ATS, excludes paused from per-ats lists", () => {
  const dir = tmp();
  try {
    const path = join(dir, "companies.yml");
    writeCompaniesFile(
      [
        {
          canonical_name: "EliseAI",
          ats: "ashby",
          slug: "eliseai",
          source: "manual",
          added_date: "2026-05-12",
        },
        {
          canonical_name: "Hebbia",
          ats: "greenhouse",
          slug: "hebbia",
          source: "manual",
          added_date: "2026-05-12",
        },
        {
          canonical_name: "Plaid",
          ats: "lever",
          slug: "plaid",
          source: "manual",
          added_date: "2026-05-14",
        },
        {
          canonical_name: "OldCo",
          ats: "ashby",
          slug: "oldco",
          source: "manual",
          added_date: "2025-01-01",
          paused: true,
        },
      ],
      path,
    );
    const grouped = loadCompaniesGrouped(path);
    assert.deepEqual(grouped.ashby, ["eliseai"]);
    assert.deepEqual(grouped.greenhouse, ["hebbia"]);
    assert.deepEqual(grouped.lever, ["plaid"]);
    assert.equal(grouped.all.length, 4); // includes paused
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("real config/companies.yml parses cleanly (smoke test)", () => {
  // The repo's real companies.yml must be parseable by this loader. If this fails,
  // the migration broke something downstream.
  const { entries } = readCompaniesFile();
  assert.ok(entries.length > 0, "config/companies.yml should not be empty");
  for (const e of entries) {
    assert.ok(["ashby", "greenhouse", "lever"].includes(e.ats));
    assert.ok(e.slug.length > 0);
  }
});

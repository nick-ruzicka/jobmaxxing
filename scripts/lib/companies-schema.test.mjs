import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateCompanyEntry,
  validateCompaniesList,
  hasEntry,
  SUPPORTED_ATS,
} from "./companies-schema.mjs";

const ok = {
  canonical_name: "EliseAI",
  ats: "ashby",
  slug: "eliseai",
  source: "manual",
  added_date: "2026-05-12",
};

test("validateCompanyEntry — accepts minimal valid entry", () => {
  assert.equal(validateCompanyEntry(ok), ok);
});

test("validateCompanyEntry — accepts all optional fields", () => {
  const full = {
    ...ok,
    notes: "Series B AI-native NYC",
    last_seen_active: "2026-05-13",
    paused: false,
    needs_slug_verification: true,
  };
  validateCompanyEntry(full);
});

test("validateCompanyEntry — rejects non-object", () => {
  assert.throws(() => validateCompanyEntry(null), /must be an object/);
  assert.throws(() => validateCompanyEntry("eliseai"), /must be an object/);
  assert.throws(() => validateCompanyEntry([]), /must be an object/);
});

test("validateCompanyEntry — rejects missing required field", () => {
  for (const k of ["canonical_name", "ats", "slug", "source", "added_date"]) {
    const e = { ...ok };
    delete e[k];
    assert.throws(() => validateCompanyEntry(e), new RegExp(`missing required field "${k}"`));
  }
});

test("validateCompanyEntry — rejects unsupported ats", () => {
  assert.throws(
    () => validateCompanyEntry({ ...ok, ats: "workday" }),
    /ats must be one of/,
  );
});

test("validateCompanyEntry — accepts all SUPPORTED_ATS values", () => {
  for (const ats of SUPPORTED_ATS) {
    validateCompanyEntry({ ...ok, ats });
  }
});

test("validateCompanyEntry — rejects malformed slug", () => {
  // Uppercase slug
  assert.throws(() => validateCompanyEntry({ ...ok, slug: "EliseAI" }), /slug must match/);
  // Slug with space
  assert.throws(() => validateCompanyEntry({ ...ok, slug: "elise ai" }), /slug must match/);
  // Slug starting with dash
  assert.throws(() => validateCompanyEntry({ ...ok, slug: "-elise" }), /slug must match/);
  // Empty slug
  assert.throws(() => validateCompanyEntry({ ...ok, slug: "" }), /missing required field/);
});

test("validateCompanyEntry — accepts slugs with dashes, underscores, digits", () => {
  validateCompanyEntry({ ...ok, slug: "modal-labs" });
  validateCompanyEntry({ ...ok, slug: "company_v2" });
  validateCompanyEntry({ ...ok, slug: "co2025" });
});

test("validateCompanyEntry — rejects malformed date", () => {
  assert.throws(() => validateCompanyEntry({ ...ok, added_date: "May 12, 2026" }), /YYYY-MM-DD/);
  assert.throws(() => validateCompanyEntry({ ...ok, added_date: "2026/05/12" }), /YYYY-MM-DD/);
  assert.throws(() => validateCompanyEntry({ ...ok, added_date: "2026-5-12" }), /YYYY-MM-DD/);
});

test("validateCompanyEntry — rejects wrong-typed optionals", () => {
  assert.throws(() => validateCompanyEntry({ ...ok, paused: "true" }), /paused must be boolean/);
  assert.throws(() => validateCompanyEntry({ ...ok, notes: 123 }), /notes must be a string/);
  assert.throws(
    () => validateCompanyEntry({ ...ok, last_seen_active: "yesterday" }),
    /YYYY-MM-DD/,
  );
});

test("validateCompanyEntry — accepts free-form source strings", () => {
  validateCompanyEntry({ ...ok, source: "manual" });
  validateCompanyEntry({ ...ok, source: "auto_promoted_from_builtin" });
  validateCompanyEntry({ ...ok, source: "some_custom_source_label" });
});

test("validateCompaniesList — accepts empty list", () => {
  assert.deepEqual(validateCompaniesList([]), []);
});

test("validateCompaniesList — rejects non-array", () => {
  assert.throws(() => validateCompaniesList({}), /top-level must be a list/);
  assert.throws(() => validateCompaniesList("hi"), /top-level must be a list/);
});

test("validateCompaniesList — rejects duplicate (ats, slug)", () => {
  const list = [
    { ...ok, slug: "x" },
    { ...ok, slug: "x" },
  ];
  assert.throws(() => validateCompaniesList(list), /duplicate entry/);
});

test("validateCompaniesList — allows same slug across different ATS", () => {
  // Hebbia is on both Ashby and Greenhouse — needs to be representable.
  const list = [
    { ...ok, slug: "hebbia", ats: "ashby" },
    { ...ok, slug: "hebbia", ats: "greenhouse" },
  ];
  validateCompaniesList(list);
});

test("hasEntry — finds existing", () => {
  const list = [{ ...ok, slug: "eliseai", ats: "ashby" }];
  assert.equal(hasEntry(list, "ashby", "eliseai"), true);
  assert.equal(hasEntry(list, "ashby", "missing"), false);
  assert.equal(hasEntry(list, "lever", "eliseai"), false);
});

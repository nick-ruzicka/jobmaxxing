import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeCompany, companyKey } from "./normalize-company.mjs";

// --- normalizeCompany --------------------------------------------------------

test("normalizeCompany — parenthetical correction (Norminal.So)", () => {
  assert.equal(normalizeCompany("Norminal.So (Nominal)"), "Nominal");
});

test("normalizeCompany — alias hit for Norminal.So bare", () => {
  assert.equal(normalizeCompany("Norminal.So"), "Nominal");
});

test("normalizeCompany — HebbiaAI alias", () => {
  assert.equal(normalizeCompany("HebbiaAI"), "Hebbia");
});

test("normalizeCompany — OpenAI Inc → OpenAI (suffix + alias)", () => {
  assert.equal(normalizeCompany("OpenAI Inc"), "OpenAI");
});

test("normalizeCompany — OpenAI, Inc. → OpenAI (suffix + alias)", () => {
  assert.equal(normalizeCompany("OpenAI, Inc."), "OpenAI");
});

test("normalizeCompany — X.AI → xAI", () => {
  assert.equal(normalizeCompany("X.AI"), "xAI");
});

test("normalizeCompany — bare X → xAI", () => {
  assert.equal(normalizeCompany("X"), "xAI");
});

test("normalizeCompany — xAI is idempotent", () => {
  assert.equal(normalizeCompany("xAI"), "xAI");
});

test("normalizeCompany — X (formerly Twitter) → xAI via parens strip", () => {
  assert.equal(normalizeCompany("X (formerly Twitter)"), "xAI");
});

test("normalizeCompany — Acme, Inc. strips legal suffix", () => {
  assert.equal(normalizeCompany("Acme, Inc."), "Acme");
});

test("normalizeCompany — Acme LLC strips legal suffix", () => {
  assert.equal(normalizeCompany("Acme LLC"), "Acme");
});

test("normalizeCompany — Acme GmbH strips legal suffix", () => {
  assert.equal(normalizeCompany("Acme GmbH"), "Acme");
});

test("normalizeCompany — Acme Corp strips legal suffix", () => {
  assert.equal(normalizeCompany("Acme Corp"), "Acme");
});

test("normalizeCompany — Acme Corporation strips legal suffix", () => {
  assert.equal(normalizeCompany("Acme Corporation"), "Acme");
});

test("normalizeCompany — Acme Ltd strips legal suffix", () => {
  assert.equal(normalizeCompany("Acme Ltd"), "Acme");
});

test("normalizeCompany — strips trailing punctuation", () => {
  assert.equal(normalizeCompany("Acme."), "Acme");
  assert.equal(normalizeCompany("Acme!"), "Acme");
});

test("normalizeCompany — preserves untouched names", () => {
  assert.equal(normalizeCompany("Stripe"), "Stripe");
  assert.equal(normalizeCompany("Hugging Face"), "Hugging Face");
});

test("normalizeCompany — trims surrounding whitespace", () => {
  assert.equal(normalizeCompany("  Acme  "), "Acme");
});

test("normalizeCompany — collapses internal whitespace", () => {
  assert.equal(normalizeCompany("Hugging   Face"), "Hugging Face");
});

test("normalizeCompany — null/undefined/empty safe", () => {
  assert.equal(normalizeCompany(null), "");
  assert.equal(normalizeCompany(undefined), "");
  assert.equal(normalizeCompany(""), "");
  assert.equal(normalizeCompany(42), ""); // non-string
});

test("normalizeCompany — stacked suffixes (', Inc., LLC')", () => {
  assert.equal(normalizeCompany("Acme, Inc., LLC"), "Acme");
});

// --- companyKey -------------------------------------------------------------

test("companyKey — Norminal.So (Nominal) → 'nominal'", () => {
  assert.equal(companyKey("Norminal.So (Nominal)"), "nominal");
});

test("companyKey — Acme, Inc. → 'acme'", () => {
  assert.equal(companyKey("Acme, Inc."), "acme");
});

test("companyKey — X.AI → 'xai'", () => {
  assert.equal(companyKey("X.AI"), "xai");
});

test("companyKey — X (formerly Twitter) → 'xai'", () => {
  assert.equal(companyKey("X (formerly Twitter)"), "xai");
});

test("companyKey — Hugging Face → 'huggingface'", () => {
  assert.equal(companyKey("Hugging Face"), "huggingface");
});

test("companyKey — double-applied gives same answer", () => {
  const inputs = [
    "Norminal.So (Nominal)",
    "HebbiaAI",
    "OpenAI Inc",
    "X.AI",
    "X (formerly Twitter)",
    "Acme, Inc.",
    "Hugging Face",
  ];
  for (const x of inputs) {
    assert.equal(
      companyKey(normalizeCompany(x)),
      companyKey(x),
      `not stable under double-application: ${x}`,
    );
  }
});

test("companyKey — null/empty → ''", () => {
  assert.equal(companyKey(null), "");
  assert.equal(companyKey(""), "");
});

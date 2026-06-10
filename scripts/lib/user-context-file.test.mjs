import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readUserContextText, _resetUserContextWarning } from "./user-context-file.mjs";

function makeConfigDir({ real, example }) {
  const dir = mkdtempSync(path.join(tmpdir(), "uctx-"));
  if (real !== undefined) writeFileSync(path.join(dir, "user-context.yaml"), real);
  if (example !== undefined) writeFileSync(path.join(dir, "user-context.example.yaml"), example);
  return dir;
}

test("prefers the real user-context.yaml when present", () => {
  const dir = makeConfigDir({ real: "compensation:\n  floor_usd: 1\n", example: "compensation:\n  floor_usd: 2\n" });
  try {
    assert.match(readUserContextText(dir), /floor_usd: 1/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("falls back to the example when the real file is absent", () => {
  _resetUserContextWarning();
  const dir = makeConfigDir({ example: "compensation:\n  floor_usd: 2\n" });
  try {
    assert.match(readUserContextText(dir), /floor_usd: 2/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("throws when neither file exists", () => {
  const dir = makeConfigDir({});
  try {
    assert.throws(() => readUserContextText(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

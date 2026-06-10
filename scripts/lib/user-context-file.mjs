// Resolves the user-context YAML source: config/user-context.yaml when
// present, else config/user-context.example.yaml with a one-time stderr
// warning. Fresh clones only have the example (the real file is personal and
// gitignored), and scoring must still work out of the box.

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG_DIR = path.resolve(__dirname, "..", "..", "config");

let warned = false;

export function readUserContextText(configDir = DEFAULT_CONFIG_DIR) {
  const realPath = path.join(configDir, "user-context.yaml");
  if (existsSync(realPath)) return readFileSync(realPath, "utf8");
  if (!warned) {
    warned = true;
    console.error(
      "[user-context] config/user-context.yaml not found — using " +
        "user-context.example.yaml defaults. Copy the example to " +
        "config/user-context.yaml and edit it to calibrate scoring.",
    );
  }
  return readFileSync(path.join(configDir, "user-context.example.yaml"), "utf8");
}

/** Test hook — re-arms the one-time warning. */
export function _resetUserContextWarning() {
  warned = false;
}

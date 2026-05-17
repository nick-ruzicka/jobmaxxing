// GET /api/qa-reports — JSON snapshot of everything PersonaLab has written
// to disk under qa/. Same loader the /qa-reports page uses, just exposed
// over HTTP so external tools (CLI, future remote dashboards, the future
// orchestrator's status command) can read it without booting a browser.
//
// Empty qa/ subdirs don't throw — they surface as `missingDirs` so the
// caller knows the orchestrator hasn't run yet.

import { join } from "path";

import { defaultQaPaths, loadQaReportsData, type QaPaths } from "../../../lib/qa-reports";

export const dynamic = "force-dynamic";

function repoRoot(): string {
  return join(process.cwd(), "..");
}

/** Exported for the unit test — lets the test inject a temp qa/ root. */
export function buildResponse(paths: QaPaths): Response {
  const data = loadQaReportsData(paths);
  return Response.json(data);
}

export async function GET(): Promise<Response> {
  return buildResponse(defaultQaPaths(repoRoot()));
}

// POST /api/backtest — run a proposed rule against recent roles and return
// the diff table. Used by /context preferences to preview a rule change
// before applying.
//
// GET /api/backtest/proposals — list meta-scorer-generated proposals.

import { runBacktest } from "../../../../scripts/lib/backtest-engine.mjs";
import { proposeRules } from "../../../../scripts/lib/meta-scorer.mjs";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { proposedRule, sampleSize } = body || {};
    if (!proposedRule || typeof proposedRule !== "object") {
      return Response.json({ error: "proposedRule required" }, { status: 400 });
    }
    const result = runBacktest({ proposedRule, sampleSize: sampleSize ?? 30 });
    return Response.json(result);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}

export async function GET() {
  try {
    const proposals = proposeRules();
    return Response.json({ proposals });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

// Tests for the agent.tools policy resolver. effectiveToolPolicy gates each
// tool call inside runAgentLoop — these tests pin the per-tool-kind defaults
// and the explicit-yaml-override path so a future loadAgentConfig refactor
// can't silently drift them.
//
// Full chat-loop integration is blocked without Anthropic credits during
// this audit run; this unit coverage stands in for the runtime behavior
// Phase 2 Flow D wanted to exercise:
//
//   - default (no agent block in yaml) → mutating tools confirm, reads auto
//   - explicit "auto" in yaml          → mutating tool skips card
//   - explicit "deny" in yaml          → tool refused without execution
//   - explicit "confirm" in yaml       → mutating tool gated (same as default)
//
// We import effectiveToolPolicy via the chat route's module — that file also
// owns the MUTATING_TOOLS set the resolver consults. Importing a route.ts
// from a test is non-standard but Next.js allows extra exports from route
// files (we leaned on this throughout Step 7/8).

import { describe, expect, it } from "vitest";
import { effectiveToolPolicy, type AgentConfig } from "@/app/api/chat/route";

function cfg(tools: AgentConfig["tools"] = {}): AgentConfig {
  return { voice: "direct", redact: [], tools };
}

describe("effectiveToolPolicy — defaults (no yaml override)", () => {
  const empty = cfg();

  it("returns 'auto' for read tools (query_roles)", () => {
    expect(effectiveToolPolicy("query_roles", empty)).toBe("auto");
  });

  it("returns 'auto' for read tools (read_prep_doc)", () => {
    expect(effectiveToolPolicy("read_prep_doc", empty)).toBe("auto");
  });

  it("returns 'confirm' for mutating tools (update_application_status)", () => {
    expect(effectiveToolPolicy("update_application_status", empty)).toBe("confirm");
  });

  it("returns 'confirm' for mutating tools (update_score_override)", () => {
    expect(effectiveToolPolicy("update_score_override", empty)).toBe("confirm");
  });

  it("returns 'confirm' for mutating tools (update_user_context)", () => {
    expect(effectiveToolPolicy("update_user_context", empty)).toBe("confirm");
  });

  it("returns 'confirm' for triggered actions (regenerate_briefing)", () => {
    expect(effectiveToolPolicy("regenerate_briefing", empty)).toBe("confirm");
  });

  it("returns 'confirm' for triggered actions (trigger_scan)", () => {
    expect(effectiveToolPolicy("trigger_scan", empty)).toBe("confirm");
  });

  it("returns 'confirm' for triggered actions (trigger_signal_scan)", () => {
    expect(effectiveToolPolicy("trigger_signal_scan", empty)).toBe("confirm");
  });

  it("returns 'auto' for unknown tools (treats them as reads — safe-by-default-for-reads)", () => {
    // This is the documented fallback: unknown tools that aren't in
    // MUTATING_TOOLS get 'auto'. Calling an unknown tool will then fall
    // through runTool's "unknown tool" branch and the agent gets back a
    // text error — same end behavior as a forbidden tool, just routed
    // through the read-tool execution path.
    expect(effectiveToolPolicy("nonexistent_tool_xyz", empty)).toBe("auto");
  });
});

describe("effectiveToolPolicy — explicit yaml overrides", () => {
  it("'auto' override for a mutating tool wins over the default 'confirm'", () => {
    const yaml = cfg({ regenerate_briefing: "auto" });
    expect(effectiveToolPolicy("regenerate_briefing", yaml)).toBe("auto");
  });

  it("'deny' override for a mutating tool returns 'deny'", () => {
    const yaml = cfg({ update_application_status: "deny" });
    expect(effectiveToolPolicy("update_application_status", yaml)).toBe("deny");
  });

  it("'confirm' override for a read tool wins over the default 'auto'", () => {
    // The whole point of letting users gate reads too — even though they
    // can't cause data damage, the cost / preview surface might matter
    // (e.g. a future read_emails tool the user wants to approve each time).
    const yaml = cfg({ query_roles: "confirm" });
    expect(effectiveToolPolicy("query_roles", yaml)).toBe("confirm");
  });

  it("'deny' on a read tool returns 'deny' (and the loop will refuse it)", () => {
    const yaml = cfg({ query_roles: "deny" });
    expect(effectiveToolPolicy("query_roles", yaml)).toBe("deny");
  });

  it("overrides scoped to one tool don't leak to others", () => {
    const yaml = cfg({ regenerate_briefing: "auto" });
    expect(effectiveToolPolicy("regenerate_briefing", yaml)).toBe("auto");
    // Sibling triggered actions keep the default.
    expect(effectiveToolPolicy("trigger_scan", yaml)).toBe("confirm");
    expect(effectiveToolPolicy("trigger_signal_scan", yaml)).toBe("confirm");
    // Mutating tools keep the default.
    expect(effectiveToolPolicy("update_application_status", yaml)).toBe("confirm");
  });

  it("multiple overrides apply independently", () => {
    const yaml = cfg({
      regenerate_briefing: "auto",
      trigger_scan: "deny",
      update_application_status: "auto",
      query_roles: "confirm",
    });
    expect(effectiveToolPolicy("regenerate_briefing", yaml)).toBe("auto");
    expect(effectiveToolPolicy("trigger_scan", yaml)).toBe("deny");
    expect(effectiveToolPolicy("update_application_status", yaml)).toBe("auto");
    expect(effectiveToolPolicy("query_roles", yaml)).toBe("confirm");
    // Untouched defaults still apply.
    expect(effectiveToolPolicy("trigger_signal_scan", yaml)).toBe("confirm");
    expect(effectiveToolPolicy("read_prep_doc", yaml)).toBe("auto");
  });
});

/**
 * POST /api/chat/respond-to-tool
 *
 * Resumes the chat agent loop after the user has confirmed or cancelled a
 * mutating tool call. The paired pause-point lives in
 * dashboard-web/app/api/chat/route.ts:runAgentLoop — when that loop hits a
 * confirmation-required tool it writes data/chats/<date>.pending.json and
 * emits a `tool_request` SSE event. This endpoint thaws that state, applies
 * the user's decision, and continues the loop on a fresh SSE stream.
 *
 * Body:
 *   {
 *     date: "YYYY-MM-DD",           // keys data/chats/<date>.pending.json
 *     tool_call_id?: string,        // optional safety check vs. pending state
 *     action: "confirm" | "cancel",
 *     reason?: string               // surfaced in the synthetic tool_result on cancel
 *   }
 *
 * Behavior:
 *   1. Load pending state. If absent → 404 no_pending_tool.
 *   2. Build the tool_result block:
 *        - confirm: run executeMutatingTool() against the persisted pending
 *          tool call. The chat-UI confirmation counts as confirmed_bulk for
 *          the underlying endpoint; we always pass that flag through.
 *        - cancel: synthesize a "[user declined; reason: …]" tool_result so
 *          the agent knows the user said no and can respond accordingly.
 *   3. Append the synthetic user turn (tool_result block) to convo.
 *   4. Open a new upstream Claude stream with the extended convo.
 *   5. Delete the pending state file (we've committed to resuming).
 *   6. Stream the next agent loop iterations to the client.
 *
 * Returns:
 *   200 SSE — delta / tool_request (if another mutation follows) / done / error
 *   400 invalid_json / invalid_date / invalid_action / tool_call_id_mismatch
 *   402 credits_exhausted (matches /api/chat semantics)
 *   404 no_pending_tool
 *   500 claude_failed / unknown
 */

import {
  AGENT_TOOLS,
  type AgentMessage,
  deletePendingFile,
  executeMutatingTool,
  openClaudeStream,
  readChatFile,
  readPendingFile,
  runAgentLoop,
} from "../route";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: {
    date?: string;
    tool_call_id?: string;
    action?: "confirm" | "cancel";
    reason?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const date = body.date;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json(
      { error: "invalid_date", message: "Expected date in YYYY-MM-DD." },
      { status: 400 },
    );
  }

  const action = body.action;
  if (action !== "confirm" && action !== "cancel") {
    return Response.json(
      { error: "invalid_action", message: "action must be 'confirm' or 'cancel'." },
      { status: 400 },
    );
  }

  const pending = readPendingFile(date);
  if (!pending) {
    return Response.json(
      {
        error: "no_pending_tool",
        message:
          "No pending tool confirmation for this date. The pause may have been superseded by a fresh user message, or the chat panel is out of sync.",
      },
      { status: 404 },
    );
  }

  // Optional but-cheap safety check: if the client passed the tool_call_id
  // we expect from the pending state, verify it matches. Catches stale UI
  // (clicking a confirmation card after a refresh raced with a new turn).
  if (body.tool_call_id && body.tool_call_id !== pending.pending_tool.id) {
    return Response.json(
      {
        error: "tool_call_id_mismatch",
        message: "Pending tool id doesn't match the one supplied.",
        expected: pending.pending_tool.id,
      },
      { status: 400 },
    );
  }

  const file = readChatFile(date);

  // Stream EVERYTHING from here on — including tool execution itself. We
  // open the SSE response immediately so tools that stream progress
  // (regenerate_briefing's ~30s sync-block) can reach the client live.
  // Errors that used to be JSON 402 / 500 now arrive as SSE error events.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      function send(payload: unknown) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      }

      // ── Phase 1: execute the pending tool (or build a decline result) ──
      let toolResultContent: string;
      if (action === "confirm") {
        try {
          toolResultContent = await executeMutatingTool(
            {
              id: pending.pending_tool.id,
              name: pending.pending_tool.name,
              input: pending.pending_tool.input,
            },
            // Forward script progress events to the chat client as
            // tool_progress SSE events. The progress widget in
            // AgentChatPanel renders these live; tools that don't stream
            // (status/override/user-context/scan kickoffs) never call this.
            (event) => {
              send({ type: "tool_progress", id: pending.pending_tool.id, event });
            },
          );
        } catch (err) {
          // executeMutatingTool catches its own errors and returns text,
          // but a programming error (bad import, etc.) could still throw.
          // Surface as a tool_result with the failure baked in so the agent
          // can apologize cleanly, then continue the loop.
          toolResultContent = `[mutating tool error: ${err instanceof Error ? err.message : "unknown"}]`;
        }
      } else {
        const reason = body.reason?.trim() || "no reason given";
        toolResultContent = `[user declined this mutation; reason: ${reason}]`;
      }

      // Tell the client the pending call resolved. Comes after the tool
      // execution so the order in the stream is:
      //   tool_progress* → tool_resolved → delta* → done
      send({
        type: "tool_resolved",
        id: pending.pending_tool.id,
        action,
        result_preview: toolResultContent.slice(0, 500),
      });

      // Append the synthetic user turn (tool_result block) to the persisted
      // convo so the upstream call sees the resolved tool call.
      const convo: AgentMessage[] = pending.convo.slice();
      convo.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: pending.pending_tool.id,
            content: toolResultContent,
          },
        ],
      });

      // ── Phase 2: open the resume stream from Claude ──
      // Errors here used to be JSON 402/500; now SSE error events because
      // we've already committed to a streaming response.
      let upstream: Response;
      try {
        upstream = await openClaudeStream({
          systemText: pending.system_text,
          messages: convo,
          tools: AGENT_TOOLS,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown";
        if (msg.includes("CREDITS_EXHAUSTED")) {
          send({
            type: "error",
            error: "credits_exhausted",
            message:
              "Anthropic API credits are exhausted. Top up to continue: https://console.anthropic.com/settings/billing",
            topUpUrl: "https://console.anthropic.com/settings/billing",
          });
        } else {
          send({ type: "error", error: "claude_failed", message: msg });
        }
        controller.close();
        return;
      }

      // Pending state has done its job — clear it before streaming. If the
      // resume itself hits a NEW confirmation gate, runAgentLoop will write
      // a fresh pending file with the updated state.
      deletePendingFile(date);

      try {
        await runAgentLoop(
          {
            date,
            file,
            systemText: pending.system_text,
            convo,
            initialUpstream: upstream,
            startRound: pending.next_round,
            initialAssistantText: pending.text_so_far,
            initialToolRounds: pending.tool_rounds,
            initialUsage: pending.usage,
            totalEst: pending.total_est,
          },
          send,
        );
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "stream failed";
        send({ type: "error", message: errMsg });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

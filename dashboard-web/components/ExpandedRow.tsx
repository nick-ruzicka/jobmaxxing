"use client";

import { useState } from "react";
import {
  ExternalLink, Globe, Calendar, MapPin, Save,
  Wrench, AlertTriangle, CheckCircle2, Building, Users,
} from "lucide-react";
import type { Role, RoleStatus } from "@/lib/types";
import { StatusDropdown } from "./StatusDropdown";

interface ExpandedRowProps {
  role: Role;
  onStatusChange: (url: string, status: RoleStatus) => void;
  onNotesChange: (url: string, notes: string) => void;
}

export function ExpandedRow({ role, onStatusChange, onNotesChange }: ExpandedRowProps) {
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesDraft, setNotesDraft] = useState(role.notes || "");
  const e = role.enrichment;

  return (
    <tr>
      <td colSpan={10} style={{ background: "var(--surface-1)", borderBottom: "1px solid var(--border-subtle)" }} className="px-0">
        <div className="animate-expand-in px-8 py-4 space-y-4">
          {/* Verdict */}
          {e?.verdict && (
            <div
              className="rounded-lg px-4 py-3"
              style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)" }}
            >
              <p className="text-[13px] leading-relaxed" style={{ color: "var(--text-primary)" }}>{e.verdict}</p>
            </div>
          )}

          {/* Enrichment grid */}
          {e && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2.5">
                {e.comp_range && e.comp_range !== "Not listed" && (
                  <Detail icon={<MapPin size={13} />} label="Comp" value={e.comp_range} />
                )}
                {e.team_context && (
                  <Detail icon={<Users size={13} />} label="Team" value={e.team_context} />
                )}
                {e.company_stage && (
                  <Detail icon={<Building size={13} />} label="Stage" value={e.company_stage} />
                )}
                {e.stack && e.stack.length > 0 && (
                  <div className="flex items-start gap-2 text-[13px]">
                    <Wrench size={13} style={{ color: "var(--text-muted)" }} className="mt-0.5 shrink-0" />
                    <div className="flex flex-wrap gap-1">
                      {e.stack.map((t) => (
                        <span
                          key={t}
                          className="rounded-md px-1.5 py-0.5 text-[11px]"
                          style={{ background: "var(--surface-3)", color: "var(--text-secondary)", border: "1px solid var(--border-subtle)" }}
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-3 text-[11px] pt-1">
                  {e.build_component === true && (
                    <span className="flex items-center gap-1" style={{ color: "var(--emerald)" }}>
                      <CheckCircle2 size={11} /> Build component
                    </span>
                  )}
                  {e.ai_signal === true && (
                    <span className="flex items-center gap-1" style={{ color: "var(--emerald)" }}>
                      <CheckCircle2 size={11} /> AI signal
                    </span>
                  )}
                  {e.build_component === false && (
                    <span className="flex items-center gap-1" style={{ color: "var(--amber)" }}>
                      <AlertTriangle size={11} /> No build component
                    </span>
                  )}
                </div>
              </div>

              <div className="space-y-3">
                {e.green_flags && e.green_flags.length > 0 && (
                  <div>
                    <span className="text-[11px] font-medium" style={{ color: "var(--emerald)" }}>Green flags</span>
                    <ul className="mt-1 space-y-0.5">
                      {e.green_flags.map((f, i) => (
                        <li key={i} className="flex items-start gap-1.5 text-[12px]" style={{ color: "var(--text-secondary)" }}>
                          <CheckCircle2 size={10} style={{ color: "rgba(52,211,153,0.5)" }} className="mt-0.5 shrink-0" />
                          {f}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {e.red_flags && e.red_flags.length > 0 && (
                  <div>
                    <span className="text-[11px] font-medium" style={{ color: "var(--red)" }}>Red flags</span>
                    <ul className="mt-1 space-y-0.5">
                      {e.red_flags.map((f, i) => (
                        <li key={i} className="flex items-start gap-1.5 text-[12px]" style={{ color: "var(--text-secondary)" }}>
                          <AlertTriangle size={10} style={{ color: "rgba(248,113,113,0.5)" }} className="mt-0.5 shrink-0" />
                          {f}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Non-enriched fallback */}
          {!e && (
            <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-[13px]">
              <Detail icon={<Globe size={13} />} label="Source" value={role.source} />
              <Detail icon={<Calendar size={13} />} label="Found" value={role.firstSeen} />
              {role.matchReason && (
                <div className="col-span-2 text-[12px]" style={{ color: "var(--text-tertiary)" }}>
                  Score signals: {role.matchReason}
                </div>
              )}
            </div>
          )}

          {/* Score provenance */}
          <div className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
            <span style={{ color: "var(--text-muted)" }}>Score {role.score}/10 — </span>
            {role.scoreProvenance === "enriched" && "from Claude JD analysis"}
            {role.scoreProvenance === "application" && "from the application tracker"}
            {role.scoreProvenance === "heuristic" && "from title/location heuristic; JD not analyzed by Claude"}
            {role.scoreCapped && " · heuristic score capped at 7"}
          </div>

          {/* Unknown company hint */}
          {role.company === "Unknown" && (
            <div
              className="rounded-lg px-3 py-1.5 text-[11px] break-all"
              style={{ background: "var(--amber-dim)", border: "1px solid rgba(251,191,36,0.15)", color: "var(--text-tertiary)" }}
            >
              <span style={{ color: "var(--amber)" }}>Source: </span>{role.url}
            </div>
          )}

          {/* Notes + Actions */}
          <div className="flex gap-4 pt-3" style={{ borderTop: "1px solid var(--border-subtle)" }}>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>Notes</span>
                {!editingNotes && (
                  <button
                    onClick={() => { setNotesDraft(role.notes || ""); setEditingNotes(true); }}
                    className="text-[11px]"
                    style={{ color: "var(--accent)" }}
                  >
                    {role.notes ? "Edit" : "Add notes"}
                  </button>
                )}
              </div>
              {editingNotes ? (
                <div className="space-y-2">
                  <textarea
                    value={notesDraft}
                    onChange={(ev) => setNotesDraft(ev.target.value)}
                    rows={3}
                    className="w-full rounded-lg px-3 py-2 text-[13px] focus:outline-none resize-none"
                    style={{
                      background: "var(--surface-2)",
                      border: "1px solid var(--border-default)",
                      color: "var(--text-secondary)",
                    }}
                    placeholder="Comp intel, interview notes, red flags..."
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => { onNotesChange(role.url, notesDraft); setEditingNotes(false); }}
                      className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-medium text-white"
                      style={{ background: "var(--accent-strong)" }}
                    >
                      <Save size={11} /> Save
                    </button>
                    <button
                      onClick={() => setEditingNotes(false)}
                      className="rounded-md px-3 py-1.5 text-[11px]"
                      style={{ color: "var(--text-tertiary)" }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : role.notes ? (
                <p className="text-[13px] leading-relaxed whitespace-pre-wrap" style={{ color: "var(--text-secondary)" }}>{role.notes}</p>
              ) : (
                <p className="text-[12px] italic" style={{ color: "var(--text-muted)" }}>No notes yet</p>
              )}
            </div>
            <div className="flex flex-col items-end gap-2 shrink-0 pt-5">
              <StatusDropdown value={role.status} onChange={(s) => onStatusChange(role.url, s)} />
              <a
                href={role.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-medium text-white transition-colors"
                style={{ background: "var(--accent-strong)" }}
              >
                <ExternalLink size={11} /> View Posting
              </a>
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
}

function Detail({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 text-[13px]">
      <span style={{ color: "var(--text-muted)" }}>{icon}</span>
      <span style={{ color: "var(--text-muted)" }} className="w-14">{label}</span>
      <span style={{ color: "var(--text-secondary)" }}>{value}</span>
    </div>
  );
}

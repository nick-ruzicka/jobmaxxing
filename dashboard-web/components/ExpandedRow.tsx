"use client";

import { useState } from "react";
import {
  ExternalLink, Globe, Calendar, MapPin, Save,
  Wrench, AlertTriangle, CheckCircle2, Building, Users, RotateCcw,
} from "lucide-react";
import type { Role, RoleStatus } from "@/lib/types";
import { StatusDropdown } from "./StatusDropdown";
import { Badge, Button } from "@/components/ui";

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
      <td colSpan={10} className="border-b border-border-subtle bg-surface-1 px-0">
        <div className="animate-expand-in space-y-4 px-8 py-4">
          {/* Verdict */}
          {e?.verdict && (
            <div className="rounded-lg border border-border-subtle bg-surface-2 px-4 py-3">
              <p className="text-[13px] leading-relaxed text-text-primary">{e.verdict}</p>
            </div>
          )}

          {/* Enrichment grid */}
          {e && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2.5">
                {e.comp_range && e.comp_range !== "Not listed" && (
                  <Detail icon={<MapPin size={13} />} label="Comp" value={e.comp_range} />
                )}
                {e.team_context && <Detail icon={<Users size={13} />} label="Team" value={e.team_context} />}
                {e.company_stage && <Detail icon={<Building size={13} />} label="Stage" value={e.company_stage} />}
                {e.stack && e.stack.length > 0 && (
                  <div className="flex items-start gap-2 text-[13px]">
                    <Wrench size={13} className="mt-0.5 shrink-0 text-text-muted" />
                    <div className="flex flex-wrap gap-1">
                      {e.stack.map((t) => (
                        <Badge key={t} color="neutral">{t}</Badge>
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-3 pt-1 text-[11px]">
                  {e.build_component === true && <Badge variant="dot" color="emerald">Build component</Badge>}
                  {e.ai_signal === true && <Badge variant="dot" color="emerald">AI signal</Badge>}
                  {e.build_component === false && <Badge variant="dot" color="amber">No build component</Badge>}
                </div>
              </div>

              <div className="space-y-3">
                {e.green_flags && e.green_flags.length > 0 && (
                  <div>
                    <span className="text-[11px] font-medium text-emerald">Green flags</span>
                    <ul className="mt-1 space-y-0.5">
                      {e.green_flags.map((f, i) => (
                        <li key={i} className="flex items-start gap-1.5 text-[12px] text-text-secondary">
                          <CheckCircle2 size={10} className="mt-0.5 shrink-0 text-emerald" />
                          {f}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {e.red_flags && e.red_flags.length > 0 && (
                  <div>
                    <span className="text-[11px] font-medium text-red">Red flags</span>
                    <ul className="mt-1 space-y-0.5">
                      {e.red_flags.map((f, i) => (
                        <li key={i} className="flex items-start gap-1.5 text-[12px] text-text-secondary">
                          <AlertTriangle size={10} className="mt-0.5 shrink-0 text-red" />
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
                <div className="col-span-2 text-[12px] text-text-tertiary">Score signals: {role.matchReason}</div>
              )}
            </div>
          )}

          {/* Score provenance */}
          <div className="text-[11px] text-text-tertiary">
            <span className="text-text-muted">Score {role.score}/10 — </span>
            {role.scoreProvenance === "override" &&
              "set manually" + (role.scoreOverrideReason ? `: ${role.scoreOverrideReason}` : "")}
            {role.scoreProvenance === "enriched" && "from Claude + G4 adjustment layer"}
            {role.scoreProvenance === "enriched_base_only" && "from Claude (engine base only — no G4 adjustments)"}
            {role.scoreProvenance === "enriched_raw_claude" && "from Claude verdict (pre-G4 record — no adjustment layer)"}
            {role.scoreProvenance === "application" && "from the application tracker"}
            {role.scoreProvenance === "heuristic" && "from a title/location heuristic; JD not analyzed by Claude"}
            {role.scoreCapped && " · heuristic score capped"}
          </div>

          {/* Unknown company hint */}
          {role.company === "Unknown" && (
            <div className="break-all rounded-lg border border-amber-border bg-amber-dim px-3 py-1.5 text-[11px] text-text-tertiary">
              <span className="text-amber">Source: </span>{role.url}
            </div>
          )}

          {/* Notes + Actions */}
          <div className="flex gap-4 border-t border-border-subtle pt-3">
            <div className="min-w-0 flex-1">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[11px] font-medium text-text-muted">Notes</span>
                {!editingNotes && (
                  <button
                    type="button"
                    onClick={() => { setNotesDraft(role.notes || ""); setEditingNotes(true); }}
                    className="text-[11px] text-accent transition-colors hover:underline"
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
                    className="w-full resize-none rounded-md border border-border-default bg-surface-2 px-3 py-2 text-[13px] text-text-secondary placeholder:text-text-muted"
                    placeholder="Comp intel, interview notes, red flags…"
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => { onNotesChange(role.url, notesDraft); setEditingNotes(false); }}
                    >
                      <Save size={11} /> Save
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setEditingNotes(false)}>Cancel</Button>
                  </div>
                </div>
              ) : role.notes ? (
                <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-text-secondary">{role.notes}</p>
              ) : (
                <p className="text-[12px] italic text-text-muted">No notes yet</p>
              )}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-2">
              <StatusDropdown value={role.status} onChange={(s) => onStatusChange(role.url, s)} />
              {(role.status === "Skipped" || role.status === "Rejected") && (
                <Button
                  variant="secondary"
                  size="sm"
                  data-action="pipeline:restore_role"
                  onClick={() => onStatusChange(role.url, "Discovered")}
                >
                  <RotateCcw size={11} /> Restore
                </Button>
              )}
              <a
                href={role.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md bg-accent-strong px-3 py-1.5 text-[11px] font-medium text-white transition-[filter] hover:brightness-110"
              >
                <ExternalLink size={11} /> View posting
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
      <span className="text-text-muted">{icon}</span>
      <span className="w-14 text-text-muted">{label}</span>
      <span className="text-text-secondary">{value}</span>
    </div>
  );
}

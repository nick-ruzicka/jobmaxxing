"use client";

import { useState, useCallback } from "react";
import {
  Mic,
  ChevronDown,
  ChevronRight,
  BookOpen,
  Target,
  MessageSquare,
  HelpCircle,
  AlertTriangle,
  DollarSign,
  Briefcase,
  ExternalLink,
  StickyNote,
  Save,
  Loader2,
  Sparkles,
} from "lucide-react";
import type { Role } from "@/lib/types";
import type { InterviewPrep } from "@/lib/data";
import { Shell } from "@/components/Shell";

interface InterviewsPageProps {
  preps: InterviewPrep[];
  storyBank: string;
  interviewRoles: Role[];
  interviewCount: number;
  activePursuing: number;
  highConviction: number;
  companyCount: number;
  signalCount: number;
  hasWarmLeads: boolean;
}

function MeetingNotesBox({ slug, initialNotes }: { slug: string; initialNotes: string }) {
  const [notes, setNotes] = useState(initialNotes);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [processOutput, setProcessOutput] = useState("");

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaved(false);
    try {
      await fetch("/api/save-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, notes }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // silent fail
    } finally {
      setSaving(false);
    }
  }, [slug, notes]);

  const handleProcess = useCallback(async () => {
    // Save first, then process
    await fetch("/api/save-notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, notes }),
    });

    setProcessing(true);
    setProcessOutput("Sending to Opus 4.6... this takes 30-90 seconds.");

    try {
      const res = await fetch("/api/process-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug }),
      });

      const data = await res.json();
      if (data.ok) {
        setProcessOutput(data.message + " Reloading...");
        setTimeout(() => window.location.reload(), 1500);
      } else {
        const msg = data.message || data.error || "Unknown error";
        const preview = data.preview ? `\n\nPreview: ${data.preview}` : "";
        setProcessOutput(msg + preview);
      }
    } catch (err) {
      setProcessOutput(`Error: ${err instanceof Error ? err.message : "unknown"}`);
    } finally {
      setProcessing(false);
    }
  }, [slug, notes]);

  return (
    <div className="border-b border-[var(--border-subtle)] px-4 py-3">
      <div className="flex items-center gap-2 mb-2">
        <StickyNote size={14} className="text-violet-400" />
        <span className="text-xs font-medium  text-[var(--text-muted)]">
          Meeting Notes
        </span>
        <span className="text-[10px] text-[var(--text-muted)] ml-1">
          Paste Granola notes, recruiter intel, comp conversations
        </span>
      </div>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Paste meeting notes here... recruiter screen details, comp discussions, interviewer names, anything useful for prep."
        rows={4}
        className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--text-secondary)] placeholder:text-[var(--text-muted)] focus:border-indigo-500/30 focus:outline-none resize-y"
      />
      <div className="flex items-center gap-2 mt-2">
        <button
          onClick={handleSave}
          disabled={saving || processing}
          className="flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-2)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:border-indigo-500/30 transition-colors disabled:opacity-50"
        >
          {saving ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Save size={12} />
          )}
          {saving ? "Saving..." : "Save Notes"}
        </button>
        <button
          onClick={handleProcess}
          disabled={processing || !notes.trim()}
          className="flex items-center gap-1.5 rounded-md bg-violet-500/15 border border-violet-500/20 px-3 py-1.5 text-xs text-violet-400 hover:bg-violet-500/25 transition-colors disabled:opacity-50"
        >
          {processing ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Sparkles size={12} />
          )}
          {processing ? "Enhancing with Opus..." : "Enhance Prep with Notes"}
        </button>
        {saved && (
          <span className="text-xs text-emerald-400">Saved to prep doc</span>
        )}
      </div>
      {processOutput && (
        <pre className="mt-2 max-h-40 overflow-y-auto rounded-md bg-[var(--surface-1)] border border-[var(--border-subtle)] p-2 text-[11px] text-[var(--text-muted)] font-mono whitespace-pre-wrap">
          {processOutput.slice(-500)}
        </pre>
      )}
    </div>
  );
}

function GeneratePrepButton({
  company,
  role,
  url,
}: {
  company: string;
  role: string;
  url?: string;
}) {
  const [generating, setGenerating] = useState(false);
  const [output, setOutput] = useState("");

  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    setOutput("");

    try {
      const res = await fetch("/api/generate-prep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company, role, url }),
      });

      if (!res.body) {
        setOutput("Error: no response");
        setGenerating(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        setOutput((prev) => prev + decoder.decode(value));
      }
    } catch (err) {
      setOutput(`Error: ${err instanceof Error ? err.message : "unknown"}`);
    } finally {
      setGenerating(false);
    }
  }, [company, role, url]);

  return (
    <div>
      <button
        onClick={handleGenerate}
        disabled={generating}
        className="flex items-center gap-1.5 rounded-md bg-indigo-500/15 border border-indigo-500/20 px-3 py-1.5 text-xs text-indigo-400 hover:bg-indigo-500/25 transition-colors disabled:opacity-50"
      >
        {generating ? (
          <Loader2 size={12} className="animate-spin" />
        ) : (
          <Sparkles size={12} />
        )}
        {generating ? "Generating..." : "Generate Prep Doc"}
      </button>
      {output && (
        <pre className="mt-2 max-h-32 overflow-y-auto rounded-md bg-[var(--surface-1)] border border-[var(--border-subtle)] p-2 text-[11px] text-[var(--text-muted)] font-mono">
          {output}
        </pre>
      )}
    </div>
  );
}

const SECTION_ICONS: Record<string, React.ReactNode> = {
  "Company Quick Brief": <Briefcase size={14} className="text-indigo-400" />,
  "Why This Role Fits You": <Target size={14} className="text-emerald-400" />,
  "STAR+R Stories Ready to Deploy": <BookOpen size={14} className="text-amber-400" />,
  "Questions THEY Will Ask You": <MessageSquare size={14} className="text-sky-400" />,
  "Questions YOU Should Ask Them": <HelpCircle size={14} className="text-violet-400" />,
  "Red Flag Watch": <AlertTriangle size={14} className="text-red-400" />,
  "Salary Negotiation Prep": <DollarSign size={14} className="text-emerald-400" />,
  "Pre-Interview Checklist": <Target size={14} className="text-amber-400" />,
  "Meeting Notes": <StickyNote size={14} className="text-violet-400" />,
};

function getIcon(heading: string) {
  for (const [key, icon] of Object.entries(SECTION_ICONS)) {
    if (heading.includes(key)) return icon;
  }
  return <ChevronRight size={14} className="text-[var(--text-muted)]" />;
}

function PrepSection({
  heading,
  content,
  defaultOpen,
}: {
  heading: string;
  content: string;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-[var(--border-subtle)] last:border-b-0">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-[var(--surface-3)]/50 transition-colors"
      >
        {getIcon(heading)}
        <span className="flex-1 text-sm font-medium text-[var(--text-primary)]">
          {heading}
        </span>
        {open ? (
          <ChevronDown size={14} className="text-[var(--text-muted)]" />
        ) : (
          <ChevronRight size={14} className="text-[var(--text-muted)]" />
        )}
      </button>
      {open && (
        <div className="px-4 pb-4 text-sm text-[var(--text-tertiary)] leading-relaxed whitespace-pre-wrap">
          {renderMarkdown(content)}
        </div>
      )}
    </div>
  );
}

function highlightRecruiterTags(text: string): React.ReactNode {
  // Split on recruiter/meeting notes markers and highlight them
  const parts = text.split(/(\(per (?:recruiter|meeting notes)\))/gi);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    /^\(per (?:recruiter|meeting notes)\)$/i.test(part) ? (
      <span
        key={i}
        className="inline-flex items-center rounded bg-violet-500/15 border border-violet-500/20 px-1.5 py-0 text-[10px] font-medium text-violet-400 ml-1"
      >
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

function renderMarkdown(text: string) {
  // Simple markdown rendering for interview prep content
  return text.split("\n").map((line, i) => {
    // Headers (### level)
    if (line.startsWith("### ")) {
      return (
        <h3 key={i} className="mt-4 mb-1 text-sm font-semibold text-[var(--text-primary)]">
          {line.slice(4)}
        </h3>
      );
    }
    // Bold text
    if (line.startsWith("**") && line.includes(":**")) {
      const [label, ...rest] = line.split(":**");
      return (
        <p key={i} className="mt-1">
          <span className="font-medium text-[var(--text-secondary)]">
            {label.replace(/^\*\*/, "")}:
          </span>{" "}
          <span>{rest.join(":**").replace(/\*\*/g, "")}</span>
        </p>
      );
    }
    // Blockquotes
    if (line.startsWith("> ")) {
      return (
        <blockquote
          key={i}
          className="mt-1 border-l-2 border-indigo-500/30 pl-3 italic text-[var(--text-muted)]"
        >
          {line.slice(2).replace(/"/g, "")}
        </blockquote>
      );
    }
    // List items
    if (line.startsWith("- ")) {
      return (
        <li key={i} className="ml-4 mt-0.5 list-disc">
          {highlightRecruiterTags(line.slice(2).replace(/\*\*/g, ""))}
        </li>
      );
    }
    // Numbered items
    const numMatch = line.match(/^(\d+)\.\s+/);
    if (numMatch) {
      return (
        <li key={i} className="ml-4 mt-0.5 list-decimal">
          {line.slice(numMatch[0].length).replace(/\*\*/g, "")}
        </li>
      );
    }
    // Checkbox items
    if (line.startsWith("- [ ] ") || line.startsWith("- [x] ")) {
      const checked = line.startsWith("- [x] ");
      return (
        <label key={i} className="flex items-center gap-2 mt-1 ml-2">
          <input
            type="checkbox"
            defaultChecked={checked}
            className="rounded border-[var(--border-subtle)] bg-[var(--surface-1)]"
          />
          <span className={checked ? "line-through text-[var(--text-muted)]" : ""}>
            {line.slice(6)}
          </span>
        </label>
      );
    }
    // Table rows (display as key-value)
    if (line.startsWith("| **") && line.includes("|")) {
      const cols = line
        .split("|")
        .map((c) => c.trim())
        .filter(Boolean);
      if (cols.length >= 2) {
        return (
          <div key={i} className="mt-1 flex gap-2">
            <span className="font-medium text-[var(--text-secondary)] min-w-[80px]">
              {cols[0].replace(/\*\*/g, "")}
            </span>
            <span className="flex-1">{cols[1]}</span>
          </div>
        );
      }
    }
    // Empty line
    if (line.trim() === "" || line.startsWith("| Element") || line.startsWith("|--")) {
      return null;
    }
    // Regular paragraph
    return line.trim() ? (
      <p key={i} className="mt-1">
        {highlightRecruiterTags(line.replace(/\*\*/g, ""))}
      </p>
    ) : null;
  });
}

export function InterviewsPage({
  preps,
  storyBank,
  interviewRoles,
  interviewCount,
  activePursuing,
  highConviction,
  companyCount,
  signalCount,
  hasWarmLeads,
}: InterviewsPageProps) {
  const [selectedPrep, setSelectedPrep] = useState<string | null>(
    preps.length > 0 ? preps[0].slug : null
  );
  const [showStoryBank, setShowStoryBank] = useState(false);

  const currentPrep = preps.find((p) => p.slug === selectedPrep);

  // Sections to show expanded by default
  const prioritySections = [
    "Why This Role Fits You",
    "Questions THEY Will Ask You",
    "Pre-Interview Checklist",
  ];

  return (
    <Shell
      activePursuing={activePursuing}
      highConviction={highConviction}
      companyCount={companyCount}
      signalCount={signalCount}
      hasWarmLeads={hasWarmLeads}
    >
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <Mic size={20} className="text-indigo-400" />
            Interview Prep
          </h1>
          <div className="flex items-center gap-4 text-xs text-[var(--text-muted)]">
            <span>{interviewCount} active interview{interviewCount !== 1 ? "s" : ""}</span>
            <span>{preps.length} prep doc{preps.length !== 1 ? "s" : ""}</span>
          </div>
        </div>

        {/* Interview roles without prep docs */}
        {interviewRoles.filter((r) => !preps.some((p) => p.company.toLowerCase() === r.company.toLowerCase())).length > 0 && (
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3">
            <div className="text-xs font-medium text-amber-400 mb-2">Needs prep doc</div>
            {interviewRoles
              .filter((r) => !preps.some((p) => p.company.toLowerCase() === r.company.toLowerCase()))
              .map((r) => (
                <div key={r.id} className="flex items-center justify-between py-1">
                  <span className="text-sm text-[var(--text-tertiary)]">
                    {r.company} — {r.title}
                  </span>
                  <GeneratePrepButton
                    company={r.company}
                    role={r.title}
                    url={r.url}
                  />
                </div>
              ))}
          </div>
        )}

        {preps.length === 0 ? (
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] p-8 text-center">
            <Mic size={32} className="mx-auto mb-3 text-[var(--text-muted)]" />
            <p className="text-sm text-[var(--text-muted)]">
              No interview prep docs yet. Run{" "}
              <code className="rounded bg-[var(--border-subtle)] px-1.5 py-0.5 text-xs text-indigo-400">
                /career-ops
              </code>{" "}
              with a role to generate one.
            </p>
          </div>
        ) : (
          <div className="flex gap-6">
            {/* Sidebar — prep doc list */}
            <div className="w-56 flex-shrink-0 space-y-2">
              {preps.map((p) => (
                <button
                  key={p.slug}
                  onClick={() => {
                    setSelectedPrep(p.slug);
                    setShowStoryBank(false);
                  }}
                  className={`flex w-full flex-col items-start rounded-lg border px-3 py-2.5 text-left transition-colors ${
                    selectedPrep === p.slug && !showStoryBank
                      ? "border-indigo-500/30 bg-indigo-500/10"
                      : "border-[var(--border-subtle)] bg-[var(--surface-2)] hover:border-[#2e2e3e]"
                  }`}
                >
                  <span className="text-sm font-medium text-[var(--text-primary)]">
                    {p.company}
                  </span>
                  <span className="text-xs text-[var(--text-muted)] truncate w-full">
                    {p.role}
                  </span>
                </button>
              ))}

              {/* Story Bank */}
              {storyBank && (
                <button
                  onClick={() => {
                    setShowStoryBank(true);
                    setSelectedPrep(null);
                  }}
                  className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                    showStoryBank
                      ? "border-amber-500/30 bg-amber-500/10"
                      : "border-[var(--border-subtle)] bg-[var(--surface-2)] hover:border-[#2e2e3e]"
                  }`}
                >
                  <BookOpen size={14} className="text-amber-400" />
                  <span className="text-sm font-medium text-[var(--text-primary)]">
                    Story Bank
                  </span>
                </button>
              )}
            </div>

            {/* Main content */}
            <div className="flex-1 min-w-0">
              {showStoryBank ? (
                <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)]">
                  <div className="border-b border-[var(--border-subtle)] px-4 py-3 flex items-center gap-2">
                    <BookOpen size={16} className="text-amber-400" />
                    <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                      Story Bank
                    </h2>
                    <span className="text-xs text-[var(--text-muted)] ml-auto">
                      Reusable STAR+R stories across all interviews
                    </span>
                  </div>
                  <div className="p-4 text-sm text-[var(--text-tertiary)] leading-relaxed whitespace-pre-wrap">
                    {renderMarkdown(storyBank)}
                  </div>
                </div>
              ) : currentPrep ? (
                <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)]">
                  {/* Prep header */}
                  <div className="border-b border-[var(--border-subtle)] px-4 py-3">
                    <div className="flex items-center justify-between">
                      <h2 className="text-base font-semibold text-[var(--text-primary)]">
                        {currentPrep.company} — {currentPrep.role}
                      </h2>
                      {currentPrep.content.match(/\*\*URL:\*\*\s*(.+)/)?.[1] && (
                        <a
                          href={currentPrep.content.match(/\*\*URL:\*\*\s*(.+)/)?.[1]?.trim()}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300"
                        >
                          <ExternalLink size={12} />
                          View JD
                        </a>
                      )}
                    </div>
                    {/* Extract status line */}
                    <div className="mt-1 flex items-center gap-3">
                      {currentPrep.content.match(/\*\*Status:\*\*\s*(.+)/)?.[1] && (
                        <span className="text-xs text-amber-400">
                          {currentPrep.content.match(/\*\*Status:\*\*\s*(.+)/)?.[1]?.trim()}
                        </span>
                      )}
                      {currentPrep.content.match(/\*\*Enhanced:\*\*\s*(.+)/)?.[1] && (
                        <span className="flex items-center gap-1 text-[10px] text-violet-400 bg-violet-500/10 border border-violet-500/20 rounded px-1.5 py-0.5">
                          <Sparkles size={10} />
                          Enhanced {currentPrep.content.match(/\*\*Enhanced:\*\*\s*(.+)/)?.[1]?.trim()}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Meeting notes input */}
                  <MeetingNotesBox
                    slug={currentPrep.slug}
                    initialNotes={
                      currentPrep.sections.find((s) => s.heading === "Meeting Notes")?.content || ""
                    }
                  />

                  {/* Collapsible sections */}
                  <div>
                    {currentPrep.sections
                      .filter((s) => s.heading !== "Meeting Notes")
                      .map((section, i) => (
                        <PrepSection
                          key={i}
                          heading={section.heading}
                          content={section.content}
                          defaultOpen={prioritySections.some((ps) =>
                            section.heading.includes(ps)
                          )}
                        />
                      ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </Shell>
  );
}

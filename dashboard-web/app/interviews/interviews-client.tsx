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
import { PageHeader, SectionLabel, Badge, Button, EmptyState } from "@/components/ui";

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
    await fetch("/api/save-notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, notes }),
    });

    setProcessing(true);
    setProcessOutput("Sending to Opus… this takes 30-90 seconds.");

    try {
      const res = await fetch("/api/process-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug }),
      });
      const data = await res.json();
      if (data.ok) {
        setProcessOutput(data.message + " Reloading…");
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
    <div className="border-b border-border-subtle px-4 py-3">
      <div className="mb-2 flex items-center gap-2">
        <StickyNote size={14} className="text-text-tertiary" />
        <span className="text-[12px] font-medium text-text-secondary">Meeting notes</span>
        <span className="ml-1 text-[11px] text-text-muted">Paste Granola notes, recruiter intel, comp conversations</span>
      </div>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Paste meeting notes here… recruiter screen details, comp discussions, interviewer names, anything useful for prep."
        rows={4}
        className="w-full resize-y rounded-md border border-border-subtle bg-surface-1 px-3 py-2 text-[13px] text-text-secondary placeholder:text-text-muted"
      />
      <div className="mt-2 flex items-center gap-2">
        <Button variant="secondary" size="sm" onClick={handleSave} disabled={saving || processing}>
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
          {saving ? "Saving…" : "Save notes"}
        </Button>
        <Button variant="secondary" size="sm" onClick={handleProcess} disabled={processing || !notes.trim()}>
          {processing ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
          {processing ? "Enhancing with Opus…" : "Enhance prep with notes"}
        </Button>
        {saved && <span className="text-[12px] text-emerald">Saved to prep doc</span>}
      </div>
      {processOutput && (
        <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md border border-border-subtle bg-surface-1 p-2 font-mono text-[11px] text-text-muted">
          {processOutput.slice(-500)}
        </pre>
      )}
    </div>
  );
}

function GeneratePrepButton({ company, role, url }: { company: string; role: string; url?: string }) {
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
      <Button variant="secondary" size="sm" onClick={handleGenerate} disabled={generating}>
        {generating ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
        {generating ? "Generating…" : "Generate prep doc"}
      </Button>
      {output && (
        <pre className="mt-2 max-h-32 overflow-y-auto rounded-md border border-border-subtle bg-surface-1 p-2 font-mono text-[11px] text-text-muted">
          {output}
        </pre>
      )}
    </div>
  );
}

// Per-section glyphs — monochrome (tints are reserved for badges that carry meaning).
const SECTION_ICONS: { key: string; icon: React.ReactNode }[] = [
  { key: "Company Quick Brief", icon: <Briefcase size={14} /> },
  { key: "Why This Role Fits", icon: <Target size={14} /> },
  { key: "STAR+R Stories", icon: <BookOpen size={14} /> },
  { key: "Questions THEY", icon: <MessageSquare size={14} /> },
  { key: "Questions YOU", icon: <HelpCircle size={14} /> },
  { key: "Red Flag", icon: <AlertTriangle size={14} /> },
  { key: "Salary", icon: <DollarSign size={14} /> },
  { key: "Pre-Interview Checklist", icon: <Target size={14} /> },
];

function getIcon(heading: string): React.ReactNode {
  const match = SECTION_ICONS.find((s) => heading.includes(s.key));
  return <span className="text-text-tertiary">{match ? match.icon : <ChevronRight size={14} />}</span>;
}

function PrepSection({ heading, content, defaultOpen }: { heading: string; content: string; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-border-subtle last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-surface-3"
      >
        {getIcon(heading)}
        <span className="flex-1 text-[14px] font-semibold tracking-[-0.01em] text-text-primary">{heading}</span>
        {open ? <ChevronDown size={14} className="text-text-muted" /> : <ChevronRight size={14} className="text-text-muted" />}
      </button>
      {open && (
        <div className="whitespace-pre-wrap px-4 pb-4 text-[13px] leading-relaxed text-text-tertiary">
          {renderMarkdown(content)}
        </div>
      )}
    </div>
  );
}

function highlightRecruiterTags(text: string): React.ReactNode {
  const parts = text.split(/(\(per (?:recruiter|meeting notes)\))/gi);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    /^\(per (?:recruiter|meeting notes)\)$/i.test(part) ? (
      <span
        key={i}
        className="ml-1 inline-flex items-center rounded-sm border border-violet-border bg-violet-dim px-1 py-0 text-[11px] font-medium text-violet"
      >
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

function renderMarkdown(text: string) {
  return text.split("\n").map((line, i) => {
    // Checkbox items (must come before the generic "- " case)
    if (line.startsWith("- [ ] ") || line.startsWith("- [x] ")) {
      const checked = line.startsWith("- [x] ");
      return (
        <label key={i} className="mt-1.5 ml-1 flex items-center gap-2">
          <input
            type="checkbox"
            defaultChecked={checked}
            className="h-3.5 w-3.5 shrink-0 rounded-sm accent-[var(--color-accent-strong)]"
          />
          <span className={checked ? "text-text-muted line-through" : ""}>{line.slice(6)}</span>
        </label>
      );
    }
    // ### headers — numbered ones (the "questions they'll ask") render as a numbered list, not 14 <h3>s
    const numberedQ = line.match(/^### (\d+)\.\s+(.+)$/);
    if (numberedQ) {
      return (
        <p key={i} className="mt-3">
          <span className="mr-1.5 tabular-nums text-text-muted">{numberedQ[1]}.</span>
          <span className="font-medium text-text-secondary">{numberedQ[2].replace(/\*\*/g, "")}</span>
        </p>
      );
    }
    if (line.startsWith("### ")) {
      return (
        <h3 key={i} className="mt-4 mb-1 text-[13px] font-semibold tracking-[-0.01em] text-text-primary">
          {line.slice(4)}
        </h3>
      );
    }
    // Bold label paragraphs
    if (line.startsWith("**") && line.includes(":**")) {
      const [label, ...rest] = line.split(":**");
      return (
        <p key={i} className="mt-1">
          <span className="font-medium text-text-secondary">{label.replace(/^\*\*/, "")}:</span>{" "}
          <span>{rest.join(":**").replace(/\*\*/g, "")}</span>
        </p>
      );
    }
    // Blockquotes — neutral left rule (a blockquote idiom, not card decoration)
    if (line.startsWith("> ")) {
      return (
        <blockquote key={i} className="mt-1 border-l-2 border-border-strong pl-3 italic text-text-muted">
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
    // Table rows → key/value pair
    if (line.startsWith("| **") && line.includes("|")) {
      const cols = line.split("|").map((c) => c.trim()).filter(Boolean);
      if (cols.length >= 2) {
        return (
          <div key={i} className="mt-1 flex gap-2">
            <span className="min-w-[80px] font-medium text-text-secondary">{cols[0].replace(/\*\*/g, "")}</span>
            <span className="flex-1">{cols[1]}</span>
          </div>
        );
      }
    }
    // Drop empty / table-chrome lines
    if (line.trim() === "" || line.startsWith("| Element") || line.startsWith("|--")) return null;
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
  const [selectedPrep, setSelectedPrep] = useState<string | null>(preps.length > 0 ? preps[0].slug : null);
  const [showStoryBank, setShowStoryBank] = useState(false);

  const currentPrep = preps.find((p) => p.slug === selectedPrep);
  // Dedupe by URL — interviewRoles can carry the same posting twice (so `id`, a hash of the
  // URL, collides) — keep the first.
  const needsPrep = [
    ...new Map(
      interviewRoles
        .filter((r) => !preps.some((p) => p.company.toLowerCase() === r.company.toLowerCase()))
        .map((r) => [r.url, r])
    ).values(),
  ];

  const prioritySections = ["Why This Role Fits You", "Questions THEY Will Ask You", "Pre-Interview Checklist"];

  return (
    <Shell
      activePursuing={activePursuing}
      highConviction={highConviction}
      companyCount={companyCount}
      signalCount={signalCount}
      hasWarmLeads={hasWarmLeads}
    >
      <PageHeader
        icon={<Mic size={16} className="text-text-tertiary" />}
        title="Interview Prep"
        subtitle={`${interviewCount} active interview${interviewCount !== 1 ? "s" : ""} · ${preps.length} prep doc${preps.length !== 1 ? "s" : ""}`}
      />

      <div className="space-y-6">
        {/* Interview roles without prep docs */}
        {needsPrep.length > 0 && (
          <div className="rounded-lg border border-border-subtle bg-surface-2 px-4 py-3">
            <SectionLabel icon={<AlertTriangle size={12} className="text-amber" />} className="mb-2">
              Needs prep doc
            </SectionLabel>
            <div className="space-y-1">
              {needsPrep.map((r) => (
                // key on the URL, not r.id — id is only the first ~9 chars of the URL base64'd,
                // so every "https://b…" posting collides on it (a latent lib/data.ts bug).
                <div key={r.url} className="flex items-center justify-between gap-3 py-1">
                  <span className="text-[13px] text-text-tertiary">{r.company} — {r.title}</span>
                  <GeneratePrepButton company={r.company} role={r.title} url={r.url} />
                </div>
              ))}
            </div>
          </div>
        )}

        {preps.length === 0 ? (
          <div className="rounded-lg border border-border-subtle bg-surface-2">
            <EmptyState
              icon={<Mic size={28} />}
              title="No interview prep docs yet"
              description={
                <>
                  Run <code className="rounded-sm bg-surface-3 px-1.5 py-0.5 font-mono text-[11px] text-text-secondary">/career-ops</code> with a role to generate one.
                </>
              }
            />
          </div>
        ) : (
          <div className="flex gap-6">
            {/* Left rail — prep docs, then Story Bank under its own label */}
            <div className="w-56 flex-shrink-0 space-y-5">
              <div className="space-y-1">
                <SectionLabel className="mb-2 px-1">Prep docs</SectionLabel>
                {preps.map((p) => {
                  const active = selectedPrep === p.slug && !showStoryBank;
                  return (
                    <button
                      key={p.slug}
                      type="button"
                      onClick={() => { setSelectedPrep(p.slug); setShowStoryBank(false); }}
                      aria-pressed={active}
                      className={`flex w-full flex-col items-start rounded-lg border px-3 py-2.5 text-left transition-colors ${
                        active
                          ? "border-accent-border bg-accent-dim"
                          : "border-border-subtle bg-surface-2 hover:border-border-default hover:bg-surface-3"
                      }`}
                    >
                      <span className="text-[13px] font-medium text-text-primary">{p.company}</span>
                      <span className="w-full truncate text-[12px] text-text-muted">{p.role}</span>
                    </button>
                  );
                })}
              </div>

              {storyBank && (
                <div className="space-y-1 border-t border-border-subtle pt-4">
                  <SectionLabel className="mb-2 px-1">Reference</SectionLabel>
                  <button
                    type="button"
                    onClick={() => { setShowStoryBank(true); setSelectedPrep(null); }}
                    aria-pressed={showStoryBank}
                    className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                      showStoryBank
                        ? "border-accent-border bg-accent-dim"
                        : "border-border-subtle bg-surface-2 hover:border-border-default hover:bg-surface-3"
                    }`}
                  >
                    <BookOpen size={14} className="text-text-tertiary" />
                    <span className="text-[13px] font-medium text-text-primary">Story Bank</span>
                  </button>
                </div>
              )}
            </div>

            {/* Main content */}
            <div className="min-w-0 flex-1">
              {showStoryBank ? (
                <div className="rounded-lg border border-border-subtle bg-surface-2">
                  <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-3">
                    <BookOpen size={14} className="text-text-tertiary" />
                    <h2 className="text-[14px] font-semibold tracking-[-0.01em] text-text-primary">Story Bank</h2>
                    <span className="ml-auto text-[12px] text-text-muted">Reusable STAR+R stories across all interviews</span>
                  </div>
                  <div className="whitespace-pre-wrap p-4 text-[13px] leading-relaxed text-text-tertiary">
                    {renderMarkdown(storyBank)}
                  </div>
                </div>
              ) : currentPrep ? (
                <div className="rounded-lg border border-border-subtle bg-surface-2">
                  {/* Prep header */}
                  <div className="border-b border-border-subtle px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <h2 className="text-[14px] font-semibold tracking-[-0.01em] text-text-primary">
                        {currentPrep.company} — {currentPrep.role}
                      </h2>
                      {currentPrep.content.match(/\*\*URL:\*\*\s*(.+)/)?.[1] && (
                        <a
                          href={currentPrep.content.match(/\*\*URL:\*\*\s*(.+)/)?.[1]?.trim()}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex shrink-0 items-center gap-1 text-[12px] text-accent transition-colors hover:underline"
                        >
                          <ExternalLink size={12} />
                          View JD
                        </a>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      {currentPrep.content.match(/\*\*Status:\*\*\s*(.+)/)?.[1] && (
                        <span className="text-[12px] text-amber">
                          {currentPrep.content.match(/\*\*Status:\*\*\s*(.+)/)?.[1]?.trim()}
                        </span>
                      )}
                      {currentPrep.content.match(/\*\*Enhanced:\*\*\s*(.+)/)?.[1] && (
                        <Badge color="violet" icon={<Sparkles size={10} />}>
                          Enhanced {currentPrep.content.match(/\*\*Enhanced:\*\*\s*(.+)/)?.[1]?.trim()}
                        </Badge>
                      )}
                    </div>
                  </div>

                  <MeetingNotesBox
                    slug={currentPrep.slug}
                    initialNotes={currentPrep.sections.find((s) => s.heading === "Meeting Notes")?.content || ""}
                  />

                  <div>
                    {currentPrep.sections
                      .filter((s) => s.heading !== "Meeting Notes")
                      .map((section, i) => (
                        <PrepSection
                          key={i}
                          heading={section.heading}
                          content={section.content}
                          defaultOpen={prioritySections.some((ps) => section.heading.includes(ps))}
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

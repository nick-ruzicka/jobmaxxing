"use client";

import { FileText, ExternalLink } from "lucide-react";
import { SectionLabel, Badge } from "@/components/ui";

interface LibraryBullet {
  id: string;
  text: string;
  archetypes: string[];
  tags: string[];
  impact_metric: string | null;
  role: string;
}

interface Library {
  archetypes: string[];
  bullets: LibraryBullet[];
  current_titles_at_linera: string[];
}

export function ResumesPanel({ library }: { library: Library | null }) {
  if (!library) {
    return (
      <div className="text-[13px] text-text-tertiary">
        No resume library found. Run{" "}
        <code className="text-text-secondary">autoapply/.venv/bin/python autoapply/cli/parse_resumes.py</code>{" "}
        to generate it.
      </div>
    );
  }

  const crossArchetype = library.bullets.filter((b) => b.archetypes.length >= 2).length;
  const singletons = library.bullets.length - crossArchetype;

  return (
    <div className="space-y-6">
      <p className="text-[12px] text-text-tertiary">
        5 parsed resumes + cross-archetype bullet library. Source PDFs at{" "}
        <code className="text-text-secondary">autoapply/resumes/source/</code> are gitignored (PII).
        Parsed HTML + library.json are committed.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Stat label="archetypes" value={library.archetypes.length} />
        <Stat label="unique bullets" value={library.bullets.length} />
        <Stat label="cross-archetype (≥2 resumes)" value={crossArchetype} />
        <Stat label="singletons" value={singletons} />
        <Stat
          label="bullets with impact metrics"
          value={library.bullets.filter((b) => b.impact_metric).length}
        />
        <Stat label="Linera current titles" value={library.current_titles_at_linera.length} />
      </div>

      <div>
        <SectionLabel className="mb-2">Parsed resumes (one per archetype)</SectionLabel>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {library.archetypes.map((arch) => {
            const bulletsInArch = library.bullets.filter((b) => b.archetypes.includes(arch));
            return (
              <div
                key={arch}
                className="flex items-center justify-between rounded-lg border border-border-subtle bg-surface-2 p-3"
              >
                <div className="flex items-center gap-2">
                  <FileText size={14} className="text-text-tertiary" />
                  <span className="text-[13px] font-medium text-text-primary">{arch}</span>
                  <Badge>{bulletsInArch.length} bullets</Badge>
                </div>
                <a
                  href={`/api/context/resume?archetype=${arch}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[12px] text-accent hover:underline"
                >
                  view HTML <ExternalLink size={10} />
                </a>
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <SectionLabel className="mb-2">Sample bullets</SectionLabel>
        <div className="space-y-2">
          {library.bullets.slice(0, 5).map((b) => (
            <div key={b.id} className="rounded-lg border border-border-subtle bg-surface-2 p-3">
              <div className="flex items-start justify-between gap-3">
                <code className="text-[11px] text-text-tertiary">{b.id}</code>
                <div className="flex flex-wrap gap-1">
                  {b.archetypes.map((a) => (
                    <Badge key={a} color="accent">
                      {a}
                    </Badge>
                  ))}
                </div>
              </div>
              <p className="mt-2 text-[12px] text-text-secondary">{b.text}</p>
              {b.impact_metric && (
                <div className="mt-2 text-[11px]">
                  <span className="text-text-tertiary">impact:</span>{" "}
                  <span className="text-amber">{b.impact_metric}</span>
                </div>
              )}
              {b.tags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {b.tags.slice(0, 10).map((t) => (
                    <code
                      key={t}
                      className="inline-block rounded bg-surface-3 px-1.5 py-0.5 text-[10px] text-text-tertiary"
                    >
                      {t}
                    </code>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-surface-2 p-3">
      <div className="text-[18px] font-semibold text-text-primary">{value}</div>
      <div className="text-[11px] text-text-tertiary">{label}</div>
    </div>
  );
}

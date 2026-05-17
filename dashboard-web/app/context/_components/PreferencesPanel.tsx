"use client";

import { SectionLabel } from "@/components/ui";

export function PreferencesPanel({
  userContext,
  globalDisqualifiers,
}: {
  userContext: Record<string, unknown>;
  globalDisqualifiers: Record<string, unknown>;
}) {
  const identity = userContext.identity as Record<string, string> | undefined;
  const loc = userContext.location_preferences as Record<string, number> | undefined;
  const comp = userContext.compensation as Record<string, number> | undefined;
  const hardNos = userContext.hard_nos as Record<string, string[]> | undefined;
  const soft = userContext.soft_preferences as Record<string, number> | undefined;
  const anti = userContext.anti_signals as Record<string, number> | undefined;

  return (
    <div className="space-y-6">
      <p className="text-[12px] text-text-tertiary">
        Read-only view of <code className="text-text-secondary">config/user-context.yaml</code>. To
        change preferences, edit the YAML file and re-run the scoring backfill.
      </p>

      <Section title="Identity">
        <KV data={identity} />
      </Section>

      <Section title="Location preferences (point deltas applied to fit_score × 10)">
        <KV data={loc} renderValue={fmtSigned} />
      </Section>

      <Section title="Compensation">
        <KV data={comp} renderValue={fmtCurrency} />
      </Section>

      <Section title="Hard nos (matches → score=0, disqualified)">
        {hardNos && (
          <div className="space-y-2">
            {Object.entries(hardNos).map(([k, v]) => (
              <div key={k}>
                <div className="text-[11px] font-medium text-text-secondary">{k}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {(v as string[]).map((item) => (
                    <code
                      key={item}
                      className="inline-block rounded bg-surface-3 px-2 py-0.5 text-[11px] text-text-secondary"
                    >
                      {item}
                    </code>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="mt-4">
          <div className="text-[11px] font-medium text-text-secondary">global_disqualifiers (from archetypes.yaml)</div>
          <pre className="mt-1 overflow-x-auto rounded bg-surface-3 p-2 text-[11px] text-text-secondary">
            {JSON.stringify(globalDisqualifiers, null, 2)}
          </pre>
        </div>
      </Section>

      <Section title="Soft preferences (JD/company markers → small boosts)">
        <KV data={soft} renderValue={fmtSigned} />
      </Section>

      <Section title="Anti-signals (JD/company markers → small dings)">
        <KV data={anti} renderValue={fmtSigned} />
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <SectionLabel className="mb-2">{title}</SectionLabel>
      <div className="rounded-lg border border-border-subtle bg-surface-2 p-4">{children}</div>
    </div>
  );
}

function KV({
  data,
  renderValue,
}: {
  data: Record<string, string | number> | undefined;
  renderValue?: (v: number) => string;
}) {
  if (!data) return <div className="text-[12px] text-text-tertiary">(empty)</div>;
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-[12px] sm:grid-cols-2">
      {Object.entries(data).map(([k, v]) => (
        <div key={k} className="flex justify-between gap-3 border-b border-border-subtle py-1 last:border-b-0">
          <dt className="text-text-tertiary">{k}</dt>
          <dd className="text-text-secondary">
            {typeof v === "number" && renderValue ? renderValue(v) : String(v)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function fmtSigned(v: number) {
  if (v > 0) return `+${v}`;
  return String(v);
}

function fmtCurrency(v: number) {
  if (Math.abs(v) >= 1000) return `$${v.toLocaleString()}`;
  return fmtSigned(v);
}

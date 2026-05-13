/**
 * /design-system — living spec preview for the proposed JobOps design system.
 *
 * Self-contained: defines the PROPOSED tokens in a scoped <style> block (does NOT
 * touch globals.css), so this renders the target look before any migration. Once
 * the system is approved and globals.css adopts @theme, this page gets simplified
 * to use the real utilities. See DESIGN.md.
 */
import {
  Briefcase, Bell, Search, RefreshCw, Radio, ExternalLink, ChevronDown,
  AlertTriangle, Sparkles, ArrowUpDown, Building2, Hammer,
} from "lucide-react";
import { DropdownPillDemo } from "./DropdownPillDemo";

const CSS = `
.ds {
  /* colors, shadow, easing come from @theme / :root in globals.css now —
     this page renders against the LIVE tokens, not a scoped copy. */
  --r-sm:6px; --r-md:8px; --r-lg:10px; --dur:150ms;
  background:var(--color-surface-0); color:var(--color-text-secondary);
  font-family: var(--font-inter), system-ui, sans-serif; font-size:14px; -webkit-font-smoothing:antialiased;
  min-height:100vh;
}
.ds *::selection { background: var(--color-accent-dim); }
.ds h1,.ds h2,.ds h3 { color:var(--color-text-primary); }
.ds .t-display{font-size:22px;font-weight:700;letter-spacing:-.02em;line-height:1.2;font-variant-numeric:tabular-nums;}
.ds .t-title{font-size:18px;font-weight:600;letter-spacing:-.02em;line-height:1.3;}
.ds .t-heading{font-size:14px;font-weight:600;letter-spacing:-.01em;line-height:1.4;}
.ds .t-body{font-size:14px;font-weight:400;line-height:1.5;}
.ds .t-body-strong{font-size:14px;font-weight:500;line-height:1.5;}
.ds .t-small{font-size:13px;line-height:1.45;}
.ds .t-caption{font-size:12px;line-height:1.4;}
.ds .t-micro{font-size:11px;font-weight:500;line-height:1.3;font-variant-numeric:tabular-nums;}
.ds .t-section{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;line-height:1;color:var(--color-text-tertiary);}
.ds .tnum{font-variant-numeric:tabular-nums;}
.ds .card{background:var(--color-surface-2);border:1px solid var(--color-border-subtle);border-radius:var(--r-lg);}
.ds .hr{height:1px;background:var(--color-border-subtle);border:0;}

/* badges */
.ds .badge{display:inline-flex;align-items:center;gap:4px;border-radius:var(--r-sm);padding:2px 8px;font-size:11px;font-weight:500;font-variant-numeric:tabular-nums;border:1px solid transparent;}
.ds .badge-neutral{background:var(--color-surface-3);color:var(--color-text-tertiary);border-color:var(--color-border-subtle);}
.ds .badge-accent{background:var(--color-accent-dim);color:var(--color-accent);border-color:var(--color-accent-border);}
.ds .badge-emerald{background:var(--color-emerald-dim);color:var(--color-emerald);border-color:var(--color-emerald-border);}
.ds .badge-amber{background:var(--color-amber-dim);color:var(--color-amber);border-color:var(--color-amber-border);}
.ds .badge-blue{background:var(--color-blue-dim);color:var(--color-blue);border-color:var(--color-blue-border);}
.ds .badge-violet{background:var(--color-violet-dim);color:var(--color-violet);border-color:var(--color-violet-border);}
.ds .badge-red{background:var(--color-red-dim);color:var(--color-red);border-color:var(--color-red-border);}
.ds .dot{width:6px;height:6px;border-radius:9999px;display:inline-block;}
.ds .pdot{width:5px;height:5px;border-radius:9999px;display:inline-block;}

/* buttons */
.ds .btn{display:inline-flex;align-items:center;gap:6px;border-radius:var(--r-sm);font-size:13px;font-weight:500;padding:6px 12px;border:1px solid transparent;cursor:pointer;
  transition:background-color var(--dur) var(--ease-out),border-color var(--dur) var(--ease-out),color var(--dur) var(--ease-out);}
.ds .btn:active{transform:translateY(.5px);}
.ds .btn:focus-visible{outline:none;box-shadow:0 0 0 2px var(--color-surface-0),0 0 0 4px var(--color-accent);}
.ds .btn-md{padding:8px 16px;}
.ds .btn-primary{background:var(--color-accent-strong);color:#fff;}
.ds .btn-primary:hover{background:#7077f2;}
.ds .btn-secondary{background:var(--color-surface-2);color:var(--color-text-secondary);border-color:var(--color-border-default);}
.ds .btn-secondary:hover{background:var(--color-surface-3);}
.ds .btn-ghost{background:transparent;color:var(--color-text-tertiary);}
.ds .btn-ghost:hover{background:var(--color-surface-3);color:var(--color-text-secondary);}
.ds .btn-danger{background:var(--color-red-dim);color:var(--color-red);border-color:var(--color-red-border);}
.ds .btn-danger:hover{background:rgba(248,113,113,.18);}
.ds .btn-disabled{opacity:.4;cursor:not-allowed;pointer-events:none;}
/* simulated states for the spec grid */
.ds .is-hover.btn-primary{background:#7077f2;}
.ds .is-hover.btn-secondary,.ds .is-hover.btn-ghost{background:var(--color-surface-3);}
.ds .is-focus{box-shadow:0 0 0 2px var(--color-surface-0),0 0 0 4px var(--color-accent);}
.ds .is-active{transform:translateY(.5px);filter:brightness(.95);}

/* inputs */
.ds .input{background:var(--color-surface-2);border:1px solid var(--color-border-default);border-radius:var(--r-md);padding:8px 12px;font-size:13px;color:var(--color-text-secondary);width:100%;}
.ds .input::placeholder{color:var(--color-text-muted);}
.ds .input:focus-visible{outline:none;box-shadow:0 0 0 2px var(--color-surface-0),0 0 0 4px var(--color-accent);}

/* segmented control */
.ds .seg{display:inline-flex;gap:2px;background:var(--color-surface-2);border:1px solid var(--color-border-default);border-radius:var(--r-md);padding:3px;}
.ds .seg button{border:0;background:transparent;color:var(--color-text-muted);font-size:12px;font-weight:500;padding:5px 12px;border-radius:var(--r-sm);cursor:pointer;transition:background-color var(--dur) var(--ease-out),color var(--dur) var(--ease-out);}
.ds .seg button:hover{color:var(--color-text-secondary);}
.ds .seg button[aria-pressed="true"]{background:var(--color-accent-dim);color:var(--color-accent);}

/* table */
.ds table{width:100%;border-collapse:collapse;font-size:13px;}
.ds .tbl{background:var(--color-surface-2);border:1px solid var(--color-border-subtle);border-radius:var(--r-lg);overflow:hidden;}
.ds thead tr{background:var(--color-surface-1);border-bottom:1px solid var(--color-border-subtle);}
.ds th{padding:10px 12px;text-align:left;font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:.04em;color:var(--color-text-tertiary);}
.ds tbody td{padding:10px 12px;border-bottom:1px solid var(--color-border-subtle);color:var(--color-text-secondary);}
.ds tbody tr:last-child td{border-bottom:0;}
.ds tbody tr:nth-child(even){background:var(--color-surface-row);}
.ds tbody tr.is-hover{background:var(--color-surface-3);}
.ds tbody tr.is-dimmed{opacity:.5;}
.ds tbody tr.is-focused td{position:relative;}
.ds tbody tr.is-focused{box-shadow:inset 0 0 0 1px var(--color-accent);}

/* nav item (sidebar) */
.ds .nav{display:flex;align-items:center;gap:10px;padding:7px 10px;border-radius:var(--r-md);font-size:13px;font-weight:500;color:var(--color-text-tertiary);border-left:2px solid transparent;}
.ds .nav:hover{background:var(--color-surface-3);color:var(--color-text-secondary);}
.ds .nav.is-selected{background:var(--color-accent-dim);color:var(--color-accent);border-left-color:var(--color-accent);}

/* skeleton */
@keyframes ds-pulse{0%,100%{opacity:1}50%{opacity:.45}}
.ds .skel{background:var(--color-surface-2);border-radius:var(--r-md);animation:ds-pulse 1.4s ease-in-out infinite;}

/* empty state */
.ds .empty{display:flex;flex-direction:column;align-items:center;text-align:center;padding:48px 16px;}

.ds .swatch{height:48px;border-radius:var(--r-md);border:1px solid var(--color-border-subtle);}
.ds .chip-key{font-size:11px;color:var(--color-text-muted);font-family:var(--font-mono,ui-monospace),monospace;}
.ds a.link{color:var(--color-accent);text-decoration:none;}
.ds a.link:hover{text-decoration:underline;}
.ds .grid-states{display:grid;grid-template-columns:repeat(5,max-content);gap:12px 20px;align-items:center;}
.ds .state-lbl{font-size:11px;color:var(--color-text-muted);text-align:center;}
`;

function Section({ id, label, title, desc, children }: { id: string; label: string; title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section id={id} style={{ marginBottom: 56 }}>
      <div className="t-section" style={{ marginBottom: 6 }}>{label}</div>
      <h2 className="t-title" style={{ marginBottom: desc ? 4 : 16 }}>{title}</h2>
      {desc && <p className="t-caption" style={{ color: "var(--color-text-muted)", marginBottom: 16, maxWidth: 680 }}>{desc}</p>}
      {children}
    </section>
  );
}

const TYPE_ROWS: [string, string, string][] = [
  ["display", "22 / 700 / −0.02em · tabular", "388 roles · 4.4 avg"],
  ["title (h1)", "18 / 600 / −0.02em", "Pipeline"],
  ["heading (h2)", "14 / 600 / −0.01em", "Hearth — GTM Engineer (Founding)"],
  ["body-strong", "14 / 500", "Supabase"],
  ["body", "14 / 400", "Strong structural fit — zero-to-one GTM ops role at an AI-native Series B."],
  ["small", "13 / 400", "Revenue Operations Lead / GTM Engineer"],
  ["caption", "12 / 400", "Checked 2026-04-27 · 138 NYC / 200 Remote"],
  ["micro", "11 / 500 · tabular", "224"],
  ["section-label", "11 / 600 / 0.06em UPPERCASE", "WORKSPACE"],
];
const TYPE_CLASS: Record<string, string> = {
  "display": "t-display", "title (h1)": "t-title", "heading (h2)": "t-heading",
  "body-strong": "t-body-strong", "body": "t-body", "small": "t-small",
  "caption": "t-caption", "micro": "t-micro", "section-label": "t-section",
};

const SURFACES = [
  ["surface-0", "#0a0a10", "page / deepest bg"],
  ["surface-1", "#0e0e16", "sidebar, table header rows"],
  ["surface-2", "#14141e", "cards, table container, inputs"],
  ["surface-3", "#1a1a26", "hover / elevated"],
  ["surface-4", "#20202e", "active / pressed"],
  ["surface-row", "#161620", "table zebra (even rows)"],
];
const TEXTS = [
  ["text-primary", "#edeef0", "~14:1", "headings, key values"],
  ["text-secondary", "#a8adb7", "~8:1", "body / default reading"],
  ["text-tertiary", "#8a909c", "~5:1 ✓AA", "labels, secondary cells, section labels"],
  ["text-muted", "#787e8b", "~4.5:1 ✓AA", "incidental hints, keyboard cues, empty-state copy"],
];
const SEMANTICS: [string, string, string, string][] = [
  ["accent", "#818cf8", "indigo", "interactive / selected — nav, focus ring, links, primary button. Nothing else."],
  ["emerald", "#34d399", "good / done / present", "score 8–10, Offer, build/AI flags, Posting detected"],
  ["amber", "#fbbf24", "warning / attention / mid", "score 4–5, needs prep doc, high-conviction, stale"],
  ["blue", "#60a5fa", "informational / in-progress", "score 6–7, Interview, Hybrid, Watched"],
  ["violet", "#a78bfa", "secondary action / applied", "Applied, enhanced-with-AI markers"],
  ["red", "#f87171", "negative / destructive", "Rejected, red flags, danger button"],
];
const SPACING: [string, number, string][] = [
  ["1", 4, "icon↔label gaps"], ["2", 8, "inside badges/buttons"],
  ["2.5", 10, "dense-table cell padding (named exception)"], ["3", 12, "between controls, cell h-padding"],
  ["4", 16, "card padding, between fields"], ["6", 24, "between page sections; page padding"],
  ["8", 32, "between major regions"], ["12", 48, "empty-state v-padding"],
];
const BADGE_COLORS = ["neutral", "accent", "emerald", "amber", "blue", "violet", "red"] as const;

export default function DesignSystemPage() {
  return (
    <div className="ds">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div style={{ maxWidth: 920, margin: "0 auto", padding: "48px 32px 96px" }}>

        {/* ---- header ---- */}
        <header style={{ marginBottom: 48 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <Briefcase size={18} style={{ color: "var(--color-accent)" }} />
            <span className="t-heading">JobOps</span>
            <span className="badge badge-amber" style={{ marginLeft: 4 }}>proposed</span>
          </div>
          <h1 className="t-display" style={{ marginBottom: 8 }}>Design System</h1>
          <p className="t-body" style={{ color: "var(--color-text-secondary)", maxWidth: 680 }}>
            Refined minimalism — Linear / Asana / Stripe / Vercel. Inter, dark-first, 14px body, 4px spacing grid,
            semantic color only, one shadow, no gradients, no emoji. This page is the living spec; the canonical
            doc is <span className="chip-key">DESIGN.md</span>. Nothing here is committed yet — review, then we implement.
          </p>
        </header>
        <hr className="hr" style={{ marginBottom: 48 }} />

        {/* ---- typography ---- */}
        <Section id="type" label="Typography" title="Type scale" desc="Inter, one family. Negative tracking on display/title/heading only. Tabular numerics on every numeric column, count, and stat value. The gap between the old 20px h1 and the 11–14px below is filled by heading/body/caption/micro plus a tracked-uppercase section label.">
          <div className="card" style={{ padding: 4 }}>
            <table>
              <thead><tr><th style={{ width: 130 }}>token</th><th style={{ width: 220 }}>spec</th><th>specimen</th></tr></thead>
              <tbody>
                {TYPE_ROWS.map(([tok, spec, sample]) => (
                  <tr key={tok}>
                    <td className="t-caption" style={{ color: "var(--color-text-muted)" }}>{tok}</td>
                    <td className="t-caption" style={{ color: "var(--color-text-tertiary)" }}>{spec}</td>
                    <td><span className={TYPE_CLASS[tok]} style={{ color: tok === "section-label" ? undefined : "var(--color-text-primary)" }}>{sample}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        {/* ---- color ---- */}
        <Section id="color" label="Color" title="Surfaces & borders" desc="Four elevation steps you can barely tell apart, plus a zebra row tint. Three border weights. 1px borders do the elevation work — there are no shadows on cards or tables.">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
            {SURFACES.map(([name, hex, use]) => (
              <div key={name} className="card" style={{ padding: 12 }}>
                <div className="swatch" style={{ background: hex, marginBottom: 8 }} />
                <div className="t-body-strong" style={{ color: "var(--color-text-primary)" }}>{name}</div>
                <div className="chip-key">{hex}</div>
                <div className="t-caption" style={{ color: "var(--color-text-muted)", marginTop: 2 }}>{use}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
            {["border-subtle #1e1e2a", "border-default #26263a", "border-strong #32324a"].map((b) => {
              const [n, h] = b.split(" ");
              return <div key={n} style={{ flex: 1, height: 44, borderRadius: 8, border: `1px solid ${h}`, background: "var(--color-surface-1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span className="t-caption"><span style={{ color: "var(--color-text-secondary)" }}>{n}</span> <span className="chip-key">{h}</span></span>
              </div>;
            })}
          </div>
        </Section>

        <Section id="text" label="Color" title="Text tiers" desc="The two muted tiers were raised to meet WCAG AA 4.5:1 (old --text-tertiary ≈4.2:1, old --text-muted ≈2.5:1). Contrast ratios shown against surface-0.">
          <div className="card" style={{ padding: 16 }}>
            {TEXTS.map(([name, hex, ratio, use], i) => (
              <div key={name} style={{ display: "flex", alignItems: "baseline", gap: 16, padding: "10px 0", borderTop: i ? "1px solid var(--color-border-subtle)" : 0 }}>
                <span style={{ color: hex, fontSize: 16, fontWeight: 500, width: 220 }}>The quick brown fox — 12345</span>
                <span className="t-body-strong" style={{ color: "var(--color-text-primary)", width: 130 }}>{name}</span>
                <span className="chip-key" style={{ width: 80 }}>{hex}</span>
                <span className="t-caption" style={{ color: ratio.includes("FAIL") ? "var(--color-red)" : "var(--color-emerald)", width: 90 }}>{ratio}</span>
                <span className="t-caption" style={{ color: "var(--color-text-muted)" }}>{use}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section id="semantics" label="Color" title="Semantic palette" desc="Each color owns a meaning. Score tiers and status colors draw from this set — indigo is no longer overloaded. Every semantic comes with -dim (12% fill) and -border (25% stroke) tokens so components stop hand-deriving rgba(...,0.2) literals.">
          {SEMANTICS.map(([name, hex, means, use]) => (
            <div key={name} className="card" style={{ padding: 14, marginBottom: 10, display: "flex", alignItems: "center", gap: 16 }}>
              <span className="dot" style={{ background: hex, width: 12, height: 12, flexShrink: 0 }} />
              <span className="badge" style={{ background: `${hex}1f`, color: hex, borderColor: `${hex}44`, flexShrink: 0 }}>{name}</span>
              <span className="chip-key" style={{ width: 70, flexShrink: 0 }}>{hex}</span>
              <span className="t-caption" style={{ color: "var(--color-text-secondary)", width: 200, flexShrink: 0 }}>{means}</span>
              <span className="t-caption" style={{ color: "var(--color-text-muted)" }}>{use}</span>
            </div>
          ))}
        </Section>

        {/* ---- spacing ---- */}
        <Section id="spacing" label="Spacing" title="Spacing scale" desc="4px base, aligned with Tailwind defaults so utilities map 1:1. 2.5 (10px) is a named exception used only for dense table cell padding (gives ~40–42px rows). Snap everything else to the scale.">
          <div className="card" style={{ padding: 16 }}>
            {SPACING.map(([name, px, use], i) => (
              <div key={name} style={{ display: "flex", alignItems: "center", gap: 16, padding: "8px 0", borderTop: i ? "1px solid var(--color-border-subtle)" : 0 }}>
                <span className="t-body-strong tnum" style={{ color: "var(--color-text-primary)", width: 32 }}>{name}</span>
                <span className="t-caption tnum" style={{ color: "var(--color-text-muted)", width: 48 }}>{px}px</span>
                <div style={{ width: px, height: 14, background: name === "2.5" ? "var(--color-amber)" : "var(--color-accent)", borderRadius: 2 }} />
                <span className="t-caption" style={{ color: "var(--color-text-muted)" }}>{use}</span>
              </div>
            ))}
          </div>
        </Section>

        {/* ---- buttons ---- */}
        <Section id="buttons" label="Components" title="Button" desc="primary / secondary / ghost / danger × sm/md. Rounded-md, 13px medium, gap-1.5, explicit transitions (no transition:all), :active translateY(0.5px), disabled = opacity-40 + not-allowed, focus-visible = the one global ring.">
          <div className="card" style={{ padding: 20 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", marginBottom: 16 }}>
              <button className="btn btn-primary"><RefreshCw size={14} />Run Job Scan</button>
              <button className="btn btn-secondary"><Radio size={14} />Signal Scan</button>
              <button className="btn btn-ghost">Clear filters</button>
              <button className="btn btn-danger">Discard</button>
              <button className="btn btn-primary btn-md"><Sparkles size={14} />Enhance with AI</button>
              <button className="btn btn-secondary btn-disabled">Disabled</button>
            </div>
            <div className="t-section" style={{ margin: "16px 0 10px" }}>States (primary)</div>
            <div className="grid-states">
              {["default", "hover", "active", "focus", "disabled"].map((s) => (
                <button key={s} className={`btn btn-primary ${s === "hover" ? "is-hover" : ""} ${s === "active" ? "is-active" : ""} ${s === "focus" ? "is-focus" : ""} ${s === "disabled" ? "btn-disabled" : ""}`}>Save</button>
              ))}
              {["default", "hover", "active", "focus", "disabled"].map((s) => <div key={s} className="state-lbl">{s}</div>)}
            </div>
            <div className="t-section" style={{ margin: "20px 0 10px" }}>Input + segmented control</div>
            <div style={{ display: "flex", gap: 12, alignItems: "center", maxWidth: 520 }}>
              <div style={{ position: "relative", flex: 1 }}>
                <Search size={14} style={{ position: "absolute", left: 12, top: 10, color: "var(--color-text-muted)" }} />
                <input className="input" style={{ paddingLeft: 34 }} placeholder="Search companies or roles…" />
              </div>
              <div className="seg">
                <button type="button">All</button><button type="button">4+</button><button type="button" aria-pressed="true">6+</button><button type="button">8+</button>
              </div>
            </div>
          </div>
        </Section>

        {/* ---- badges ---- */}
        <Section id="badges" label="Components" title="Badge" desc="soft (the chip) and dot (the quiet status marker). ScorePill, LocationTag, the company tier badge, the filter-count, and the nav count all collapse into one <Badge color variant>. rounded-md, 11px medium, tabular.">
          <div className="card" style={{ padding: 20 }}>
            <div className="t-section" style={{ marginBottom: 10 }}>soft</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
              {BADGE_COLORS.map((c) => <span key={c} className={`badge badge-${c}`}>{c} <span style={{ opacity: 0.7 }}>·</span> 24</span>)}
            </div>
            <div className="t-section" style={{ marginBottom: 10 }}>dot (status)</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginBottom: 20 }}>
              {[["neutral", "Discovered"], ["accent", "Evaluated"], ["violet", "Applied"], ["blue", "Interview"], ["emerald", "Offer"], ["red", "Rejected"]].map(([c, l]) => (
                <span key={l} className="t-small" style={{ display: "inline-flex", alignItems: "center", gap: 7, color: "var(--color-text-secondary)" }}>
                  <span className="dot" style={{ background: `var(--${c})` }} />{l} <ChevronDown size={11} style={{ color: "var(--color-text-muted)" }} />
                </span>
              ))}
            </div>
            <div className="t-section" style={{ marginBottom: 10 }}>real uses</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              <span className="badge badge-emerald">9</span>
              <span className="badge badge-blue">7</span>
              <span className="badge badge-amber">5</span>
              <span className="badge badge-neutral">3</span>
              <span style={{ width: 16 }} />
              <span className="badge badge-blue"><Building2 size={10} />Hybrid</span>
              <span className="badge badge-accent"><Building2 size={10} />Remote US</span>
              <span className="badge badge-neutral"><Building2 size={10} />Unknown</span>
              <span style={{ width: 16 }} />
              <span className="badge badge-blue">Watched</span>
              <span className="badge badge-amber">Signal</span>
              <span className="badge badge-neutral">Scan</span>
            </div>
          </div>
        </Section>

        {/* ---- dropdown pill (live demo of the real primitive) ---- */}
        <Section id="dropdown-pill" label="Components" title="DropdownPill" desc="Filter pill identical to the FilterBar Chip + a chevron that rotates on open. Use for grouped options that would overflow as separate chips (e.g. 'More locations' for non-NYC/Remote buckets). This is the real components/ui/DropdownPill rendered live — open it, toggle, tab out, ESC to close.">
          <div className="card" style={{ padding: 20 }}>
            <DropdownPillDemo />
            <p className="t-caption" style={{ color: "var(--color-text-muted)", marginTop: 12 }}>
              Left: multi-select with a count (active option seeded). Middle: <span className="chip-key">closeOnSelect</span> for radio-style use. Right: <span className="chip-key">align=&quot;right&quot;</span> popover anchoring.
            </p>
          </div>
        </Section>

        {/* ---- score + provenance ---- */}
        <Section id="score" label="Components" title="Score & provenance dots" desc="Score 8–10 emerald · 6–7 blue · 4–5 amber · <4 neutral (no hover glow). The tiny provenance dot next to the score: emerald = AI-enriched, neutral = title-only heuristic, blue = manual, violet = override — with a tooltip. Replaces the unexplained Hammer/Cpu icon-circles; build/AI flags become dot badges.">
          <div className="card" style={{ padding: 20 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 24, alignItems: "center" }}>
              {[["9", "emerald", "emerald", "AI-enriched"], ["7", "blue", "neutral", "title-only"], ["6", "blue", "blue", "manual"], ["5", "amber", "violet", "override"]].map(([n, sc, pr, lbl]) => (
                <span key={lbl} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span className={`badge badge-${sc}`}>{n}</span>
                  <span className="pdot" style={{ background: `var(--${pr})` }} title={lbl} />
                  <span className="t-caption" style={{ color: "var(--color-text-muted)" }}>{lbl}</span>
                </span>
              ))}
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <span className="t-small" style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--color-emerald)" }}><span className="dot" style={{ background: "var(--color-emerald)" }} />Build component</span>
              <span className="t-small" style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--color-emerald)" }}><span className="dot" style={{ background: "var(--color-emerald)" }} />AI signal</span>
              <span className="t-small" style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--color-amber)" }}><span className="dot" style={{ background: "var(--color-amber)" }} />No build component</span>
            </div>
          </div>
        </Section>

        {/* ---- table ---- */}
        <Section id="table" label="Components" title="DataTable" desc="One shell — border + rounded-lg + overflow-x-auto, no shadow. Uppercase tracked column heads. ~40px rows. Zebra and hover are CSS-only (even:bg-surface-row, hover:bg-surface-3) — zero JS hover handlers. Dimmed rows = opacity-50 only, no strikethrough, no left-border. Keyboard-focused row uses the global ring.">
          <div className="tbl">
            <table>
              <thead><tr>
                <th style={{ width: 70 }}><span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>Score <ArrowUpDown size={10} /></span></th>
                <th>Company</th><th>Role</th><th style={{ width: 120 }}>Comp</th><th style={{ width: 110 }}>Location</th><th style={{ width: 130 }}>Status</th><th style={{ width: 60 }}>Found</th><th style={{ width: 36 }}></th>
              </tr></thead>
              <tbody>
                {[
                  { s: "9", sc: "emerald", pr: "emerald", co: "Supabase", ro: "GTM Engineer", comp: "—", loc: ["accent", "Remote US"], st: ["violet", "Applied"], f: "1mo", cls: "" },
                  { s: "8", sc: "emerald", pr: "neutral", co: "Mento", ro: "GTM Engineer", comp: "—", loc: ["accent", "Remote US"], st: ["neutral", "Discovered"], f: "21d", cls: "is-hover" },
                  { s: "8", sc: "emerald", pr: "blue", co: "Mutiny", ro: "GTM Engineer", comp: "$150–200k", loc: ["emerald", "NYC"], st: ["accent", "Evaluated"], f: "2mo", cls: "" },
                  { s: "7", sc: "blue", pr: "violet", co: "Hebbia", ro: "GTM Engineer", comp: "—", loc: ["emerald", "NYC"], st: ["blue", "Interview"], f: "1mo", cls: "is-focused" },
                  { s: "5", sc: "amber", pr: "neutral", co: "Rula", ro: "GTM Engineer (Remote)", comp: "—", loc: ["accent", "Remote US"], st: ["neutral", "Skipped"], f: "1mo", cls: "is-dimmed" },
                ].map((r, i) => (
                  <tr key={i} className={r.cls}>
                    <td><span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span className={`badge badge-${r.sc}`}>{r.s}</span><span className="pdot" style={{ background: `var(--${r.pr})` }} /></span></td>
                    <td><span className="t-body-strong" style={{ color: "var(--color-text-primary)" }}>{r.co}</span></td>
                    <td>{r.ro}</td>
                    <td className="tnum t-caption" style={{ color: r.comp === "—" ? "var(--color-text-muted)" : "var(--color-text-secondary)" }}>{r.comp}</td>
                    <td><span className={`badge badge-${r.loc[0]}`}><Building2 size={10} />{r.loc[1]}</span></td>
                    <td><span className="t-small" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span className="dot" style={{ background: `var(--${r.st[0]})` }} />{r.st[1]} <ChevronDown size={10} style={{ color: "var(--color-text-muted)" }} /></span></td>
                    <td className="t-micro" style={{ color: "var(--color-text-muted)" }}>{r.f}</td>
                    <td><ExternalLink size={13} style={{ color: "var(--color-text-muted)" }} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="t-caption" style={{ color: "var(--color-text-muted)", marginTop: 8 }}>Row 2 = hover · Row 4 = keyboard-focused · Row 5 = dimmed (skipped)</p>
        </Section>

        {/* ---- nav + section label ---- */}
        <Section id="nav" label="Components" title="Sidebar nav & SectionLabel" desc="Selected = accent-dim fill + 2px left accent bar (the only place a left-accent bar is allowed — it's wayfinding, not card decoration). The logo is a monochrome icon, not a tinted circle. Group headers use the tracked-uppercase SectionLabel.">
          <div className="card" style={{ padding: 16, maxWidth: 260 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 6px", marginBottom: 16 }}>
              <Briefcase size={16} style={{ color: "var(--color-text-primary)" }} />
              <span className="t-heading">JobOps</span>
              <Bell size={14} style={{ color: "var(--color-text-muted)", marginLeft: "auto" }} />
            </div>
            <div className="t-section" style={{ padding: "0 8px 8px" }}>Workspace</div>
            <div className="nav is-selected" style={{ marginBottom: 2 }}><Briefcase size={16} />Pipeline<span className="badge badge-accent" style={{ marginLeft: "auto" }}>17</span></div>
            <div className="nav" style={{ marginBottom: 2 }}><Radio size={16} />Signals<span className="badge badge-neutral" style={{ marginLeft: "auto" }}>13</span></div>
            <div className="nav" style={{ marginBottom: 2 }}><Building2 size={16} />Companies</div>
            <div className="nav"><Hammer size={16} />Interview Prep</div>
          </div>
        </Section>

        {/* ---- empty + loading ---- */}
        <Section id="states" label="Patterns" title="Empty / loading / error" desc="Empty = centered icon + title + optional description + optional secondary-button action. Loading = skeleton blocks that match the real layout (opacity pulse, not a moving gradient). Error = the empty pattern with AlertTriangle + a 'Try again' button.">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div className="card empty">
              <Search size={28} style={{ color: "var(--color-text-muted)", marginBottom: 12 }} />
              <div className="t-small" style={{ color: "var(--color-text-secondary)" }}>No roles match your filters</div>
              <div className="t-caption" style={{ color: "var(--color-text-muted)", marginTop: 4 }}>Try widening the score range or clearing location filters.</div>
              <button className="btn btn-secondary" style={{ marginTop: 14 }}>Clear filters</button>
            </div>
            <div className="card empty">
              <AlertTriangle size={28} style={{ color: "var(--color-text-muted)", marginBottom: 12 }} />
              <div className="t-small" style={{ color: "var(--color-text-secondary)" }}>Something went wrong</div>
              <div className="t-caption" style={{ color: "var(--color-text-muted)", marginTop: 4 }}>Failed to read the pipeline data.</div>
              <button className="btn btn-secondary" style={{ marginTop: 14 }}><RefreshCw size={14} />Try again</button>
            </div>
          </div>
          <div className="card" style={{ padding: 16, marginTop: 16 }}>
            <div className="t-section" style={{ marginBottom: 12 }}>Loading skeleton</div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <div className="skel" style={{ width: 120, height: 22 }} />
              <div className="skel" style={{ width: 110, height: 30 }} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 16 }}>
              {[0, 1, 2, 3].map((i) => <div key={i} className="skel" style={{ height: 56 }} />)}
            </div>
            {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="skel" style={{ height: 18, marginBottom: 8, width: `${100 - i * 4}%` }} />)}
          </div>
        </Section>

        {/* ---- motion ---- */}
        <Section id="motion" label="Motion" title="Transitions" desc="">
          <div className="card" style={{ padding: 16 }}>
            <ul className="t-small" style={{ color: "var(--color-text-secondary)", lineHeight: 1.7, paddingLeft: 18, margin: 0, listStyle: "disc" }}>
              <li>Default: <span className="chip-key">transition: background-color 150ms var(--ease-out), border-color 150ms…, color 150ms…, box-shadow 150ms…</span> — never <span className="chip-key">transition: all</span> (it&apos;s on ~750 elements today).</li>
              <li>Durations: micro 120ms (hover) · default 150ms · slow 220ms (panel/drawer slide). Nothing slower.</li>
              <li>Easing: <span className="chip-key">cubic-bezier(.16,1,.3,1)</span> for entrances/hover; <span className="chip-key">ease-in</span> for exits. No bounce.</li>
              <li>Only <span className="chip-key">transform</span> and <span className="chip-key">opacity</span> for movement (expand-row = translateY + opacity).</li>
              <li><span className="chip-key">@media (prefers-reduced-motion: reduce)</span> kills animations app-wide. The warm-lead pulse lives inside that guard.</li>
            </ul>
          </div>
        </Section>

        <div className="bg-surface-2 text-text-primary border border-border-subtle rounded-md" style={{ padding: "8px 12px", marginBottom: 24, display: "flex", alignItems: "center", gap: 8 }}>
          <span className="t-caption" style={{ color: "var(--color-text-muted)" }}>@theme smoke test — this row is styled with Tailwind utilities:</span>
          <span className="chip-key">bg-surface-2 · text-text-primary · border-border-subtle · rounded-md</span>
        </div>
        <hr className="hr" style={{ margin: "8px 0 24px" }} />
        <p className="t-caption" style={{ color: "var(--color-text-muted)" }}>
          Spec: <span className="chip-key">DESIGN.md</span> · Preview route: <span className="chip-key">/design-system</span> · Status: proposed, nothing committed.
          Review &amp; refine, then implement one commit per chunk (order in DESIGN.md).
        </p>
      </div>
    </div>
  );
}

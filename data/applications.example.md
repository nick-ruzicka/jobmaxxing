# Applications Tracker

> Copy to `data/applications.md` and start with an empty table — or pre-populate
> with active applications you want the pipeline to track. The framework reads
> this file to:
>
> - Compute `score-overrides.json` (boost = applied/evaluated highly, penalize =
>   rejected). See `scripts/sync-score-feedback.mjs`.
> - Drive the `/today` briefing's "stalled" and "follow-up" detection.
> - Provide context to the AI agent (after AI migration step 3 lands).
>
> Format is a Markdown table — the parser is lenient but the column order matters.
> The status column must be one of the canonical states in `templates/states.yml`:
> `Evaluated` / `Applied` / `Responded` / `Interview` / `Offer` / `Rejected`
> / `Discarded` / `SKIP`.

|#|Date|Company|Role|Score|Applied|PDF|Report|Notes|
|---|------|---------|------|-------|--------|-----|--------|-------|
| 1 | 2026-01-15 | Anthropic | Forward Deployed Engineer, Applied AI | 4.8/5 | Applied | ✅ | — | Strong JD alignment. Recruiter screen 2026-01-22. |
| 2 | 2026-01-16 | Databricks | Senior Forward Deployed Engineer | 4.5/5 | Interview | ✅ | — | Phone screen 2026-01-25; emphasized customer-engineering background. |
| 3 | 2026-01-18 | Reducto | Applied AI Engineer | 4.3/5 | Evaluated | — | — | Comp not yet listed; recruiter outreach pending. |

<!-- Add new rows above this comment. Old / closed rows can move below to keep the active section visible. -->

---

## Status legend

- **Evaluated** — scored by the pipeline, you haven't yet decided
- **Applied** — application submitted
- **Responded** — company replied (recruiter outreach, scheduling)
- **Interview** — any interview stage scheduled or in progress
- **Offer** — offer extended
- **Rejected** — declined by company (or by you after offer)
- **Discarded** — you decided not to pursue
- **SKIP** — auto-skipped by the pipeline

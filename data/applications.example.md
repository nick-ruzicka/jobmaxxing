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
> A status column value of `Applied` / `Screen` / `Onsite` / `Offer` / `Rejected`
> / `Evaluated` / `Skipped` is recognized by the pipeline.

|#|Date|Company|Role|Score|Applied|PDF|Report|Notes|
|---|------|---------|------|-------|--------|-----|--------|-------|
| 1 | 2026-01-15 | Anthropic | Forward Deployed Engineer, Applied AI | 4.8/5 | Applied | ✅ | [001](reports/001-anthropic-2026-01-15.md) | Strong JD alignment. Recruiter screen 2026-01-22. |
| 2 | 2026-01-16 | Databricks | Senior Forward Deployed Engineer | 4.5/5 | Screen | ✅ | [002](reports/002-databricks-2026-01-16.md) | Phone screen 2026-01-25; emphasized customer-engineering background. |
| 3 | 2026-01-18 | Reducto | Applied AI Engineer | 4.3/5 | Evaluated | — | — | Comp not yet listed; recruiter outreach pending. |

<!-- Add new rows above this comment. Old / closed rows can move below to keep the active section visible. -->

---

## Status legend

- **Evaluated** — scored by the pipeline, you haven't yet decided
- **Applied** — application submitted
- **Screen** — recruiter / hiring manager screen scheduled or completed
- **Onsite** — onsite or virtual loop scheduled or in progress
- **Offer** — offer extended
- **Rejected** — declined by company (or by you after offer)
- **Skipped** — you decided not to pursue

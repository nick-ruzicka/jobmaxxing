# AutoApply

AI-assisted job application tooling. Given an Ashby job URL, AutoApply fetches
the JD, loads Nick's profile, drafts answers to free-text questions, fills the
standard fields, and **stops before submit** for human review.

Status: Ashby MVP (Task E of the 2026-05-14 12h autonomous session). Other
ATSes (Greenhouse, Lever, Workday) are scaffolded in the Chrome extension
(Task I) but not yet wired into the Python CLI.

## Why Ashby first

`autoapply/SOURCE_PRIORITY.md` shows Ashby is 87% of Nick's application
volume. Greenhouse and Lever are next; their MVPs reuse this module's shape.

## Setup

```bash
cd ~/projects/job-search/nick-career-ops
cp autoapply/profile.json.example autoapply/profile.json
```

Open `autoapply/profile.json` and **replace every value starting with
`REPLACE_WITH_`** with the real value (email, phone, resume URL, start date).
Anything still tagged `REPLACE_WITH_*` or containing `XX` will be detected by
the placeholder guard and skipped during form-fill — see SKILL.md rule 6.

`profile.json` is gitignored. The `.example` file is committed and is the
source of truth for the schema.

Set `ANTHROPIC_API_KEY` in `.env` (already required for `npm run enrich`).
Only used when you ask for drafted answers via `--draft-question`.

## Usage

### Plan only (no browser)

```bash
python autoapply/cli/apply.py https://jobs.ashbyhq.com/hebbia-ai/3d1c1050-236a-42e4-a1be-8e6b48b6b247
```

Output is a structured report:

- **SUMMARY** — role title + URL + location
- **FILLED (N fields)** — every standard field with the value that will be
  filled
- **SKIPPED (N fields)** — fields skipped due to placeholder or empty value,
  each labeled with the profile key to set
- **DRAFTED ANSWERS (N)** — only present when `--draft-question` was passed
- **SAFETY TRIGGERS** — runtime safety report (live mode only)
- **READY FOR REVIEW** — `yes` if you can hand off to a human, `no` + the
  list of profile values that still need real data

Exit codes:
- `0` — plan is ready; nothing blocking
- `1` — invalid URL, JD fetch failed, or profile file missing
- `2` — placeholders in profile blocked the apply (action required)

### Draft answers for free-text questions

```bash
python autoapply/cli/apply.py https://jobs.ashbyhq.com/<slug>/<id> \
  --draft-question "Why are you interested in <Company>?" \
  --draft-question "What's a recent project you're proud of?"
```

The drafter embeds your `answer_style` block from `profile.json` verbatim, so
bumping the voice rules there flows through to every answer. ≤200 words each.

### Live browser run (browser-harness)

```bash
python autoapply/cli/apply.py <url> --launch | browser-harness
```

`--launch` appends a browser-harness Python script after the report. Pipe it
to `browser-harness` (must be on `$PATH` — see `autoapply/browser-harness/`).
The script opens the URL, prints `page_info()`, and surfaces the PLAN list so
you can verify the form rendered before hand-filling.

**The initial MVP does NOT auto-fill the form fields in the browser** —
Ashby's selectors vary by tenant and the safest first run is
human-in-the-loop. The PLAN list tells you exactly what to type where, in
order. Subsequent iterations can extend `build_launch_script()` to walk
SKILL.md's selector map automatically.

### Smoke test with the example profile

For a no-PII test that hits the real Ashby API:

```bash
python autoapply/cli/apply.py https://jobs.ashbyhq.com/hebbia-ai/<job_id> \
  --profile-path autoapply/profile.json.example
```

You'll see 13 fields fill (the non-PII ones) and the 3 `REPLACE_WITH_*`
fields skipped with explicit "set <key>" instructions. Exit code 2.

## What the agent does

- Fetches the JD via Ashby's public job-board API
  (`api.ashbyhq.com/posting-api/job-board/<slug>?includeCompensation=true`)
  — pages on `jobs.ashbyhq.com` are React-rendered and a plain HTTP GET
  returns an empty skeleton.
- Loads `profile.json` and walks the SKILL.md standard-field mapping.
- Detects placeholders (`REPLACE_WITH_*` prefix OR two-or-more consecutive
  Xs, case-insensitive — see `profile_bridge.is_placeholder`).
- Drafts answers via Claude when `--draft-question` is supplied, embedding
  `answer_style` for voice consistency.

## What the agent does NOT do (by design)

- **Never clicks "Submit", "Apply Now", or any submit-equivalent button**
  (SKILL.md rule 1).
- Pauses before filling the last visible required field if no other
  unfilled required field is in view AND no submit button is identifiable
  (SKILL.md rule 2 — the auto-advance footgun).
- Stops before "Next" / "Continue" on multi-step forms when the next step
  would be the final one (SKILL.md rule 3).
- Leaves fields blank rather than guessing (SKILL.md rule 4).
- Never touches consent / agreement checkboxes without explicit approval
  (SKILL.md rule 5).
- Never fills a `REPLACE_WITH_*` or `XX` value (SKILL.md rule 6).
- Leaves every demographics / EEO question blank — Nick decides per
  application whether to disclose.

## Known limitations

- The browser-side automation is **plan only** for the MVP. Real form-fill
  via browser-harness selectors is a follow-up — the Python side is
  ready; the JS selector map in SKILL.md needs to be exercised against real
  Ashby tenants and tuned.
- File-picker resume uploads (where the form refuses programmatic
  `<input type="file">`) fall back to manual.
- Multi-select skill tags are skipped unless obviously matched —
  Ashby tenants vary too widely to safely heuristic-fill.
- The Claude prompt currently sees ~3K chars of JD; longer JDs are
  truncated to keep cost predictable.

## Roadmap

- Wire `build_launch_script()` to walk SKILL.md's selector map and fill
  each field deterministically inside browser-harness.
- Greenhouse skill (autoapply/skills/greenhouse/SKILL.md).
- Lever skill (autoapply/skills/lever/SKILL.md).
- Detect "Already applied" state from Ashby's API and short-circuit.
- Cross-reference against `data/applications.md` to refuse duplicates.
- Per-company answer cache (don't re-draft the same "why interested" if
  you've already drafted it for that company in the last 30 days).

## File layout

```
autoapply/
├── AUTOAPPLY.md             this file
├── __init__.py
├── profile.json             your real profile (gitignored)
├── profile.json.example     schema + Nick's non-PII defaults
├── profile_bridge.py        profile loading + placeholder detection
├── draft_answers.py         Claude API call for free-text questions
├── cli/
│   ├── __init__.py
│   └── apply.py             CLI orchestrator (this is what you run)
├── skills/
│   └── ashby/
│       └── SKILL.md         the safety rules + field-map for Ashby
└── tests/
    ├── test_apply_cli.py
    ├── test_ashby_skill.py
    ├── test_draft_answers.py
    └── test_profile_bridge.py
```

## Running the tests

```bash
# requires Python 3.11+ (uv-managed Python 3.12 works):
python -m unittest discover -s autoapply/tests -v
```

44 tests, all unit-level (no live API calls).

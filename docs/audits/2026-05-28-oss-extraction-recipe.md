# Career-Ops fork — OSS extraction recipe

**Date:** 2026-05-28 · **Source branch:** `main` · **Mode:** checklist for the future-session that publishes a clean copy of this fork as OSS — concrete commands, not re-derivation.

This recipe lifts the **framework** (code, configs, templates, tests, dashboard, audits, schemas) out of this fork into a fresh standalone repo, leaving behind the **personal data** (Nick's CV, applications, scoring overrides, scraped role state, interview stories). Same shape as the cohortqa extraction (`docs/audits/2026-05-24-extraction-recipe.md`, on the `personalab/publish` branch), adapted to a more scattered PII surface.

**Don't run any of this in this session.** This file exists so the future extraction session has the exact invocations + verification steps.

---

## 0. Pre-flight decisions

Three open questions to lock down before pushing the destination repo:

### 0.1 Destination repo name

The upstream is `santifer/career-ops`. The fork's identity needs to differentiate:

| Direction | Example |
|---|---|
| Maintainer-prefixed | `nick-ruzicka/career-ops-fde-edition` |
| Feature-flavored | `nick-ruzicka/career-ops-archetype-fit` (lands the v2 work as the headline differentiator) |
| Generic fork name | `nick-ruzicka/career-ops` (matches the local dir but doesn't signal the fork lineage) |
| New brand | something other than career-ops entirely (heavier — more reframing in README + tests + commits) |

**Default recommendation:** `nick-ruzicka/career-ops` with the fork-notice README block (already landed in PR #49) doing the lineage clarification. Cleanest, doesn't require rebranding inside the codebase.

### 0.2 Visibility on the destination

Public from day one (matches santifer's upstream + the cohortqa pattern) vs private until ready (lets you iterate without external observers). **Default: public.** If private, flag for later — productization-on-private-repo means Code Scanning gets paywalled again, same as the CodeQL issue we hit tonight.

### 0.3 Whether to push back to upstream santifer/career-ops

Some of this fork's work could be PR'd back to santifer. Probably worth it as a separate exercise — not part of the extraction. The work that would PR-cleanly back upstream (per `docs/audits/2026-05-22-upstream-delta.md` if present):

- FDE archetype expansion + sourcing queries + Tier 10 fwddeploy.com (`config/archetypes.yaml`, `scripts/scan-jobs.mjs`)
- Per-archetype qualification gate in user-context.yaml (`scripts/lib/scoring-layer.mjs` + helper)
- VERSION auto-sync workflow step (`.github/workflows/release.yml`)
- CodeQL upload skip (`.github/workflows/codeql.yml`)
- release-please config files (`release-please-config.json`, `.release-please-manifest.json`)
- Various audit docs

**This recipe assumes you're doing the standalone OSS extraction first; upstream PRs are a separate session.**

---

## 1. Tooling prereq

```bash
brew install git-filter-repo
# or:
python3 -m pip install git-filter-repo

# Verify:
git filter-repo --version    # expect: 2.45.0+
```

---

## 2. The extraction itself

### 2.1 — Inventory the PII files (to confirm the negative filter)

Every file in this list will be **excluded** from the extracted history:

```
cv.md                       — Nick's CV (Markdown)
config/profile.yml          — Nick's profile (YAML)
config/user-context.yaml    — Nick's live scoring biases — TRACKED (missed by
                              the original list; found in the 2026-06-09 audit).
                              See §10.3 for the CI implication of filtering it.
data/applications.md        — Nick's application history (Markdown table)
data/seen-urls.json         — ~1 MB of scraped role URL state
data/enrichments.json       — ~3 MB of classifications
data/score-overrides.json   — Nick's company opinions
data/signal-seen.json       — Per-company signal scan history
data/applications.md.bak    — leftover backup
data/seen-urls.json.bak2    — leftover backup
data/career-ops-events/     — per-day JSONL event logs (~11 files at extraction time)
data/chats/                 — per-day chat transcripts (PII via conversation content)
data/briefings/             — per-day briefing JSON (PII via items[].context)
interview-prep/             — entire dir: Nick's prep docs + story bank
autoapply/resumes/parsed/   — Nick's parsed resumes (HTML, generated)
autoapply/resumes/library.json — Nick's real resume bullet library (2026-06-09
                              review finding; whole-file PII)
modes/_profile.md           — Nick's profile-bound prompt
WORK_LOG_*.md               — Nick's session work logs (root)
MORNING_REPORT*.md          — Nick's morning reports if any
AUDIT_COMPANY_SURFACES.md   — tracked session work log (2026-06-09 audit)
FIX_PROPOSAL_POST_TASK_G.md — tracked session work log (2026-06-09 audit)
data/scans/                 — scan-job records + logs (Step 8, post-recipe;
                              untracked but filter defensively)
```

**NOT filtered (deliberate):** `config/companies.yml` ships as a seed list —
decision 2026-06-09 — so the public repo scans real companies out of the box.

**Each PII file has a corresponding `.example.<ext>` template already in the repo** from PR #52. The extracted repo ships the templates; users `cp` them to the real names at first run.

### 2.2 — Clone to scratch

```bash
SRC=/tmp/career-ops-extract
rm -rf "$SRC"

# Option A — clone from origin (recommended; slower but simpler):
git clone --no-local --branch main \
  https://github.com/nick-ruzicka/nick-career-ops.git "$SRC"

# Option B — clone from your local fork (faster). Substitute the path to
# your local nick-career-ops worktree:
#   git clone --no-local --branch main \
#     "file://${HOME}/path/to/nick-career-ops" "$SRC"

cd "$SRC"
```

### 2.3 — Run filter-repo with `--invert-paths` (keep everything EXCEPT the PII)

```bash
git filter-repo --force \
  --invert-paths \
  --path cv.md \
  --path config/profile.yml \
  --path config/user-context.yaml \
  --path data/applications.md \
  --path data/applications.md.bak \
  --path data/seen-urls.json \
  --path data/seen-urls.json.bak2 \
  --path data/enrichments.json \
  --path data/score-overrides.json \
  --path data/signal-seen.json \
  --path-glob 'data/career-ops-events/*' \
  --path-glob 'data/chats/*' \
  --path-glob 'data/briefings/*' \
  --path interview-prep \
  --path-glob 'autoapply/resumes/parsed/*' \
  --path autoapply/resumes/library.json \
  --path modes/_profile.md \
  --path-glob 'WORK_LOG_*.md' \
  --path-glob 'MORNING_REPORT*.md' \
  --path AUDIT_COMPANY_SURFACES.md \
  --path FIX_PROPOSAL_POST_TASK_G.md \
  --path docs/audits/2026-05-18-california-rescore-applied.md \
  --path docs/audits/2026-05-18-post-15-16-rescore-impact.md \
  --path docs/audits/session-log-2026-05-18.md \
  --path docs/handoffs \
  --path-glob 'data/scans/*' \
  --path forge \
  --path forge-qa \
  --path chariot-qa \
  --path qa \
  --path hebbia-signal-engine-reference \
  --path personalab
```

**Why `--invert-paths`:** the cohortqa recipe used positive `--path` (keep only this) because the surface to keep was small (one directory). Careerops is the opposite — almost everything stays; the PII surface is what's small and well-defined.

**The trailing `--path forge / forge-qa / chariot-qa / qa / hebbia-signal-engine-reference / personalab` entries** strip the vendored reference repos and the cohortqa source dir (which lives in this repo's history pre-extraction). All gitignored at runtime; these `--invert-paths` lines clean the *history*.

### 2.4 — Verify the filter-repo output

```bash
# Expect: every PII path is gone
for p in cv.md config/profile.yml data/applications.md data/seen-urls.json data/enrichments.json data/score-overrides.json interview-prep; do
  if [ -e "$p" ]; then echo "  ✗ STILL PRESENT: $p"; fi
done

# Expect: every example template still present
for p in cv.example.md config/profile.example.yml config/user-context.example.yaml data/applications.example.md data/score-overrides.example.json interview-prep/story-bank.example.md; do
  if [ ! -e "$p" ]; then echo "  ✗ TEMPLATE MISSING: $p"; fi
done

# Expect: framework + tests + audits all present
test -d scripts/lib && test -d dashboard-web && test -d config && test -d docs/audits || echo "✗ FRAMEWORK INCOMPLETE"
```

---

## 3. Post-filter cleanup

### 3.1 — Add a `data/.gitkeep` so the directory survives the filter

After filtering out the JSONL files inside `data/`, the directory might be empty (only `.gitkeep` and the example templates survive). If `data/` is entirely removed, scripts will fail. Confirm:

```bash
ls data/
# Expect: .gitkeep, applications.example.md, enrichments.example.json,
#         score-overrides.example.json, seen-urls.example.json
```

If `.gitkeep` is missing, add one:

```bash
touch data/.gitkeep
git add data/.gitkeep
```

### 3.2 — `interview-prep/.gitkeep` for the same reason

```bash
mkdir -p interview-prep
touch interview-prep/.gitkeep   # (if not present)
git add interview-prep/.gitkeep
```

### 3.3 — Verify .gitignore covers the now-absent files

After extraction, users will create their own `cv.md`, `config/profile.yml`, etc. We don't want those committed by mistake. Confirm `.gitignore` includes:

```
# Personal data (use the *.example.* templates to bootstrap)
cv.md
config/profile.yml
data/applications.md
data/seen-urls.json
data/enrichments.json
data/score-overrides.json
data/signal-seen.json
data/career-ops-events/
data/chats/
data/briefings/
interview-prep/*.md
!interview-prep/*.example.md
!interview-prep/.gitkeep
autoapply/resumes/parsed/
modes/_profile.md
WORK_LOG_*.md
MORNING_REPORT*.md

# Vendored reference repos
forge/
forge-qa/
chariot-qa/
qa/
hebbia-signal-engine-reference/

# CohortQA source (extracted separately)
personalab/
```

Audit the current `.gitignore` first — most of these probably already exist. Add only what's missing.

### 3.4 — Update README's Quick Start to reference the templates

The current Quick Start (in the upstream santifer README) instructs `cp config/profile.example.yml config/profile.yml` and that's it. Add the other templates to make the bootstrap obvious:

```bash
cp config/profile.example.yml config/profile.yml
cp config/user-context.example.yaml config/user-context.yaml
cp cv.example.md cv.md
cp data/applications.example.md data/applications.md
cp data/score-overrides.example.json data/score-overrides.json
cp data/seen-urls.example.json data/seen-urls.json
cp data/enrichments.example.json data/enrichments.json
cp interview-prep/story-bank.example.md interview-prep/story-bank.md
# Then edit each with your actual content.
```

### 3.5 — Commit the cleanup

```bash
git add -A
git commit -m "chore: post-extraction cleanup — .gitkeep, .gitignore audit, README quickstart refresh"
```

---

## 4. Verification gates (must hold before pushing)

### 4.1 — No PII left in committed files

```bash
# Searches for any literal PII the original Nick fork had — adjust to your
# actual real-name + email + LinkedIn for the local run.
grep -ri -E "nicholas|nick.*ruzicka|nick\.c\.ruzicka@gmail|linkedin\.com/in/nick" \
  . --exclude-dir=.git 2>/dev/null | head -5
# Expect: zero hits (or only matches in fork-notice / LICENSE attribution)
```

### 4.2 — No PII left in git HISTORY

```bash
# Slower — searches the full rewritten history for the same patterns.
git log --all -p | grep -iE "nicholas|nick\.c\.ruzicka@gmail" | head -5
# Expect: zero hits beyond the fork-notice in commits that mention Nick by name
# (those are intentional).
```

### 4.3 — All tests pass

```bash
node --test scripts/lib/*.test.mjs 2>&1 | tail -5
# Expect: 684+ tests pass (or whatever the current count is at extraction time).
# The 1 pre-existing 'generateThesis — readOnly' failure is OK if still present.
```

### 4.4 — `node test-all.mjs` smoke

```bash
node test-all.mjs 2>&1 | tail -10
# Expect: "Results: 86 passed, 4 failed" or better. If failures spike, the
# extraction took something it needed (likely a missing example template).
```

### 4.5 — Dashboard builds

```bash
cd dashboard-web
npm install
npm run build
# Expect: clean build, no missing-file errors.
cd ..
```

### 4.6 — No secrets in history

```bash
git log --all -p | grep -iE 'sk-ant-|api[_-]?key.*=.*["'\''][a-z0-9_-]{20,}' | head
# Expect: zero matches.
```

### 4.7 — Filter-repo dropped origin (expected)

```bash
git remote -v
# Expect: empty (filter-repo drops the origin remote intentionally).
```

---

## 5. Push to the new repo

Once steps 1-4 all pass:

```bash
# 5.1 — create the GitHub repo
gh repo create nick-ruzicka/career-ops --public \
  --description "AI-first job-search pipeline with per-archetype qualification gates. Fork of santifer/career-ops." \
  --homepage "https://santifer.io/career-ops-system"
# (Adjust description / homepage to taste.)

# 5.2 — point the local extracted history at it
cd "$SRC"
git remote add origin git@github.com:nick-ruzicka/career-ops.git
git branch -M main      # filter-repo renamed it; double-check it's still 'main'
git push -u origin main
```

After the push, GitHub Actions will fire (Release Please, CodeQL, etc.). Wait for them to land before tagging a release.

---

## 6. Post-publish hygiene

- [ ] Add a CI status badge to README (release-please will generate one on first cut)
- [ ] If the cv-santiago + santifer.io references in the README don't apply to this fork's audience, edit them (PR #49 noted this is an editorial decision)
- [ ] File the first GitHub Issue as "Architectural migration: AI as assistant in the pipeline" linking to `docs/audits/2026-05-28-ai-feature-audit.md`
- [ ] File the second issue as "v3 productization: auto-populate archetype_fit from CV" linking to the per-archetype-experience-bar memory note
- [ ] Mark the careerops `main` branch on the source fork as merged-and-archived if the extraction stays current

---

## 7. What this recipe does NOT do

- **Doesn't run the extraction.** That's the next session.
- **Doesn't decide the final repo name.** Open question §0.1.
- **Doesn't write a CHANGELOG from scratch.** release-please will pick up from the next conventional-commit. The historical CHANGELOG.md (currently at root) is from upstream santifer; consider whether to keep it as-is or reset to "Releases from this fork start at <date>".
- **Doesn't add a CONTRIBUTING.md.** Worth doing as a follow-up if the project picks up contributors. For v0 of the extracted repo, the upstream santifer CONTRIBUTING is still accurate enough.

---

## 8. Cost of running this recipe

`git filter-repo` is local-only ($0). All verification gates are local ($0). One CI run on first push to verify ($0 for public repos). **Total: $0.** Same shape as the cohortqa recipe.

---

## 9. Source state this recipe was written against

- **Branch:** `main`
- **Tip:** see `git log -1 origin/main` (at time of writing this was post-PR #52)
- **Tests:** 684 passing in `scripts/lib/*.test.mjs` (1 pre-existing failure unrelated)
- **PII surface:** 7 primary files + 3 directories (per §2.1)
- **Templates:** 8 `.example.*` files (per the inventory in §2.1 verification)

If `main` advances substantially before the extraction session, re-read §2.1 against the new tip — particularly look for any new files under `data/` or any new personal docs that landed since.

---

## 10. Addendum — 2026-06-09 refresh (pre-extraction audit)

Re-audited per §9 against tip `5d2f045` (post-PR #78). Changes folded into
§2.1/§2.3 above, plus the decisions and one new gotcha below.

### 10.1 Decisions locked (resolves §0)

- **§0.1 repo name → NEW BRAND** (not `nick-ruzicka/career-ops`). Name itself
  still TBD. This is the heavier path: before pushing, also do the rebrand
  pass — README title/intro rewrite (keep the santifer fork-notice for
  lineage), `package.json` + `dashboard-web/package.json` name fields,
  `CITATION.cff`, `release-please-config.json` package name, and any
  "career-ops" strings in dashboard chrome (header/title tags).
- **§0.2 visibility → public** from day one (unchanged default).
- **`config/companies.yml` → ships as seed** (user decision 2026-06-09). It
  only lists public AI companies + ATS slugs; gives adopters a working scan
  out of the box. NOT in the filter list.

### 10.2 PII surface delta since 2026-05-28

| New finding | Disposition |
|---|---|
| `config/user-context.yaml` tracked (live comp floor, hard nos, archetype_fit) | added to §2.3 filter |
| `AUDIT_COMPANY_SURFACES.md`, `FIX_PROPOSAL_POST_TASK_G.md` tracked at root | added to §2.3 filter |
| `data/career-ops-events/career-ops-2026-05-17.jsonl` tracked (one stray) | already covered by the §2.3 glob; untracked + gitignored in the source repo by the 2026-06-09 hygiene PR |
| `data/scans/` (Step 8 job records + logs) not gitignored | gitignored in source repo by the same PR; defensive glob added to §2.3 |

### 10.3 CI gotcha — filtering config/user-context.yaml breaks the build

`scripts/lib/comp-floor.mjs` (and `scoring-layer.mjs`, and the
comp-floor-consistency test) read `config/user-context.yaml` and **throw if
it's missing**. Today CI passes because the file is tracked. After extraction
it won't exist in a fresh checkout, so before pushing the extracted repo,
pick one:

1. **CI bootstrap step** (cheapest): add
   `cp config/user-context.example.yaml config/user-context.yaml` to the
   workflow before tests/build, and the same line at the top of the README
   quickstart (§3.4 already lists it).
2. **Loader fallback** (nicer DX): make the loaders fall back to
   `user-context.example.yaml` with a stderr warning when the real file is
   absent. One-time code change; first-run experience works with zero setup.

Verify with §4.3–4.5 *after* removing the file locally, not before — that's
the state a fresh clone will see.

### 10.4 Content-level PII in autoapply/ — needs a genericize pass, not path filtering

Independent review (2026-06-09) found Nick's real identity (last name,
LinkedIn, GitHub handle) baked INTO tracked source/fixture/doc files under
`autoapply/`. Path filtering can't fix these — the files must ship, so the
strings must be genericized (Jane-Doe-style persona) in a commit BEFORE the
extraction:

```
autoapply/profile.json.example          — real identity in the template itself
autoapply/chrome-extension/popup/popup.js — real identity as hardcoded defaults
autoapply/chrome-extension/README.md
autoapply/resume_parser.py
autoapply/skills/ashby/SKILL.md
autoapply/tests/test_apply_cli.py
autoapply/tests/test_draft_answers.py
autoapply/tests/test_resume_parser.py
```

(`autoapply/resumes/library.json` is whole-file PII — Nick's real resume
bullet library — and was added to the §2.3 filter list instead. The
`autoapply/resumes/parsed/*` glob already covered the parsed HTML.)

Because the genericize commit lands before extraction, the OLD revisions of
these files still carry the strings in history — but §4.2's history-wide grep
is the gate for that. If it still hits on autoapply paths post-filter, either
add the offending historical paths to §2.3 or use
`git filter-repo --replace-text` with a mapping like
`Ruzicka==>Doe` / `nicholas-ruzicka-0x==>jane-doe-example`.

Verification (run after the genericize commit, expect only public-handle
GitHub-URL hits in docs/CHANGELOG):

```bash
git grep -liE "ruzicka|nick\.c\.ruzicka|650.?554" -- ':!node_modules'
```

Run on 2026-06-09 (post-genericize): remaining hits are LICENSE + README
fork-notice attribution (intentional), CHANGELOG/recipe GitHub-URL public
handles (fine), and four personal session docs — three 2026-05-18 audit
docs + docs/handoffs/ — which were added to the §2.3 filter list.

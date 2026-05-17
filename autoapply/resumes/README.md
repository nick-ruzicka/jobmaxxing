# Resume Library

The resume library is the source of truth for which bullets, roles, and skill
sets feed each archetype's CV generation, classifier evidence, and Apply-button
handoff.

## Layout

```
autoapply/resumes/
├── source/                 # PDFs — PII, gitignored, never commit
│   ├── gtm-engineering.pdf
│   ├── ai-operations.pdf
│   ├── fde.pdf
│   ├── web3-bd.pdf
│   └── web3-bizops.pdf
├── parsed/                 # Structured HTML — committed
│   ├── gtm-engineering.html
│   ├── ai-operations.html
│   ├── fde.html
│   ├── web3-bd.html
│   └── web3-bizops.html
├── library.json            # Cross-archetype bullet index — committed
└── README.md               # This file
```

## Two layers

**Source PDFs** (`source/`) are the human-readable, ATS-submittable artifacts.
They contain PII (address, phone, email) and are gitignored via the pattern
`autoapply/resumes/source/*.pdf`.

**Parsed HTML + library.json** (`parsed/`, `library.json`) are the structured
form. They contain the same content but with stable IDs, archetype tags, and
provenance tracking. These are committed because downstream code (classifier,
Apply-handoff, /context UI) reads them — they need to survive fresh clones.

## library.json schema

```jsonc
{
  "archetypes": ["ai-operations", "fde", "gtm-engineering", "web3-bd", "web3-bizops"],
  "bullets": [
    {
      "id": "bullet-001",                   // stable, sequential
      "text": "Built ...",                  // canonical text (longest of variants)
      "archetypes": ["fde", "gtm-engineering"],  // which resumes contain this bullet
      "tags": ["supabase", "nextjs", "hubspot", "technical", "linera"],
      "impact_metric": "+18%, 3x, 85%" | null,
      "role": "linera"                      // company slug
    },
    ...
  ],
  "current_titles_at_linera": [
    "GTM Engineer & Head of Business Development",
    "AI Operations Lead & Head of Business Development",
    ...
  ]
}
```

Bullets that appear (with fuzzy-similar wording) in 2+ resumes are collapsed
into one library entry with all source archetypes listed. The fuzzy match
threshold is `SIMILARITY_THRESHOLD = 0.80` in `resume_library.py` (using
stdlib `difflib.SequenceMatcher`).

## Parsed HTML data attributes

Every bullet in `parsed/*.html` carries:

- `data-id="gte-001"` — unique per archetype, with archetype-specific prefix:
  - gtm-engineering → `gte-NNN`
  - ai-operations → `aio-NNN`
  - fde → `fde-NNN`
  - web3-bd → `w3b-NNN`
  - web3-bizops → `w3o-NNN`
- `data-archetype="<archetype-id>"`
- `data-tags="tag1,tag2,..."` — extracted keywords + the parent role slug
- `data-impact-metric="..."` — extracted quantitative markers, if any

Each `<section class="role">` carries `data-company="<slug>"` and
`data-archetype-title="<title>"` so consumers can filter or substitute.

## Regenerating

To rebuild the parsed HTML + library after editing any source PDF:

```bash
autoapply/.venv/bin/python autoapply/cli/parse_resumes.py
```

That command:

1. Reads every PDF in `source/` whose name matches a known archetype
2. Extracts text via pdfplumber
3. Parses into the structured dict
4. Emits one HTML file per archetype to `parsed/`
5. Aggregates all parsed dicts into `library.json` with cross-archetype dedup

## Setup

The CLI requires pdfplumber. First-time setup:

```bash
cd autoapply
python3 -m venv .venv
.venv/bin/pip install pdfplumber
```

The unit tests in `autoapply/tests/test_resume_parser.py` work against fixture
text and have **no pdfplumber dependency** — they run on a stock Python 3
install.

## Adding a new archetype

1. Drop the new PDF at `autoapply/resumes/source/<archetype-id>.pdf` (matching
   filename to archetype id).
2. Add the archetype id to the `ARCHETYPES` list in
   `autoapply/cli/parse_resumes.py`.
3. Add a bullet-prefix entry to `BULLET_PREFIX` in `autoapply/resume_html_writer.py`.
4. Re-run the CLI.
5. Add the archetype to `config/archetypes.yaml` (G2).

## Manual overrides

If the parser produces a wrong tag or impact metric on a specific bullet, prefer
fixing the regex/keyword map in `autoapply/resume_parser.py` (it generalizes).
Hand-editing `parsed/*.html` works as a last resort, but the next CLI run will
overwrite the change — better to encode the fix as a rule.

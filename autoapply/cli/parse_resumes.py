"""CLI: parse all source resume PDFs into HTML + library.json.

Usage
-----
    autoapply/.venv/bin/python autoapply/cli/parse_resumes.py

Reads every PDF in autoapply/resumes/source/ named after one of the supported
archetypes, parses it via pdfplumber, emits an HTML file in
autoapply/resumes/parsed/, and writes the aggregated library to
autoapply/resumes/library.json.

The source PDFs are PII and gitignored — only the parsed HTML + library.json
are committed.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pdfplumber  # type: ignore

# Make the autoapply package importable when this CLI is run directly.
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from autoapply.resume_parser import parse_resume_text  # noqa: E402
from autoapply.resume_html_writer import render_resume_html  # noqa: E402
from autoapply.resume_library import build_library  # noqa: E402


ARCHETYPES = [
    "gtm-engineering",
    "ai-operations",
    "fde",
    "web3-bd",
    "web3-bizops",
]


def extract_pdf_text(pdf_path: Path) -> str:
    """Concatenate text from all pages of a PDF."""
    chunks = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            txt = page.extract_text() or ""
            chunks.append(txt)
    return "\n".join(chunks)


def main() -> int:
    source_dir = ROOT / "autoapply" / "resumes" / "source"
    parsed_dir = ROOT / "autoapply" / "resumes" / "parsed"
    library_path = ROOT / "autoapply" / "resumes" / "library.json"

    parsed_dir.mkdir(parents=True, exist_ok=True)

    parsed_by_archetype = {}
    missing = []
    for archetype in ARCHETYPES:
        pdf_path = source_dir / f"{archetype}.pdf"
        if not pdf_path.exists():
            missing.append(archetype)
            continue
        text = extract_pdf_text(pdf_path)
        parsed = parse_resume_text(text)
        parsed_by_archetype[archetype] = parsed

        html_doc = render_resume_html(parsed, archetype)
        html_path = parsed_dir / f"{archetype}.html"
        html_path.write_text(html_doc, encoding="utf-8")
        n_bullets = sum(len(r.get("bullets", [])) for r in parsed.get("experience", []))
        n_roles = len(parsed.get("experience", []))
        print(f"  {archetype}: {n_roles} roles, {n_bullets} bullets → {html_path.relative_to(ROOT)}")

    if missing:
        print(f"WARNING: missing PDFs for archetypes: {missing}", file=sys.stderr)

    library = build_library(parsed_by_archetype)
    library_path.write_text(json.dumps(library, indent=2) + "\n", encoding="utf-8")

    unique = len(library["bullets"])
    cross = sum(1 for b in library["bullets"] if len(b["archetypes"]) > 1)
    singletons = unique - cross
    print()
    print("=== library summary ===")
    print(f"  archetypes: {library['archetypes']}")
    print(f"  unique bullets: {unique}")
    print(f"  cross-archetype (>=2 resumes): {cross}")
    print(f"  singletons: {singletons}")
    print(f"  current Linera titles: {len(library['current_titles_at_linera'])}")
    print(f"  → {library_path.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

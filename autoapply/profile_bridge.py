"""profile_bridge.py — load Nick's structured profile for AutoApply.

Reads three sources, in order of preference:

  1. ``autoapply/profile.json`` (the canonical structured profile — gitignored)
  2. ``modes/_profile.md``      (read-only narrative profile — used as context
                                  only, never modified)
  3. ``data/applications.md``   (read-only application history — supplies the
                                  list of companies / titles already applied to,
                                  so downstream code can avoid re-applying)

Pure stdlib (json, pathlib). No external dependencies — keeps the Python side
of AutoApply self-contained so the same code can run in browser-harness
sandboxes that may not have pip installed.

Schema:  see ``autoapply/profile.json.example`` for the canonical structure.
Placeholders look like ``REPLACE_WITH_*`` strings; downstream code uses
``is_placeholder()`` to detect them and skip form fields rather than fill
junk.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Paths — resolved relative to the repo root (autoapply/.. = nick-career-ops/)
# ---------------------------------------------------------------------------

_REPO_ROOT = Path(__file__).resolve().parent.parent
PROFILE_JSON_PATH = _REPO_ROOT / "autoapply" / "profile.json"
PROFILE_EXAMPLE_PATH = _REPO_ROOT / "autoapply" / "profile.json.example"
PROFILE_MD_PATH = _REPO_ROOT / "modes" / "_profile.md"
APPLICATIONS_MD_PATH = _REPO_ROOT / "data" / "applications.md"

# Detect either an explicit "REPLACE_WITH_*" prefix or two-or-more-X marker
# anywhere in the string (case-insensitive). See SKILL.md PLACEHOLDER GUARD.
_PLACEHOLDER_RE = re.compile(r"(REPLACE_WITH_|X{2,})", re.IGNORECASE)


def is_placeholder(value: Any) -> bool:
    """Return True if a profile value is a placeholder that must NOT be filled.

    Placeholders match either ``REPLACE_WITH_*`` (the schema's convention) or
    ``XX`` (legacy convention, kept for belt-and-suspenders per SKILL.md rule 6).
    """
    if not isinstance(value, str):
        return False
    return bool(_PLACEHOLDER_RE.search(value))


class ProfileError(Exception):
    """Raised when the profile is missing or unparseable."""


def _read_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def get_profile(*, profile_path: Path | None = None) -> dict:
    """Load the structured profile from ``autoapply/profile.json``.

    If the file doesn't exist, raise ``ProfileError`` with the recommended fix
    (copy the example into place, then fill in REPLACE_WITH_* values).

    ``profile_path`` is an injection seam for tests.
    """
    path = profile_path or PROFILE_JSON_PATH
    if not path.exists():
        msg = (
            f"profile not found: {path}\n"
            f"copy {PROFILE_EXAMPLE_PATH.name} into place and fill in the "
            f"REPLACE_WITH_* values:\n"
            f"  cp {PROFILE_EXAMPLE_PATH} {PROFILE_JSON_PATH}"
        )
        raise ProfileError(msg)
    try:
        return _read_json(path)
    except json.JSONDecodeError as exc:
        raise ProfileError(f"profile JSON parse error at {path}: {exc}") from exc


def load_applications_md(*, applications_path: Path | None = None) -> str:
    """Return the raw text of ``data/applications.md`` (read-only).

    Empty string if the file doesn't exist — applications.md is protected and
    we never create or modify it.
    """
    path = applications_path or APPLICATIONS_MD_PATH
    if not path.exists():
        return ""
    return path.read_text(encoding="utf-8")


def load_profile_md(*, profile_md_path: Path | None = None) -> str:
    """Return the raw text of ``modes/_profile.md`` (read-only).

    Used as supplemental narrative context for draft_answers; never modified.
    """
    path = profile_md_path or PROFILE_MD_PATH
    if not path.exists():
        return ""
    return path.read_text(encoding="utf-8")


def applied_companies(applications_md: str | None = None) -> set[str]:
    """Extract the set of canonical company names already in applications.md.

    Conservative: pulls every line beginning with a ``- `` bullet that appears
    to name a company. Caller can intersect with discoveries to filter
    duplicates.
    """
    text = applications_md if applications_md is not None else load_applications_md()
    out: set[str] = set()
    for line in text.splitlines():
        # Typical row shape: "- [Company Name](url) — date — status — notes"
        # or simpler: "- Company Name — date — status"
        match = re.match(r"^\s*-\s+\[?([^\]\n|—]+?)\]?\s*[(—|]", line)
        if match:
            name = match.group(1).strip()
            if name:
                out.add(name)
    return out

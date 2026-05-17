"""Aggregate parsed resumes from multiple archetypes into a single library.

Cross-archetype dedup: bullets with normalized-text similarity above
SIMILARITY_THRESHOLD are treated as the same bullet (Nick wrote one bullet,
phrased slightly differently across resumes). The library entry tracks which
archetypes the bullet appears in.

Public entry point
------------------
build_library(parsed_by_archetype) -> dict
"""

from __future__ import annotations

import re
from difflib import SequenceMatcher
from typing import Dict, List, Tuple

from autoapply.resume_parser import (
    extract_bullet_tags,
    extract_impact_metrics,
    slug_company,
)


SIMILARITY_THRESHOLD = 0.80  # ratio in [0,1]; >=0.80 ≈ "same bullet, different wording"


def build_library(parsed_by_archetype: Dict[str, Dict]) -> Dict:
    """Aggregate parsed resumes into a library index.

    Parameters
    ----------
    parsed_by_archetype : dict[str, dict]
        Maps archetype id → parsed resume dict (output of parse_resume_text).

    Returns
    -------
    {
      "archetypes": [archetype_ids...],
      "bullets": [
        {
          "id": "bullet-001",
          "text": "...",
          "archetypes": [archetype_ids...],
          "tags": [tag, tag, ...],
          "impact_metric": "+18% SQLs..." | None,
          "role": "linera"
        },
        ...
      ],
      "current_titles_at_linera": [...]
    }
    """
    archetype_ids = sorted(parsed_by_archetype.keys())

    # Flatten: one entry per bullet-occurrence
    occurrences: List[Dict] = []
    for archetype_id in archetype_ids:
        parsed = parsed_by_archetype[archetype_id]
        for role in parsed.get("experience", []):
            company = role.get("company", "")
            role_slug = slug_company(company)
            for bullet in role.get("bullets", []):
                text = bullet["text"] if isinstance(bullet, dict) else str(bullet)
                occurrences.append(
                    {
                        "text": text,
                        "archetype": archetype_id,
                        "role": role_slug,
                        "normalized": _normalize_for_match(text),
                    }
                )

    groups = _group_similar(occurrences)

    bullets_out: List[Dict] = []
    for i, group in enumerate(groups, start=1):
        canonical = max(group, key=lambda o: len(o["text"]))
        archetypes_in_group = sorted({o["archetype"] for o in group})
        roles_in_group = sorted({o["role"] for o in group if o["role"]})
        # Tags = union across all occurrences (different archetypes may have
        # slightly different wording surfaces different tags)
        tag_set: List[str] = []
        seen_tags = set()
        for o in group:
            for t in extract_bullet_tags(o["text"], o["role"]):
                if t not in seen_tags:
                    tag_set.append(t)
                    seen_tags.add(t)
        impact = None
        for o in group:
            metric = extract_impact_metrics(o["text"])
            if metric:
                impact = metric
                break
        bullets_out.append(
            {
                "id": f"bullet-{i:03d}",
                "text": canonical["text"],
                "archetypes": archetypes_in_group,
                "tags": tag_set,
                "impact_metric": impact,
                "role": roles_in_group[0] if roles_in_group else "",
            }
        )

    # First role per resume = Linera (current). Collect titles.
    linera_titles: List[str] = []
    seen_titles = set()
    for archetype_id in archetype_ids:
        parsed = parsed_by_archetype[archetype_id]
        roles = parsed.get("experience", [])
        if not roles:
            continue
        first = roles[0]
        title = first.get("title", "").strip()
        if title and title not in seen_titles:
            linera_titles.append(title)
            seen_titles.add(title)

    return {
        "archetypes": archetype_ids,
        "bullets": bullets_out,
        "current_titles_at_linera": linera_titles,
    }


# ─── internals ────────────────────────────────────────────────────────────────


def _normalize_for_match(text: str) -> str:
    """Lowercase + collapse whitespace + strip punctuation for fuzzy comparison."""
    s = text.lower()
    s = re.sub(r"[^a-z0-9\s]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _group_similar(occurrences: List[Dict]) -> List[List[Dict]]:
    """Union-find-style grouping by similarity."""
    n = len(occurrences)
    parent = list(range(n))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(i: int, j: int) -> None:
        ri, rj = find(i), find(j)
        if ri != rj:
            parent[ri] = rj

    # Only compare bullets in the same role — different roles are never the
    # "same bullet" even if phrased similarly.
    for i in range(n):
        for j in range(i + 1, n):
            if occurrences[i]["role"] != occurrences[j]["role"]:
                continue
            ratio = SequenceMatcher(
                None, occurrences[i]["normalized"], occurrences[j]["normalized"]
            ).ratio()
            if ratio >= SIMILARITY_THRESHOLD:
                union(i, j)

    groups: Dict[int, List[Dict]] = {}
    for i in range(n):
        groups.setdefault(find(i), []).append(occurrences[i])

    # Sort groups by representative occurrence order (stable, deterministic)
    return [groups[k] for k in sorted(groups.keys())]

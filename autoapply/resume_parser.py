"""Parse resume text (extracted from PDF) into a structured dict.

The PDF reading lives in `cli/parse_resumes.py` (pdfplumber). This module is
pure stdlib so the unit tests can run against fixture text without installing
pdfplumber.

Public entry points
-------------------
parse_resume_text(text)            -> dict
extract_bullet_tags(text, role)    -> list[str]
extract_impact_metrics(text)       -> str | None
slug_company(name)                 -> str
"""

from __future__ import annotations

import re
from typing import Dict, List, Optional, Tuple


# ─── regexes ──────────────────────────────────────────────────────────────────

# Date range at line end: "2024 – Present", "2019 – 2021", "2014–2017"
DATE_RANGE_RE = re.compile(
    r"\b(?:19|20)\d{2}\s*[–—-]\s*(?:(?:19|20)\d{2}|Present)\s*$"
)
# Bare year at line end
SINGLE_YEAR_RE = re.compile(r"\b(?:19|20)\d{2}\s*$")

EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
PHONE_RE = re.compile(
    r"\(\d{3}\)\s*\d{3}[-\s]?\d{4}|\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b"
)
# Trailing "City, ST" or "City Name, State". Cities are Title Case (uppercase
# followed by at least one lowercase), so this regex won't swallow ALL-CAPS
# company suffixes like "NICK RUZICKA CONSULTING".
LOCATION_END_RE = re.compile(
    r"\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*,\s*(?:[A-Z]{2}|[A-Z][a-z]+))\s*$"
)

SECTION_HEADERS = {
    "EXPERIENCE": "experience",
    "PROFESSIONAL EXPERIENCE": "experience",
    "EDUCATION": "education",
    "SKILLS": "skills",
    "SKILLS & INTERESTS": "skills",
}


# ─── public API ───────────────────────────────────────────────────────────────


def parse_resume_text(text: str) -> Dict:
    """Parse a resume's full text into a structured dict.

    Returns
    -------
    {
      "identity": {name, subtitle, location, email, phone, linkedin, github},
      "experience": [{company, company_descriptor, location, title, dates, bullets: [{text}]}],
      "education": [{institution, degree, dates, bullets: [...]}],
      "skills": {category: [items]},
    }
    """
    lines = [ln.rstrip() for ln in text.split("\n") if ln.strip()]

    sections = _split_sections(lines)

    return {
        "identity": _parse_header(sections.get("header", [])),
        "experience": _parse_experience(sections.get("experience", [])),
        "education": _parse_education(sections.get("education", [])),
        "skills": _parse_skills(sections.get("skills", [])),
    }


def slug_company(name: str) -> str:
    """Stable slug for a company/institution name."""
    if not name:
        return ""
    s = name.lower()
    # Drop trailing parens content (descriptors)
    s = re.sub(r"\s*\([^)]*\)", "", s)
    # Drop ampersands and special chars
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")


# ─── tag and impact extraction ────────────────────────────────────────────────

# Lowercase keyword → tag emitted. First match wins; multiple keywords may map
# to the same tag (we dedupe).
KEYWORD_TAG_MAP: List[Tuple[str, str]] = [
    # Technical stack
    ("supabase", "supabase"),
    ("next.js", "nextjs"),
    ("nextjs", "nextjs"),
    ("pgvector", "pgvector"),
    ("typescript", "typescript"),
    ("javascript", "javascript"),
    ("python", "python"),
    ("react", "react"),
    ("ruby on rails", "rails"),
    ("rails", "rails"),
    ("rust", "rust"),
    ("tailwind", "tailwind"),
    ("sql", "sql"),
    # AI
    ("claude api", "claude-api"),
    ("claude-powered", "claude-api"),
    ("claude code", "claude-code"),
    ("claude", "claude"),
    ("llm", "llm"),
    ("gpt", "gpt"),
    ("autonomous", "autonomous"),
    ("agent", "agent"),
    ("ai-native", "ai-native"),
    ("ai-first", "ai-first"),
    ("ai-powered", "ai-powered"),
    # GTM stack
    ("salesforce", "salesforce"),
    ("hubspot", "hubspot"),
    ("clay", "clay"),
    ("apollo", "apollo"),
    ("outreach", "outreach"),
    ("snowflake", "snowflake"),
    ("zapier", "zapier"),
    ("n8n", "n8n"),
    # Domain / web3
    ("tokenomics", "tokenomics"),
    ("on-chain", "on-chain"),
    ("exchange listing", "exchange-listing"),
    ("market-maker", "market-maker"),
    ("oracle", "oracle-infra"),
    ("bridge", "bridge-infra"),
    ("chainlink", "chainlink"),
    ("morpho", "morpho"),
    ("liquid staking", "liquid-staking"),
    ("celestia", "celestia"),
    ("zk proof", "zk"),
    ("zero-knowledge", "zk"),
    ("regulatory", "regulatory"),
    ("compliance", "compliance"),
    ("legal counsel", "legal"),
    ("vendor evaluation", "vendor-eval"),
    ("due diligence", "due-diligence"),
    # Function tags
    ("revops", "revops"),
    ("bizops", "bizops"),
    ("fundrais", "fundraising"),
    ("partnership", "partnerships"),
    ("enterprise", "enterprise"),
    ("signal", "signals"),
    ("lead scoring", "lead-scoring"),
    ("lead routing", "lead-routing"),
    ("attribution", "attribution"),
    ("enrichment", "enrichment"),
    ("forecasting", "forecasting"),
    ("crm", "crm"),
]

# Action verbs that signal "technical / builder" work
_BUILDER_VERBS = ("built", "shipped", "deployed", "designed and implemented")

# Impact-metric regex — combined alternation so finditer produces
# non-overlapping matches. Order matters: longer/more-specific patterns first.
IMPACT_METRIC_RE = re.compile(
    r"\$\d[\d,.]*\s*[KMB]\b"          # $1.8M, $501K
    r"|\b\d+(?:\.\d+)?[KMB]\+?\b"     # 4.5M+, 100K
    r"|\$\d[\d,.]*\b"                  # $501 (no K/M/B suffix)
    r"|\+\d+%"                          # +18%
    r"|\b\d+x\b"                        # 3x (word boundaries avoid m0x false-positive)
    r"|\b\d+%"                          # 85%
    r"|\b\d{2,4}\+(?!\d)"               # 200+ (not followed by another digit)
    r"|\b\d+(?:,\d{3})+\b"             # 1,000
)


def extract_bullet_tags(text: str, role_slug: str) -> List[str]:
    """Extract semantic tags from bullet text plus the parent role slug."""
    tags: List[str] = []
    seen: set = set()
    lowered = text.lower()
    for keyword, tag in KEYWORD_TAG_MAP:
        if keyword in lowered and tag not in seen:
            tags.append(tag)
            seen.add(tag)
    if any(v in lowered for v in _BUILDER_VERBS) and "technical" not in seen:
        tags.append("technical")
        seen.add("technical")
    if extract_impact_metrics(text) and "measurable" not in seen:
        tags.append("measurable")
        seen.add("measurable")
    if role_slug and role_slug not in seen:
        tags.append(role_slug)
        seen.add(role_slug)
    return tags


def extract_impact_metrics(text: str) -> Optional[str]:
    """Concatenate any quantitative impact markers found in the bullet."""
    found: List[str] = []
    for m in IMPACT_METRIC_RE.finditer(text):
        tok = m.group(0)
        if tok not in found:
            found.append(tok)
    return ", ".join(found) if found else None


# ─── internals ────────────────────────────────────────────────────────────────


def _split_sections(lines: List[str]) -> Dict[str, List[str]]:
    sections: Dict[str, List[str]] = {"header": []}
    current = "header"
    for line in lines:
        stripped = line.strip()
        if stripped in SECTION_HEADERS:
            current = SECTION_HEADERS[stripped]
            sections.setdefault(current, [])
            continue
        sections.setdefault(current, []).append(line)
    return sections


def _parse_header(lines: List[str]) -> Dict:
    identity = {
        "name": "",
        "subtitle": "",
        "location": "",
        "email": "",
        "phone": "",
        "linkedin": "",
        "github": "",
    }
    if not lines:
        return identity
    identity["name"] = lines[0].strip()
    contact_idx = next((i for i, ln in enumerate(lines) if EMAIL_RE.search(ln)), None)
    if contact_idx is not None and contact_idx > 1:
        identity["subtitle"] = " ".join(ln.strip() for ln in lines[1:contact_idx])
    if contact_idx is not None:
        identity.update(_parse_contact(lines[contact_idx]))
    return identity


def _parse_contact(line: str) -> Dict:
    out = {"location": "", "email": "", "phone": "", "linkedin": "", "github": ""}
    m = EMAIL_RE.search(line)
    if m:
        out["email"] = m.group(0)
    m = PHONE_RE.search(line)
    if m:
        out["phone"] = m.group(0).strip()
    parts = re.split(r"\s*[•|]\s*", line)
    for part in parts:
        p = part.strip()
        if not p:
            continue
        if EMAIL_RE.fullmatch(p) or PHONE_RE.fullmatch(p):
            continue
        if p == "LinkedIn":
            out["linkedin"] = "LinkedIn"
        elif p == "GitHub":
            out["github"] = "GitHub"
        elif not out["location"]:
            # Try to extract a "City, ST" or "City, State" suffix
            m_loc = re.search(
                r"([A-Z][a-zA-Z .]+,\s*(?:[A-Z]{2}|[A-Z][a-z]+))\s*$", p
            )
            if m_loc:
                out["location"] = re.sub(r"\s+", " ", m_loc.group(1)).strip()
    return out


def _is_mostly_upper(token: str) -> bool:
    letters = [c for c in token if c.isalpha()]
    if not letters:
        return False
    return sum(1 for c in letters if c.isupper()) / len(letters) > 0.8


def _normalize_company_name(name: str) -> str:
    """Title-case ALL-CAPS company names; leave already-cased names alone.

    Heuristic:
    - Single-word names <=4 chars stay as-is (stylized brands like PAYY, AWS, META).
    - Single-word names >4 chars are title-cased (LINERA → Linera, ORACLE → Oracle).
    - Multi-word names get every word title-cased (NICK RUZICKA CONSULTING →
      Nick Ruzicka Consulting), parenthesized tokens preserved as-is.
    """
    if not _is_mostly_upper(name):
        return name
    pieces = name.split()
    if len(pieces) == 1:
        only = pieces[0]
        return only if len(only) <= 4 else only.capitalize()
    out: List[str] = []
    for piece in pieces:
        if piece.startswith("(") and piece.endswith(")"):
            out.append(piece)
        else:
            out.append(piece.capitalize())
    return " ".join(out)


def _parse_company_line(line: str) -> Tuple[str, str, str]:
    """Parse 'LINERA (Layer 1 Blockchain) New York, NY' → (company, descriptor, location)."""
    location = ""
    m = LOCATION_END_RE.search(line)
    if m:
        location = re.sub(r"\s+", " ", m.group(1)).strip()
        line = line[: m.start()].rstrip()
    descriptor = ""
    m = re.search(r"\s*\(([^)]+)\)\s*", line)
    if m:
        descriptor = m.group(1).strip()
        line = (line[: m.start()] + line[m.end() :]).strip()
    company = _normalize_company_name(line.strip())
    return company, descriptor, location


def _parse_title_line(line: str) -> Tuple[str, str]:
    m = DATE_RANGE_RE.search(line)
    if not m:
        m = SINGLE_YEAR_RE.search(line)
    if m:
        return line[: m.start()].strip(), m.group(0).strip()
    return line.strip(), ""


def _merge_bullets(lines: List[str]) -> List[str]:
    out: List[str] = []
    current: Optional[str] = None
    for line in lines:
        if line.startswith("• "):
            if current is not None:
                out.append(re.sub(r"\s+", " ", current).strip())
            current = line[2:].strip()
        else:
            if current is not None:
                current += " " + line.strip()
            # else: a stray non-bullet line — ignore (shouldn't happen in normal layouts)
    if current is not None:
        out.append(re.sub(r"\s+", " ", current).strip())
    return out


def _parse_experience(lines: List[str]) -> List[Dict]:
    """Find role headers (company + title-with-dates pairs) and group bullets under each.

    Strategy: a title line is any non-bullet line ending in a year/year-range.
    The line immediately before each title is the company line. Bullets between
    one title and the next belong to that role.
    """
    if not lines:
        return []

    title_indices = [
        i for i, ln in enumerate(lines)
        if not ln.startswith("• ")
        and (DATE_RANGE_RE.search(ln) or SINGLE_YEAR_RE.search(ln))
    ]

    roles: List[Dict] = []
    for j, ti in enumerate(title_indices):
        if ti == 0:
            continue  # no company line precedes — malformed, skip
        company_idx = ti - 1
        if lines[company_idx].startswith("• "):
            # The line before the title is a bullet — likely a parse artifact; skip
            continue
        body_start = ti + 1
        body_end = (title_indices[j + 1] - 1) if j + 1 < len(title_indices) else len(lines)
        company, descriptor, location = _parse_company_line(lines[company_idx])
        title, dates = _parse_title_line(lines[ti])
        bullets = _merge_bullets(lines[body_start:body_end])
        roles.append(
            {
                "company": company,
                "company_descriptor": descriptor,
                "location": location,
                "title": title,
                "dates": dates,
                "bullets": [{"text": b} for b in bullets],
            }
        )
    return roles


def _parse_education(lines: List[str]) -> List[Dict]:
    """Education entries. Two formats observed:
       A) 'Institution — Degree YYYY – YYYY'  (single line, em-dash separator)
       B) 'INSTITUTION City, ST' / 'Degree YYYY – YYYY' (two lines, ALL CAPS first)
       Both may be followed by bullet lines."""
    entries: List[Dict] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        if line.startswith("• "):
            # Bullet attached to most recent entry
            if entries:
                entries[-1].setdefault("bullets", []).append({"text": _merge_bullets([line])[0]})
            i += 1
            continue
        if " — " in line and (DATE_RANGE_RE.search(line) or SINGLE_YEAR_RE.search(line)):
            entries.append(_parse_education_a(line))
            i += 1
        elif i + 1 < len(lines) and (DATE_RANGE_RE.search(lines[i + 1]) or SINGLE_YEAR_RE.search(lines[i + 1])):
            entries.append(_parse_education_b(line, lines[i + 1]))
            i += 2
        else:
            i += 1
    return entries


def _parse_education_a(line: str) -> Dict:
    m = DATE_RANGE_RE.search(line) or SINGLE_YEAR_RE.search(line)
    dates = m.group(0).strip() if m else ""
    head = line[: m.start()].strip() if m else line.strip()
    parts = head.split(" — ", 1)
    inst = parts[0].strip()
    degree = parts[1].strip() if len(parts) > 1 else ""
    return {"institution": inst, "degree": degree, "dates": dates, "bullets": []}


def _parse_education_b(line1: str, line2: str) -> Dict:
    m_loc = LOCATION_END_RE.search(line1)
    inst_raw = line1[: m_loc.start()].rstrip() if m_loc else line1.strip()
    inst = _normalize_company_name(inst_raw)
    m = DATE_RANGE_RE.search(line2) or SINGLE_YEAR_RE.search(line2)
    dates = m.group(0).strip() if m else ""
    degree = line2[: m.start()].strip() if m else line2.strip()
    return {"institution": inst, "degree": degree, "dates": dates, "bullets": []}


def _parse_skills(lines: List[str]) -> Dict[str, List[str]]:
    skills: Dict[str, List[str]] = {}
    for line in lines:
        if line.startswith("• "):
            continue
        m = re.match(r"^([^:]+):\s*(.+)$", line.strip())
        if not m:
            continue
        category = m.group(1).strip()
        body = m.group(2).strip()
        items: List[str] = []
        # Split on commas; handle Oxford "and "
        for raw in re.split(r",\s*", body):
            piece = raw.strip()
            if piece.lower().startswith("and "):
                piece = piece[4:].strip()
            piece = piece.rstrip(".").strip()
            if piece:
                items.append(piece)
        skills[category] = items
    return skills

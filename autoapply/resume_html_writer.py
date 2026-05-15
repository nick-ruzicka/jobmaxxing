"""Render parsed resume dict into semantic HTML with data attributes.

Pure stdlib. The HTML is structured (not styled) — styling lives wherever the
HTML gets rendered (dashboard preview, ATS submission helper, etc.).

Public entry point
------------------
render_resume_html(parsed, archetype_id) -> str
"""

from __future__ import annotations

import html
from typing import Dict, List

from autoapply.resume_parser import (
    extract_bullet_tags,
    extract_impact_metrics,
    slug_company,
)


# Archetype id → bullet-id prefix.
BULLET_PREFIX = {
    "gtm-engineering": "gte",
    "ai-operations": "aio",
    "fde": "fde",
    "web3-bd": "w3b",
    "web3-bizops": "w3o",
}


def render_resume_html(parsed: Dict, archetype_id: str) -> str:
    prefix = BULLET_PREFIX.get(archetype_id, archetype_id[:3] or "res")
    counter = {"n": 0}

    def next_id() -> str:
        counter["n"] += 1
        return f"{prefix}-{counter['n']:03d}"

    parts: List[str] = []
    parts.append(f'<article class="resume" data-archetype="{html.escape(archetype_id)}">')
    parts.append(_render_header(parsed.get("identity", {})))
    parts.append(_render_experience(parsed.get("experience", []), archetype_id, next_id))
    parts.append(_render_education(parsed.get("education", [])))
    parts.append(_render_skills(parsed.get("skills", {})))
    parts.append("</article>")
    return "\n".join(parts) + "\n"


def _render_header(identity: Dict) -> str:
    out = ['<header class="resume-header">']
    if identity.get("name"):
        out.append(f'  <h1 class="name">{html.escape(identity["name"])}</h1>')
    if identity.get("subtitle"):
        out.append(f'  <p class="subtitle">{html.escape(identity["subtitle"])}</p>')
    out.append('  <ul class="contact">')
    fields = (
        ("location", "contact-location"),
        ("email", "contact-email"),
        ("phone", "contact-phone"),
        ("linkedin", "contact-link"),
        ("github", "contact-link"),
    )
    for key, cls in fields:
        val = identity.get(key)
        if val:
            out.append(f'    <li class="{cls}">{html.escape(val)}</li>')
    out.append("  </ul>")
    out.append("</header>")
    return "\n".join(out)


def _render_experience(roles: List[Dict], archetype_id: str, next_id) -> str:
    out = ['<section class="experience">', "  <h2>Experience</h2>"]
    for role in roles:
        out.append(_render_role(role, archetype_id, next_id))
    out.append("</section>")
    return "\n".join(out)


def _render_role(role: Dict, archetype_id: str, next_id) -> str:
    company = role.get("company", "")
    company_slug = slug_company(company)
    descriptor = role.get("company_descriptor", "")
    location = role.get("location", "")
    title = role.get("title", "")
    dates = role.get("dates", "")

    out = [
        f'  <section class="role" '
        f'data-company="{html.escape(company_slug)}" '
        f'data-archetype-title="{html.escape(title)}">'
    ]
    company_html = f'<span class="company-name">{html.escape(company)}</span>'
    if descriptor:
        company_html += f' <span class="company-descriptor">({html.escape(descriptor)})</span>'
    if location:
        company_html += f' <span class="role-location">{html.escape(location)}</span>'
    out.append(f'    <h3 class="role-company">{company_html}</h3>')

    title_html = html.escape(title)
    if dates:
        title_html += f' <span class="role-dates">{html.escape(dates)}</span>'
    out.append(f'    <p class="role-title">{title_html}</p>')

    bullets = role.get("bullets", [])
    if bullets:
        out.append('    <ul class="bullets">')
        for bullet in bullets:
            text = bullet["text"] if isinstance(bullet, dict) else str(bullet)
            tags = extract_bullet_tags(text, company_slug)
            impact = extract_impact_metrics(text) or ""
            bid = next_id()
            out.append(
                f'      <li class="bullet" '
                f'data-id="{html.escape(bid)}" '
                f'data-archetype="{html.escape(archetype_id)}" '
                f'data-tags="{html.escape(",".join(tags))}" '
                f'data-impact-metric="{html.escape(impact)}">'
                f"{html.escape(text)}</li>"
            )
        out.append("    </ul>")
    out.append("  </section>")
    return "\n".join(out)


def _render_education(entries: List[Dict]) -> str:
    out = ['<section class="education">', "  <h2>Education</h2>", '  <ul class="education-list">']
    for e in entries:
        inst = html.escape(e.get("institution", ""))
        degree = e.get("degree", "")
        dates = e.get("dates", "")
        line = f'<span class="institution">{inst}</span>'
        if degree:
            line += f' — <span class="degree">{html.escape(degree)}</span>'
        if dates:
            line += f' <span class="dates">{html.escape(dates)}</span>'
        out.append(f'    <li class="education-entry">{line}</li>')
    out.append("  </ul>")
    out.append("</section>")
    return "\n".join(out)


def _render_skills(skills: Dict[str, List[str]]) -> str:
    out = ['<section class="skills-section">', "  <h2>Skills</h2>"]
    for category, items in skills.items():
        slug = (
            category.lower()
            .replace("&", "and")
            .replace(" ", "-")
            .replace("--", "-")
            .strip("-")
        )
        out.append(f'  <ul class="skills" data-category="{html.escape(slug)}">')
        out.append(f'    <li class="skills-category-label">{html.escape(category)}</li>')
        for item in items:
            out.append(f'    <li class="skill">{html.escape(item)}</li>')
        out.append("  </ul>")
    out.append("</section>")
    return "\n".join(out)

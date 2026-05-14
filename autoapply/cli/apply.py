#!/usr/bin/env python3
"""apply.py — AutoApply CLI for Ashby job postings.

Usage:
    python autoapply/cli/apply.py <ashby_url> [--launch] [--draft-question Q]

Steps (matches the Task E spec):
    1. Parse the URL → (org_slug, job_id)
    2. Fetch JD via Ashby's public job-board API
       https://api.ashbyhq.com/posting-api/job-board/<slug>?includeCompensation=true
       (Ashby pages are React-rendered — plain requests.get returns an empty
       skeleton. The API is the only reliable JD source short of letting
       browser-harness render the page.)
    3. Load profile via profile_bridge.get_profile()
    4. Build the AutoApply plan: profile values to fill, drafted answers for
       any free-text questions provided via --draft-question.
    5. Print the plan in the structured report shape from SKILL.md.
    6. (--launch only) Build a browser-harness Python script that opens the
       URL and stops at the form. Pipe via subprocess. Reads SKILL.md
       safety rules.

Exit codes:
    0  — plan printed successfully (default mode)
    1  — invalid URL / no JD fetched / profile missing
    2  — placeholder values in profile blocked the apply (action required)
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

# Make ``autoapply`` importable when invoked as ``python autoapply/cli/apply.py``.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from autoapply import profile_bridge  # noqa: E402  — sys.path adjusted above
from autoapply import draft_answers  # noqa: E402


ASHBY_API = "https://api.ashbyhq.com/posting-api/job-board"

# Ashby's job-board API rejects default urllib UA with HTTP 403; any browser-ish
# User-Agent + Accept clears the gate. Matches scripts/enrich-roles.mjs.
_BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)
_REQ_HEADERS = {
    "User-Agent": _BROWSER_UA,
    "Accept": "application/json,text/plain,*/*",
}


def parse_ashby_url(url: str) -> tuple[str, str]:
    """Return (org_slug, job_id) from a jobs.ashbyhq.com URL.

    Accepts:
        https://jobs.ashbyhq.com/<slug>/<job_id>
        https://jobs.ashbyhq.com/<slug>/<job_id>/application

    Raises ValueError on malformed input.
    """
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError(f"not an http(s) URL: {url}")
    host = parsed.hostname or ""
    if not (host == "jobs.ashbyhq.com" or host.endswith(".ashbyhq.com")):
        raise ValueError(f"not an Ashby URL (host={host}): {url}")
    parts = [p for p in parsed.path.split("/") if p]
    if len(parts) < 2:
        raise ValueError(
            f"Ashby URL must include /<org_slug>/<job_id>; got path: {parsed.path}"
        )
    return parts[0], parts[1]


def fetch_ashby_jd(slug: str, job_id: str, *, timeout: int = 20) -> dict:
    """Fetch a single Ashby posting via the public job-board API.

    Returns a dict with: title, description, location, isRemote, compensation,
    org_slug, job_id, posting_id (Ashby's full ID, distinct from job_id in some
    URL shapes). Raises ValueError if the job_id isn't in the response.
    """
    api_url = f"{ASHBY_API}/{slug}?includeCompensation=true"
    req = urllib.request.Request(api_url, headers=_REQ_HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise ValueError(
            f"Ashby API returned HTTP {exc.code} for slug={slug!r}: {exc}"
        ) from exc
    except urllib.error.URLError as exc:
        raise ValueError(f"Ashby API network error: {exc}") from exc

    jobs = payload.get("jobs") or []
    match = next((j for j in jobs if j.get("id") == job_id), None)
    if match is None:
        # Sometimes the URL fragment is a "shortcode" rather than the canonical id.
        match = next((j for j in jobs if j.get("jobUrl", "").endswith(job_id)), None)
    if match is None:
        raise ValueError(
            f"job_id {job_id!r} not found in Ashby /job-board/{slug} response "
            f"(payload had {len(jobs)} postings)"
        )
    return {
        "title": match.get("title") or "",
        "description": match.get("descriptionPlain") or match.get("descriptionHtml") or "",
        "location": match.get("location") or "",
        "is_remote": bool(match.get("isRemote")),
        "compensation": match.get("compensation"),
        "department": match.get("department") or "",
        "team": match.get("team") or "",
        "org_slug": slug,
        "job_id": job_id,
        "ashby_posting_id": match.get("id") or job_id,
    }


def field_plan(profile: dict) -> tuple[list[dict], list[dict]]:
    """Walk the standard form fields documented in SKILL.md, splitting them into
    (will_fill, will_skip_due_to_placeholder).

    Returns two lists of dicts: { form_field, profile_path, value }.
    """
    identity = profile.get("identity") or {}
    links = profile.get("links") or {}
    current = profile.get("current_role") or {}
    comp = profile.get("compensation") or {}

    rows = [
        ("first_name", "identity.first_name", identity.get("first_name")),
        ("last_name", "identity.last_name", identity.get("last_name")),
        ("email", "identity.email", identity.get("email")),
        ("phone", "identity.phone", identity.get("phone")),
        ("location_city", "identity.location_city", identity.get("location_city")),
        ("location_state", "identity.location_state", identity.get("location_state")),
        ("location_country", "identity.location_country", identity.get("location_country")),
        ("linkedin", "links.linkedin", links.get("linkedin")),
        ("github", "links.github", links.get("github")),
        ("portfolio", "links.portfolio", links.get("portfolio")),
        ("resume_url", "links.resume_url", links.get("resume_url")),
        ("current_company", "current_role.company", current.get("company")),
        ("current_title", "current_role.title", current.get("title")),
        ("work_authorization", "identity.work_authorization", identity.get("work_authorization")),
        ("willing_to_relocate", "identity.willing_to_relocate", identity.get("willing_to_relocate")),
        ("remote_preference", "identity.remote_preference", identity.get("remote_preference")),
    ]
    if comp.get("salary_floor_usd"):
        rows.append(
            ("salary_expectations", "compensation.salary_floor_usd",
             f"${comp['salary_floor_usd']:,}+")
        )

    fill: list[dict] = []
    skip: list[dict] = []
    for form_field, profile_path, value in rows:
        if value is None or value == "":
            skip.append({"form_field": form_field, "profile_path": profile_path,
                         "value": value, "reason": "empty"})
            continue
        if profile_bridge.is_placeholder(value):
            skip.append({"form_field": form_field, "profile_path": profile_path,
                         "value": value, "reason": "placeholder"})
            continue
        fill.append({"form_field": form_field, "profile_path": profile_path,
                     "value": value})
    return fill, skip


def render_report(*, jd: dict, fill: list[dict], skip: list[dict],
                  drafted: list[dict]) -> str:
    """Build the structured report string per SKILL.md."""
    lines: list[str] = []
    lines.append("SUMMARY")
    lines.append(f"- Role: {jd['title']} at {jd['org_slug']}")
    lines.append(
        f"- URL: https://jobs.ashbyhq.com/{jd['org_slug']}/{jd['job_id']}"
    )
    lines.append(f"- Location: {jd['location']}{' (remote ok)' if jd['is_remote'] else ''}")
    lines.append("")
    lines.append(f"FILLED ({len(fill)} fields)")
    for row in fill:
        v = row["value"]
        v_display = v if isinstance(v, (str, bool, int, float)) else json.dumps(v)
        lines.append(f"- {row['form_field']}: {v_display}")
    lines.append("")
    lines.append(f"SKIPPED ({len(skip)} fields)")
    for row in skip:
        lines.append(
            f"- {row['form_field']}: {row['value']!r} ({row['reason']}) — set {row['profile_path']}"
        )
    lines.append("")
    if drafted:
        lines.append(f"DRAFTED ANSWERS ({len(drafted)})")
        for d in drafted:
            preview = d["answer"][:120].rstrip()
            if len(d["answer"]) > 120:
                preview += "…"
            lines.append(f"- Q: {d['question']}")
            lines.append(f"  A (preview): {preview}")
        lines.append("")
    lines.append("SAFETY TRIGGERS")
    lines.append("- (no live browser run — submit-boundary check fires only when --launch is used and the form reaches a single remaining required field).")
    lines.append("")
    blocking_placeholders = [r for r in skip if r["reason"] == "placeholder"]
    if blocking_placeholders:
        miss = ", ".join(r["profile_path"] for r in blocking_placeholders)
        lines.append(f"READY FOR REVIEW: no — set the following profile values first: {miss}")
    else:
        lines.append("READY FOR REVIEW: yes — plan is complete; run with --launch to fill the form.")
    return "\n".join(lines)


def build_launch_script(*, url: str, fill: list[dict]) -> str:
    """Build the browser-harness Python script that opens the URL and (for the
    MVP) prints a screenshot + page_info so the human can verify the form
    rendered.

    The full per-field-fill logic is deliberately out of scope for the initial
    MVP — Ashby's selectors vary by tenant (see SKILL.md), and the safest
    first run is human-in-the-loop. Subsequent iterations can extend this
    script to walk the SKILL.md selector map.
    """
    fields_json = json.dumps(fill, indent=2)
    return (
        f'new_tab("{url}")\n'
        f"wait_for_load()\n"
        f"print(page_info())\n"
        f"# Plan (FILL these fields manually for now; SKILL.md selector map\n"
        f"# automation is a follow-up):\n"
        f"PLAN = {fields_json}\n"
        f"print(\"PLAN:\", PLAN)\n"
    )


def _emit(text: str, *, fh) -> None:
    fh.write(text + "\n")
    fh.flush()


def main(argv: list[str] | None = None, *, stdout=None, stderr=None) -> int:
    out = stdout if stdout is not None else sys.stdout
    err = stderr if stderr is not None else sys.stderr

    ap = argparse.ArgumentParser(description="AutoApply for Ashby job postings")
    ap.add_argument("url", help="Ashby job URL, e.g. https://jobs.ashbyhq.com/<slug>/<job_id>")
    ap.add_argument(
        "--launch",
        action="store_true",
        help="Build the browser-harness script and print it (pipe to `browser-harness` to run).",
    )
    ap.add_argument(
        "--draft-question",
        action="append",
        default=[],
        metavar="QUESTION",
        help=(
            "A free-text application question to draft an answer for. "
            "Can be repeated. Requires ANTHROPIC_API_KEY. "
            "(--draft-question 'Why are you interested in <Company>?')"
        ),
    )
    ap.add_argument(
        "--profile-path",
        type=Path,
        default=None,
        help=(
            "Override autoapply/profile.json (useful for smoke-testing with "
            "profile.json.example without overwriting your real profile)."
        ),
    )
    args = ap.parse_args(argv)

    try:
        slug, job_id = parse_ashby_url(args.url)
    except ValueError as exc:
        _emit(f"ERROR: {exc}", fh=err)
        return 1

    try:
        jd = fetch_ashby_jd(slug, job_id)
    except ValueError as exc:
        _emit(f"ERROR fetching JD: {exc}", fh=err)
        return 1

    try:
        profile = profile_bridge.get_profile(profile_path=args.profile_path)
    except profile_bridge.ProfileError as exc:
        _emit(f"ERROR loading profile: {exc}", fh=err)
        return 1

    fill, skip = field_plan(profile)

    drafted: list[dict] = []
    for question in args.draft_question:
        if not draft_answers.needs_drafted_answer(question):
            _emit(
                f"NOTE: --draft-question {question!r} doesn't match heuristic; "
                f"drafting anyway.",
                fh=err,
            )
        try:
            answer = draft_answers.draft_answer(
                profile=profile,
                jd_text=jd["description"],
                question=question,
            )
            drafted.append({"question": question, "answer": answer})
        except draft_answers.DraftError as exc:
            _emit(f"WARN draft failed for {question!r}: {exc}", fh=err)

    report = render_report(jd=jd, fill=fill, skip=skip, drafted=drafted)
    _emit(report, fh=out)

    if args.launch:
        _emit("", fh=out)
        _emit("--- BROWSER-HARNESS SCRIPT (pipe to `browser-harness`) ---", fh=out)
        _emit(build_launch_script(url=args.url, fill=fill), fh=out)

    return 2 if any(r["reason"] == "placeholder" for r in skip) else 0


if __name__ == "__main__":
    sys.exit(main())

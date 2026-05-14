"""draft_answers.py — draft open-ended application answers via Claude.

For Ashby applications, the standard fields (name, email, etc.) come straight
from profile.json. The annoying part is the 2-4 free-text questions per role:
"Why are you interested in <Company>?", "Tell us about a recent project",
"What excites you about this role?"

This module wraps a single Claude API call that takes:
  - the full profile (so the model knows Nick's voice, current role,
    differentiators, recent projects),
  - the fetched JD,
  - the specific question,
  - the answer_style block from profile.json (verbatim — Nick's voice in his
    own words; this is the load-bearing part that prevents corporate slop).

Returns a string answer ≤200 words.

No external deps — uses urllib for the HTTP call so the Python side of
AutoApply stays self-contained.

Tests in autoapply/tests/test_draft_answers.py use the ``_call_claude`` seam
to inject a mock so the unit suite never hits a live API.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any, Callable

ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
DEFAULT_MODEL = "claude-sonnet-4-20250514"
DEFAULT_MAX_TOKENS = 600


class DraftError(Exception):
    """Raised when answer drafting fails (network, API, or empty response)."""


def _build_prompt(*, profile: dict, jd_text: str, question: str) -> str:
    """Assemble the system prompt fragment for Claude.

    The answer_style block is embedded verbatim — bumping it in profile.json
    flows through to every drafted answer without code changes.
    """
    identity = profile.get("identity") or {}
    current = profile.get("current_role") or {}
    style = profile.get("answer_style") or {}
    projects = profile.get("recent_projects") or []
    differentiators = profile.get("differentiators") or []

    project_lines = "\n".join(
        f"- {p.get('name', '')}: {p.get('summary', '')}"
        for p in projects
        if isinstance(p, dict)
    )
    diff_lines = "\n".join(f"- {d}" for d in differentiators if isinstance(d, str))

    name = " ".join(
        [identity.get("first_name", ""), identity.get("last_name", "")]
    ).strip() or "the candidate"

    style_voice = style.get("voice", "Direct, terse, no em dashes")
    style_lead = style.get("lead_with", "Concrete numbers and shipped implementations")
    style_avoid = style.get("avoid", "Corporate language, fluff, hedging, em dashes")

    return (
        f"You are drafting an application answer on behalf of {name}, currently "
        f"{current.get('title', '')} at {current.get('company', '')}.\n\n"
        f"VOICE: {style_voice}\n"
        f"LEAD WITH: {style_lead}\n"
        f"AVOID: {style_avoid}\n\n"
        f"RECENT PROJECTS:\n{project_lines}\n\n"
        f"DIFFERENTIATORS:\n{diff_lines}\n\n"
        f"JOB DESCRIPTION (truncated):\n{jd_text[:3000]}\n\n"
        f"QUESTION FROM APPLICATION FORM:\n{question}\n\n"
        f"Write a single answer ≤200 words. Match the VOICE. Use specifics from "
        f"the JD and the recent projects when relevant. Do not include "
        f"placeholder phrases like 'I'm excited because' — open with the "
        f"substance. Return only the answer text, no preamble, no quotes."
    )


def _call_claude(prompt: str, *, api_key: str, model: str, max_tokens: int) -> str:
    """Send a single user message to the Anthropic Messages API.

    Pure stdlib (urllib) so this module stays dep-free. Returns the assistant's
    text content; raises DraftError on failure.
    """
    body = json.dumps(
        {
            "model": model,
            "max_tokens": max_tokens,
            "messages": [{"role": "user", "content": prompt}],
        }
    ).encode("utf-8")

    req = urllib.request.Request(
        ANTHROPIC_API_URL,
        data=body,
        headers={
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:  # noqa: S310 — known host
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise DraftError(f"Claude API HTTP {exc.code}: {exc.read()[:200]!r}") from exc
    except urllib.error.URLError as exc:
        raise DraftError(f"Claude API network error: {exc}") from exc
    content = payload.get("content") or []
    for block in content:
        if isinstance(block, dict) and block.get("type") == "text":
            text = (block.get("text") or "").strip()
            if text:
                return text
    raise DraftError("Claude returned no usable text content")


def draft_answer(
    *,
    profile: dict,
    jd_text: str,
    question: str,
    api_key: str | None = None,
    model: str = DEFAULT_MODEL,
    max_tokens: int = DEFAULT_MAX_TOKENS,
    _call: Callable[..., str] = _call_claude,
) -> str:
    """Draft an answer to an application question. Returns the answer string.

    ``_call`` is an injection seam for tests; production callers should leave
    it at the default.

    Raises DraftError on missing API key or call failure.
    """
    api_key = api_key or os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise DraftError(
            "ANTHROPIC_API_KEY not set — required for draft_answer. "
            "Add it to .env or export it before running."
        )
    prompt = _build_prompt(profile=profile, jd_text=jd_text, question=question)
    answer = _call(prompt, api_key=api_key, model=model, max_tokens=max_tokens)
    # Guard: trim accidental trailing quotes / leading 'Answer:' artifacts.
    answer = answer.strip()
    for prefix in ("Answer:", "ANSWER:", "Here is", "Here's"):
        if answer.startswith(prefix):
            # Cut to the first newline or sentence boundary after the prefix.
            tail = answer[len(prefix):].lstrip(": \n")
            if tail:
                answer = tail
                break
    return answer


# Convenience: identify questions that warrant a drafted answer vs. a profile
# lookup. Used by the Ashby skill orchestrator (cli/apply.py).
_DRAFT_TRIGGER_PATTERNS = [
    "why",
    "tell us about",
    "what excites",
    "what attracts",
    "describe a",
    "describe your",
    "walk us through",
    "share a story",
    "biggest impact",
    "proudest",
    "recent project",
    "favorite project",
]


def needs_drafted_answer(question: str) -> bool:
    """Heuristic: should this question be sent to draft_answer, or filled from profile?"""
    if not question:
        return False
    q = question.lower()
    if any(p in q for p in _DRAFT_TRIGGER_PATTERNS):
        return True
    # Catch-all for long free-text fields (>50 chars of prompt typically means
    # the form expects a written answer rather than a single value).
    return len(question) > 50 and "?" in question

"""autoapply — AI-assisted job application tooling for nick-career-ops.

Layout:
  profile_bridge.py  — load profile.json + applications.md
  draft_answers.py   — Claude API call for free-text application questions
  cli/apply.py       — CLI orchestrator for an Ashby application
  skills/ashby/      — Ashby form-fill skill (SKILL.md with safety rules)
  tests/             — Python unit tests for the modules above
"""

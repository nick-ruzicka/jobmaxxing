---
name: ashby
description: Fill an Ashby job application form on behalf of the candidate in profile.json — standard fields from profile.json, drafted answers for free-text questions, STOP before submit. Used by autoapply/cli/apply.py and by any agent acting on a jobs.ashbyhq.com domain.
---

# Ashby Application Skill

You are filling an Ashby job application form on behalf of the candidate.
Profile data lives in `autoapply/profile.json`; drafted answers come from
`autoapply/draft_answers.py`. Read both before touching the form.

## CRITICAL SAFETY RULES (never violate)

1. **NEVER click "Submit", "Submit Application", "Apply Now", "Send", or any
   button that submits the form.** This is non-negotiable.

2. **BEFORE FILLING THE LAST VISIBLE REQUIRED FIELD**, pause and verify there
   is either:
   (a) at least one other unfilled required field still visible, OR
   (b) an explicit submit button you can identify and refuse to click.
   If neither is true, the form may auto-submit on the next field fill — HALT
   and report. Do not gamble.

3. **Multi-step forms**: fill only the current step. STOP before clicking
   "Next" or "Continue" if the next step would be the final step. Report and
   let the human decide.

4. **Confidence gate**: if you cannot identify a form field's purpose with
   high confidence, leave it BLANK and report it. Never guess. A blank field
   is recoverable; a wrong answer is not.

5. **Consent / agreement checkboxes**: never check or uncheck any consent,
   agreement, or acknowledgment checkbox without explicit human approval.
   Same for "I authorize…", "I agree…", "I consent…".

6. **PLACEHOLDER GUARD**: if any profile value is a string that starts with
   "REPLACE_WITH_" OR contains two-or-more consecutive Xs (case-insensitive,
   anywhere in the string), DO NOT fill that field. Report which field was
   skipped and which profile key needs to be set. Use
   `profile_bridge.is_placeholder(value)` to check — single source of truth.

## What to fill confidently

| Form field (typical Ashby data-testid)              | Profile path                       |
|-----------------------------------------------------|------------------------------------|
| First name (`name` first half)                      | `identity.first_name`              |
| Last name (`name` last half)                        | `identity.last_name`               |
| Email (`email`)                                     | `identity.email`                   |
| Phone (`phone`)                                     | `identity.phone`                   |
| Location — city / state / country                   | `identity.location_*`              |
| LinkedIn URL (`linkedin`, `linkedinUrl`)            | `links.linkedin`                   |
| GitHub URL (`github`, `githubUrl`)                  | `links.github`                     |
| Portfolio (`portfolio`, `website`)                  | `links.portfolio` (skip if empty)  |
| Resume upload (`resume`, `cv`)                      | `links.resume_url` — see below     |
| Current company                                     | `current_role.company`             |
| Current title                                       | `current_role.title`               |
| Work authorization                                  | `identity.work_authorization`      |
| Willing to relocate                                 | `identity.willing_to_relocate`     |
| Remote preference                                   | `identity.remote_preference`      |
| Salary expectations                                 | `compensation.salary_floor_usd` — format as "$200,000+" |

Apply the PLACEHOLDER GUARD to every value before filling.

### Resume upload specifics

Try, in order:
1. If `links.resume_url` is a fetchable URL, download to a temp file and use
   the form's file input (`<input type="file">`). Most Ashby forms accept PDF
   directly.
2. If the upload UI requires the user's native file picker (no programmatic
   path), leave it blank and report. Resume upload is the most common
   manual-intervention point — don't fight it.

## What needs drafted answers (call draft_answer())

These warrant Claude-drafted answers from `draft_answers.draft_answer()`:

- "Why this company?" / "Why interested?" / "What excites you about <Co>?"
- "Tell us about yourself" / "Brief introduction"
- "What's a recent project you're proud of?"
- "Describe a time when…"
- Any free-text question over ~50 characters that ends in "?"

Use `draft_answers.needs_drafted_answer(question)` as the trigger heuristic.
Pass the full profile + JD text to `draft_answer()`. The function embeds
`profile.answer_style` in the prompt — Nick's voice in his own words.

## Edge cases

- **Multi-select skills/tags** (`Skills`, `Languages`, `Frameworks`):
  skip unless the option text is an obvious match for `recent_projects`,
  `differentiators`, or `current_role.summary`. Report what was skipped so
  the human can fill the rest.

- **"How did you hear about us?"**:
  - If it's a dropdown, choose "Personal research" or "Direct" or the
    closest equivalent.
  - If it's free-text, leave blank — Nick fills this manually so the source
    tag matches his outreach plan.

- **Demographics / EEO questions** (race, gender, veteran status,
  disability): leave EVERY field blank, even "decline to answer". These are
  optional by law; Nick chooses per-application whether to disclose.
  Reporting this back is mandatory — list each EEO question that appeared.

- **Cover letter upload**: skip unless `links.portfolio` or a specific cover
  letter path is configured. Most Ashby forms make this optional. Report
  whether it was offered.

## Reporting back

When you halt (either at the submit boundary, after a safety trigger, or on
explicit user request), produce a structured report:

```
SUMMARY
- Role: <title> at <company>
- URL: <ashby url>
- Form: <single-step | multi-step (X/Y)>

FILLED (N fields)
- first_name: Nick
- email: ...
- ...

SKIPPED (N fields)
- start_date: REPLACE_WITH_START_DATE (placeholder guard)
- demographics_race: EEO question — left blank
- skill_tag_kubernetes: low confidence
- resume_upload: manual file picker required
- ...

DRAFTED ANSWERS (N)
- Q: "Why are you interested in <Company>?"
  A (preview): "Linera is shipping the GTM signal engine I've spent..."
- ...

SAFETY TRIGGERS
- rule_2_last_field_check fired on submit button: held the form, did not click.
- rule_5_consent_checkbox: 'I authorize background check' left unchanged.

READY FOR REVIEW: <yes | no — explain>
```

Anyone reviewing the report should be able to make a click-Submit decision
from it alone, without re-reading the JD.

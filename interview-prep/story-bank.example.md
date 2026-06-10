# Story Bank — Master STAR+R Stories

> Copy to `interview-prep/story-bank.md`. Behavioral interviews ask the same
> 5-10 questions in different wrappings ("Tell me about a time you led without
> authority" / "Describe a conflict you resolved" / "What's a project you're
> most proud of"). Maintain ~6-10 master stories you've practiced; map them to
> incoming questions on the fly.

## How it works

Each story uses the **STAR+R** structure — Situation, Task, Action, Result,
**Reflection**. The +R is the part most candidates skip and most interviewers
notice the absence of: what did you learn, what would you do differently, what
does the experience say about how you work?

Keep each story **~90 seconds spoken** (≈ 250 words written). If you find
yourself padding, the story has the wrong scope for an interview — either too
big (split it) or too small (combine with another).

Tag stories with the dimensions they best demonstrate. Common dimensions:
*Building from zero · Strategic influence · Conflict resolution · Speed of
execution · Analytics & reporting · Customer-facing · Cross-functional
leadership · AI / innovation · Mentorship · Failure / recovery*.

## Stories

### [Building from Zero] Your First Production Deployment

**Situation.** [Company name] had no production deployment pipeline for the ML
models the data team had been building. Three models were in notebooks; ops
team was nervous about putting them in front of customers.

**Task.** I was asked to "make this deployable" — vague scope, no budget for
new infrastructure, two-week deadline for a customer demo that depended on it.

**Action.** I started by writing down what "deployable" actually meant — a
checklist of 12 items spanning monitoring, rollback, schema versioning,
shadow-deployment for accuracy verification. Then I picked the 4 most critical
for the demo (the other 8 became phase-2). Built a thin FastAPI wrapper +
Postgres for predictions logging + a one-line Slack alert on inference error
spike. Demo went out on day 12.

**Result.** Customer signed a $X expansion the week after the demo. The
4-item checklist became the team's deployment standard; we extended it to the
phase-2 items over the next quarter.

**Reflection.** What I'd do differently: I tried to scope all 12 items into
the first pass and burnt two days on what couldn't ship. The lesson was to
write down everything but pick ruthlessly. I still use that checklist pattern
on every project.

---

### [AI Innovation] Your AI-Powered Internal Tool

**Situation.** [Team] was spending ~6 hours per week manually triaging support
tickets, deciding which were bugs vs feature requests vs config issues.

**Task.** Free up engineering time without sacrificing triage quality. I had
permission to spend ~1 week on a prototype.

**Action.** Set up a labeled dataset (200 manually-triaged tickets), tried a
fine-tuned BERT classifier first (85% accuracy, too brittle for new categories),
then switched to a Claude few-shot classifier with a rolling 20-example
context window. Wrote eval harness with held-out 50 tickets. Final accuracy
93% — better than two of three human triagers. Shipped behind a feature flag.

**Result.** Saved an estimated 5h/week of engineering triage time. Caught two
high-severity bugs in the first month that had been mis-categorized as
feature requests by human triagers. Pattern reused for two other internal
tools.

**Reflection.** I almost shipped the BERT model because the numbers were close
enough. The few-shot Claude version was actually faster to build AND more
maintainable (no fine-tuning pipeline, no retraining when categories changed).
The lesson: when LLMs are an option, try them first; their cost surface is
predictable, the latency is good enough for most internal tools, and you ship
faster.

---

### [Customer-Facing] Onboarding a Skeptical Enterprise Customer

**Situation.** A logo customer (Fortune 500, $XM annual contract) was at
churn risk after onboarding. Two prior CSMs hadn't been able to get them past
"first value" — their internal champion had left.

**Task.** Re-establish the relationship, identify a concrete first-value use
case, get them shipped within 30 days.

**Action.** [Your actions here.]

**Result.** [Your outcomes here.]

**Reflection.** [What you learned.]

---

### [Speed of Execution] Your One-Weekend Build

**Situation.** [Context.]

**Task.** [What needed to be done.]

**Action.** [What you did.]

**Result.** [Outcome with numbers.]

**Reflection.** [What you learned.]

---

<!-- Add 2-4 more stories covering: cross-functional leadership, analytics &
     reporting, strategic influence, mentorship, failure/recovery. Target 6-10
     total — enough to cover most behavioral prompts without resorting to
     story you haven't practiced. -->

## Meeting Notes

<!-- The /process-notes AI route reads this section. Add insider intel from
     recruiter calls / coffee chats / panel feedback. The route uses Claude
     to fold the notes into the rest of the prep doc, then clears this section. -->

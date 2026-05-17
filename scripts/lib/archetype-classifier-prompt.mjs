// Prompt builder for the Claude-disambiguation stage of the archetype classifier.
//
// Called only when the rules-based stage produces two close-fitness archetypes
// (gap < DISAMBIGUATION_GAP) AND there is API budget remaining.

export function buildDisambiguationPrompt(role, candidates, archetypes) {
  const byId = new Map(archetypes.map((a) => [a.id, a]));
  const candidateDefs = candidates
    .map((c) => byId.get(c.id))
    .filter(Boolean)
    .map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description,
      maturity: a.maturity,
      key_signals: collectKeySignals(a),
    }));

  const jdPreview = ((role.description || "") + "\n\n" + (role.requirements || "")).slice(0, 6000);

  return `You are a hybrid rules+model archetype classifier. The rules layer has narrowed
this role to a small set of candidate archetypes that scored close (gap < 0.15).
Your job: pick the best one, list any others that also clearly apply, and
explain why in one sentence.

ROLE CONTEXT
- Title: ${role.title || "(missing)"}
- Company: ${role.company || "(missing)"}
- ATS: ${role.ats || "(unknown)"}

CANDIDATE ARCHETYPES
${candidateDefs.map((c) => formatCandidate(c)).join("\n\n")}

JOB DESCRIPTION
${jdPreview || "(empty)"}

INSTRUCTIONS
- Return ONLY a single JSON object. No prose before or after.
- Fields:
  - primary: id of the single best-matching archetype (string)
  - confidence: 0.0 - 1.0 (how strongly the JD matches the primary)
  - secondary: array of other archetype ids that also apply with strength >= 0.6 (may be empty)
  - reasoning: one-sentence explanation (max ~25 words)

EXAMPLE OUTPUT
{"primary":"gtm-engineering","confidence":0.85,"secondary":["fde"],"reasoning":"Title is GTM Engineer and JD emphasizes Supabase + Claude + HubSpot — pure GTM-eng work, with FDE flavor due to customer-deployment language."}`;
}

function collectKeySignals(a) {
  const out = [];
  if (a.title_signals?.high_match?.length) out.push(`high-match titles: ${a.title_signals.high_match.join(", ")}`);
  if (a.required_signals?.length) out.push(`required signals: ${a.required_signals.join(", ")}`);
  for (const g of a.reward_signals ?? []) {
    out.push(`reward (weight ${g.weight}): ${(g.keywords ?? []).slice(0, 6).join(", ")}`);
  }
  if (a.institutional_companies_boost?.tier_1) {
    out.push(`institutional Web3 boost active`);
  }
  return out;
}

function formatCandidate(c) {
  return `- id: ${c.id}
  name: ${c.name}
  maturity: ${c.maturity}
  description: ${c.description}
  signals:
${c.key_signals.map((s) => `    • ${s}`).join("\n")}`;
}

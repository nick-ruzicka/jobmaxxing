// Numeric parsing of free-text comp strings (e.g. "$150k - $200k", "$1.2M").
// Extracted from scoring-layer.mjs so the dashboard (comp-floor filter) and the
// scoring layer share one definition. compMidpoint encodes the Fix D (2026-05-18)
// rule: compare a range's midpoint against the floor, not its min.

// Smallest/first dollar figure in the string. null if none.
// Patterns like "$150k - $200k", "$150,000 to $200,000", "$150,000+", "150-200k".
export function extractMinComp(s) {
  if (!s) return null;
  const norm = String(s).replace(/,/g, "");
  const dollar = norm.match(/\$?(\d+(?:\.\d+)?)\s*(k|m)?/i);
  if (!dollar) return null;
  let n = parseFloat(dollar[1]);
  const suffix = (dollar[2] || "").toLowerCase();
  if (suffix === "k") n *= 1000;
  else if (suffix === "m") n *= 1000000;
  else if (n < 1000) n *= 1000; // bare "150" → 150,000
  return n;
}

// Largest dollar number in the comp string. null if none.
export function extractMaxComp(s) {
  if (!s) return null;
  const norm = String(s).replace(/,/g, "");
  const matches = [...norm.matchAll(/\$?(\d+(?:\.\d+)?)\s*(k|m)?/gi)];
  if (matches.length === 0) return null;
  let max = 0;
  for (const m of matches) {
    let n = parseFloat(m[1]);
    const suffix = (m[2] || "").toLowerCase();
    if (suffix === "k") n *= 1000;
    else if (suffix === "m") n *= 1000000;
    else if (n < 1000) n *= 1000;
    if (n > max) max = n;
  }
  return max || null;
}

// Midpoint of the comp range, the "expected" comp used for floor comparison.
// A band $191K-$249K straddling a $200K floor yields midpoint $220K. Single-value
// comps (min == max) return that value. null when nothing parses.
export function compMidpoint(s) {
  const min = extractMinComp(s);
  if (min === null) return null;
  const max = extractMaxComp(s);
  return max !== null && max > min ? Math.round((min + max) / 2) : min;
}

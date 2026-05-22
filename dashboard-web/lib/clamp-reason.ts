// Parse a raw engine clamp_reason into display parts.
// Raw shape (from scripts/lib/scoring-layer.mjs): "<source> (<delta>)",
// e.g. "location:onsite_international (-75)" or "comp:below_floor (-50)".

export interface ParsedClampReason {
  /** The adjustment family, e.g. "location", "comp". */
  factor: string;
  /** Humanized detail, e.g. "onsite international", "below floor". Empty if none. */
  detail: string;
}

export function parseClampReason(raw: string): ParsedClampReason {
  // strip the trailing " (-75)" magnitude
  const body = raw.replace(/\s*\(-?\d+\)\s*$/, "").trim();
  const colon = body.indexOf(":");
  const factor = (colon === -1 ? body : body.slice(0, colon)).trim();
  const detail = (colon === -1 ? "" : body.slice(colon + 1)).trim().replace(/_/g, " ");
  return { factor, detail };
}

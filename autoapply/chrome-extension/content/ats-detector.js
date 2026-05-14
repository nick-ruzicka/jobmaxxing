// ats-detector.js — pure URL-based ATS identification. Mirrored in the
// service worker (background/service-worker.js) so the popup can ask before
// the content script runs. Keep these in sync.

/**
 * Identify the ATS provider hosting the current page.
 *
 * @param {string} [url] — defaults to document.location.href in the browser
 * @returns {"ashby" | "greenhouse" | "lever" | "workday" | null}
 */
function detectAts(url) {
  const href = url || (typeof location !== "undefined" ? location.href : "");
  if (!href) return null;
  let host;
  try {
    host = new URL(href).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (host === "jobs.ashbyhq.com" || host.endsWith(".ashbyhq.com")) return "ashby";
  if (host === "boards.greenhouse.io" || host === "job-boards.greenhouse.io")
    return "greenhouse";
  if (host === "jobs.lever.co") return "lever";
  if (host.endsWith(".myworkdayjobs.com")) return "workday";
  return null;
}

// Expose to content-script.js (no module loader available in MV3 content scripts).
globalThis.AutoApplyAtsDetector = { detectAts };

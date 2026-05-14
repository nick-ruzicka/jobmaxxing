// content-script.js — entry point for every supported ATS page. Orchestrates:
//   1. ATS detection (already loaded via globalThis from ats-detector.js IIFE).
//   2. Loading the matching selector map for the detected ATS.
//   3. Receiving FILL_FORM messages from the service worker and running fills.
//
// Manifest v3 content scripts run in an isolated world but share the DOM
// with the page. We attach helpers to globalThis so the popup can verify the
// content script ran (DevTools console will show the bootstrap log).

(async function bootstrap() {
  // ats-detector.js + form-filler.js are listed in manifest content_scripts so
  // they load before this file. They attach to globalThis.AutoApply*.
  const detector = globalThis.AutoApplyAtsDetector;
  const filler = globalThis.AutoApplyFormFiller;
  if (!detector || !filler) {
    console.warn(
      "[AutoApply] missing dependencies (detector=%o, filler=%o); content-script will not bind.",
      Boolean(detector),
      Boolean(filler),
    );
    return;
  }

  const ats = detector.detectAts();
  console.log("[AutoApply] content-script bootstrap; ats =", ats);

  if (!ats) return; // nothing to do — page isn't on a supported ATS

  // Each lib/selectors/<ats>.js is listed in manifest content_scripts and runs
  // before this file. They attach to globalThis.AutoApplySelectors_<ats>.
  const selectorMap = globalThis[`AutoApplySelectors_${ats}`] || {};
  if (Object.keys(selectorMap).length === 0) {
    console.warn(
      `[AutoApply] selector map for ${ats} is empty — fill-form will be a no-op until a real map is published.`,
    );
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.type !== "autoapply:fill-form") return false;
    chrome.storage.local.get(["profile"]).then(({ profile }) => {
      if (!profile) {
        sendResponse({ ok: false, reason: "no-profile-in-storage" });
        return;
      }
      const subset = profileSubset(profile);
      const results = filler.fillFromMap(selectorMap, subset);
      sendResponse({ ok: true, ats, results });
    });
    return true; // async sendResponse
  });
})();

/**
 * Pull the standard logical fields out of a CareerOps profile JSON into the
 * flat shape the selector map expects. Mirrors the contract in
 * autoapply/skills/ashby/SKILL.md and autoapply/cli/apply.py `field_plan`.
 */
function profileSubset(profile) {
  const id = profile.identity || {};
  const links = profile.links || {};
  const role = profile.current_role || {};
  const comp = profile.compensation || {};
  const salary = typeof comp.salary_floor_usd === "number"
    ? `$${comp.salary_floor_usd.toLocaleString("en-US")}+`
    : "";
  return {
    first_name: id.first_name,
    last_name: id.last_name,
    full_name: [id.first_name, id.last_name].filter(Boolean).join(" "),
    email: id.email,
    phone: id.phone,
    location_city: id.location_city,
    location_state: id.location_state,
    location_country: id.location_country,
    work_authorization: id.work_authorization,
    willing_to_relocate: id.willing_to_relocate,
    remote_preference: id.remote_preference,
    linkedin: links.linkedin,
    github: links.github,
    portfolio: links.portfolio,
    resume_url: links.resume_url,
    current_company: role.company,
    current_title: role.title,
    salary_expectations: salary,
  };
}


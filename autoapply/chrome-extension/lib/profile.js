// profile.js — small wrappers around chrome.storage.local for the profile
// blob. Intentionally minimal: the foundation MVP stores a hardcoded test
// profile via the popup. Future versions can swap loadProfile() to fetch
// from a CareerOps API or read from a local file picker.
//
// IMPORTANT: chrome.storage.local is per-extension, not per-tab. The same
// profile is used across every supported ATS tab.

const PROFILE_KEY = "profile";

/**
 * @returns {Promise<object | null>} the stored profile JSON or null
 */
async function loadProfile() {
  const obj = await chrome.storage.local.get([PROFILE_KEY]);
  return obj[PROFILE_KEY] || null;
}

/**
 * @param {object} profile
 * @returns {Promise<void>}
 */
async function saveProfile(profile) {
  if (!profile || typeof profile !== "object") {
    throw new TypeError("saveProfile expects a profile object");
  }
  await chrome.storage.local.set({ [PROFILE_KEY]: profile });
}

async function clearProfile() {
  await chrome.storage.local.remove(PROFILE_KEY);
}

globalThis.AutoApplyProfile = { loadProfile, saveProfile, clearProfile, PROFILE_KEY };

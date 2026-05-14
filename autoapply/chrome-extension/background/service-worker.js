// service-worker.js — Manifest v3 background. Coordinates messages between
// the popup and the active tab's content script.
//
// Why a service worker at all? activeTab + storage + scripting can technically
// be invoked from the popup directly, but Chrome teardown timing for popups is
// flaky. Routing through the worker keeps the message contracts explicit and
// makes it easy to add cross-tab features later (e.g., "fill across multiple
// open Ashby tabs").

const CHANNELS = {
  // Popup → service worker: "what ATS am I looking at?"
  DETECT_ATS: "autoapply:detect-ats",
  // Service worker → content script: do the actual fill.
  FILL_FORM: "autoapply:fill-form",
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || !msg.type) return false;

  if (msg.type === CHANNELS.DETECT_ATS) {
    queryActiveTab()
      .then((tab) => sendResponse({ ok: true, ats: detectAtsFromUrl(tab?.url || "") }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true; // async sendResponse
  }

  if (msg.type === CHANNELS.FILL_FORM) {
    queryActiveTab()
      .then((tab) =>
        chrome.tabs.sendMessage(tab.id, { type: CHANNELS.FILL_FORM }),
      )
      .then((res) => sendResponse({ ok: true, contentResult: res }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  return false;
});

async function queryActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error("no active tab");
  return tab;
}

// Mirror of content/ats-detector.js — kept here because the service worker
// also needs to answer DETECT_ATS for the popup in cases where the content
// script hasn't run yet (e.g., chrome://newtab/ → user opens popup → no
// content script). Keep these in sync.
function detectAtsFromUrl(url) {
  if (!url) return null;
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
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

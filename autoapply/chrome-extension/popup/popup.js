// popup.js — wires the UI to chrome.runtime messages.
//
// Flow:
//   1. On open, ask the service worker which ATS is on the active tab.
//   2. Show "AutoApply ready (Ashby)" or "(no supported ATS detected)".
//   3. Check chrome.storage.local for a saved profile. If none, offer the
//      "Use test profile" button to seed a basic one (Nick's non-PII defaults
//      from profile.json.example, hardcoded here for the foundation MVP).
//   4. "Fill form" sends FILL_FORM to the service worker, which relays to the
//      content script. Results stream back into <pre id="results-output">.

const TEST_PROFILE = {
  identity: {
    first_name: "Nick",
    last_name: "Ruzicka",
    email: "test@example.com",  // replace with your real value once Nick imports
    phone: "+1-555-0100",
    location_city: "New York",
    location_state: "NY",
    location_country: "United States",
    work_authorization: "US Citizen",
    willing_to_relocate: false,
    remote_preference: "Hybrid NYC preferred",
  },
  links: {
    linkedin: "https://linkedin.com/in/nicholas-ruzicka-0x",
    github: "https://github.com/nick-ruzicka",
    portfolio: "",
    resume_url: "",
  },
  current_role: {
    company: "Linera",
    title: "Head of Operations & Business Development",
  },
  compensation: {
    salary_floor_usd: 200000,
  },
};

const ATS_LABELS = {
  ashby: "Ashby",
  greenhouse: "Greenhouse",
  lever: "Lever",
  workday: "Workday",
};

document.addEventListener("DOMContentLoaded", async () => {
  await refreshAtsLabel();
  await refreshProfileStatus();

  document.getElementById("set-test-profile-btn").addEventListener("click", async () => {
    await chrome.storage.local.set({ profile: TEST_PROFILE });
    await refreshProfileStatus();
    setResults("Saved test profile to chrome.storage.local.");
  });

  document.getElementById("fill-btn").addEventListener("click", async () => {
    setResults("Filling…");
    try {
      const res = await chrome.runtime.sendMessage({ type: "autoapply:fill-form" });
      setResults(JSON.stringify(res, null, 2));
    } catch (err) {
      setResults(`Error: ${err.message || err}`);
    }
  });
});

async function refreshAtsLabel() {
  const el = document.getElementById("ats-detected");
  try {
    const res = await chrome.runtime.sendMessage({ type: "autoapply:detect-ats" });
    if (res && res.ok && res.ats) {
      el.textContent = `Detected: ${ATS_LABELS[res.ats] || res.ats}`;
    } else {
      el.textContent = "No supported ATS detected on this tab.";
    }
  } catch (err) {
    el.textContent = `(detect error: ${err.message || err})`;
  }
}

async function refreshProfileStatus() {
  const el = document.getElementById("profile-status-value");
  const fillBtn = document.getElementById("fill-btn");
  const { profile } = await chrome.storage.local.get(["profile"]);
  if (profile) {
    const name =
      [profile.identity?.first_name, profile.identity?.last_name]
        .filter(Boolean)
        .join(" ") || "(unnamed)";
    el.textContent = `loaded — ${name}`;
    fillBtn.disabled = false;
  } else {
    el.textContent = "none set";
    fillBtn.disabled = true;
  }
}

function setResults(text) {
  document.getElementById("results-output").textContent = text;
}

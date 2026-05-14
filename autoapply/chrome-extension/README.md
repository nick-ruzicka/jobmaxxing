# AutoApply Chrome Extension

Manifest v3 extension that augments any supported ATS application form
(Ashby, Greenhouse, Lever, Workday) when you land on it via normal browsing
— complement to the Python CLI in `autoapply/cli/apply.py` which is for
headless / automated runs.

**Status: foundation MVP.** The structure is in place; the Ashby selector
map is the only one even partially populated. Greenhouse / Lever / Workday
selectors are stubs. Selector hits in the wild will need per-tenant tuning.

## Loading the extension in Chrome

1. Open `chrome://extensions` in Chrome (or Edge / any Chromium-based browser).
2. Toggle **Developer mode** on (top right).
3. Click **Load unpacked**.
4. Navigate to `~/projects/job-search/nick-career-ops/autoapply/chrome-extension/`
   and select the directory.

You should see "AutoApply by CareerOps" appear in the extensions list. No
errors should be reported. If they are, check the
[Known limitations](#known-limitations) section.

The extension icon doesn't ship a graphic yet (see `icons/` — empty
intentionally). Chrome will use a generic puzzle-piece icon until one is
added.

## Setting your profile

For the foundation MVP, the popup hardcodes a non-PII test profile and
saves it to `chrome.storage.local` when you click **Use test profile**.
That's the simplest path to a working demo.

The next iteration will either:
1. Import from `autoapply/profile.json` via a local file picker, or
2. Fetch from a future CareerOps profile API.

Either way the storage shape stays the same:

```js
chrome.storage.local.get(["profile"], ({ profile }) => console.log(profile));
```

## Using it

1. Set your profile (button in the popup).
2. Open an Ashby / Greenhouse / Lever / Workday application page.
3. Click the AutoApply extension icon → **Fill form**.
4. The popup shows a JSON result with what filled and what didn't.
5. **Verify the form in the page before clicking the page's Submit
   button.** AutoApply NEVER clicks submit; that's your job.

## What it fills (when selectors hit)

The same logical-field set as `autoapply/cli/apply.py` field_plan:

- first/last/full name
- email, phone
- location city / state / country
- LinkedIn, GitHub, portfolio
- resume URL (note: file-picker uploads don't work via JS; you'll need to
  attach the resume manually)
- current company, current title
- work authorization (dropdown)
- willing to relocate (dropdown)
- remote preference, salary expectations

## What it doesn't do (by design)

- **Never clicks Submit.** No exceptions.
- Never touches consent / agreement checkboxes.
- Never fills demographics / EEO questions.
- Never fills a field whose profile value is missing or empty.
- Doesn't draft free-text answers — those still come from the Python CLI's
  `draft_answers.py`. Extension-side answer drafting is on the roadmap.

## Known limitations

- **Selector maps are stubs.** Ashby in particular has high tenant variance;
  the selectors here are best-guesses against jobs.ashbyhq.com/hebbia-ai
  and similar. Real-world hit rate will need tuning per tenant. Verify in
  DevTools (right-click on a field → Inspect → look for `data-testid`
  attributes).
- **No icons shipped.** Chrome will show the default puzzle-piece. Add
  PNGs to `icons/` if you want branding.
- **No CSP overrides.** Some ATS pages block content-script inline scripts;
  if a selector that exists in DevTools fails to fill via the extension,
  this is likely the cause. Workaround: nothing in this codebase yet.
- **Resume file uploads don't work.** Browser file inputs (`<input
  type="file">`) reject programmatic JS assignment by design. The MVP
  doesn't try; attach the resume manually.
- **No tests** — Chrome extension testing requires Playwright /
  Puppeteer / a real Chrome instance, which is out of scope for the
  foundation. Manual smoke testing only (see below).

## Smoke test (manual)

After loading the unpacked extension:

1. Verify `chrome://extensions` shows no errors next to AutoApply.
2. Right-click the extension icon → **Inspect popup** → console should have
   no errors.
3. Right-click the service worker in `chrome://extensions` → **Service
   worker** → console should be clean.
4. Open a tab to `https://jobs.ashbyhq.com/hebbia-ai/<any-job-id>`.
5. Open the extension popup. The header should say
   "Detected: Ashby".
6. Click **Use test profile** → profile status updates to "loaded — Nick
   Ruzicka".
7. Click **Fill form**. The Results pane shows JSON like:

   ```json
   {
     "ok": true,
     "ats": "ashby",
     "results": [
       { "logical": "first_name", "selector": "...", "ok": true, "value": "Nick" },
       { "logical": "linkedin", "selector": "...", "ok": false, "reason": "not-found" }
     ]
   }
   ```

   Selector hits depend on the tenant's actual DOM. Misses are expected and
   not a failure of the foundation — they indicate the stub selector needs
   updating for that tenant.

## Roadmap

- Real Ashby selectors verified against 3-5 tenants
- Greenhouse / Lever / Workday selector maps fleshed out
- Profile import from `autoapply/profile.json` (file picker)
- Draft-answer integration with the Python `draft_answers.py` via a local
  HTTP bridge (or in-extension Anthropic client)
- Icons + Chrome Web Store packaging
- Sync of fill results back to `data/applications.md` so applications
  tracking happens automatically

## File layout

```
autoapply/chrome-extension/
├── manifest.json
├── background/
│   └── service-worker.js
├── content/
│   ├── ats-detector.js     URL → ATS name
│   ├── form-filler.js      generic field-fill helpers
│   └── content-script.js   wires the above on every supported page
├── lib/
│   ├── profile.js          chrome.storage.local helpers
│   └── selectors/
│       ├── ashby.js        (partial — verified against 1-2 tenants)
│       ├── greenhouse.js   (stub)
│       ├── lever.js        (stub)
│       └── workday.js      (stub)
├── popup/
│   ├── popup.html
│   ├── popup.js
│   └── popup.css
└── README.md               this file
```

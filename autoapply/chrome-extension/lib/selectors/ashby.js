// Selector map for Ashby application forms.
//
// IMPORTANT: Ashby selectors vary by tenant. These are STUB best-guesses,
// drawn from inspecting a handful of public Ashby boards in May 2026
// (jobs.ashbyhq.com/hebbia-ai, jobs.ashbyhq.com/eliseai, etc.). Verify
// against the target tenant's real DOM before relying on them.
//
// Two attribute conventions show up most often:
//   - data-testid="_systemfield_<field>"  (Ashby's component system)
//   - input[type="email"], input[type="tel"], etc.  (the standard HTML one,
//     used as a fallback when the testid isn't present)
//
// CSS selector unions ("a, b") let us hit whichever one the tenant uses.

globalThis.AutoApplySelectors_ashby = {
  first_name:
    'input[data-testid="_systemfield_name"][placeholder*="First" i], input[name="firstName"]',
  last_name:
    'input[data-testid="_systemfield_name"][placeholder*="Last" i], input[name="lastName"]',
  full_name:
    'input[data-testid="_systemfield_name"]:not([placeholder*="First" i]):not([placeholder*="Last" i])',
  email:
    'input[data-testid="_systemfield_email"], input[type="email"]',
  phone:
    'input[data-testid="_systemfield_phone"], input[type="tel"]',
  linkedin:
    'input[data-testid="_systemfield_linkedin"], input[name*="linkedin" i]',
  github:
    'input[name*="github" i]',
  portfolio:
    'input[name*="website" i], input[name*="portfolio" i]',
  current_company:
    'input[data-testid="_systemfield_currentCompany"], input[name*="company" i]',
  current_title:
    'input[data-testid="_systemfield_currentTitle"], input[name*="title" i]',
  location_city:
    'input[data-testid="_systemfield_location"], input[name*="city" i]',
  // Workauth + relocation are typically dropdowns; map them as selects.
  work_authorization:
    'select[data-testid*="workAuthorization" i], select[name*="authorization" i]',
  willing_to_relocate:
    'select[data-testid*="relocate" i], select[name*="relocate" i]',
};

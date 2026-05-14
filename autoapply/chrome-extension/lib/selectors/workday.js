// Selector map for Workday application forms.
//
// STUB — Workday is the hardest of the four ATSes to automate. Its DOM is
// heavily nested in Shadow DOMs and data-automation-id attributes, and the
// "Apply" flow walks through 6-12 distinct steps (not a single form). The
// selectors below are placeholder shapes — the real work is per-tenant.
//
// Reference for the data-automation-id naming convention:
//   https://community.workday.com/sites/default/files/file-hosting/
//   productionapi/restapi/devCenter/Workday%20Web%20Services%20Reference.pdf
// (Workday hides their actual contract behind a customer login.)

globalThis.AutoApplySelectors_workday = {
  first_name: 'input[data-automation-id="legalNameSection_firstName"]',
  last_name: 'input[data-automation-id="legalNameSection_lastName"]',
  email: 'input[data-automation-id="email"]',
  phone: 'input[data-automation-id="phone-number"]',
};

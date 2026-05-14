// Selector map for Greenhouse application forms.
//
// STUB — placeholder values, not verified against real tenants. Greenhouse
// forms use stable id attributes (id="first_name", id="last_name", id="email",
// id="phone", and custom ones for "Where did you hear about us?", LinkedIn,
// etc.). The standard contract is documented at
// https://support.greenhouse.io/hc/en-us/articles/360050527732, but the
// per-tenant custom fields vary widely — verify against the target before
// wiring more.

globalThis.AutoApplySelectors_greenhouse = {
  first_name: 'input#first_name',
  last_name: 'input#last_name',
  email: 'input#email',
  phone: 'input#phone',
  linkedin: 'input[id*="linkedin" i], input[name*="linkedin" i]',
  github: 'input[id*="github" i], input[name*="github" i]',
  portfolio: 'input[id*="website" i], input[name*="website" i]',
  current_company: 'input[id*="company" i]:not([id*="why" i])',
  current_title: 'input[id*="title" i]',
};

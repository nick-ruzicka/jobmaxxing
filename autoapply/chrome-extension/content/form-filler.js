// form-filler.js — generic fill helpers. Selector maps live in
// lib/selectors/<ats>.js and are loaded by content-script.js for the
// detected ATS.

/**
 * Fill a single form input by CSS selector. Returns:
 *   { ok: true, selector, value }
 *   { ok: false, selector, reason: "not-found" | "wrong-type" | "disabled" }
 *
 * For React-controlled inputs (Ashby, Greenhouse, Lever all use React), a
 * raw .value = newValue assignment doesn't fire the synthetic event React
 * watches. We dispatch a native InputEvent so React's onChange handler
 * picks the value up. Same trick the React testing-library uses internally.
 */
function fillField(selector, value) {
  const el = document.querySelector(selector);
  if (!el) return { ok: false, selector, reason: "not-found" };
  if (el.disabled) return { ok: false, selector, reason: "disabled" };

  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
    const type = (el.getAttribute("type") || "text").toLowerCase();
    if (type === "checkbox" || type === "radio") {
      const target = Boolean(value);
      if (el.checked !== target) {
        el.click(); // most reliable across React + native event listeners
      }
      return { ok: true, selector, value: target };
    }
    // text-ish: use the property setter React tracks, then dispatch input.
    setReactValue(el, String(value ?? ""));
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, selector, value };
  }

  if (el.tagName === "SELECT") {
    const target = String(value ?? "");
    // Try matching by value, then by visible text.
    let matched = false;
    for (const opt of el.options) {
      if (opt.value === target || opt.textContent.trim() === target) {
        el.value = opt.value;
        matched = true;
        break;
      }
    }
    if (!matched) return { ok: false, selector, reason: "no-matching-option" };
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, selector, value: el.value };
  }

  return { ok: false, selector, reason: "wrong-type" };
}

/**
 * Walk a logical-field → CSS-selector map and fill each. Logs every result
 * to the console for the human to scan in DevTools. Returns the same array.
 */
function fillFromMap(selectorMap, profileSubset) {
  const results = [];
  for (const [logical, selector] of Object.entries(selectorMap || {})) {
    const value = profileSubset?.[logical];
    if (value === undefined || value === null || value === "") {
      results.push({ ok: false, logical, selector, reason: "no-value" });
      continue;
    }
    const res = fillField(selector, value);
    results.push({ logical, ...res });
  }
  // eslint-disable-next-line no-console
  console.log("[AutoApply] fill results:", results);
  return results;
}

/**
 * React's synthetic-event system intercepts .value writes through a wrapped
 * descriptor on HTMLInputElement.prototype. Use the underlying native setter
 * so React's tracker registers the change before we dispatch the event.
 */
function setReactValue(el, value) {
  const proto = el.tagName === "TEXTAREA"
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
}

globalThis.AutoApplyFormFiller = { fillField, fillFromMap };

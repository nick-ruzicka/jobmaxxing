import { test } from "node:test";
import assert from "node:assert/strict";
import { stripHtml } from "./strip-html.mjs";

test("stripHtml: drops <script> body before tag strip", () => {
  const html = `
    <div>
      <h1>Senior GTM Engineer</h1>
      <script>window.__NUXT__ = { jobBoardConfig: "noise we do not want as text" };</script>
      <p>We are hiring.</p>
    </div>
  `;
  const out = stripHtml(html);
  assert.ok(out.includes("Senior GTM Engineer"));
  assert.ok(out.includes("We are hiring."));
  assert.ok(!out.includes("__NUXT__"), `leaked script body: ${out}`);
  assert.ok(!out.includes("jobBoardConfig"), `leaked script body: ${out}`);
  assert.ok(!out.includes("noise"), `leaked script body: ${out}`);
});

test("stripHtml: drops <style> body before tag strip", () => {
  const html = `
    <style>.jd-wrap { background: #fff; color: #000; font-family: sans-serif; }</style>
    <div class="jd-wrap"><p>Compensation: $200K-$240K base.</p></div>
  `;
  const out = stripHtml(html);
  assert.ok(out.includes("$200K-$240K"));
  assert.ok(!out.includes("background"), `leaked style body: ${out}`);
  assert.ok(!out.includes("sans-serif"), `leaked style body: ${out}`);
  assert.ok(!out.includes(".jd-wrap"), `leaked style body: ${out}`);
});

test("stripHtml: handles adjacent and multiple script blocks (non-greedy)", () => {
  const html = `
    <script>var a = 1;</script>
    <p>Real content one.</p>
    <script>var b = 2;</script>
    <p>Real content two.</p>
    <script type="application/ld+json">{"@type":"JobPosting"}</script>
  `;
  const out = stripHtml(html);
  assert.ok(out.includes("Real content one."));
  assert.ok(out.includes("Real content two."));
  // Non-greedy means we don't accidentally swallow the <p> blocks between scripts.
  assert.ok(!out.includes("var a"), `merged script bodies: ${out}`);
  assert.ok(!out.includes("var b"), `merged script bodies: ${out}`);
  assert.ok(!out.includes("JobPosting"), `JSON-LD script leaked: ${out}`);
});

test("stripHtml: case-insensitive script/style tags", () => {
  const html = `<SCRIPT>leaked()</SCRIPT><Style>.x{}</Style><p>kept</p>`;
  const out = stripHtml(html);
  assert.equal(out, "kept");
});

test("stripHtml: still decodes the entities the existing pipeline relied on", () => {
  const html = "<p>R&amp;D &lt;hr&gt; &quot;leadership&quot; &#39;ops&#39; &nbsp; team</p>";
  const out = stripHtml(html);
  assert.equal(out, `R&D <hr> "leadership" 'ops' team`);
});

test("stripHtml: collapses whitespace and trims", () => {
  const html = "  <p>   spaced   out\n\n  text  </p>  ";
  assert.equal(stripHtml(html), "spaced out text");
});

test("stripHtml: null/undefined/empty are safe", () => {
  assert.equal(stripHtml(null), "");
  assert.equal(stripHtml(undefined), "");
  assert.equal(stripHtml(""), "");
});

test("stripHtml: does not match <scripted> or <styled> (\\b boundary)", () => {
  // Edge case: a fictional <scripted> tag should NOT have its body removed.
  // The \b boundary after "script" prevents that.
  const html = `<scripted data-x="1">visible</scripted>`;
  const out = stripHtml(html);
  assert.ok(out.includes("visible"));
});

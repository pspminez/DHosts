#!/usr/bin/env node
// tools/check-landing.cjs — guards the static landing page.
//
// The stats row used to be a count-up that started at zero, so anything that
// did not finish the animation (link previews, scrapers, a throttled tab) showed
// "$0 / 0 min / 0/7". The real values must be in the markup, with no script
// resetting them. This also pins the Portfolio feature list so a duplicated or
// dropped bullet cannot come back unnoticed.

const fs = require("fs");

const html = fs.readFileSync("site/index.html", "utf8");
const js = fs.readFileSync("site/main.js", "utf8");

const results = [];
function check(label, ok, detail) {
  results.push({ label, ok, detail: detail || "" });
}

const metrics = [...html.matchAll(/<dd class="metric-value"><span>([^<]*)<\/span><\/dd>/g)].map((m) => m[1]);
check(
  "stats render their real values in the markup",
  JSON.stringify(metrics) === JSON.stringify(["$39", "10 min", "24/7", "0"]),
  "found " + JSON.stringify(metrics),
);
check(
  "no counter attributes remain",
  !/data-count|data-prefix|data-suffix/.test(html),
  "data-count still present",
);
check(
  "no count-up code can reset the numbers",
  !/runCounter|data-count/.test(js),
  "main.js still contains the counter",
);

const lists = [...html.matchAll(/<ul class="plan-features">([\s\S]*?)<\/ul>/g)].map((m) => m[1]);
const bullets = [...lists[1].matchAll(/<\/svg><\/span>([^<]+)<\/li>/g)].map((m) => m[1]);
const expected = [
  "Up to 4 properties, a number each",
  "Everything in Solo",
  "One dashboard across all four",
  "A separate approved guide per property — no shared facts between houses",
  "Weekly coverage review with suggested guide edits",
];
check(
  "Portfolio lists the intended five features",
  JSON.stringify(bullets) === JSON.stringify(expected),
  "found " + JSON.stringify(bullets),
);

let failed = 0;
for (const result of results) {
  console.log((result.ok ? "  ok   " : "  FAIL ") + result.label + (result.ok ? "" : "\n       " + result.detail));
  if (!result.ok) failed++;
}
console.log(failed ? "LANDING CHECK: FAIL" : "LANDING CHECK: PASS");
process.exit(failed ? 1 : 0);

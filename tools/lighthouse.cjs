#!/usr/bin/env node
// tools/lighthouse.cjs — repeatable Lighthouse gate for the landing page.
//
//   npm run check:lighthouse
//   LIGHTHOUSE_URL=http://localhost:8788/ npm run check:lighthouse
//
// Runs Lighthouse through npx (no dependency added to package.json), writes the
// JSON report to .shots/ (gitignored) and fails when a category drops below its
// threshold. Thresholds can be raised per run with the environment variables
// below, but they are deliberately floors: the page currently scores 99-100.
//
// Needs Chrome installed. Chrome's default path is used on Windows if
// CHROME_PATH is not already set.

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const url = process.env.LIGHTHOUSE_URL || "https://davenport-host-co.pages.dev/";
const outFile = process.env.LIGHTHOUSE_OUTPUT || path.join(".shots", "lighthouse.json");
const thresholds = {
  performance: Number(process.env.LIGHTHOUSE_MIN_PERFORMANCE || 90),
  accessibility: Number(process.env.LIGHTHOUSE_MIN_ACCESSIBILITY || 95),
  "best-practices": Number(process.env.LIGHTHOUSE_MIN_BEST_PRACTICES || 95),
  seo: Number(process.env.LIGHTHOUSE_MIN_SEO || 95),
};

try {
  new URL(url);
} catch {
  console.error("LIGHTHOUSE_URL must be a valid URL.");
  process.exit(2);
}

const env = { ...process.env };
const windowsChrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
if (!env.CHROME_PATH && fs.existsSync(windowsChrome)) env.CHROME_PATH = windowsChrome;

fs.mkdirSync(path.dirname(outFile), { recursive: true });

// One flag per token: --chrome-flags splits on spaces, and a shell is needed to
// launch npx on Windows, so a multi-flag value would be split twice.
const args = [
  "--yes",
  "lighthouse@13",
  url,
  "--output=json",
  "--output-path=" + outFile,
  "--chrome-flags=--headless=new",
  "--only-categories=performance,accessibility,best-practices,seo",
  "--quiet",
];

console.log("Running Lighthouse against " + url);
const run = spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", args, {
  stdio: "inherit",
  env,
  shell: process.platform === "win32",
  timeout: 300000,
});

if (run.error) {
  console.error("Could not run Lighthouse: " + run.error.message);
  process.exit(1);
}
if (run.status !== 0) {
  console.error("Lighthouse exited with status " + run.status);
  process.exit(1);
}

let report;
try {
  report = JSON.parse(fs.readFileSync(outFile, "utf8"));
} catch (error) {
  console.error("Could not read the Lighthouse report: " + error.message);
  process.exit(1);
}

let failed = 0;
for (const [key, minimum] of Object.entries(thresholds)) {
  const category = report.categories && report.categories[key];
  if (!category || typeof category.score !== "number") {
    console.log("  FAIL " + key + " · category missing from the report");
    failed++;
    continue;
  }
  const score = Math.round(category.score * 100);
  const ok = score >= minimum;
  console.log("  " + (ok ? "ok   " : "FAIL ") + category.title + " " + score + " (min " + minimum + ")");
  if (!ok) failed++;
}

for (const id of ["first-contentful-paint", "largest-contentful-paint", "total-blocking-time", "cumulative-layout-shift"]) {
  const audit = report.audits && report.audits[id];
  if (audit && audit.displayValue) console.log("       " + audit.title + ": " + audit.displayValue);
}

console.log(failed ? "LIGHTHOUSE: FAIL (" + failed + " categories below threshold)" : "LIGHTHOUSE: PASS");
process.exit(failed ? 1 : 0);

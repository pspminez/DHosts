#!/usr/bin/env node
// Read-only production smoke check. It sends GET requests only and never prints
// credentials, property identifiers, contact details, knowledge, or scorecards.
//
//   STAYXI_ADMIN_PASSWORD must be set in the environment before running, or
//   kept in the git-ignored .dev.vars at the repo root so a plain `npm run
//   check:production` works without putting the password in shell history.

const fs = require("fs");
const path = require("path");

const DEFAULT_BASE_URL = "https://davenport-host-co-bot.davenport-host-co-bot.workers.dev";
const baseUrl = (process.env.STAYXI_SMOKE_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
let parsedBaseUrl;
try {
  parsedBaseUrl = new URL(baseUrl);
} catch {
  console.error("STAYXI_SMOKE_BASE_URL must be a valid HTTPS URL.");
  process.exit(2);
}
const allowedProductionHosts = new Set([
  "davenport-host-co-bot.davenport-host-co-bot.workers.dev",
  "api.stayxi.com",
]);
const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
const isLocalTarget = parsedBaseUrl.protocol === "http:" && localHosts.has(parsedBaseUrl.hostname);
const isProductionTarget = parsedBaseUrl.protocol === "https:" && allowedProductionHosts.has(parsedBaseUrl.hostname);
if ((!isLocalTarget && !isProductionTarget) || parsedBaseUrl.username || parsedBaseUrl.password || parsedBaseUrl.pathname !== "/" || parsedBaseUrl.search || parsedBaseUrl.hash) {
  console.error("Use the configured production Worker/API origin, or localhost for testing; do not include credentials or a path.");
  process.exit(2);
}
// .dev.vars is local-only and never printed. Reading it here keeps the password
// out of shell history and chat transcripts; the environment variable still wins
// so CI can inject it directly.
function passwordFromDevVars() {
  try {
    const text = fs.readFileSync(path.join(__dirname, "..", ".dev.vars"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const match = /^STAYXI_ADMIN_PASSWORD\s*=\s*(.*)$/.exec(line.trim());
      if (!match) continue;
      const value = match[1].trim().replace(/^(['"])([\s\S]*)\1$/, "$2");
      if (value) return value;
    }
  } catch {
    // No .dev.vars is normal; the environment variable is the primary path.
  }
  return "";
}

const password = process.env.STAYXI_ADMIN_PASSWORD || passwordFromDevVars();

if (!password) {
  console.error("Set STAYXI_ADMIN_PASSWORD in the environment or in the git-ignored .dev.vars at the repo root; the value is never printed.");
  process.exit(2);
}

// The marketing site is a separate Pages project, so it gets its own origin
// rather than the Worker base URL above.
const DEFAULT_LANDING_URL = "https://davenport-host-co.pages.dev";
const landingUrl = (process.env.STAYXI_LANDING_URL || DEFAULT_LANDING_URL).replace(/\/+$/, "");
let parsedLandingUrl;
try {
  parsedLandingUrl = new URL(landingUrl);
} catch {
  console.error("STAYXI_LANDING_URL must be a valid HTTPS URL.");
  process.exit(2);
}
const allowedLandingHosts = new Set(["davenport-host-co.pages.dev"]);
const isLocalLanding = parsedLandingUrl.protocol === "http:" && localHosts.has(parsedLandingUrl.hostname);
const isProductionLanding = parsedLandingUrl.protocol === "https:" && allowedLandingHosts.has(parsedLandingUrl.hostname);
if ((!isLocalLanding && !isProductionLanding) || parsedLandingUrl.username || parsedLandingUrl.password || parsedLandingUrl.pathname !== "/" || parsedLandingUrl.search || parsedLandingUrl.hash) {
  console.error("Use the production Pages origin, or localhost for testing; do not include credentials or a path.");
  process.exit(2);
}

const headers = { "x-admin-password": password };
let failures = 0;

async function get(path, authenticated = false) {
  const response = await fetch(baseUrl + path, {
    method: "GET",
    headers: authenticated ? headers : undefined,
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  if (response.status !== 200) {
    throw new Error(`${path} returned HTTP ${response.status}`);
  }
  return response;
}

async function getLanding(pathAndQuery) {
  const response = await fetch(landingUrl + pathAndQuery, {
    method: "GET",
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  if (response.status !== 200) {
    throw new Error(`${pathAndQuery} returned HTTP ${response.status}`);
  }
  return response;
}

async function check(label, run) {
  try {
    const detail = await run();
    console.log(`  ok   ${label}${detail ? ` · ${detail}` : ""}`);
  } catch (error) {
    failures++;
    console.error(`  FAIL ${label} · ${error.message}`);
  }
}

async function main() {
await check("public Worker health", async () => {
  const response = await get("/health");
  const body = await response.json();
  if (body.status !== "ok") throw new Error("health payload is not ok");
});

await check("Pilot admin markup", async () => {
  const response = await get("/admin");
  const html = await response.text();
  for (const marker of ['id="pilotAuditSummary"', 'id="pilotAuditEvents"', "StayXI Property Pilot Program"]) {
    if (!html.includes(marker)) throw new Error("Pilot panel markup is missing");
  }
});

await check("authenticated admin health", async () => {
  const response = await get("/admin/api/health", true);
  const body = await response.json();
  if (body.database !== "ok" || body.propertyStore !== "ok") throw new Error("D1 or property store is not healthy");
  if (!body.twilioConfigured) throw new Error("Twilio credentials are not configured");
  if (!body.signatureValidationEnabled) throw new Error("Twilio signature validation is disabled");
});

await check("authenticated pilot records API", async () => {
  const response = await get("/admin/api/pilots", true);
  const body = await response.json();
  if (!Array.isArray(body.pilots) || !Array.isArray(body.availableProperties)) {
    throw new Error("unexpected pilot API response");
  }
});

await check("pilot records API rejects unauthenticated access", async () => {
  try {
    await get("/admin/api/pilots");
  } catch (error) {
    if (error.message.endsWith("returned HTTP 401")) return;
    throw error;
  }
  throw new Error("endpoint did not require authentication");
});

await check("authenticated pilot activity API", async () => {
  const response = await get("/admin/api/pilot-audit", true);
  const body = await response.json();
  const expected = ["launched", "completed", "scorecardsSaved"];
  if (!body.summary || expected.some((key) => !Number.isInteger(body.summary[key])) || !Array.isArray(body.events)) {
    throw new Error("unexpected audit API response");
  }
  if (body.events.some((event) => "scorecard" in event || "changedFields" in event || "notes" in event)) {
    throw new Error("audit API exposed scorecard or field contents");
  }
  return "metadata-only response; no scorecard values or property details are printed";
});

await check("landing stats render without JavaScript", async () => {
  const html = await (await getLanding(`/?smoke=${Date.now()}`)).text();
  const metrics = [...html.matchAll(/<dd class="metric-value"><span>([^<]*)<\/span><\/dd>/g)].map((match) => match[1]);
  if (JSON.stringify(metrics) !== JSON.stringify(["$39", "10 min", "24/7", "0"])) {
    throw new Error("stats markup is " + JSON.stringify(metrics));
  }
  if (/data-count/.test(html)) throw new Error("stats still depend on a count-up");
  return "4 static values, no counter attributes";
});

await check("landing Portfolio plan lists five features", async () => {
  const html = await (await getLanding(`/?smoke=${Date.now()}`)).text();
  const lists = [...html.matchAll(/<ul class="plan-features">([\s\S]*?)<\/ul>/g)].map((match) => match[1]);
  const bullets = [...(lists[1] || "").matchAll(/<\/svg><\/span>([^<]+)<\/li>/g)].map((match) => match[1]);
  const expected = [
    "Up to 4 properties, a number each",
    "Everything in Solo",
    "One dashboard across all four",
    "A separate approved guide per property — no shared facts between houses",
    "Weekly coverage review with suggested guide edits",
  ];
  if (JSON.stringify(bullets) !== JSON.stringify(expected)) {
    throw new Error("Portfolio bullets are " + JSON.stringify(bullets));
  }
  return "5 bullets";
});

await check("landing JavaScript has no counter", async () => {
  const js = await (await getLanding(`/main.js?smoke=${Date.now()}`)).text();
  if (/runCounter|data-count/.test(js)) throw new Error("counter code is still served");
  return "static values only";
});

console.log(failures ? `PRODUCTION SMOKE: FAIL (${failures} checks)` : "PRODUCTION SMOKE: PASS");
process.exitCode = failures ? 1 : 0;
}

main().catch((error) => {
  console.error(`PRODUCTION SMOKE: FAIL · ${error.message}`);
  process.exitCode = 1;
});

#!/usr/bin/env node
// Read-only production smoke check. It sends GET requests only and never prints
// credentials, property identifiers, contact details, knowledge, or scorecards.
//
//   STAYXI_ADMIN_PASSWORD must be set in the environment before running.

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
const password = process.env.STAYXI_ADMIN_PASSWORD;

if (!password) {
  console.error("Set STAYXI_ADMIN_PASSWORD in the environment; the password is never read from a file or printed.");
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

console.log(failures ? `PRODUCTION SMOKE: FAIL (${failures} checks)` : "PRODUCTION SMOKE: PASS");
process.exitCode = failures ? 1 : 0;
}

main().catch((error) => {
  console.error(`PRODUCTION SMOKE: FAIL · ${error.message}`);
  process.exitCode = 1;
});

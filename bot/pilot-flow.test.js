import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WRANGLER = path.join(ROOT, "node_modules", "wrangler", "bin", "wrangler.js");
const PASSWORD = "pilot-flow-test-password";
const PROPERTY_ID = "PILOTFLOWTEST";
const TEST_TIMEOUT_MS = 90000;

async function unusedPort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

function runWrangler(args, options = {}) {
  const result = spawnSync(process.execPath, [WRANGLER, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 60000,
    env: { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" },
    ...options,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`wrangler ${args.join(" ")} failed:\n${result.stdout || ""}\n${result.stderr || ""}\n${result.error || ""}`);
  }
  return result.stdout;
}

async function waitForWorker(baseUrl, worker, getOutput) {
  const deadline = Date.now() + 30000;
  let lastError = "not ready";
  while (Date.now() < deadline) {
    if (worker.exitCode !== null) {
      throw new Error(`Local Wrangler exited (${worker.exitCode}):\n${getOutput()}`);
    }
    try {
      const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return;
      lastError = `health returned HTTP ${response.status}`;
    } catch (error) {
      lastError = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Local Wrangler did not become ready (${lastError}):\n${getOutput()}`);
}

async function api(baseUrl, cookie, route, { method = "GET", body, headers: extraHeaders = {} } = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { response, data };
}

test("pilot flow persists through the local Worker and blocks unchecked activation", { timeout: TEST_TIMEOUT_MS }, async (t) => {
  const persistTo = await mkdtemp(path.join(os.tmpdir(), "stayxi-pilot-flow-"));
  const port = await unusedPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  let worker;
  let workerOutput = "";
  const appendOutput = (chunk) => {
    workerOutput = (workerOutput + chunk.toString()).slice(-12000);
  };

  t.after(async () => {
    if (worker && worker.exitCode === null) {
      worker.kill("SIGTERM");
      await Promise.race([once(worker, "exit"), new Promise((resolve) => setTimeout(resolve, 4000))]);
      if (worker.exitCode === null) worker.kill("SIGKILL");
    }
    for (let attempt = 0; attempt < 12; attempt++) {
      try {
        await rm(persistTo, { recursive: true, force: true, maxRetries: 2, retryDelay: 250 });
        return;
      } catch (error) {
        if (attempt === 11) throw error;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  });

  runWrangler([
    "d1", "migrations", "apply", "davenport-host-co-db", "--local", "--persist-to", persistTo,
  ]);

  worker = spawn(process.execPath, [
    WRANGLER,
    "dev",
    "--local",
    "--ip", "127.0.0.1",
    "--port", String(port),
    "--inspector-port", "0",
    "--persist-to", persistTo,
    "--var", `ADMIN_PASSWORD:${PASSWORD}`,
    "--show-interactive-dev-session=false",
  ], {
    cwd: ROOT,
    env: { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  worker.stdout.on("data", appendOutput);
  worker.stderr.on("data", appendOutput);
  await waitForWorker(baseUrl, worker, () => workerOutput);

  // The login endpoint verifies the password from a header rather than JSON.
  const login = await api(baseUrl, "", "/admin/api/login", {
    method: "POST",
    headers: { "x-admin-password": PASSWORD },
  });
  assert.equal(login.response.status, 200, JSON.stringify(login.data));
  const setCookie = login.response.headers.get("set-cookie") || "";
  assert.match(setCookie, /admin_session=[0-9a-f]{64}/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  const cookie = setCookie.match(/admin_session=[^;,]+/)?.[0];
  assert.ok(cookie, "login must establish an admin session cookie");

  let result = await api(baseUrl, "", "/admin/api/pilots");
  assert.equal(result.response.status, 401, "pilot APIs require a session");

  result = await api(baseUrl, cookie, "/admin/api/property", {
    method: "POST",
    body: {
      id: PROPERTY_ID,
      name: "Pilot Flow Test Property",
      hostPhone: "+15550101234",
      twilioNumber: "+15550105678",
      active: false,
    },
  });
  assert.equal(result.response.status, 200, JSON.stringify(result.data));

  result = await api(baseUrl, cookie, "/admin/api/pilots", {
    method: "POST",
    body: {
      propertyId: PROPERTY_ID,
      clientName: "Integration Test Operator",
      contactName: "Test Contact",
      contactEmail: "pilot@example.test",
      contactPhone: "+15550109876",
      location: "Test Location",
      knowledge: {
        answers: [{ topic: "Wi-Fi", keywords: ["wifi"], reply: "Use the guest network." }],
        secrets: [],
      },
    },
  });
  assert.equal(result.response.status, 201, JSON.stringify(result.data));
  assert.equal(result.data.stage, "draft");

  result = await api(baseUrl, cookie, `/admin/api/property?id=${PROPERTY_ID}`, {
    method: "PUT",
    body: { id: PROPERTY_ID, active: true },
  });
  assert.equal(result.response.status, 409, "generic property edits cannot bypass pilot launch checks");

  // A property that already serves guests can start a pilot too. Onboarding it
  // must not pause it: it keeps answering guests while the setup is a draft.
  const ACTIVE_ID = "PILOTFLOWLIVE";
  result = await api(baseUrl, cookie, "/admin/api/property", {
    method: "POST",
    body: {
      id: ACTIVE_ID,
      name: "Already Serving Property",
      hostPhone: "+15550101235",
      twilioNumber: "+15550105679",
      active: true,
    },
  });
  assert.equal(result.response.status, 200, JSON.stringify(result.data));

  result = await api(baseUrl, cookie, "/admin/api/pilots");
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  const eligibleIds = result.data.availableProperties.map((item) => item.id);
  assert.ok(eligibleIds.includes(ACTIVE_ID), "an active property without a pilot is offered for onboarding");
  assert.ok(!eligibleIds.includes(PROPERTY_ID), "a property that already has a pilot is not offered again");

  result = await api(baseUrl, cookie, "/admin/api/pilots", {
    method: "POST",
    body: { propertyId: ACTIVE_ID, clientName: "Already Serving Operator", contactEmail: "live@example.test" },
  });
  assert.equal(result.response.status, 201, JSON.stringify(result.data));
  assert.equal(result.data.stage, "draft");
  assert.equal(result.data.active, true, "starting a pilot leaves an active property serving guests");

  result = await api(baseUrl, cookie, "/admin/api/pilots");
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  const activePilot = result.data.pilots.find((item) => item.propertyId === ACTIVE_ID);
  assert.ok(activePilot, "the active property now has a pilot record");
  assert.equal(activePilot.stage, "draft");
  assert.equal(activePilot.active, true, "the property stays active while its pilot setup is a draft");

  const today = new Date().toISOString().slice(0, 10);
  const endsAt = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  const checklist = Object.fromEntries(Array.from({ length: 7 }, (_, index) => [String(index), index !== 4]));
  const draft = {
    propertyId: PROPERTY_ID,
    clientName: "Integration Test Operator",
    contactName: "Test Contact",
    contactEmail: "pilot@example.test",
    contactPhone: "+15550109876",
    location: "Test Location",
    startedAt: today,
    endsAt,
    feeCents: 4900,
    checklist,
    knowledge: { answers: [{ topic: "Wi-Fi", keywords: ["wifi"], reply: "Use the guest network." }], secrets: [] },
    scorecard: {},
  };

  result = await api(baseUrl, cookie, "/admin/api/pilot", { method: "PUT", body: draft });
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  result = await api(baseUrl, cookie, "/admin/api/pilot", {
    method: "PUT",
    body: { propertyId: PROPERTY_ID, stage: "pilot" },
  });
  assert.equal(result.response.status, 409, "launch rejects an incomplete safety/operational checklist");

  draft.checklist = Object.fromEntries(Array.from({ length: 7 }, (_, index) => [String(index), true]));
  result = await api(baseUrl, cookie, "/admin/api/pilot", { method: "PUT", body: draft });
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  result = await api(baseUrl, cookie, "/admin/api/pilot", {
    method: "PUT",
    body: { propertyId: PROPERTY_ID, stage: "pilot" },
  });
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.stage, "pilot");

  result = await api(baseUrl, cookie, "/admin/api/pilots");
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  let pilot = result.data.pilots.find((item) => item.propertyId === PROPERTY_ID);
  assert.ok(pilot, "launched pilot is returned from persistent storage");
  assert.equal(pilot.stage, "pilot");
  assert.equal(pilot.active, true);

  const scorecard = {
    amountPaid: "49.00",
    answerQuality: "Reviewed and correct",
    incidents: "None reported",
    decision: "continue",
    nextAction: "Schedule closeout",
  };
  result = await api(baseUrl, cookie, "/admin/api/pilot", {
    method: "PUT",
    body: { propertyId: PROPERTY_ID, scorecard },
  });
  assert.equal(result.response.status, 200, JSON.stringify(result.data));

  result = await api(baseUrl, cookie, "/admin/api/pilots");
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  pilot = result.data.pilots.find((item) => item.propertyId === PROPERTY_ID);
  assert.deepEqual(pilot.scorecard, scorecard, "scorecard remains in D1 and is returned by a fresh API read");
});

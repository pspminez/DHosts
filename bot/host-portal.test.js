// Tests for the host portal's credentials, sessions and dashboard shaping.

import test from "node:test";
import assert from "node:assert/strict";
import {
  HOST_LOGIN_MAX_FAILURES,
  buildHostOverview,
  clearHostLoginFailures,
  clearHostPasscode,
  createHostSession,
  getHostSession,
  hostLoginLock,
  hostPasscodeProblem,
  DEFAULT_HOST_PASSCODE,
  hostPortalStatus,
  hostSessionClearCookie,
  hostSessionCookie,
  normalizeHostGuide,
  noteHostLoginFailure,
  revokeAllHostSessions,
  revokeHostSession,
  sampleHostOverview,
  saveHostPasscode,
  verifyHostPasscode,
} from "./host-portal.js";

class MemoryKV {
  constructor() {
    this.map = new Map();
  }
  async get(key, type) {
    const value = this.map.get(key);
    if (value === undefined) return null;
    if (type === "json") {
      try { return JSON.parse(value); } catch { return null; }
    }
    return value;
  }
  async put(key, value) {
    this.map.set(key, value);
  }
  async delete(key) {
    this.map.delete(key);
  }
  async list({ prefix } = {}) {
    const keys = [...this.map.keys()]
      .filter((key) => !prefix || key.startsWith(prefix))
      .map((name) => ({ name }));
    return { keys, list_complete: true, cursor: undefined };
  }
}

test("a host passcode is salted, stored only as a hash, and verifiable", async () => {
  const kv = new MemoryKV();
  await saveHostPasscode(kv, "CEDAR", "porch-light-42");
  assert.notEqual(await kv.get("host:credential:CEDAR"), null);
  assert.ok(!String(await kv.get("host:credential:CEDAR")).includes("porch-light-42"));

  const stored = await kv.get("host:credential:CEDAR", "json");
  assert.equal(await verifyHostPasscode(stored, "porch-light-42"), true);
  assert.equal(await verifyHostPasscode(stored, "porch-light-41"), false);
  assert.equal(await verifyHostPasscode(null, "porch-light-42"), false);

  const status = await hostPortalStatus(kv, "CEDAR");
  assert.equal(status.configured, true);
  assert.equal(status.defaultPasscode, false);
  assert.ok(status.updatedAt);

  await clearHostPasscode(kv, "CEDAR");
  const cleared = await hostPortalStatus(kv, "CEDAR");
  assert.equal(cleared.configured, false);
  assert.equal(cleared.defaultPasscode, false);
});

// The admin panel flags portals that still use the staging passcode. That flag
// is derived from the stored hash, so no plaintext passcode is kept anywhere.
test("the admin status names the staging passcode without storing it", async () => {
  const kv = new MemoryKV();
  await saveHostPasscode(kv, "CEDAR", DEFAULT_HOST_PASSCODE);
  const flagged = await hostPortalStatus(kv, "CEDAR");
  assert.equal(flagged.configured, true);
  assert.equal(flagged.defaultPasscode, true);

  await saveHostPasscode(kv, "CEDAR", "porch-light-42");
  assert.equal((await hostPortalStatus(kv, "CEDAR")).defaultPasscode, false);
  assert.ok(!String(await kv.get("host:credential:CEDAR")).includes(DEFAULT_HOST_PASSCODE));
});

test("host passcodes have a length floor and ceiling", () => {
  assert.match(hostPasscodeProblem("short"), /at least 8/);
  assert.match(hostPasscodeProblem("x".repeat(201)), /200 characters or fewer/);
  assert.equal(hostPasscodeProblem("long-enough"), "");
  assert.match(hostPasscodeProblem(null), /string/);
});

test("a host session survives only while its token is stored", async () => {
  const kv = new MemoryKV();
  await createHostSession(kv, "token-a", { propertyId: "CEDAR", houseCode: "CEDAR", hostName: "Dana" }, 3600);
  const session = await getHostSession(kv, "token-a");
  assert.equal(session.propertyId, "CEDAR");
  assert.equal(session.hostName, "Dana");

  await revokeHostSession(kv, "token-a");
  assert.equal(await getHostSession(kv, "token-a"), null);
  assert.equal(await getHostSession(kv, "missing"), null);

  const cookie = hostSessionCookie("token-a", 3600);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Max-Age=3600/);
  assert.match(hostSessionClearCookie(), /Max-Age=0/);
});

test("changing a passcode can revoke every session for that property only", async () => {
  const kv = new MemoryKV();
  await createHostSession(kv, "cedar-1", { propertyId: "CEDAR" }, 3600);
  await createHostSession(kv, "cedar-2", { propertyId: "CEDAR" }, 3600);
  await createHostSession(kv, "harbor-1", { propertyId: "HARBOR" }, 3600);

  await revokeAllHostSessions(kv, "CEDAR");
  assert.equal(await getHostSession(kv, "cedar-1"), null);
  assert.equal(await getHostSession(kv, "cedar-2"), null);
  assert.equal((await getHostSession(kv, "harbor-1")).propertyId, "HARBOR");
});

test("five wrong passcodes lock the address and house code for fifteen minutes", async () => {
  const kv = new MemoryKV();
  const now = 1_800_000_000_000;
  for (let attempt = 1; attempt < HOST_LOGIN_MAX_FAILURES; attempt += 1) {
    const result = await noteHostLoginFailure(kv, "203.0.113.5", "CEDAR", now);
    assert.equal(result.locked, false);
    assert.equal(result.attemptsRemaining, HOST_LOGIN_MAX_FAILURES - attempt);
  }
  const locked = await noteHostLoginFailure(kv, "203.0.113.5", "CEDAR", now);
  assert.equal(locked.locked, true);
  assert.ok(locked.retryAfterSeconds > 0);

  assert.equal((await hostLoginLock(kv, "203.0.113.5", "CEDAR", now + 60_000)).locked, true);
  // A different house code from the same address is unaffected.
  assert.equal((await hostLoginLock(kv, "203.0.113.5", "HARBOR", now)).locked, false);
  // The lock expires with the window.
  assert.equal((await hostLoginLock(kv, "203.0.113.5", "CEDAR", now + 16 * 60_000)).locked, false);

  await clearHostLoginFailures(kv, "203.0.113.5", "CEDAR");
  assert.equal((await hostLoginLock(kv, "203.0.113.5", "CEDAR", now)).locked, false);
});

test("the host guide is trimmed, de-duplicated, and drops empty sections", () => {
  const answers = normalizeHostGuide([
    { topic: "  Wifi  ", keywords: [" Wifi ", "wifi", "password"], reply: "  CedarGuest  " },
    { topic: "Empty", keywords: [], reply: "not reachable" },
    { topic: "No reply", keywords: ["quiet"], reply: "   " },
    { topic: "Parking", keywords: ["park", "  "], reply: "Driveway, two cars." },
  ]);
  assert.equal(answers.length, 2);
  assert.deepEqual(answers[0], {
    topic: "Wifi",
    keywords: ["wifi", "password"],
    reply: "CedarGuest",
  });
  assert.equal(answers[1].topic, "Parking");
  assert.throws(() => normalizeHostGuide("nope"), /list of answers/);
  assert.throws(() => normalizeHostGuide(new Array(101).fill({ keywords: ["x"], reply: "y" })), /100 answers/);
});

test("the overview fills the week, counts statuses, and reports a median reply", () => {
  const now = new Date("2026-11-05T12:00:00Z");
  const overview = buildHostOverview({
    range: "stay",
    property: { id: "CEDAR", name: "Cedar House", hostName: "Dana" },
    stats: { inbound: 14, answered: 12, routed: 2 },
    latencies: [4000, 8000, 6000],
    daily: [{ day: "2026-11-05", inbound: 14 }],
    recent: [
      { text: "Can we check in early?", resolution: "escalated", at: "2026-11-05T11:48:00Z" },
      { text: "Wifi password?", resolution: "keyword", at: "2026-11-05T11:15:00Z" },
      { text: "Is the pool heated?", resolution: "unrouted", at: "2026-11-05T10:00:00Z" },
    ],
    questions: [{ text: "Wifi password?", resolution: "keyword", intentKey: "wifi", at: "2026-11-05T11:15:00Z" }],
    coverage: [
      { intentKey: "wifi", total: 4, answered: 4, routed: 0 },
      { intentKey: "early_checkin", total: 2, answered: 0, routed: 2 },
    ],
    answers: [{ topic: "Wifi", keywords: ["wifi"], reply: "CedarGuest" }],
  }, now);

  assert.equal(overview.range, "stay");
  assert.equal(overview.daily.length, 7);
  assert.equal(overview.daily[6].day, "2026-11-05");
  assert.equal(overview.daily[6].inbound, 14);
  assert.equal(overview.stats.medianReplySeconds, 6);
  assert.equal(overview.stats.answeredPct, 86);
  assert.equal(overview.stats.sectionsUsed, 1);
  assert.equal(overview.recent[0].status, "routed");
  assert.equal(overview.recent[1].status, "answered");
  assert.equal(overview.recent[2].status, "other");
  assert.equal(overview.questions[0].label, "Wi-Fi");
  assert.equal(overview.guide.sections[0].topic, "Wifi");
  assert.match(overview.recent[0].ago, /12m ago/);
});

test("the sample host dashboard is deterministic, labelled, and complete", () => {
  const now = new Date("2026-11-05T12:00:00Z");
  const first = sampleHostOverview("stay", now);
  const second = sampleHostOverview("stay", now);
  assert.deepEqual(first, second);
  assert.equal(first.sample, true);
  assert.equal(first.property.name, "Cedar House");
  assert.equal(first.stats.answered, 96);
  assert.equal(first.stats.medianReplySeconds, 6);
  assert.equal(first.daily.length, 7);
  assert.equal(first.guide.sections.length, 4);
  assert.equal(first.recent.length, 5);
  assert.equal(first.coverage.length, 5);
  const today = sampleHostOverview("today", now);
  assert.equal(today.range, "today");
  assert.equal(today.stats.answered, 12);
  assert.equal(today.stats.routed, 2);
});

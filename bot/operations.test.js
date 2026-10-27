import test from "node:test";
import assert from "node:assert/strict";
import { handledWithoutHuman, sampleAnalytics } from "./analytics.js";
import { buildDayParts, sampleOperations } from "./operations.js";

// Fixed clock so the derived figures are deterministic in every timezone.
const NOW = new Date(Date.UTC(2026, 9, 26, 12, 0, 0));

// The contract the panel depends on: the demo payload must carry exactly what
// the live SQL and the live health check return, or a tile renders "—" / blank
// and nobody notices until a prospect is watching.
const LIVE_METRIC_FIELDS = [
  "guestMessages24h",
  "resolvedGuestMessages24h",
  "openEscalations",
  "escalations24h",
  "failedHostNotifications24h",
  "rateLimitedMessages24h",
  "failedAI24h",
  "aiInteractions24h",
  "aiAnswers24h",
  "avgAILatencyMs24h",
  "avgHostResponseMinutes30d",
  "measuredAt",
];

const LIVE_HEALTH_FIELDS = [
  "database",
  "propertyStore",
  "twilioConfigured",
  "aiConfigured",
  "signatureValidationEnabled",
  "missingHostPhone",
  "missingTextNumber",
];

test("demo metrics expose exactly the fields the live query returns", () => {
  const { metrics } = sampleOperations(NOW);
  assert.deepEqual(Object.keys(metrics).sort(), [...LIVE_METRIC_FIELDS].sort());
});

test("demo health exposes exactly the fields the live health check returns", () => {
  const { health } = sampleOperations(NOW);
  assert.deepEqual(Object.keys(health).sort(), [...LIVE_HEALTH_FIELDS].sort());
});

test("demo health reports every check as healthy", () => {
  const { health } = sampleOperations(NOW);
  assert.equal(health.database, "ok");
  assert.equal(health.propertyStore, "ok");
  assert.equal(health.twilioConfigured, true);
  assert.equal(health.aiConfigured, true);
  assert.equal(health.signatureValidationEnabled, true);
  assert.equal(health.missingHostPhone, 0);
  assert.equal(health.missingTextNumber, 0);
});

test("is flagged as sample data so the panel can label it", () => {
  assert.equal(sampleOperations(NOW).sample, true);
});

test("agrees with the Analytics tab about today's guest volume", () => {
  const operations = sampleOperations(NOW);
  const analytics = sampleAnalytics(NOW);
  assert.equal(operations.metrics.guestMessages24h, analytics.today.inbound);
});

test("reports an automated-resolution share matching the analytics donut", () => {
  const { metrics } = sampleOperations(NOW);
  const withoutHuman = handledWithoutHuman(sampleAnalytics(NOW).mix);
  const derived = (metrics.resolvedGuestMessages24h / metrics.guestMessages24h) * 100;
  // Rounding to whole messages is the only loss: with N messages, the derived
  // rate can be off by at most one message's worth.
  assert.ok(
    Math.abs(derived - withoutHuman) <= 100 / metrics.guestMessages24h,
    `derived ${derived}% vs donut ${withoutHuman}%`,
  );
  assert.ok(metrics.resolvedGuestMessages24h <= metrics.guestMessages24h);
});

test("never reports a null average, which the panel would render as a dash", () => {
  const { metrics } = sampleOperations(NOW);
  assert.equal(typeof metrics.avgAILatencyMs24h, "number");
  assert.equal(typeof metrics.avgHostResponseMinutes30d, "number");
  assert.ok(Number.isFinite(metrics.avgAILatencyMs24h));
  assert.ok(Number.isFinite(metrics.avgHostResponseMinutes30d));
});

test("keeps every count a non-negative whole number", () => {
  const { metrics } = sampleOperations(NOW);
  // The two averages are ROUND(AVG(...), 1) in SQL, so they are decimal by
  // design; everything else is a row count.
  const averages = new Set(["measuredAt", "avgAILatencyMs24h", "avgHostResponseMinutes30d"]);
  for (const field of LIVE_METRIC_FIELDS) {
    if (averages.has(field)) continue;
    const value = metrics[field];
    assert.equal(Number.isInteger(value), true, `${field} should be a whole number`);
    assert.ok(value >= 0, `${field} should not be negative`);
  }
  assert.ok(metrics.escalations24h <= metrics.guestMessages24h);
  assert.ok(metrics.aiAnswers24h <= metrics.aiInteractions24h);
});

test("the demo open queue adds up and names real sample properties", () => {
  const { awaiting } = sampleOperations(NOW);
  const analytics = sampleAnalytics(NOW);
  assert.equal(typeof awaiting.open, "number");
  assert.equal(
    awaiting.byProperty.reduce((sum, row) => sum + row.open, 0),
    awaiting.open,
    "the per-property counts must add up to the headline",
  );
  const names = analytics.properties.map((property) => property.name);
  for (const row of awaiting.byProperty) {
    assert.ok(names.includes(row.name), row.name + " is not one of the sample properties");
    assert.equal(Number.isInteger(row.oldestMinutes), true, "age should be whole minutes");
  }
  assert.equal(awaiting.over4h <= awaiting.over1h, true, "four hours is a subset of one hour");
  assert.equal(awaiting.over1h <= awaiting.open, true);
  assert.equal(awaiting.oldestMinutes, Math.max(...awaiting.byProperty.map((row) => row.oldestMinutes)));
});

test("is deterministic, so reloading the demo never moves the numbers", () => {
  assert.deepEqual(sampleOperations(NOW), sampleOperations(NOW));
});

test("stamps the same way the live query does", () => {
  const { metrics } = sampleOperations(NOW);
  assert.match(metrics.measuredAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.equal(metrics.measuredAt, "2026-10-26 12:00:00");
});

test("splits the last 24 hours into the four stretches of the host's day", () => {
  const { dayParts, metrics } = sampleOperations(NOW);
  assert.deepEqual(dayParts.map((part) => part.key), ["overnight", "morning", "afternoon", "evening"]);
  assert.deepEqual(dayParts.map((part) => part.hours), ["12–6am", "6am–12pm", "12–6pm", "6pm–12am"]);
  // The panel shows the parts next to the guest-message tile, so they have to
  // be the same messages, split across the clock.
  assert.equal(dayParts.reduce((sum, part) => sum + part.inbound, 0), metrics.guestMessages24h);
  const shares = dayParts.reduce((sum, part) => sum + part.share, 0);
  assert.ok(Math.abs(shares - 100) <= 0.5, `shares should cover the day, got ${shares}%`);
});

test("reads the hourly buckets in the host's timezone, not UTC", () => {
  // 13:00 UTC is 9am in Davenport, so that hour is a morning message. Grouping
  // by the raw UTC hour would have filed it under the afternoon.
  const rows = [{ hour: "2026-10-26T13", inbound: 4 }];
  const now = new Date(Date.UTC(2026, 9, 26, 16, 0, 0));
  assert.equal(buildDayParts(rows, now).find((part) => part.key === "morning").inbound, 4);
  assert.equal(buildDayParts(rows, now).find((part) => part.key === "afternoon").inbound, 0);
});

test("fills quiet stretches with real zeros", () => {
  // A stretch with no rows must render as an empty bar, not as a missing card.
  const parts = buildDayParts([], NOW);
  assert.deepEqual(parts.map((part) => part.inbound), [0, 0, 0, 0]);
  assert.deepEqual(parts.map((part) => part.share), [0, 0, 0, 0]);
});

test("ignores buckets older than the 24-hour window", () => {
  const rows = [
    { hour: "2026-10-26T11", inbound: 5 },
    { hour: "2026-10-01T09", inbound: 99 },
  ];
  assert.equal(buildDayParts(rows, NOW).reduce((sum, part) => sum + part.inbound, 0), 5);
});

test("the demo day looks like a host's day: quiet overnight, busy after lunch", () => {
  const byKey = new Map(sampleOperations(NOW).dayParts.map((part) => [part.key, part.inbound]));
  assert.equal(byKey.get("overnight"), 0, "no sample guest texts arrive at 2am");
  assert.ok(byKey.get("afternoon") > byKey.get("morning"), "the afternoon should be the busiest stretch");
  assert.ok(byKey.get("morning") > byKey.get("evening"));
});

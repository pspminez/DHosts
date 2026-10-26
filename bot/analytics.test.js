import test from "node:test";
import assert from "node:assert/strict";
import {
  ANALYTICS_WINDOW_DAYS,
  WEEKLY_BUCKETS,
  bucketResolution,
  buildAnalytics,
  buildDailySeries,
  buildMix,
  buildPropertyShares,
  buildWeekly,
  handledWithoutHuman,
  percentDelta,
  sampleAnalytics,
} from "./analytics.js";

// Fixed clock so day maths is deterministic in every timezone.
const NOW = new Date(Date.UTC(2026, 9, 26, 12, 0, 0));

test("groups every resolution value into the four dashboard buckets", () => {
  assert.equal(bucketResolution("keyword"), "fromAnswers");
  assert.equal(bucketResolution("kb"), "fromAnswers");
  assert.equal(bucketResolution("ai"), "byAi");
  assert.equal(bucketResolution("escalated"), "escalated");
  assert.equal(bucketResolution("emergency"), "escalated");
  assert.equal(bucketResolution("unrouted"), "other");
  assert.equal(bucketResolution("blocked"), "other");
  assert.equal(bucketResolution(null), "other");
  assert.equal(bucketResolution("KEYWORD"), "fromAnswers", "case is ignored");
});

test("builds a resolution mix with percentages that add up", () => {
  const mix = buildMix([
    { resolution: "keyword", n: 178 },
    { resolution: "kb", n: 68 },
    { resolution: "ai", n: 109 },
    { resolution: "escalated", n: 33 },
    { resolution: "emergency", n: 5 },
    { resolution: "unrouted", n: 9 },
  ]);
  const byKey = Object.fromEntries(mix.map((entry) => [entry.key, entry]));
  assert.equal(byKey.fromAnswers.n, 246);
  assert.equal(byKey.byAi.n, 109);
  assert.equal(byKey.escalated.n, 38);
  assert.equal(byKey.other.n, 9);
  assert.equal(byKey.fromAnswers.pct, 61.2);
  assert.equal(byKey.byAi.pct, 27.1);
  const total = mix.reduce((sum, entry) => sum + entry.pct, 0);
  assert.ok(Math.abs(total - 100) < 0.5, `percentages sum to about 100, got ${total}`);
});

test("an empty mix reports no percentage instead of dividing by zero", () => {
  const mix = buildMix([]);
  assert.equal(mix.every((entry) => entry.n === 0 && entry.pct === 0), true);
  assert.equal(handledWithoutHuman(mix), null);
});

test("reports the share of guest messages handled without a human", () => {
  assert.equal(
    handledWithoutHuman(buildMix([
      { resolution: "keyword", n: 246 },
      { resolution: "ai", n: 109 },
      { resolution: "escalated", n: 38 },
      { resolution: "unrouted", n: 9 },
    ])),
    88.3,
  );
});

test("fills quiet days so the chart has no gaps", () => {
  const series = buildDailySeries(
    [{ day: "2026-10-25", inbound: 3, outbound: 2 }, { day: "2026-09-27", inbound: 5, outbound: 5 }],
    ANALYTICS_WINDOW_DAYS,
    NOW,
  );
  assert.equal(series.length, ANALYTICS_WINDOW_DAYS);
  assert.equal(series[series.length - 1].day, "2026-10-26", "ends today");
  assert.equal(series[0].day, "2026-09-27", "starts 29 days back");
  assert.deepEqual(series[0], { day: "2026-09-27", inbound: 5, outbound: 5, escalated: 0 });
  assert.deepEqual(series[series.length - 2], { day: "2026-10-25", inbound: 3, outbound: 2, escalated: 0 });
  assert.deepEqual(series[1], { day: "2026-09-28", inbound: 0, outbound: 0, escalated: 0 }, "quiet day is zero-filled");
});

test("carries the daily escalation count for its trend line", () => {
  const series = buildDailySeries([{ day: "2026-10-24", inbound: 6, outbound: 6, escalated: 2 }], 7, NOW);
  const day = series.find((point) => point.day === "2026-10-24");
  assert.equal(day.inbound, 6);
  assert.equal(day.escalated, 2);
  assert.equal(series[0].escalated, 0);
});

test("ignores rows outside the requested window", () => {
  const series = buildDailySeries([{ day: "2026-01-01", inbound: 99, outbound: 99 }], 7, NOW);
  assert.equal(series.length, 7);
  assert.equal(series.reduce((sum, day) => sum + day.inbound, 0), 0);
});

test("buckets the last eight weeks oldest first", () => {
  const daily = buildDailySeries([], WEEKLY_BUCKETS * 7, NOW).map((day, index) => ({
    ...day,
    inbound: index + 1,
    outbound: 0,
  }));
  const weekly = buildWeekly(daily, WEEKLY_BUCKETS);
  assert.equal(weekly.length, WEEKLY_BUCKETS);
  assert.deepEqual(weekly.map((bucket) => bucket.label), ["W1", "W2", "W3", "W4", "W5", "W6", "W7", "W8"]);
  assert.equal(weekly[0].inbound, 1 + 2 + 3 + 4 + 5 + 6 + 7, "first week is the oldest seven days");
  assert.equal(
    weekly[WEEKLY_BUCKETS - 1].inbound,
    50 + 51 + 52 + 53 + 54 + 55 + 56,
    "last week is the newest seven days",
  );
});

test("reports no delta when there is no previous period to compare against", () => {
  assert.equal(percentDelta(5, 0), null, "first traffic has no baseline");
  assert.equal(percentDelta(0, 0), 0, "no traffic either side is not a change");
  assert.equal(percentDelta(15, 10), 50);
  assert.equal(percentDelta(10, 15), -33.3);
});

test("computes each property's share of guest messages", () => {
  const shares = buildPropertyShares([
    { id: "a", name: "Villa A", inbound: 39 },
    { id: "b", name: "Villa B", inbound: 168 },
    { id: "c", name: "", inbound: 121 },
  ]);
  assert.deepEqual(shares.map((share) => share.inbound), [168, 121, 39], "largest first");
  assert.equal(shares[0].pct, 51);
  assert.equal(shares[2].pct, 12);
  assert.equal(shares[1].name, "c", "falls back to the id when a property has no name");
});

test("compares the last 30 days against the 30 before it", () => {
  // 60 days: the older 30 average 1/day, the newer 30 average 2/day.
  const rows = [];
  for (let offset = 59; offset >= 0; offset -= 1) {
    const day = new Date(NOW.getTime() - offset * 86400000).toISOString().slice(0, 10);
    rows.push({ day, inbound: offset >= 30 ? 1 : 2, outbound: offset >= 30 ? 1 : 2 });
  }
  const snapshot = buildAnalytics(
    {
      daily: rows,
      resolutions: [{ resolution: "ai", n: 10 }],
      properties: [{ id: "a", name: "Villa A", inbound: 10 }],
      recent: [],
      commonRequests: [{ intentKey: "wifi", total: 4 }],
    },
    NOW,
  );

  assert.equal(snapshot.sample, false);
  assert.equal(snapshot.windowDays, 30);
  assert.equal(snapshot.daily.length, 30, "only the recent window is charted");
  assert.equal(snapshot.totals.inbound, 60);
  assert.equal(snapshot.deltas.inbound, 100, "doubling is +100%");
  assert.equal(snapshot.today.inbound, 2);
  assert.equal(snapshot.yesterday.inbound, 2);
  assert.equal(snapshot.totals.answeredWithoutHuman, 100);
  assert.deepEqual(snapshot.commonRequests, [{ intentKey: "wifi", total: 4 }]);
});

test("the demo dataset is labelled, complete, and deterministic", () => {
  const first = sampleAnalytics(NOW);
  const second = sampleAnalytics(NOW);

  assert.equal(first.sample, true, "the UI relies on this to show the demo banner");
  assert.deepEqual(first, second, "same clock produces the same demo, so a demo never flickers");
  assert.equal(first.daily.length, 30);
  assert.equal(first.weekly.length, 8);
  assert.deepEqual(first.mix.map((entry) => entry.key), ["fromAnswers", "byAi", "escalated", "other"]);
  assert.ok(first.totals.inbound > 0);
  assert.ok(first.totals.answeredWithoutHuman > 80);
  assert.equal(first.properties.length, 4);
  assert.ok(first.recent.length > 0);
  assert.ok(
    first.recent.every((event) => event.property.startsWith("Sample")),
    "demo rows must be obviously sample data",
  );
});

// These came out of looking at a rendered screenshot: the weekly bars were eight
// identical columns and the replies line sat exactly on top of the inbound line,
// so the demo looked like a broken chart rather than a plausible week.
test("the demo weekly bars differ enough to read as a real trend", () => {
  const { weekly } = sampleAnalytics(NOW);
  const values = weekly.map((bucket) => bucket.inbound);
  const min = Math.min(...values);
  const max = Math.max(...values);
  assert.ok(max - min >= max * 0.15, `weeks span ${min}..${max} — too flat to chart`);
  assert.ok(new Set(values).size >= 6, "nearly every week should differ");
});

test("the demo reply line sits visibly below the inbound line", () => {
  const { daily, totals } = sampleAnalytics(NOW);
  const gap = totals.inbound - totals.outbound;
  assert.ok(gap > 0, "replies cannot be drawn on top of inbound");
  assert.ok(gap < totals.inbound, "replies still have to exist");
  for (const day of daily) {
    assert.ok(day.outbound <= day.inbound, "a day cannot reply to more than it received");
  }
});

test("the demo headline figures agree with the series drawn under them", () => {
  const snapshot = sampleAnalytics(NOW);
  const last = snapshot.daily[snapshot.daily.length - 1];
  const prior = snapshot.daily[snapshot.daily.length - 2];
  assert.equal(snapshot.today.inbound, last.inbound);
  assert.equal(snapshot.today.outbound, last.outbound);
  assert.equal(snapshot.yesterday.inbound, prior.inbound);

  const current = snapshot.daily.reduce((sum, day) => sum + day.inbound, 0);
  assert.equal(snapshot.totals.inbound, current, "the 30-day hero must match its own chart");

  // A demo that shows a delta has to have a previous period behind it.
  const sharesInbound = snapshot.deltas.inbound === null || Number.isFinite(snapshot.deltas.inbound);
  assert.ok(sharesInbound, "delta must be a number, never NaN");
  assert.notEqual(snapshot.deltas.inbound, 0, "the demo should show movement, not a flat line");
});

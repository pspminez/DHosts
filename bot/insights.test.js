import test from "node:test";
import assert from "node:assert/strict";
import { sampleAnalytics } from "./analytics.js";
import { buildInsights, sampleInsights, themeLabel } from "./insights.js";

const NOW = new Date(Date.UTC(2026, 9, 26, 12, 0, 0));

const INPUT = {
  current: [
    { intentKey: "wifi", total: 40, escalated: 2, unresolved: 1 },
    { intentKey: "trash", total: 10, escalated: 8, unresolved: 0 },
    { intentKey: "pool_heat", total: 5, escalated: 4, unresolved: 1 },
    { intentKey: "unknown_key", total: 5, escalated: 0, unresolved: 0 },
  ],
  previous: [
    { intentKey: "wifi", total: 32 },
    { intentKey: "trash", total: 10 },
  ],
  properties: [
    { name: "Sunset Villa", total: 40, unresolved: 6 },
    { name: "Harbor House", total: 20, unresolved: 0 },
  ],
};

test("gives intent keys a human name and never shows raw snake_case", () => {
  assert.equal(themeLabel("wifi"), "Wi-Fi");
  assert.equal(themeLabel("pool_heat"), "Pool heater");
  assert.equal(themeLabel("WIFI"), "Wi-Fi", "case is ignored");
  assert.equal(themeLabel("pool_heat "), "Pool heater", "stray whitespace is ignored");
  assert.equal(themeLabel("some_new_thing"), "Some New Thing", "unknown keys are prettified");
  assert.equal(themeLabel(null), "Unclassified");
  assert.equal(themeLabel(""), "Unclassified");
});

test("ranks themes by volume and keeps shares adding up", () => {
  const { themes, totals } = buildInsights(INPUT, NOW);
  assert.deepEqual(themes.map((theme) => theme.key), ["wifi", "trash", "pool_heat", "unknown_key"]);
  assert.equal(themes[0].total, 40);
  const shareSum = themes.reduce((sum, theme) => sum + theme.share, 0);
  assert.ok(Math.abs(shareSum - 100) < 0.1, "shares should total about 100%, got " + shareSum);
  assert.equal(totals.messages, 60);
  assert.equal(totals.themes, 4);
});

test("ranks what needs a human by frequency, not by volume", () => {
  const { unanswered } = buildInsights(INPUT, NOW);
  // trash escalates 8 of 10 but wifi, with four times the volume, only needs
  // help three times — the small broken theme is the one worth fixing.
  assert.deepEqual(unanswered.map((row) => row.key), ["trash", "pool_heat", "wifi"]);
  assert.equal(unanswered[0].needsHuman, 8);
  assert.equal(unanswered[0].shareOfTheme, 80);
  assert.ok(
    unanswered.every((row) => row.needsHuman > 0),
    "themes that always got answered are not listed",
  );
});

test("computes needs-human totals from escalated plus unrouted", () => {
  const { totals } = buildInsights(INPUT, NOW);
  assert.equal(totals.needsHuman, 2 + 1 + 8 + 4 + 1);
  assert.equal(totals.needsHumanShare, 26.7);
});

test("reports a delta only where a previous period exists", () => {
  const { themes } = buildInsights(INPUT, NOW);
  const byKey = Object.fromEntries(themes.map((theme) => [theme.key, theme]));
  assert.equal(byKey.wifi.deltaPct, 25, "(40 - 32) / 32");
  assert.equal(byKey.trash.deltaPct, 0, "unchanged is a real zero");
  assert.equal(byKey.pool_heat.deltaPct, null, "no previous period means no arrow");
  assert.equal(byKey.unknown_key.deltaPct, null);
});

test("shares per property and keeps zero-activity properties honest", () => {
  const { properties } = buildInsights(
    {
      current: [],
      previous: [],
      properties: [
        { name: "Busy", total: 30, unresolved: 3 },
        { name: "Quiet", total: 0, unresolved: 0 },
      ],
    },
    NOW,
  );
  assert.equal(properties[0].name, "Busy");
  assert.equal(properties[0].share, 100);
  assert.equal(properties[0].needsHumanShare, 10);
  assert.equal(properties[1].share, 0);
  assert.equal(properties[1].needsHumanShare, 0, "never divide by zero");
});

test("handles a period with no traffic without inventing numbers", () => {
  const empty = buildInsights({ current: [], previous: [], properties: [] }, NOW);
  assert.equal(empty.totals.messages, 0);
  assert.equal(empty.totals.needsHumanShare, null, "the panel shows a dash, not 0%");
  assert.deepEqual(empty.themes, []);
  assert.deepEqual(empty.unanswered, []);
});

test("the demo insights are labelled, deterministic, and add up", () => {
  const first = sampleInsights(NOW);
  const second = sampleInsights(NOW);
  assert.equal(first.sample, true);
  assert.deepEqual(first, second, "reloading must not move the numbers");
  assert.ok(first.themes.length >= 5);
  assert.ok(first.unanswered.length > 0);
  assert.ok(first.properties.length === 4);
  assert.ok(first.totals.needsHumanShare > 0 && first.totals.needsHumanShare < 100);
  assert.ok(
    first.properties.every((property) => property.name.startsWith("Sample")),
    "demo rows must be obviously sample data",
  );
});

test("the demo agrees with the Analytics tab about the same questions", () => {
  const insights = sampleInsights(NOW);
  const analytics = sampleAnalytics(NOW);
  const requests = new Map(analytics.commonRequests.map((row) => [row.intentKey, row.total]));
  for (const theme of insights.themes) {
    assert.equal(
      theme.total,
      requests.get(theme.key),
      theme.key + " must show the same count on both tabs",
    );
    assert.notEqual(theme.label, theme.key, "demo themes are labelled, not raw keys");
  }
});

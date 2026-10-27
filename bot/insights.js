// bot/insights.js
//
// Turns raw intent counts into the guest-question insights view.
//
// Pure: rows in, panel-ready numbers out. worker.ts runs the SQL and hands the
// results here, so the percentage maths and the demo dataset can be tested
// without a database.
//
// Two rules, both from the pilot plan:
//   * Counts only. No guest names, phone numbers or message text ever enter this
//     module, so nothing here can leak into a shared screen.
//   * A theme with no previous period reports a null delta, never 0% — the panel
//     shows no arrow rather than inventing a comparison.

import { buildDailySeries, buildWeekly, percentDelta, sampleAnalytics, themeLabel } from "./analytics.js";

// Shared with the analytics payload; kept as a re-export so callers of this
// module do not have to know where the map lives.
export { themeLabel };

export const INSIGHTS_WINDOW_DAYS = 30;

const round1 = (value) => Math.round(value * 10) / 10;

/**
 * input:
 *   current     [{ intentKey, total, escalated, unresolved }] — last 30 days
 *   previous    [{ intentKey, total }]                        — the 30 days before
 *   properties  [{ name, total, unresolved }]                 — last 30 days, live only
 *   daily       [{ day, inbound }]                            — last 60 days, for the chart
 *
 * A message "needs a human" when it escalated or never got routed to an answer.
 */
export function buildInsights(input, now = new Date()) {
  const current = (input && input.current) || [];
  const previous = (input && input.previous) || [];
  const propertyRows = (input && input.properties) || [];

  const priorByKey = new Map();
  for (const row of previous) {
    const key = String((row && row.intentKey) || "unknown");
    priorByKey.set(key, (priorByKey.get(key) || 0) + Number((row && row.total) || 0));
  }

  const totalMessages = current.reduce((sum, row) => sum + Number((row && row.total) || 0), 0);

  const themes = current
    .map((row) => {
      const key = String((row && row.intentKey) || "unknown");
      const total = Number((row && row.total) || 0);
      const escalated = Number((row && row.escalated) || 0);
      const unresolved = Number((row && row.unresolved) || 0);
      return {
        key,
        label: themeLabel(key),
        total,
        share: totalMessages ? round1((total / totalMessages) * 100) : 0,
        escalated,
        unresolved,
        needsHuman: escalated + unresolved,
        deltaPct: priorByKey.has(key) ? percentDelta(total, priorByKey.get(key)) : null,
      };
    })
    .sort((a, b) => b.total - a.total);

  const needsHuman = themes.reduce((sum, theme) => sum + theme.needsHuman, 0);

  // Ranked by how often the answers run out, not by volume: a small theme that
  // always escalates is the one worth fixing.
  const unanswered = themes
    .filter((theme) => theme.needsHuman > 0)
    .map((theme) => ({
      key: theme.key,
      label: theme.label,
      total: theme.total,
      needsHuman: theme.needsHuman,
      escalated: theme.escalated,
      unresolved: theme.unresolved,
      shareOfTheme: theme.total ? round1((theme.needsHuman / theme.total) * 100) : 0,
    }))
    .sort((a, b) => b.needsHuman - a.needsHuman || b.shareOfTheme - a.shareOfTheme);

  // The tab draws the same style of chart as Analytics: a filled area series of
  // daily questions plus weekly buckets, so the payload carries both.
  const dailySeries = buildDailySeries((input && input.daily) || [], INSIGHTS_WINDOW_DAYS, now);

  const propertyTotals = propertyRows.reduce((sum, row) => sum + Number((row && row.total) || 0), 0);
  const properties = propertyRows
    .map((row) => {
      const total = Number((row && row.total) || 0);
      const unresolved = Number((row && row.unresolved) || 0);
      return {
        name: (row && row.name) || "Unnamed property",
        total,
        needsHuman: unresolved,
        share: propertyTotals ? round1((total / propertyTotals) * 100) : 0,
        needsHumanShare: total ? round1((unresolved / total) * 100) : 0,
      };
    })
    .sort((a, b) => b.total - a.total);

  return {
    sample: false,
    windowDays: INSIGHTS_WINDOW_DAYS,
    generatedAt: now.toISOString(),
    totals: {
      messages: totalMessages,
      themes: themes.length,
      needsHuman,
      needsHumanShare: totalMessages ? round1((needsHuman / totalMessages) * 100) : null,
    },
    themes,
    unanswered,
    properties,
    daily: dailySeries,
    // Four weeks rather than eight: the window is 30 days, so eight buckets
    // would render four permanently empty bars at the left of the chart.
    weekly: buildWeekly(dailySeries, 4),
  };
}

// ---------------------------------------------------------------------------
// Demo dataset
// ---------------------------------------------------------------------------
// Volume matches sampleAnalytics()'s most-common-requests figures and its
// per-property shares, so the Analytics tab and this one tell the same story.
const SAMPLE_THEMES = [
  { intentKey: "wifi", total: 96, escalated: 8, unresolved: 2, prior: 88 },
  { intentKey: "checkout", total: 71, escalated: 3, unresolved: 1, prior: 74 },
  { intentKey: "gate", total: 64, escalated: 5, unresolved: 0, prior: 51 },
  { intentKey: "trash", total: 38, escalated: 12, unresolved: 1, prior: 30 },
  { intentKey: "pool_heat", total: 27, escalated: 9, unresolved: 0, prior: 31 },
  { intentKey: "parking", total: 19, escalated: 2, unresolved: 0, prior: 21 },
];

const SAMPLE_PROPERTIES = [
  { name: "Sample Villa A", total: 168, unresolved: 24 },
  { name: "Sample Villa B", total: 121, unresolved: 15 },
  { name: "Sample Villa C", total: 74, unresolved: 9 },
  { name: "Sample Villa D", total: 39, unresolved: 4 },
];

export function sampleInsights(now = new Date()) {
  const current = SAMPLE_THEMES.map((theme) => ({
    intentKey: theme.intentKey,
    total: theme.total,
    escalated: theme.escalated,
    unresolved: theme.unresolved,
  }));
  const previous = SAMPLE_THEMES.map((theme) => ({ intentKey: theme.intentKey, total: theme.prior }));
  // Same daily shape as the Analytics demo, so both tabs tell one story.
  const daily = sampleAnalytics(now).daily.map((day) => ({ day: day.day, inbound: day.inbound }));
  return {
    ...buildInsights({ current, previous, properties: SAMPLE_PROPERTIES, daily }, now),
    sample: true,
  };
}

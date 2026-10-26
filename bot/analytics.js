// bot/analytics.js
//
// Turns raw D1 rows into the shape the Analytics dashboard renders.
//
// Everything here is pure: rows in, chart-ready numbers out. worker.ts runs the
// SQL and hands the results to buildAnalytics(), so the percentage maths, the
// gap-filling of quiet days, and the demo dataset can be tested without a
// database.
//
// Two rules worth keeping:
//   * A period with no previous baseline reports a null delta, never 0% — the
//     panel shows "—" instead of inventing a comparison.
//   * Demo figures only ever come from sampleAnalytics(), are deterministic, and
//     are flagged `sample: true` so the UI can label them. They are never mixed
//     into real numbers.

export const ANALYTICS_WINDOW_DAYS = 30;
export const WEEKLY_BUCKETS = 8;
export const WEEK_DAYS = 7;

// `messages.resolution` carries more values than the dashboard shows; these sets
// decide which of the four dashboard buckets a row counts towards.
const FROM_ANSWERS = new Set(["keyword", "kb"]);
const BY_AI = new Set(["ai"]);
const ESCALATED = new Set(["escalated", "escalate", "emergency"]);

// Human names for the router's intent keys. Anything missing is prettified, so a
// new intent never reaches the screen as raw snake_case. Lives here rather than
// in insights.js because this module has no imports of its own, and the page
// needs the label baked into the payload: the browser cannot see server exports.
const THEME_LABELS = {
  wifi: "Wi-Fi",
  wifi_password: "Wi-Fi",
  checkout: "Checkout",
  checkin: "Check-in",
  check_in: "Check-in",
  early_checkin: "Early check-in",
  late_checkout: "Late checkout",
  gate: "Gate code",
  gate_code: "Gate code",
  door_code: "Door code",
  lock: "Door lock",
  lockout: "Locked out",
  trash: "Trash and bins",
  pool: "Pool",
  pool_heat: "Pool heater",
  parking: "Parking",
  pets: "Pets",
  rules: "House rules",
  ac: "Air conditioning",
  thermostat: "Thermostat",
  tv: "TV",
  internet: "Internet",
  noise: "Noise complaint",
  maintenance: "Maintenance",
  emergency: "Emergency",
  rate_limit: "Rate limited",
  unknown: "Unclassified",
};

export function themeLabel(intentKey) {
  const key = String(intentKey == null ? "" : intentKey).trim().toLowerCase();
  if (!key) return "Unclassified";
  if (THEME_LABELS[key]) return THEME_LABELS[key];
  return key
    .replace(/[_-]+/g, " ")
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

export const MIX_KEYS = ["fromAnswers", "byAi", "escalated", "other"];

export const MIX_LABELS = {
  fromAnswers: "From your answers",
  byAi: "Answered by AI",
  escalated: "Escalated to you",
  other: "Unrouted or blocked",
};

export function bucketResolution(resolution) {
  const key = String(resolution == null ? "" : resolution).trim().toLowerCase();
  if (FROM_ANSWERS.has(key)) return "fromAnswers";
  if (BY_AI.has(key)) return "byAi";
  if (ESCALATED.has(key)) return "escalated";
  return "other";
}

const round1 = (value) => Math.round(value * 10) / 10;

// rows: [{ resolution, n }]
export function buildMix(rows) {
  const counts = new Map(MIX_KEYS.map((key) => [key, 0]));
  for (const row of rows || []) {
    const key = bucketResolution(row && row.resolution);
    counts.set(key, (counts.get(key) || 0) + Number((row && row.n) || 0));
  }
  const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
  return MIX_KEYS.map((key) => {
    const n = counts.get(key) || 0;
    return { key, label: MIX_LABELS[key], n, pct: total ? round1((n / total) * 100) : 0 };
  });
}

// Share of guest messages that never needed a human.
export function handledWithoutHuman(mix) {
  const total = (mix || []).reduce((sum, entry) => sum + Number(entry.n || 0), 0);
  if (!total) return null;
  const handled = (mix || [])
    .filter((entry) => entry.key === "fromAnswers" || entry.key === "byAi")
    .reduce((sum, entry) => sum + Number(entry.n || 0), 0);
  return round1((handled / total) * 100);
}

function utcDayKey(date) {
  return date.toISOString().slice(0, 10);
}

// rows: [{ day: 'YYYY-MM-DD', inbound, outbound, escalated }] — only days with
// traffic. Returns a continuous series so the chart never skips quiet days.
export function buildDailySeries(rows, days = ANALYTICS_WINDOW_DAYS, now = new Date()) {
  const counts = new Map();
  for (const row of rows || []) {
    if (!row || !row.day) continue;
    counts.set(String(row.day), {
      inbound: Number(row.inbound || 0),
      outbound: Number(row.outbound || 0),
      escalated: Number(row.escalated || 0),
    });
  }
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const series = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = utcDayKey(new Date(end - offset * 86400000));
    const value = counts.get(day) || { inbound: 0, outbound: 0, escalated: 0 };
    series.push({
      day,
      inbound: value.inbound,
      outbound: value.outbound,
      escalated: value.escalated,
    });
  }
  return series;
}

// Groups the most recent `weeks * 7` days into weekly inbound totals, oldest first.
export function buildWeekly(daily, weeks = WEEKLY_BUCKETS) {
  const buckets = [];
  const series = daily || [];
  for (let index = weeks - 1; index >= 0; index -= 1) {
    const end = series.length - index * WEEK_DAYS;
    const slice = series.slice(Math.max(0, end - WEEK_DAYS), end);
    buckets.push({
      label: `W${weeks - index}`,
      inbound: slice.reduce((sum, day) => sum + Number(day.inbound || 0), 0),
    });
  }
  return buckets;
}

// Percentage change, or null when there is no previous period to compare with.
export function percentDelta(current, previous) {
  const now = Number(current || 0);
  const before = Number(previous || 0);
  if (!before) return now ? null : 0;
  return round1(((now - before) / before) * 100);
}

// rows: [{ id, name, inbound, aiAnswers, escalated, lastActivity }]
export function buildPropertyShares(rows) {
  const list = (rows || []).map((row) => ({
    id: row.id,
    name: row.name || row.id || "Unnamed property",
    inbound: Number((row && row.inbound) || 0),
    aiAnswers: Number((row && row.aiAnswers) || 0),
    escalated: Number((row && row.escalated) || 0),
    lastActivity: (row && row.lastActivity) || null,
  }));
  const total = list.reduce((sum, property) => sum + property.inbound, 0);
  return list
    .map((property) => ({
      ...property,
      pct: total ? Math.round((property.inbound / total) * 100) : 0,
    }))
    .sort((a, b) => b.inbound - a.inbound);
}

function totalsFrom(daily) {
  return (daily || []).reduce(
    (sum, day) => ({
      inbound: sum.inbound + Number(day.inbound || 0),
      outbound: sum.outbound + Number(day.outbound || 0),
    }),
    { inbound: 0, outbound: 0 },
  );
}

/**
 * input:
 *   daily        rows for the last 56 days (30 shown + 30 for the comparison)
 *   resolutions  rows for the last 30 days
 *   properties   per-property inbound rows for the last 30 days
 *   recent       mixed escalations/messages, newest first
 *   commonRequests  intent breakdown for the last 30 days
 */
export function buildAnalytics(input, now = new Date()) {
  const windowDays = ANALYTICS_WINDOW_DAYS;
  const totalDays = windowDays * 2;
  const series = buildDailySeries(input && input.daily, totalDays, now);

  const current = series.slice(-windowDays);
  const previous = series.slice(0, totalDays - windowDays);
  const currentTotals = totalsFrom(current);
  const previousTotals = totalsFrom(previous);
  const today = series[series.length - 1] || { inbound: 0, outbound: 0 };
  const yesterday = series[series.length - 2] || { inbound: 0, outbound: 0 };

  const mix = buildMix(input && input.resolutions);
  const mixTotal = mix.reduce((sum, entry) => sum + entry.n, 0);

  return {
    sample: false,
    windowDays,
    generatedAt: now.toISOString(),
    totals: {
      inbound: currentTotals.inbound,
      outbound: currentTotals.outbound,
      answeredWithoutHuman: handledWithoutHuman(mix),
      escalated: (mix.find((entry) => entry.key === "escalated") || {}).n || 0,
      mixTotal,
    },
    deltas: {
      inbound: percentDelta(currentTotals.inbound, previousTotals.inbound),
      outbound: percentDelta(currentTotals.outbound, previousTotals.outbound),
    },
    daily: current,
    weekly: buildWeekly(series, WEEKLY_BUCKETS),
    mix,
    properties: buildPropertyShares(input && input.properties),
    today: { inbound: Number(today.inbound || 0), outbound: Number(today.outbound || 0) },
    yesterday: { inbound: Number(yesterday.inbound || 0), outbound: Number(yesterday.outbound || 0) },
    recent: (input && input.recent) || [],
    // The label travels with the count so the page never has to know the map.
    commonRequests: ((input && input.commonRequests) || []).map((row) => ({
      intentKey: row.intentKey,
      label: themeLabel(row.intentKey),
      total: Number(row.total || 0),
    })),
  };
}

// ---------------------------------------------------------------------------
// Demo dataset
// ---------------------------------------------------------------------------
// Deterministic on purpose: reloading the dashboard shows the same picture, so
// a prospect demo never flickers between numbers. Every value is generated here
// — nothing is sampled from the database.

const SAMPLE_WEEK_PATTERN = [4, 7, 5, 9, 12, 10, 6];
const SAMPLE_PROPERTIES = ["Sample Villa A", "Sample Villa B", "Sample Villa C", "Sample Villa D"];
const SAMPLE_EVENTS = [
  { kind: "escalation", status: "open", text: "Guest locked out at the gate", minutesAgo: 12 },
  { kind: "message", text: "What time is checkout?", minutesAgo: 45 },
  { kind: "message", text: "How do I work the pool heater?", minutesAgo: 96 },
  { kind: "escalation", status: "answered", text: "Trash bins were not collected", minutesAgo: 240 },
  { kind: "message", text: "Is early check-in possible?", minutesAgo: 430 },
  { kind: "escalation", status: "open", text: "Wi-Fi keeps dropping", minutesAgo: 1400 },
];

export function sampleAnalytics(now = new Date()) {
  const totalDays = ANALYTICS_WINDOW_DAYS * 2;
  const empty = buildDailySeries([], totalDays, now);
  // A weekday rhythm plus a slow ramp, deliberately not a repeating 7-day loop:
  // eight identical weeks made the weekly bars look like a broken chart, and a
  // demo is the one place the shape has to look plausible at a glance.
  const daily = empty.map((day, index) => {
    const weekday = SAMPLE_WEEK_PATTERN[index % SAMPLE_WEEK_PATTERN.length];
    const inbound = weekday + Math.floor(index / 12) + (index % 9 === 4 ? 4 : 0);
    // Replies trail inbound: escalated and rate-limited messages never get an
    // automated answer, so the second line must not sit on top of the first.
    const outbound = Math.max(0, inbound - 1 - (index % 4));
    const escalated = index % 13 === 5 ? 3 : index % 5 === 2 ? 2 : index % 7 === 0 ? 1 : 0;
    return { day: day.day, inbound, outbound, escalated };
  });

  const window = daily.slice(-ANALYTICS_WINDOW_DAYS);
  const previous = daily.slice(0, totalDays - ANALYTICS_WINDOW_DAYS);
  const totals = totalsFrom(window);
  const priorTotals = totalsFrom(previous);
  const today = daily[daily.length - 1];
  const yesterday = daily[daily.length - 2];
  const mixTotal = 402;
  const mix = buildMix([
    { resolution: "keyword", n: 178 },
    { resolution: "kb", n: 68 },
    { resolution: "ai", n: 109 },
    { resolution: "escalated", n: 33 },
    { resolution: "emergency", n: 5 },
    { resolution: "unrouted", n: 9 },
  ]);

  return {
    sample: true,
    windowDays: ANALYTICS_WINDOW_DAYS,
    generatedAt: now.toISOString(),
    totals: {
      inbound: totals.inbound,
      outbound: totals.outbound,
      answeredWithoutHuman: handledWithoutHuman(mix),
      escalated: 38,
      mixTotal,
    },
    // Derived, not typed in: the headline delta has to agree with the series
    // drawn underneath it.
    deltas: {
      inbound: percentDelta(totals.inbound, priorTotals.inbound),
      outbound: percentDelta(totals.outbound, priorTotals.outbound),
    },
    daily: window,
    weekly: buildWeekly(daily, WEEKLY_BUCKETS),
    mix,
    properties: buildPropertyShares([
      { id: "sample-a", name: SAMPLE_PROPERTIES[0], inbound: 168, aiAnswers: 47, escalated: 14, lastActivity: new Date(now.getTime() - 45 * 60000).toISOString() },
      { id: "sample-b", name: SAMPLE_PROPERTIES[1], inbound: 121, aiAnswers: 33, escalated: 11, lastActivity: new Date(now.getTime() - 3 * 3600000).toISOString() },
      { id: "sample-c", name: SAMPLE_PROPERTIES[2], inbound: 74, aiAnswers: 20, escalated: 8, lastActivity: new Date(now.getTime() - 26 * 3600000).toISOString() },
      { id: "sample-d", name: SAMPLE_PROPERTIES[3], inbound: 39, aiAnswers: 9, escalated: 5, lastActivity: new Date(now.getTime() - 50 * 3600000).toISOString() },
    ]),
    today: { inbound: today.inbound, outbound: today.outbound },
    yesterday: { inbound: yesterday.inbound, outbound: yesterday.outbound },
    recent: SAMPLE_EVENTS.map((event) => ({
      kind: event.kind,
      status: event.status || null,
      property: SAMPLE_PROPERTIES[0],
      text: event.text,
      at: new Date(now.getTime() - event.minutesAgo * 60000).toISOString(),
    })),
    // Mapped through themeLabel so the demo payload has the same shape as the
    // live one — otherwise the demo is the only place a raw key shows up.
    commonRequests: [
      { intentKey: "wifi", total: 96 },
      { intentKey: "checkout", total: 71 },
      { intentKey: "gate", total: 64 },
      { intentKey: "trash", total: 38 },
      { intentKey: "pool_heat", total: 27 },
      { intentKey: "parking", total: 19 },
    ].map((row) => ({ intentKey: row.intentKey, label: themeLabel(row.intentKey), total: row.total })),
  };
}

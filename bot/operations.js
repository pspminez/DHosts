// bot/operations.js
//
// The Operations tab's demo dataset.
//
// The live figures are queried in worker.ts; this module only builds the
// deterministic "what an operating panel looks like" version that `?sample=1`
// serves, so the maths can be tested without a database.
//
// One rule worth keeping: the volume figures are derived from sampleAnalytics()
// rather than invented here. Analytics and Operations are two views of one
// system, and anyone with both tabs open should never see them disagree about
// how many guests texted today.

import { buildMix, sampleAnalytics, handledWithoutHuman } from "./analytics.js";

// Last-24-hours chart data. The panel draws the same chart family as the
// Analytics tab, so the payload carries a day-part summary and a resolution
// mix. Rules kept from the volume figures: derived from sampleAnalytics() where
// a relationship exists, deterministic, and never mixed with live numbers.

// Guests text on their own clock, but the hourly buckets come from strftime()
// over UTC timestamps. Grouping them by UTC hour would file a 9am message under
// "afternoon" for a Davenport host.
const HOST_TIME_ZONE = "America/New_York";

// Four six-hour stretches. Equal spans on purpose: a bucket that covered more of
// the clock would win by width alone.
const DAY_PARTS = [
  { key: "overnight", label: "Overnight", hours: "12–6am" },
  { key: "morning", label: "Morning", hours: "6am–12pm" },
  { key: "afternoon", label: "Afternoon", hours: "12–6pm" },
  { key: "evening", label: "Evening", hours: "6pm–12am" },
];

const HOUR_FORMATTERS = new Map();

function hostHour(date, timeZone) {
  try {
    let formatter = HOUR_FORMATTERS.get(timeZone);
    if (!formatter) {
      formatter = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" });
      HOUR_FORMATTERS.set(timeZone, formatter);
    }
    const hour = Number(formatter.format(date));
    return Number.isFinite(hour) ? hour % 24 : date.getUTCHours();
  } catch {
    // A V8 built without timezone data: fall back to UTC rather than throw.
    return date.getUTCHours();
  }
}

// rows: [{ hour: 'YYYY-MM-DDTHH', inbound }] — only hours with traffic.
// Returns the four stretches of the host's day over the last 24 hours, walking
// every hour in the window so a quiet stretch is a real zero rather than a
// missing bar. The window is exactly 24 hours, so each part covers six hours
// and the comparison between them is fair.
export function buildDayParts(rows, now = new Date(), timeZone = HOST_TIME_ZONE) {
  const counts = new Map();
  for (const row of rows || []) {
    if (!row || !row.hour) continue;
    counts.set(String(row.hour).slice(0, 13), Number(row.inbound || 0));
  }
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours());
  const parts = DAY_PARTS.map((part) => ({ ...part, inbound: 0 }));
  for (let offset = 23; offset >= 0; offset -= 1) {
    const stamp = new Date(end - offset * 3600000);
    const inbound = counts.get(stamp.toISOString().slice(0, 13)) || 0;
    parts[Math.floor(hostHour(stamp, timeZone) / 6)].inbound += inbound;
  }
  const total = parts.reduce((sum, part) => sum + part.inbound, 0);
  return parts.map((part) => ({ ...part, share: total ? Math.round((part.inbound / total) * 1000) / 10 : 0 }));
}

// A guest day by the host's local hour: quiet overnight, busy from late morning
// through the evening. Fixed so reloading the panel never moves a bar.
const LOCAL_HOUR_WEIGHTS = [0, 0, 0, 0, 0, 0, 1, 2, 4, 6, 7, 6, 5, 6, 7, 8, 7, 6, 5, 4, 3, 2, 2, 1];

// Whole messages per hour, handed out by largest remainder so the hours add up
// to exactly the 24-hour headline. Rounding each hour on its own showed 12
// messages on the chart next to a tile that said 13.
function distribute(weights, total) {
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  const exact = weights.map((weight) => (weight / weightTotal) * total);
  const counts = exact.map(Math.floor);
  const left = total - counts.reduce((sum, count) => sum + count, 0);
  exact
    .map((value, index) => ({ index, remainder: value - counts[index] }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index)
    .slice(0, Math.max(0, left))
    .forEach(({ index }) => {
      counts[index] += 1;
    });
  return counts;
}

// Same shape as the live SQL's `strftime('%Y-%m-%dT%H', created_at)` grouping.
function sampleHourlyRows(now, total, timeZone = HOST_TIME_ZONE) {
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours());
  const buckets = [];
  for (let offset = 23; offset >= 0; offset -= 1) {
    const stamp = new Date(end - offset * 3600000);
    buckets.push({ stamp, weight: LOCAL_HOUR_WEIGHTS[hostHour(stamp, timeZone)] });
  }
  const counts = distribute(buckets.map((bucket) => bucket.weight), total);
  return buckets.map((bucket, index) => ({
    hour: bucket.stamp.toISOString().slice(0, 13),
    inbound: counts[index],
  }));
}

// Fixed on purpose: reloading the panel must not make the numbers move.
const SAMPLE_AI_LATENCY_MS = 1180.5;
const SAMPLE_AI_CALLS_PER_GUEST_MESSAGE = 1.1;
const SAMPLE_AI_ANSWER_SHARE = 0.92;
const SAMPLE_AVG_HOST_RESPONSE_MINUTES = 8.4;
const SAMPLE_OPEN_ESCALATIONS = 3;

// Same shape as datetime('now') from the live query, so the stamp in the panel
// head doesn't suddenly switch format when demo mode is on.
// Demo property names come from the analytics sample so both tabs agree.
function propertyName(analytics, index) {
  const properties = (analytics && analytics.properties) || [];
  return (properties[index] && properties[index].name) || "Sample Villa " + (index + 1);
}

function measuredAtStamp(now) {
  return now.toISOString().slice(0, 19).replace("T", " ");
}

export function sampleOperations(now = new Date()) {
  const analytics = sampleAnalytics(now);
  const guestMessages24h = Number(analytics.today.inbound || 0);
  const withoutHuman = handledWithoutHuman(analytics.mix) || 0;
  const aiInteractions24h = Math.round(guestMessages24h * SAMPLE_AI_CALLS_PER_GUEST_MESSAGE);

  // Day parts always add up to the headline: they are the same messages, split
  // across the clock, never a second source of truth.
  const dayParts = buildDayParts(sampleHourlyRows(now, guestMessages24h), now);
  // 24h resolution mix in the Analytics donut's shape, so the two tabs use one
  // renderer and one legend.
  const mix = buildMix([
    { resolution: "keyword", n: Math.round(guestMessages24h * 0.44) },
    { resolution: "ai", n: Math.round(guestMessages24h * 0.27) },
    { resolution: "escalated", n: Math.round(guestMessages24h * 0.09) },
    { resolution: "emergency", n: Math.round(guestMessages24h * 0.01) },
    { resolution: "unrouted", n: Math.round(guestMessages24h * 0.05) },
  ]);

  return {
    sample: true,
    dayParts,
    mix,
    metrics: {
      guestMessages24h,
      // Kept consistent with the donut's "no human" share rather than plucked
      // from the air, so the two tabs tell the same story.
      resolvedGuestMessages24h: Math.round((guestMessages24h * withoutHuman) / 100),
      openEscalations: SAMPLE_OPEN_ESCALATIONS,
      escalations24h: Math.round(analytics.totals.escalated / analytics.windowDays),
      failedHostNotifications24h: 0,
      rateLimitedMessages24h: 0,
      failedAI24h: 0,
      aiInteractions24h,
      aiAnswers24h: Math.round(aiInteractions24h * SAMPLE_AI_ANSWER_SHARE),
      avgAILatencyMs24h: SAMPLE_AI_LATENCY_MS,
      avgHostResponseMinutes30d: SAMPLE_AVG_HOST_RESPONSE_MINUTES,
      measuredAt: measuredAtStamp(now),
    },
    // The open queue: a couple of young questions plus one that has been sitting
    // past the four-hour mark, so the demo exercises the stale styling rather
    // than only ever showing the calm state.
    awaiting: {
      open: 4,
      oldestMinutes: 291,
      over1h: 3,
      over4h: 1,
      byProperty: [
        { name: propertyName(analytics, 0), open: 2, oldestMinutes: 291 },
        { name: propertyName(analytics, 1), open: 1, oldestMinutes: 96 },
        { name: propertyName(analytics, 2), open: 1, oldestMinutes: 38 },
      ],
    },
    // A whole healthy panel. Showing live checks next to demo figures would
    // mix two different truths in one card, which is exactly what the banner
    // promises not to do.
    health: {
      database: "ok",
      propertyStore: "ok",
      twilioConfigured: true,
      aiConfigured: true,
      signatureValidationEnabled: true,
      missingHostPhone: 0,
      missingTextNumber: 0,
    },
  };
}

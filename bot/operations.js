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

import { sampleAnalytics, handledWithoutHuman } from "./analytics.js";

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

  return {
    sample: true,
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

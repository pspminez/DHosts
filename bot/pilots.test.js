import test from "node:test";
import assert from "node:assert/strict";
import {
  addOnCandidates,
  canLaunchPilot,
  knowledgeCount,
  measurePilot,
  normaliseKnowledge,
  pilotCode,
} from "./pilots.js";

const today = new Date().toISOString().slice(0, 10);
const checklist = Object.fromEntries(Array.from({ length: 7 }, (_, index) => [String(index), true]));
const knowledge = {
  answers: [{ topic: "Trash", keywords: ["bins"], reply: "Pickup is Tuesday." }],
  secrets: [],
};

function launch(overrides = {}) {
  return canLaunchPilot({
    checklist,
    startedAt: today,
    endsAt: today,
    knowledge,
    approvedKnowledge: knowledge,
    hasTextLine: true,
    hasHostContact: true,
    now: Date.parse(today + "T12:00:00Z"),
    ...overrides,
  });
}

test("normalises and bounds pilot answers and protected details", () => {
  assert.deepEqual(normaliseKnowledge({
    answers: [
      { topic: " Wi-Fi ", keywords: [" wifi ", 42, "network"], reply: " Router details " },
      { topic: "empty", keywords: [], reply: " " },
      null,
    ],
    secrets: [
      { keywords: [" gate code "], reply: " 1234 " },
      { keywords: [], reply: "must not be exposed" },
    ],
  }), {
    answers: [{ topic: "Wi-Fi", keywords: ["wifi", "network"], reply: "Router details" }],
    secrets: [{ keywords: ["gate code"], reply: "1234" }],
  });
  assert.deepEqual(knowledgeCount({ answers: [{ reply: "a" }], secrets: [{ keywords: ["x"], reply: "b" }] }), {
    answers: 1,
    secrets: 1,
  });
});

test("mints property codes in the supported alphabet and resolves collisions", () => {
  assert.equal(pilotCode("Sunset Villa"), "SUNSET-VILLA");
  assert.equal(pilotCode("Sunset Villa", ["SUNSET-VILLA"]), "SUNSET-VILLA-2");
  assert.match(pilotCode("🌴", ["PILOT"]), /^[A-Z0-9_-]{2,20}$/);
});

test("turns recurring intents into bounded, deduplicated add-on candidates", () => {
  assert.deepEqual(addOnCandidates([
    { intent: "gate", count: 4 },
    { intent: "door", count: 3 },
    { intent: "unknown", count: 9 },
    { intent: "wifi", count: 2 },
  ], 2).map(({ intent, count }) => ({ intent, count })), [
    { intent: "gate", count: 4 },
    { intent: "door", count: 3 },
  ]);
});

test("measures rates and leaves zero-traffic rates undefined", () => {
  const metrics = measurePilot({
    guestMessages: 8,
    answered: 5,
    escalated: 2,
    unrouted: 1,
    openEscalations: 1,
    avgHostReplyMinutes: 12.5,
  });
  assert.equal(metrics.answeredRate, 62.5);
  assert.equal(metrics.escalatedRate, 25);
  assert.equal(metrics.unroutedRate, 12.5);
  assert.equal(metrics.openEscalations, 1);
  assert.equal(metrics.avgHostReplyMinutes, 12.5);
  assert.equal(measurePilot().answeredRate, null);
});

test("allows launch only when every checklist item and operational prerequisite passes", () => {
  assert.equal(launch(), true);
  assert.equal(launch({ checklist: { ...checklist, "4": false } }), false);
  assert.equal(launch({ checklist: { ...checklist, "7": true } }), false);
  assert.equal(launch({ startedAt: null }), false);
  assert.equal(launch({ startedAt: "not-a-date" }), false);
  assert.equal(launch({ startedAt: "2999-01-01" }), false);
  assert.equal(launch({ endsAt: "2000-01-01" }), false);
  assert.equal(launch({ hasTextLine: false }), false);
  assert.equal(launch({ hasHostContact: false }), false);
  assert.equal(launch({ hasPendingChanges: true }), false);
  assert.equal(launch({ knowledge: { answers: [], secrets: [] } }), false);
});

test("requires approved knowledge to match protected pilot details", () => {
  const proposed = {
    answers: [{ topic: "Gate code", keywords: ["gate code"], reply: "1234" }],
    secrets: [{ keywords: ["wifi password"], reply: "safe-secret" }],
  };
  const approved = structuredClone(proposed);
  assert.equal(launch({ knowledge: proposed, approvedKnowledge: approved }), true);
  assert.equal(launch({ knowledge: proposed, approvedKnowledge: { answers: [], secrets: [] } }), false);
  assert.equal(launch({ knowledge: proposed, approvedKnowledge: { ...approved, secrets: [] } }), false);
});

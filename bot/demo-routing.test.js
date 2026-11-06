import test from "node:test";
import assert from "node:assert/strict";
import { previewDemoMessage } from "./demo-routing.js";

test("answers a sample FAQ without AI or SMS", () => {
  const result = previewDemoMessage("What time is checkout?");
  assert.equal(result.action, "answer");
  assert.match(result.reply, /10:00 AM/);
  assert.equal(result.aiCalled, false);
  assert.equal(result.smsSent, false);
});

test("answers the sample wifi question with demo-only credentials", () => {
  const result = previewDemoMessage("What is the wifi password?");
  assert.equal(result.action, "answer");
  assert.match(result.reply, /CedarGuest/);
  assert.match(result.reply, /porch-light-42/);
});

test("answers the natural parking and bin phrasings used by the landing page", () => {
  const parking = previewDemoMessage("Where do we park?");
  assert.equal(parking.action, "answer");
  assert.equal(parking.intentKey, "faq_parking");

  const bins = previewDemoMessage("Which bin goes out tonight?");
  assert.equal(bins.action, "answer");
  assert.equal(bins.intentKey, "faq_trash");
});

test("does not expose access credentials in the public sample", () => {
  const result = previewDemoMessage("What is the gate code?");
  assert.equal(result.action, "answer");
  assert.match(result.reply, /does not provide access codes/i);
  assert.doesNotMatch(result.reply, /\d{3,}/);
});

test("routes emergencies and high-risk messages away from AI", () => {
  const emergency = previewDemoMessage("I smell gas");
  assert.equal(emergency.action, "emergency");
  assert.match(emergency.reply, /call 911/i);
  assert.equal(emergency.aiCalled, false);

  const refund = previewDemoMessage("I need a refund");
  assert.equal(refund.action, "escalate");
  assert.equal(refund.aiCalled, false);
  assert.match(refund.reply, /contact the host/i);
});

test("hands off legitimate questions the guide does not cover", () => {
  const crib = previewDemoMessage("Is there a crib?");
  assert.equal(crib.action, "not_covered");
  assert.match(crib.reply, /handed to the host/i);

  const dog = previewDemoMessage("Can we bring our dog this time?");
  assert.equal(dog.action, "not_covered");
  assert.match(dog.reply, /handed to the host/i);
});

test("keeps off-topic replies for genuinely non-stay messages", () => {
  assert.match(previewDemoMessage("Tell me a joke").reply, /only demonstrates property-stay questions/i);
});

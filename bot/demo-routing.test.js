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

test("fails closed for unknown and off-topic sample questions", () => {
  assert.match(previewDemoMessage("Is there a crib?").reply, /can't confirm/i);
  assert.match(previewDemoMessage("Tell me a joke").reply, /only demonstrates property-stay questions/i);
});

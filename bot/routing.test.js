import test from "node:test";
import assert from "node:assert/strict";
import { matchKnownAnswer, planGuestMessage } from "./routing.js";

const property = {
  secrets: [{ topic: "Door code", keywords: ["door code", "keypad"], reply: "The door code is 1234." }],
  answers: [
    { topic: "WiFi", keywords: ["wifi", "wi-fi"], reply: "Network: Guest." },
    { topic: "Checkout", keywords: ["checkout", "check out"], reply: "Checkout is 10 AM." },
  ],
};

test("returns a property FAQ answer without needing AI", () => {
  assert.deepEqual(matchKnownAnswer("What's the Wi-Fi?", property), {
    text: "Network: Guest.",
    secret: false,
    topic: "WiFi",
  });
  assert.equal(planGuestMessage("What's the Wi-Fi?", property).action, "answer");
});

test("matches complete words rather than a substring", () => {
  assert.equal(matchKnownAnswer("Please investigate this", property), null);
});

test("routes dangerous situations before known answers", () => {
  const plan = planGuestMessage("The gas smells bad and I need the door code", property);
  assert.equal(plan.action, "emergency");
  assert.equal(plan.risk, "emergency");
});

test("routes lockouts and water leaks directly to a human", () => {
  for (const body of ["We are locked out", "There is a water leak under the sink"]) {
    const plan = planGuestMessage(body, property);
    assert.equal(plan.action, "emergency", body);
    assert.equal(plan.risk, "emergency", body);
  }
});

test("routes legal, refund, damage, and safety topics away from AI", () => {
  for (const body of ["I want a refund", "The window is broken", "I need a lawyer", "This feels unsafe"]) {
    const plan = planGuestMessage(body, property);
    assert.equal(plan.action, "escalate", body);
    assert.equal(plan.risk, "high", body);
  }
});

test("permits AI only for plausible property-stay questions", () => {
  assert.equal(planGuestMessage("Is there an iron in the house?", property).action, "ai");
  assert.equal(planGuestMessage("Who won the game last night?", property).action, "off_topic");
});

test("asks for clarification on empty, unclear, and overlong messages", () => {
  assert.equal(planGuestMessage("   ", property).action, "clarify");
  assert.equal(planGuestMessage("pool", property).action, "clarify");
  assert.equal(planGuestMessage("wifi " + "x".repeat(501), property).action, "clarify");
});

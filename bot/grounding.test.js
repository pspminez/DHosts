import test from "node:test";
import assert from "node:assert/strict";
import { redactForAudit, validateGroundedAnswer } from "./grounding.js";

const facts = JSON.stringify({
  name: "Sunset Villa",
  answers: [
    { topic: "Checkout", reply: "Checkout is 10:00 AM. Late checkout is not available." },
    { topic: "Pool", reply: "The pool heater is the grey panel on the lanai wall." },
  ],
});

test("accepts short answers whose substantive words and numbers are in property facts", () => {
  assert.deepEqual(validateGroundedAnswer("Checkout is 10 AM.", facts), {
    valid: true,
    unsupported: [],
  });
});

test("rejects invented charges, instructions, and unsupported facts", () => {
  const result = validateGroundedAnswer("Late checkout costs $50 and is available.", facts);
  assert.equal(result.valid, false);
  assert.ok(result.unsupported.includes("costs"));
  assert.ok(result.unsupported.includes("50"));
});

test("rejects empty and oversized AI answers", () => {
  assert.equal(validateGroundedAnswer("", facts).valid, false);
  assert.equal(validateGroundedAnswer("x".repeat(301), facts).valid, false);
});

test("removes email, phone, credential values, and long numeric sequences from audit text", () => {
  const result = redactForAudit(
    "Call 407-555-1212; code is 1234; email guest@example.com; ref 98342.",
    ["1234"],
  );
  assert.equal(result, "Call [phone]; code is [redacted]; email [email]; ref [number].");
});

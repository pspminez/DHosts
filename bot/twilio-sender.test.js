import test from "node:test";
import assert from "node:assert/strict";
import { buildTwilioSendParams } from "./twilio-sender.js";

const SERVICE = "MG0fb969af1db78e37e0c50e306dfe6289";

test("sends from the property's own number when it has one", () => {
  const params = buildTwilioSendParams("+18635550142", "Your gate code is 4821.", "+18635550101", SERVICE);
  assert.equal(params.get("From"), "+18635550101");
  assert.equal(params.get("MessagingServiceSid"), null, "Twilio rejects a send that carries both");
});

test("falls back to the Messaging Service when the sender is a service SID", () => {
  // The production shape this was written for: a property row holding the
  // service SID in its number field, which used to go out as From and fail.
  const params = buildTwilioSendParams("+18635550142", "Your gate code is 4821.", SERVICE, SERVICE);
  assert.equal(params.get("MessagingServiceSid"), SERVICE);
  assert.equal(params.get("From"), null);
});

test("falls back to the Messaging Service when a property has no number", () => {
  for (const sender of ["", "   ", null, undefined]) {
    const params = buildTwilioSendParams("+18635550142", "Hello", sender, SERVICE);
    assert.equal(params.get("MessagingServiceSid"), SERVICE, "sender " + JSON.stringify(sender));
  }
});

test("refuses to send without a usable sender", () => {
  assert.equal(buildTwilioSendParams("+18635550142", "Hello", "", ""), null);
  assert.equal(buildTwilioSendParams("+18635550142", "Hello", "555-0100", ""), null);
  assert.equal(buildTwilioSendParams("+18635550142", "Hello", SERVICE, ""), null, "a SID is not a From number and there is no service");
});

test("ignores a malformed Messaging Service SID instead of sending it", () => {
  assert.equal(buildTwilioSendParams("+18635550142", "Hello", "", "MG123"), null);
  assert.equal(buildTwilioSendParams("+18635550142", "Hello", "+18635550101", "MG123").get("From"), "+18635550101");
});

test("refuses a request with no recipient, whatever the sender", () => {
  assert.equal(buildTwilioSendParams("", "Hello", "+18635550101", SERVICE), null);
});

test("carries the recipient and the body through untouched", () => {
  const params = buildTwilioSendParams("+18635550142", "Wi-Fi: 2F & stairs", "+18635550101");
  assert.equal(params.get("To"), "+18635550142");
  assert.equal(params.get("Body"), "Wi-Fi: 2F & stairs");
});

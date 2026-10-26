import test from "node:test";
import assert from "node:assert/strict";
import {
  decryptRefreshToken,
  encryptRefreshToken,
  hashOutreachValue,
  hashUnsubscribeToken,
  makeGmailRawMessage,
  makeUnsubscribeToken,
} from "./gmail.js";

const testKey = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));

test("builds a base64url Gmail MIME message with one-click unsubscribe", () => {
  const raw = makeGmailRawMessage({
    from: "hello@example.com",
    to: "pilot@example.org",
    subject: "A thoughtful pilot",
    body: "Hi there,\nA short note.",
    unsubscribeUrl: "https://example.com/email/unsubscribe?token=abc123",
  });
  const mime = new TextDecoder().decode(Uint8Array.from(
    atob(raw.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - raw.length % 4) % 4)),
    (char) => char.charCodeAt(0),
  ));
  assert.match(mime, /To: pilot@example\.org/);
  assert.match(mime, /List-Unsubscribe-Post: List-Unsubscribe=One-Click/);
  assert.match(mime, /unsubscribe\?token=abc123/);
});

test("rejects invalid addresses, header injection, and non-HTTPS unsubscribe links", () => {
  const base = {
    from: "hello@example.com",
    to: "pilot@example.org",
    subject: "Hello",
    body: "Message",
    unsubscribeUrl: "https://example.com/unsubscribe",
  };
  assert.throws(() => makeGmailRawMessage({ ...base, subject: "Hello\r\nBcc: bad@example.com" }));
  assert.throws(() => makeGmailRawMessage({ ...base, to: "not-an-email" }));
  assert.throws(() => makeGmailRawMessage({ ...base, unsubscribeUrl: "http://example.com/unsubscribe" }));
});

test("encrypts refresh tokens and detects tampering", async () => {
  const encrypted = await encryptRefreshToken("refresh-token-value", testKey);
  assert.equal(await decryptRefreshToken(encrypted, testKey), "refresh-token-value");
  const record = JSON.parse(encrypted);
  record.ciphertext = btoa("tampered");
  await assert.rejects(decryptRefreshToken(JSON.stringify(record), testKey));
  await assert.rejects(encryptRefreshToken("refresh", "short"));
});

test("uses opaque unsubscribe tokens and normalized email hashes", async () => {
  const token = makeUnsubscribeToken();
  assert.ok(token.length >= 40);
  assert.notEqual(await hashUnsubscribeToken(token), token);
  assert.equal(await hashOutreachValue(" Pilot@Example.Org "), await hashOutreachValue("pilot@example.org"));
});

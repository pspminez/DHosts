import test from "node:test";
import assert from "node:assert/strict";
import {
  ADMIN_SESSION_TTL_SECONDS,
  adminSessionClearCookie,
  adminSessionSetCookie,
  adminSessionValid,
  createAdminSession,
  getCookieValue,
  hashSessionToken,
  randomSessionToken,
  revokeAdminSession,
} from "./admin-session.js";

// Stand-in for the Workers KV namespace. It records every write so a test can
// prove the token itself is never what lands in storage.
class FakeKV {
  constructor() {
    this.values = new Map();
    this.writes = [];
  }
  async get(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }
  async put(key, value, options) {
    this.values.set(key, value);
    this.writes.push({ key, value, options });
  }
  async delete(key) {
    this.values.delete(key);
  }
}

test("creates a session token that is stored only as a hash", async () => {
  const kv = new FakeKV();
  const token = randomSessionToken();

  assert.match(token, /^[0-9a-f]{64}$/, "the token is 32 random bytes as hex");
  await createAdminSession(kv, token);

  assert.equal(await adminSessionValid(kv, token), true);
  assert.equal(kv.writes.length, 1);
  const [write] = kv.writes;
  assert.equal(write.key, `admin:session:${await hashSessionToken(token)}`);
  assert.notEqual(write.key, `admin:session:${token}`, "the raw token is not the storage key");
  assert.ok(
    !kv.writes.some((entry) => entry.key.includes(token.slice(8))),
    "no stored key contains the token",
  );
  assert.equal(write.options.expirationTtl, ADMIN_SESSION_TTL_SECONDS);
});

test("generates a distinct token every time", () => {
  const tokens = new Set();
  for (let i = 0; i < 200; i++) tokens.add(randomSessionToken());
  assert.equal(tokens.size, 200);
});

test("a token survives as a cookie and dies when the session is revoked", async () => {
  const kv = new FakeKV();
  const token = randomSessionToken();
  await createAdminSession(kv, token);

  // What the browser stores after login, and sends back on the next request.
  const setCookie = adminSessionSetCookie(token);
  const storedValue = setCookie.split(";")[0].split("=")[1];
  const fromRequest = getCookieValue(`admin_session=${storedValue}`, "admin_session");
  assert.equal(fromRequest, token);
  assert.equal(await adminSessionValid(kv, fromRequest), true);

  // Logging out deletes the stored token, so the same cookie stops working.
  await revokeAdminSession(kv, fromRequest);
  assert.equal(await adminSessionValid(kv, fromRequest), false);
  assert.equal(
    await adminSessionValid(kv, getCookieValue(adminSessionClearCookie(), "admin_session")),
    false,
  );
});

test("rejects unknown, empty, and tampered tokens", async () => {
  const kv = new FakeKV();
  const token = randomSessionToken();
  await createAdminSession(kv, token);

  assert.equal(await adminSessionValid(kv, ""), false);
  assert.equal(await adminSessionValid(kv, randomSessionToken()), false);
  assert.equal(await adminSessionValid(kv, token.slice(0, -1)), false);
  assert.equal(await adminSessionValid(kv, `${token}0`), false);
});

test("a KV outage fails closed instead of authenticating", async () => {
  const failingKv = {
    async get() {
      throw new Error("KV unavailable");
    },
  };
  const logged = [];
  const original = console.error;
  console.error = (...args) => logged.push(args.join(" "));
  try {
    assert.equal(await adminSessionValid(failingKv, randomSessionToken()), false);
  } finally {
    console.error = original;
  }
  assert.equal(logged.length, 1);
  assert.match(logged[0], /Admin session lookup failed/);
});

test("the session cookie is HttpOnly, Secure, and Strict", () => {
  const cookie = adminSessionSetCookie(randomSessionToken());
  assert.match(cookie, /^admin_session=[0-9a-f]{64};/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Path=\//);
  assert.match(cookie, new RegExp(`Max-Age=${ADMIN_SESSION_TTL_SECONDS}`));
  assert.equal(ADMIN_SESSION_TTL_SECONDS, 60 * 60 * 24 * 3);

  const cleared = adminSessionClearCookie();
  assert.match(cleared, /^admin_session=;/);
  assert.match(cleared, /Max-Age=0/);
  assert.match(cleared, /HttpOnly/);
});

test("reads the session cookie out of a multi-cookie header", () => {
  const header = "other=1; admin_session=abc123; theme=dark";
  assert.equal(getCookieValue(header, "admin_session"), "abc123");
  assert.equal(getCookieValue(header, "theme"), "dark");
  assert.equal(getCookieValue(header, "missing"), "");
  assert.equal(getCookieValue("", "admin_session"), "");
  assert.equal(
    getCookieValue("not_admin_session=nope", "admin_session"),
    "",
    "a cookie whose name merely ends with the same text must not match",
  );
});

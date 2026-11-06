import test from "node:test";
import assert from "node:assert/strict";
import {
  ADMIN_PASSWORD_MAX_LENGTH,
  ADMIN_PASSWORD_MIN_LENGTH,
  adminPasswordConfigured,
  adminPasswordProblem,
  revokeAllAdminSessions,
  saveAdminPassword,
  verifyAdminPassword,
} from "./admin-password.js";
import { adminSessionValid, createAdminSession, randomSessionToken } from "./admin-session.js";

// The credential key is deliberately not exported from the module; tests read
// the one record the code writes so they can prove it never holds plaintext.
const CREDENTIAL_KEY = "admin:credential";

class FakeKV {
  constructor() {
    this.values = new Map();
    this.listSnapshots = new Map();
  }
  async get(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }
  async put(key, value, options) {
    this.values.set(key, value);
    this.lastPut = { key, value, options };
  }
  async delete(key) {
    this.values.delete(key);
  }
  // Page size 1 so revokeAllAdminSessions has to follow its cursor. Like real
  // KV, the cursor walks a snapshot: deleting the page you just read must not
  // shift the next page and leave a key behind.
  async list({ prefix = "", cursor } = {}) {
    const snapshot = cursor === undefined
      ? [...this.values.keys()].filter((name) => name.startsWith(prefix)).sort()
      : this.listSnapshots.get(prefix) || [];
    if (cursor === undefined) this.listSnapshots.set(prefix, snapshot);
    const start = cursor ? Number(cursor) : 0;
    const end = Math.min(start + 1, snapshot.length);
    return {
      keys: snapshot.slice(start, end).map((name) => ({ name })),
      list_complete: end >= snapshot.length,
      cursor: end >= snapshot.length ? undefined : String(end),
    };
  }
}

const NEW_PASSWORD = "correct horse battery staple";

test("validates password length without trimming the value", () => {
  assert.equal(adminPasswordProblem("a".repeat(ADMIN_PASSWORD_MIN_LENGTH - 1)).includes("at least"), true);
  assert.equal(adminPasswordProblem("a".repeat(ADMIN_PASSWORD_MIN_LENGTH)), "");
  assert.equal(adminPasswordProblem("a".repeat(ADMIN_PASSWORD_MAX_LENGTH)), "");
  assert.equal(adminPasswordProblem("a".repeat(ADMIN_PASSWORD_MAX_LENGTH + 1)).includes("or fewer"), true);
  assert.equal(adminPasswordProblem(12345), "Password must be a string.");
  assert.equal(adminPasswordProblem("  spaces count  "), "");
});

test("stores only a salted hash and the stored password overrides the secret", async () => {
  const kv = new FakeKV();
  await saveAdminPassword(kv, NEW_PASSWORD);

  const raw = kv.values.get(CREDENTIAL_KEY);
  assert.ok(raw, "a credential record was written");
  assert.equal(raw.includes(NEW_PASSWORD), false, "the password is not stored in plaintext");
  const record = JSON.parse(raw);
  assert.equal(record.version, 1);
  assert.match(record.salt, /^[0-9a-f]{32}$/);
  assert.match(record.hash, /^[0-9a-f]{64}$/);
  assert.ok(record.iterations >= 10_000);

  const env = { ADMIN_PASSWORD: "old-deployment-secret", PROPERTIES: kv };
  assert.equal(await verifyAdminPassword(env, NEW_PASSWORD), true);
  assert.equal(await verifyAdminPassword(env, "old-deployment-secret"), false, "the secret no longer signs in");
  assert.equal(await verifyAdminPassword(env, NEW_PASSWORD + "x"), false);
  assert.equal(await verifyAdminPassword(env, ""), false);
  assert.equal(await adminPasswordConfigured(env), true);
});

test("uses ADMIN_PASSWORD until a password is set from the panel", async () => {
  const kv = new FakeKV();
  const env = { ADMIN_PASSWORD: "deployment-secret", PROPERTIES: kv };
  assert.equal(await adminPasswordConfigured(env), true);
  assert.equal(await verifyAdminPassword(env, "deployment-secret"), true);
  assert.equal(await verifyAdminPassword(env, "wrong"), false);

  const unconfigured = { PROPERTIES: new FakeKV() };
  assert.equal(await adminPasswordConfigured(unconfigured), false);
  assert.equal(await verifyAdminPassword(unconfigured, "anything"), false);
});

test("a password change revokes every session but keeps the new credential", async () => {
  const kv = new FakeKV();
  const tokens = [randomSessionToken(), randomSessionToken(), randomSessionToken()];
  for (const token of tokens) await createAdminSession(kv, token);
  await saveAdminPassword(kv, NEW_PASSWORD);

  await revokeAllAdminSessions(kv);

  for (const token of tokens) {
    assert.equal(await adminSessionValid(kv, token), false, "old session was revoked");
  }
  assert.equal(await verifyAdminPassword({ PROPERTIES: kv }, NEW_PASSWORD), true);
});

test("a KV outage fails closed and reports no configured password", async () => {
  const failingKv = {
    async get() {
      throw new Error("KV unavailable");
    },
  };
  const logged = [];
  const original = console.error;
  console.error = (...args) => logged.push(args.join(" "));
  try {
    assert.equal(await verifyAdminPassword({ ADMIN_PASSWORD: "secret", PROPERTIES: failingKv }, "secret"), false);
    // A configured secret answers without touching KV, so ask only about the
    // no-secret deployment to exercise the failing lookup.
    assert.equal(await adminPasswordConfigured({ PROPERTIES: failingKv }), false);
  } finally {
    console.error = original;
  }
  assert.equal(logged.length, 2);
  assert.match(logged[0], /Admin password lookup failed/);
});

test("a malformed stored record falls back to ADMIN_PASSWORD", async () => {
  const kv = new FakeKV();
  await kv.put(CREDENTIAL_KEY, "{not-json");
  const logged = [];
  const original = console.error;
  console.error = (...args) => logged.push(args.join(" "));
  try {
    assert.equal(await verifyAdminPassword({ ADMIN_PASSWORD: "secret", PROPERTIES: kv }, "secret"), true);
  } finally {
    console.error = original;
  }
  assert.equal(logged.length, 1);
  assert.match(logged[0], /Stored admin password is unreadable/);
});

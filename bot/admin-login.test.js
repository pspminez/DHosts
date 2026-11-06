import test from "node:test";
import assert from "node:assert/strict";
import {
  LOGIN_LOCK_SECONDS,
  LOGIN_MAX_FAILURES,
  LOGIN_WINDOW_SECONDS,
  clearLoginFailures,
  loginLock,
  noteLoginFailure,
} from "./admin-login.js";

class FakeKV {
  constructor() {
    this.values = new Map();
  }
  async get(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }
  async put(key, value) {
    this.values.set(key, value);
  }
  async delete(key) {
    this.values.delete(key);
  }
}

const NOW = Date.UTC(2026, 10, 5, 12, 0, 0);

test("four wrong passwords leave one attempt and the fifth locks the address", async () => {
  const kv = new FakeKV();
  assert.deepEqual(await loginLock(kv, "203.0.113.5", NOW), {
    locked: false,
    failures: 0,
    attemptsRemaining: LOGIN_MAX_FAILURES,
    retryAfterSeconds: 0,
  });

  for (let attempt = 1; attempt < LOGIN_MAX_FAILURES; attempt++) {
    const state = await noteLoginFailure(kv, "203.0.113.5", NOW);
    assert.equal(state.locked, false);
    assert.equal(state.failures, attempt);
    assert.equal(state.attemptsRemaining, LOGIN_MAX_FAILURES - attempt);
  }

  const locked = await noteLoginFailure(kv, "203.0.113.5", NOW);
  assert.equal(locked.locked, true);
  assert.equal(locked.failures, LOGIN_MAX_FAILURES);
  assert.equal(locked.attemptsRemaining, 0);
  assert.equal(locked.retryAfterSeconds, LOGIN_LOCK_SECONDS);

  const fromOtherIp = await loginLock(kv, "198.51.100.9", NOW);
  assert.equal(fromOtherIp.locked, false, "one address being locked must not block another");
});

test("a locked address stays locked until the lock expires", async () => {
  const kv = new FakeKV();
  for (let attempt = 0; attempt < LOGIN_MAX_FAILURES; attempt++) await noteLoginFailure(kv, "ip", NOW);

  const during = await loginLock(kv, "ip", NOW + 60_000);
  assert.equal(during.locked, true);
  assert.equal(during.retryAfterSeconds, LOGIN_LOCK_SECONDS - 60);

  const after = await loginLock(kv, "ip", NOW + LOGIN_LOCK_SECONDS * 1000 + 1);
  assert.equal(after.locked, false);
  assert.equal(after.attemptsRemaining, LOGIN_MAX_FAILURES);
});

test("the failure window resets, and a successful sign-in clears the count", async () => {
  const kv = new FakeKV();
  await noteLoginFailure(kv, "ip", NOW);
  await noteLoginFailure(kv, "ip", NOW);
  assert.equal((await loginLock(kv, "ip", NOW)).failures, 2);

  const afterWindow = NOW + LOGIN_WINDOW_SECONDS * 1000 + 1;
  assert.equal((await loginLock(kv, "ip", afterWindow)).failures, 0);
  assert.equal((await noteLoginFailure(kv, "ip", afterWindow)).failures, 1);

  await clearLoginFailures(kv, "ip");
  assert.equal((await loginLock(kv, "ip", afterWindow)).failures, 0);
  assert.equal((await noteLoginFailure(kv, "ip", afterWindow)).failures, 1);
});

test("a KV outage fails open and is logged instead of locking everyone out", async () => {
  const failingKv = {
    async get() {
      throw new Error("KV unavailable");
    },
    async put() {
      throw new Error("KV unavailable");
    },
  };
  const logged = [];
  const original = console.error;
  console.error = (...args) => logged.push(args.join(" "));
  try {
    const state = await loginLock(failingKv, "ip", NOW);
    assert.equal(state.locked, false);
    assert.equal(state.attemptsRemaining, LOGIN_MAX_FAILURES);
  } finally {
    console.error = original;
  }
  assert.equal(logged.length, 1);
  assert.match(logged[0], /Login throttle lookup failed/);
});

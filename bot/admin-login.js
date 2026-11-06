// bot/admin-login.js
//
// Per-IP sign-in throttle. Stored in KV rather than isolate memory because a
// Worker isolate is short-lived and there are many of them: an in-memory counter
// would let an attacker reset their attempts by landing on a different isolate.
//
// Five wrong passwords from one address within fifteen minutes lock that
// address for fifteen minutes. The lock is deliberately coarse: the admin panel
// has one shared password and no per-user accounts, so a targeted attacker must
// not be able to keep guessing.

export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_WINDOW_SECONDS = 15 * 60;
export const LOGIN_LOCK_SECONDS = 15 * 60;

const PREFIX = "admin:login-fail:";
const WINDOW_MS = LOGIN_WINDOW_SECONDS * 1000;
const LOCK_MS = LOGIN_LOCK_SECONDS * 1000;

function loginKey(ip) {
  return `${PREFIX}${ip || "unknown"}`;
}

function parseRecord(raw) {
  if (typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const failures = Number(parsed.failures);
    const windowStart = Number(parsed.windowStart);
    const lockedUntil = Number(parsed.lockedUntil) || 0;
    if (!Number.isInteger(failures) || failures < 0 || !Number.isFinite(windowStart)) return null;
    return { failures, windowStart, lockedUntil };
  } catch {
    return null;
  }
}

function lockedResult(record, now) {
  return {
    locked: true,
    failures: record.failures,
    attemptsRemaining: 0,
    retryAfterSeconds: Math.max(1, Math.ceil((record.lockedUntil - now) / 1000)),
  };
}

function openResult(failures = 0) {
  return {
    locked: false,
    failures,
    attemptsRemaining: Math.max(0, LOGIN_MAX_FAILURES - failures),
    retryAfterSeconds: 0,
  };
}

/** Current throttle state without recording an attempt. */
export async function loginLock(kv, ip, now = Date.now()) {
  let raw;
  try {
    raw = await kv.get(loginKey(ip));
  } catch (err) {
    // Fail open on a throttle outage: a KV failure must not lock every operator
    // out, and password verification is a separate, fail-closed check.
    console.error("Login throttle lookup failed:", err);
    return openResult();
  }
  const record = parseRecord(raw);
  if (!record) return openResult();
  if (record.lockedUntil > now) return lockedResult(record, now);
  if (record.windowStart + WINDOW_MS <= now) return openResult();
  return openResult(record.failures);
}

/** Record one wrong password and say whether this attempt triggers a lock. */
export async function noteLoginFailure(kv, ip, now = Date.now()) {
  const key = loginKey(ip);
  let raw = null;
  try {
    raw = await kv.get(key);
  } catch (err) {
    console.error("Login throttle lookup failed:", err);
    return openResult();
  }
  let record = parseRecord(raw);
  if (record && record.lockedUntil > now) return lockedResult(record, now);
  if (!record || record.windowStart + WINDOW_MS <= now) {
    record = { failures: 0, windowStart: now, lockedUntil: 0 };
  }
  record.failures += 1;
  let result;
  if (record.failures >= LOGIN_MAX_FAILURES) {
    record.lockedUntil = now + LOCK_MS;
    result = lockedResult(record, now);
  } else {
    result = openResult(record.failures);
  }
  try {
    await kv.put(key, JSON.stringify(record), {
      expirationTtl: Math.max(LOGIN_WINDOW_SECONDS, LOGIN_LOCK_SECONDS),
    });
  } catch (err) {
    // The attempt was already rejected; failing to persist the counter must not
    // turn a wrong password into an error page.
    console.error("Could not record a failed login:", err);
  }
  return result;
}

/** A successful sign-in wipes the address's failure history. */
export async function clearLoginFailures(kv, ip) {
  try {
    await kv.delete(loginKey(ip));
  } catch (err) {
    console.error("Could not clear login failures:", err);
  }
}

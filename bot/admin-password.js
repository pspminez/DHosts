// bot/admin-password.js
//
// The admin password can be changed from the panel. A Worker cannot rewrite its
// own wrangler secret, so a password set in the panel lives in KV, stored as a
// salted PBKDF2-SHA256 hash — never plaintext and never in D1.
//
// ADMIN_PASSWORD remains the bootstrap and recovery secret: it is used until a
// stored password exists, and deleting the admin:credential key restores it.
// Every login after the change uses the stored credential instead.

export const ADMIN_PASSWORD_MIN_LENGTH = 12;
export const ADMIN_PASSWORD_MAX_LENGTH = 200;

const ADMIN_PASSWORD_KEY = "admin:credential";
const SESSION_PREFIX = "admin:session:";
// Slow enough to make an offline guess expensive, small enough to stay well
// inside a Worker's CPU budget on a sign-in (the only time it runs).
const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const HASH_BYTES = 32;

function toHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function derive(password, salt, iterations) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    HASH_BYTES * 8,
  );
  return new Uint8Array(bits);
}

function isStoredCredential(value) {
  return Boolean(
    value &&
      value.version === 1 &&
      Number.isInteger(value.iterations) &&
      value.iterations >= 10_000 &&
      value.iterations <= 1_000_000 &&
      typeof value.salt === "string" &&
      /^[0-9a-f]{32}$/.test(value.salt) &&
      typeof value.hash === "string" &&
      /^[0-9a-f]{64}$/.test(value.hash),
  );
}

/** Returns a human-readable problem, or "" when the password is acceptable. */
export function adminPasswordProblem(password) {
  if (typeof password !== "string") return "Password must be a string.";
  const length = [...password].length;
  if (length < ADMIN_PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${ADMIN_PASSWORD_MIN_LENGTH} characters.`;
  }
  if (length > ADMIN_PASSWORD_MAX_LENGTH) {
    return `Password must be ${ADMIN_PASSWORD_MAX_LENGTH} characters or fewer.`;
  }
  return "";
}

/**
 * The panel-changed credential, or null when none has been saved. A malformed
 * record is logged and treated as absent so the deployment can still fall back
 * to ADMIN_PASSWORD; KV reads that throw are left to the caller to fail closed.
 */
export async function loadStoredAdminPassword(kv) {
  const raw = await kv.get(ADMIN_PASSWORD_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!isStoredCredential(parsed)) throw new Error("unexpected shape");
    return parsed;
  } catch (err) {
    console.error("Stored admin password is unreadable; falling back to ADMIN_PASSWORD:", err);
    return null;
  }
}

/** True when either a stored password or the deployment secret exists. */
export async function adminPasswordConfigured(env) {
  try {
    if (env.ADMIN_PASSWORD) return true;
    return (await loadStoredAdminPassword(env.PROPERTIES)) !== null;
  } catch (err) {
    console.error("Admin password lookup failed:", err);
    return false;
  }
}

/** Verify a candidate against the stored password, or the secret if none yet. */
export async function verifyAdminPassword(env, candidate) {
  if (typeof candidate !== "string" || !candidate) return false;
  let stored;
  try {
    stored = await loadStoredAdminPassword(env.PROPERTIES);
  } catch (err) {
    // Fail closed: a KV outage must not fall back to a weaker check.
    console.error("Admin password lookup failed:", err);
    return false;
  }
  if (stored) {
    const derived = await derive(candidate, fromHex(stored.salt), stored.iterations);
    return constantTimeEqual(toHex(derived), stored.hash);
  }
  return Boolean(env.ADMIN_PASSWORD) && constantTimeEqual(candidate, env.ADMIN_PASSWORD);
}

/** Hash and save a new password. The caller validates it and revokes sessions. */
export async function saveAdminPassword(kv, password) {
  const problem = adminPasswordProblem(password);
  if (problem) throw new Error(problem);
  const salt = new Uint8Array(SALT_BYTES);
  crypto.getRandomValues(salt);
  const hash = await derive(password, salt, PBKDF2_ITERATIONS);
  await kv.put(
    ADMIN_PASSWORD_KEY,
    JSON.stringify({ version: 1, iterations: PBKDF2_ITERATIONS, salt: toHex(salt), hash: toHex(hash) }),
  );
}

/** Drop every admin session. Used after a password change. */
export async function revokeAllAdminSessions(kv) {
  let cursor;
  do {
    const page = await kv.list({ prefix: SESSION_PREFIX, cursor });
    await Promise.all(page.keys.map((key) => kv.delete(key.name)));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
}

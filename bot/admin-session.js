// bot/admin-session.js
//
// Admin session tokens.
//
// The admin panel used to keep the ADMIN_PASSWORD itself in a cookie, base64
// encoded. Base64 is not encryption, so anyone who read that cookie could
// recover the password, and because the page script had to read the cookie to
// restore a session it could not be HttpOnly.
//
// Now the browser gets a random 256-bit token and the Worker stores only its
// SHA-256 hash in KV. The token is not derived from the password, so a stolen
// cookie cannot be turned back into one, and it is revocable (logout deletes
// it) — neither of which was true of a copy of the password.
//
// Each record also carries descriptive metadata so the Account tab can list
// signed-in browsers and revoke one. That metadata never includes the token.

export const ADMIN_SESSION_DEFAULT_HOURS = 12;
export const ADMIN_SESSION_REMEMBER_DEFAULT_DAYS = 30;
export const ADMIN_SESSION_TTL_SECONDS = ADMIN_SESSION_DEFAULT_HOURS * 60 * 60;
export const ADMIN_SESSION_REMEMBER_TTL_SECONDS = ADMIN_SESSION_REMEMBER_DEFAULT_DAYS * 24 * 60 * 60;

const SESSION_PREFIX = "admin:session:";

/**
 * Server-side lifetime for a new session. The two environment values are
 * deployment settings (wrangler.toml); a missing, non-numeric, or non-positive
 * value falls back to the default rather than creating a session without an
 * expiry. Remembered sessions are capped at one year.
 */
export function adminSessionTtlSeconds(config = {}, remember = false) {
  if (remember) {
    const days = Number(config.ADMIN_SESSION_REMEMBER_DAYS);
    const value = Number.isFinite(days) && days > 0
      ? Math.min(days, 365)
      : ADMIN_SESSION_REMEMBER_DEFAULT_DAYS;
    return Math.floor(value * 24 * 60 * 60);
  }
  const hours = Number(config.ADMIN_SESSION_HOURS);
  const value = Number.isFinite(hours) && hours > 0
    ? Math.min(hours, 24 * 30)
    : ADMIN_SESSION_DEFAULT_HOURS;
  return Math.floor(value * 60 * 60);
}

export function randomSessionToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hashSessionToken(token) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// KV keys hold the hash, never the token, so a dump of KV cannot be replayed.
async function sessionKey(token) {
  return `${SESSION_PREFIX}${await hashSessionToken(token)}`;
}

function parseSession(raw) {
  if (typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function createAdminSession(kv, token, meta = {}, ttlSeconds = ADMIN_SESSION_TTL_SECONDS) {
  const record = {
    id: typeof meta.id === "string" && meta.id ? meta.id : crypto.randomUUID(),
    createdAt: typeof meta.createdAt === "string" && meta.createdAt ? meta.createdAt : new Date().toISOString(),
    ip: typeof meta.ip === "string" ? meta.ip.slice(0, 64) : "",
    userAgent: typeof meta.userAgent === "string" ? meta.userAgent.slice(0, 300) : "",
  };
  const ttl = Number.isFinite(Number(ttlSeconds)) && Number(ttlSeconds) > 0
    ? Math.floor(Number(ttlSeconds))
    : ADMIN_SESSION_TTL_SECONDS;
  await kv.put(await sessionKey(token), JSON.stringify(record), { expirationTtl: ttl });
}

// Fails closed: a KV error means "not signed in", never "signed in". Older
// sessions stored the string "1"; either a record or "1" means signed in.
export async function adminSessionValid(kv, token) {
  if (!token) return false;
  try {
    return Boolean(await kv.get(await sessionKey(token)));
  } catch (err) {
    console.error("Admin session lookup failed:", err);
    return false;
  }
}

export async function revokeAdminSession(kv, token) {
  if (!token) return;
  await kv.delete(await sessionKey(token));
}

/**
 * Every active session, newest first. `currentToken` marks the browser making
 * the request. Legacy sessions (value "1") are listed with a derived id so they
 * can still be revoked.
 */
export async function listAdminSessions(kv, currentToken) {
  const currentKey = currentToken ? await sessionKey(currentToken) : "";
  const sessions = [];
  let cursor;
  do {
    const page = await kv.list({ prefix: SESSION_PREFIX, cursor });
    for (const key of page.keys) {
      const raw = await kv.get(key.name);
      if (!raw) continue;
      const record = parseSession(raw);
      const hash = key.name.slice(SESSION_PREFIX.length);
      sessions.push({
        key: key.name,
        id: record && typeof record.id === "string" && record.id ? record.id : `legacy-${hash.slice(0, 12)}`,
        current: key.name === currentKey,
        createdAt: record && typeof record.createdAt === "string" ? record.createdAt : null,
        ip: record && typeof record.ip === "string" ? record.ip : "",
        userAgent: record && typeof record.userAgent === "string" ? record.userAgent : "",
        legacy: !record,
      });
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return sessions.sort(
    (a, b) => (b.createdAt || "").localeCompare(a.createdAt || "") || a.id.localeCompare(b.id),
  );
}

/**
 * Revoke one session by its public id. The current session is never revoked
 * here: signing yourself out has its own button and clears the cookie.
 */
export async function revokeAdminSessionById(kv, id, currentToken) {
  if (!id) return { revoked: false, current: false };
  const sessions = await listAdminSessions(kv, currentToken);
  const target = sessions.find((session) => session.id === id);
  if (!target) return { revoked: false, current: false };
  if (target.current) return { revoked: false, current: true };
  await kv.delete(target.key);
  return { revoked: true, current: false };
}

// A positive max-age persists the cookie for that long. Zero (or any invalid
// value) omits Max-Age, making it a browser-session cookie: closing the browser
// ends it, while the KV record still expires on its own schedule.
export function adminSessionSetCookie(token, maxAgeSeconds = ADMIN_SESSION_TTL_SECONDS) {
  const maxAge = Number(maxAgeSeconds);
  const age = Number.isFinite(maxAge) && maxAge > 0 ? `; Max-Age=${Math.floor(maxAge)}` : "";
  return `admin_session=${token}; Path=/;${age} HttpOnly; Secure; SameSite=Strict`;
}

export function adminSessionClearCookie() {
  return "admin_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict";
}

export function getCookieValue(cookieHeader, name) {
  const prefix = `${name}=`;
  const cookie = cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix));
  return cookie ? cookie.slice(prefix.length) : "";
}

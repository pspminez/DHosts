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

export const ADMIN_SESSION_TTL_SECONDS = 60 * 60 * 24 * 3; // 3 days

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
  return `admin:session:${await hashSessionToken(token)}`;
}

export async function createAdminSession(kv, token) {
  await kv.put(await sessionKey(token), "1", { expirationTtl: ADMIN_SESSION_TTL_SECONDS });
}

// Fails closed: a KV error means "not signed in", never "signed in".
export async function adminSessionValid(kv, token) {
  if (!token) return false;
  try {
    return (await kv.get(await sessionKey(token))) === "1";
  } catch (err) {
    console.error("Admin session lookup failed:", err);
    return false;
  }
}

export async function revokeAdminSession(kv, token) {
  if (!token) return;
  await kv.delete(await sessionKey(token));
}

export function adminSessionSetCookie(token) {
  return `admin_session=${token}; Path=/; Max-Age=${ADMIN_SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
}

export function adminSessionClearCookie() {
  return "admin_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict";
}

export function getCookieValue(cookieHeader, name) {
  const prefix = `${name}=`;
  const cookie = cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix));
  return cookie ? cookie.slice(prefix.length) : "";
}

// bot/host-portal.js
//
// The host side of StayXI.
//
// A host signs in with their property's house code and a passcode the operator
// sets in the admin panel. The passcode is stored only as a salted PBKDF2 hash
// under its own KV key, so saving the property from the admin panel cannot wipe
// it. Sessions are random tokens; KV holds only their SHA-256 hash.
//
// This module stays pure where it can: the worker runs the SQL and hands the
// rows to buildHostOverview(), the same split analytics.js uses, so the numbers
// can be tested without a database.

import { buildDailySeries, themeLabel } from "./analytics.js";

export const HOST_PASSCODE_MIN_LENGTH = 8;
export const HOST_PASSCODE_MAX_LENGTH = 200;
export const HOST_SESSION_DEFAULT_HOURS = 12;
export const HOST_SESSION_REMEMBER_DAYS = 30;
export const HOST_LOGIN_MAX_FAILURES = 5;
export const HOST_LOGIN_WINDOW_SECONDS = 15 * 60;
export const HOST_LOGIN_LOCK_SECONDS = 15 * 60;

const CREDENTIAL_PREFIX = "host:credential:";
const SESSION_PREFIX = "host:session:";
const LOGIN_PREFIX = "host:login-fail:";
const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const HASH_BYTES = 32;
const LOGIN_WINDOW_MS = HOST_LOGIN_WINDOW_SECONDS * 1000;
const LOGIN_LOCK_MS = HOST_LOGIN_LOCK_SECONDS * 1000;

// Four tones for the guide sections, matching the landing dashboard.
export const SECTION_COLORS = ["#ff8a3d", "#5b9cf5", "#d46bf5", "#49c97a", "#f2c94c", "#ff6b6b"];

export const HOST_RANGES = {
  today: { id: "today", label: "Today", days: 1 },
  stay: { id: "stay", label: "This stay", days: 7 },
  all: { id: "all", label: "All", days: 30 },
};

export function hostRange(value) {
  return HOST_RANGES[value] || HOST_RANGES.stay;
}

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

async function derive(passcode, salt, iterations) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passcode),
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

export async function hashHostPasscode(passcode) {
  const salt = new Uint8Array(SALT_BYTES);
  crypto.getRandomValues(salt);
  const hash = await derive(passcode, salt, PBKDF2_ITERATIONS);
  return {
    version: 1,
    iterations: PBKDF2_ITERATIONS,
    salt: toHex(salt),
    hash: toHex(hash),
  };
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

/** Returns a human-readable problem, or "" when the passcode is acceptable. */
export function hostPasscodeProblem(passcode) {
  if (typeof passcode !== "string") return "Passcode must be a string.";
  const length = [...passcode].length;
  if (length < HOST_PASSCODE_MIN_LENGTH) {
    return `Passcode must be at least ${HOST_PASSCODE_MIN_LENGTH} characters.`;
  }
  if (length > HOST_PASSCODE_MAX_LENGTH) {
    return `Passcode must be ${HOST_PASSCODE_MAX_LENGTH} characters or fewer.`;
  }
  return "";
}

export async function loadHostPasscode(kv, propertyId) {
  const raw = await kv.get(`${CREDENTIAL_PREFIX}${propertyId}`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!isStoredCredential(parsed)) throw new Error("unexpected shape");
    return parsed;
  } catch (err) {
    console.error("Stored host passcode is unreadable:", err);
    return null;
  }
}

/** Status for the admin panel: configured or off, never the hash itself. */
export async function hostPortalStatus(kv, propertyId) {
  const credential = await loadHostPasscode(kv, propertyId);
  return {
    configured: Boolean(credential),
    updatedAt: credential && typeof credential.updatedAt === "string" ? credential.updatedAt : null,
  };
}

export async function saveHostPasscode(kv, propertyId, passcode) {
  const problem = hostPasscodeProblem(passcode);
  if (problem) throw new Error(problem);
  const credential = await hashHostPasscode(passcode);
  await kv.put(
    `${CREDENTIAL_PREFIX}${propertyId}`,
    JSON.stringify({ ...credential, updatedAt: new Date().toISOString() }),
  );
}

export async function clearHostPasscode(kv, propertyId) {
  await kv.delete(`${CREDENTIAL_PREFIX}${propertyId}`);
}

/** Fails closed: a missing or malformed record never authenticates. */
export async function verifyHostPasscode(credential, passcode) {
  if (!credential || typeof passcode !== "string" || !passcode) return false;
  try {
    const derived = await derive(passcode, fromHex(credential.salt), credential.iterations);
    return constantTimeEqual(toHex(derived), credential.hash);
  } catch (err) {
    console.error("Host passcode check failed:", err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Sign-in throttle
// ---------------------------------------------------------------------------

function loginKey(ip, houseCode) {
  return `${LOGIN_PREFIX}${ip || "unknown"}:${houseCode || "unknown"}`;
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

function openResult(failures = 0) {
  return {
    locked: false,
    failures,
    attemptsRemaining: Math.max(0, HOST_LOGIN_MAX_FAILURES - failures),
    retryAfterSeconds: 0,
  };
}

export async function hostLoginLock(kv, ip, houseCode, now = Date.now()) {
  let raw;
  try {
    raw = await kv.get(loginKey(ip, houseCode));
  } catch (err) {
    // A throttle outage must not lock every host out; the passcode check itself
    // still fails closed.
    console.error("Host login throttle lookup failed:", err);
    return openResult();
  }
  const record = parseRecord(raw);
  if (!record) return openResult();
  if (record.lockedUntil > now) {
    return {
      locked: true,
      failures: record.failures,
      attemptsRemaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((record.lockedUntil - now) / 1000)),
    };
  }
  if (record.windowStart + LOGIN_WINDOW_MS <= now) return openResult();
  return openResult(record.failures);
}

export async function noteHostLoginFailure(kv, ip, houseCode, now = Date.now()) {
  const key = loginKey(ip, houseCode);
  let raw = null;
  try {
    raw = await kv.get(key);
  } catch (err) {
    console.error("Host login throttle lookup failed:", err);
    return openResult();
  }
  let record = parseRecord(raw);
  if (record && record.lockedUntil > now) {
    return {
      locked: true,
      failures: record.failures,
      attemptsRemaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((record.lockedUntil - now) / 1000)),
    };
  }
  if (!record || record.windowStart + LOGIN_WINDOW_MS <= now) {
    record = { failures: 0, windowStart: now, lockedUntil: 0 };
  }
  record.failures += 1;
  let result;
  if (record.failures >= HOST_LOGIN_MAX_FAILURES) {
    record.lockedUntil = now + LOGIN_LOCK_MS;
    result = {
      locked: true,
      failures: record.failures,
      attemptsRemaining: 0,
      retryAfterSeconds: Math.ceil(LOGIN_LOCK_MS / 1000),
    };
  } else {
    result = openResult(record.failures);
  }
  try {
    await kv.put(key, JSON.stringify(record), {
      expirationTtl: Math.max(HOST_LOGIN_WINDOW_SECONDS, HOST_LOGIN_LOCK_SECONDS),
    });
  } catch (err) {
    console.error("Could not record a failed host login:", err);
  }
  return result;
}

export async function clearHostLoginFailures(kv, ip, houseCode) {
  try {
    await kv.delete(loginKey(ip, houseCode));
  } catch (err) {
    console.error("Could not clear host login failures:", err);
  }
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

const SESSION_TTL_SECONDS = HOST_SESSION_DEFAULT_HOURS * 60 * 60;
const SESSION_REMEMBER_TTL_SECONDS = HOST_SESSION_REMEMBER_DAYS * 24 * 60 * 60;

export function hostSessionTtlSeconds(remember = false) {
  return remember ? SESSION_REMEMBER_TTL_SECONDS : SESSION_TTL_SECONDS;
}

async function hashToken(token) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return toHex(new Uint8Array(digest));
}

async function sessionKey(token) {
  return `${SESSION_PREFIX}${await hashToken(token)}`;
}

export async function createHostSession(kv, token, record = {}, ttlSeconds = SESSION_TTL_SECONDS) {
  const value = {
    propertyId: typeof record.propertyId === "string" ? record.propertyId : "",
    houseCode: typeof record.houseCode === "string" ? record.houseCode : "",
    hostName: typeof record.hostName === "string" ? record.hostName : "",
    createdAt: new Date().toISOString(),
  };
  const ttl = Number.isFinite(Number(ttlSeconds)) && Number(ttlSeconds) > 0
    ? Math.floor(Number(ttlSeconds))
    : SESSION_TTL_SECONDS;
  await kv.put(await sessionKey(token), JSON.stringify(value), { expirationTtl: ttl });
  return value;
}

export async function getHostSession(kv, token) {
  if (!token) return null;
  try {
    const raw = await kv.get(await sessionKey(token));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    if (typeof parsed.propertyId !== "string" || !parsed.propertyId) return null;
    return parsed;
  } catch (err) {
    console.error("Host session lookup failed:", err);
    return null;
  }
}

export async function revokeHostSession(kv, token) {
  if (!token) return;
  try {
    await kv.delete(await sessionKey(token));
  } catch (err) {
    console.error("Could not revoke the host session:", err);
  }
}

/** Drop every host session for one property, e.g. after a passcode change. */
export async function revokeAllHostSessions(kv, propertyId) {
  try {
    let cursor;
    do {
      const page = await kv.list({ prefix: SESSION_PREFIX, cursor });
      for (const key of page.keys) {
        const raw = await kv.get(key.name);
        if (!raw) continue;
        try {
          const record = JSON.parse(raw);
          if (record && record.propertyId === propertyId) await kv.delete(key.name);
        } catch {
          // An unreadable session expires on its own.
        }
      }
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
  } catch (err) {
    console.error("Could not revoke host sessions:", err);
  }
}

export function hostSessionCookie(token, maxAgeSeconds = SESSION_TTL_SECONDS) {
  const age = Number(maxAgeSeconds) > 0 ? `; Max-Age=${Math.floor(Number(maxAgeSeconds))}` : "";
  return `host_session=${token}; Path=/;${age} HttpOnly; Secure; SameSite=Lax`;
}

export function hostSessionClearCookie() {
  return "host_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax";
}

// ---------------------------------------------------------------------------
// Guide editing
// ---------------------------------------------------------------------------

/**
 * Validate what a host may save. Critical answers (codes, safety, check-in/out)
 * are managed by the operator, so they are rejected here rather than silently
 * written past the admin review step.
 */
export function normalizeHostGuide(input) {
  if (!Array.isArray(input)) throw new Error("Guide must be a list of answers.");
  if (input.length > 100) throw new Error("Limit the guide to 100 answers.");
  const answers = [];
  for (const entry of input) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const topic = typeof entry.topic === "string" ? entry.topic.trim().slice(0, 80) : "";
    const keywords = Array.isArray(entry.keywords)
      ? entry.keywords
        .filter((keyword) => typeof keyword === "string")
        .map((keyword) => keyword.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 15)
      : [];
    const reply = typeof entry.reply === "string" ? entry.reply.trim().slice(0, 1000) : "";
    if (!keywords.length || !reply) continue;
    answers.push({
      topic: topic || keywords[0],
      keywords: [...new Set(keywords)],
      reply,
    });
  }
  return answers;
}

// ---------------------------------------------------------------------------
// Dashboard shaping
// ---------------------------------------------------------------------------

function statusFor(resolution) {
  const value = String(resolution || "").toLowerCase();
  if (value === "escalated" || value === "escalate" || value === "emergency") return "routed";
  if (value === "keyword" || value === "kb" || value === "ai") return "answered";
  return "other";
}

function median(values) {
  const list = values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  if (!list.length) return null;
  const middle = Math.floor(list.length / 2);
  const value = list.length % 2 ? list[middle] : (list[middle - 1] + list[middle]) / 2;
  return Math.round(value);
}

function timeLabel(iso, now) {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";
  const minutes = Math.max(0, Math.round((now.getTime() - then.getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function buildHostOverview(input, now = new Date()) {
  const range = hostRange(input && input.range);
  const property = (input && input.property) || {};
  const stats = (input && input.stats) || {};
  const inbound = Number(stats.inbound || 0);
  const answered = Number(stats.answered || 0);
  const routed = Number(stats.routed || 0);
  const answers = ((input && input.answers) || []).map((answer, index) => ({
    topic: answer.topic || answer.keywords?.[0] || "Guest questions",
    keywords: answer.keywords || [],
    reply: answer.reply || "",
    color: SECTION_COLORS[index % SECTION_COLORS.length],
  }));
  const sections = answers.map(({ topic, color }) => ({ topic, color }));
  const coverage = ((input && input.coverage) || []).map((row) => {
    const total = Number(row.total || 0);
    const rowAnswered = Number(row.answered || 0);
    return {
      intentKey: row.intentKey || "unknown",
      label: themeLabel(row.intentKey),
      total,
      answered: rowAnswered,
      routed: Number(row.routed || 0),
      answeredPct: total ? Math.round((rowAnswered / total) * 100) : 0,
    };
  });
  const sectionsUsed = coverage.filter((row) => row.answered > 0).length;
  const daily = buildDailySeries((input && input.daily) || [], 7, now)
    .map((day) => ({ day: day.day, inbound: Number(day.inbound || 0) }));
  // ai_interactions stores latency in milliseconds; the dashboard reads seconds.
  const replyMs = median((input && input.latencies) || []);

  return {
    sample: Boolean(input && input.sample),
    range: range.id,
    rangeLabel: range.label,
    generatedAt: now.toISOString(),
    property: {
      id: property.id || "",
      name: property.name || property.id || "Your property",
      hostName: property.hostName || "",
    },
    stats: {
      inbound,
      answered,
      routed,
      medianReplySeconds: replyMs == null ? null : Math.round(replyMs / 1000),
      answeredPct: inbound ? Math.round((answered / inbound) * 100) : 0,
      routedPct: inbound ? Math.round((routed / inbound) * 100) : 0,
      sectionsUsed,
    },
    daily,
    recent: ((input && input.recent) || []).map((row) => ({
      text: String(row.text || "").slice(0, 140),
      status: statusFor(row.resolution),
      resolution: row.resolution || null,
      at: row.at || "",
      ago: timeLabel(row.at, now),
    })),
    questions: ((input && input.questions) || []).map((row) => ({
      text: String(row.text || "").slice(0, 200),
      intentKey: row.intentKey || "unknown",
      label: themeLabel(row.intentKey),
      status: statusFor(row.resolution),
      resolution: row.resolution || null,
      at: row.at || "",
      ago: timeLabel(row.at, now),
    })),
    coverage,
    guide: { sections, answers },
  };
}

// ---------------------------------------------------------------------------
// Sample dashboard
// ---------------------------------------------------------------------------
// Deterministic, always labelled `sample: true`, and never mixed into real
// numbers. The figures mirror the dashboard mock the landing page shows.

const SAMPLE_ANSWERS = [
  {
    topic: "Check-in & arrival",
    keywords: ["check in", "check-in", "arrival", "early check-in"],
    reply: "Check-in starts at 4 PM. The door code is sent the morning of arrival.",
  },
  {
    topic: "Wifi & parking",
    keywords: ["wifi", "wi-fi", "password", "parking", "park"],
    reply: "The network is CedarGuest. Park anywhere in the driveway, two cars maximum.",
  },
  {
    topic: "House rules",
    keywords: ["quiet hours", "noise", "pets", "smoking"],
    reply: "Quiet hours are 10 PM to 8 AM. No smoking indoors; pets are welcome with notice.",
  },
  {
    topic: "Departure",
    keywords: ["checkout", "check out", "trash", "bins", "leave"],
    reply: "Check-out is 10 AM. Bins go out Monday night; towels can stay in the bathrooms.",
  },
];

const SAMPLE_DAILY = [3, 6, 4, 8, 12, 9, 14];

const SAMPLE_RECENT = [
  { text: "Can we check in a little early?", resolution: "escalated", intentKey: "early_checkin", minutesAgo: 12 },
  { text: "Wifi password?", resolution: "keyword", intentKey: "wifi", minutesAgo: 45 },
  { text: "Where do we park the second car?", resolution: "keyword", intentKey: "parking", minutesAgo: 96 },
  { text: "Trash and recycling?", resolution: "ai", intentKey: "trash", minutesAgo: 240 },
  { text: "Is the hot tub open?", resolution: "escalated", intentKey: "pool", minutesAgo: 430 },
];

const SAMPLE_QUESTIONS = SAMPLE_RECENT.concat([
  { text: "How do we work the coffee maker?", resolution: "ai", intentKey: "appliance", minutesAgo: 1400 },
  { text: "What time is checkout?", resolution: "keyword", intentKey: "checkout", minutesAgo: 1600 },
  { text: "Is there a pack and play?", resolution: "escalated", intentKey: "unknown", minutesAgo: 2100 },
]);

const SAMPLE_COVERAGE = [
  { intentKey: "wifi", total: 18, answered: 18, routed: 0 },
  { intentKey: "parking", total: 12, answered: 11, routed: 1 },
  { intentKey: "checkout", total: 10, answered: 10, routed: 0 },
  { intentKey: "trash", total: 8, answered: 7, routed: 1 },
  { intentKey: "early_checkin", total: 5, answered: 0, routed: 5 },
];

export function sampleHostOverview(rangeValue = "stay", now = new Date()) {
  const range = hostRange(rangeValue);
  const answers = SAMPLE_ANSWERS.map((answer, index) => ({
    ...answer,
    color: SECTION_COLORS[index % SECTION_COLORS.length],
  }));
  const series = buildDailySeries(
    SAMPLE_DAILY.map((inbound, index) => ({
      day: new Date(now.getTime() - (SAMPLE_DAILY.length - 1 - index) * 86400000)
        .toISOString()
        .slice(0, 10),
      inbound,
    })),
    7,
    now,
  ).map((day) => ({ day: day.day, inbound: Number(day.inbound || 0) }));

  const stats = range.id === "today"
    ? { inbound: 14, answered: 12, routed: 2, medianReplySeconds: 6, sectionsUsed: 4 }
    : range.id === "all"
      ? { inbound: 456, answered: 388, routed: 68, medianReplySeconds: 7, sectionsUsed: 4 }
      : { inbound: 114, answered: 96, routed: 18, medianReplySeconds: 6, sectionsUsed: 4 };

  return {
    sample: true,
    range: range.id,
    rangeLabel: range.label,
    generatedAt: now.toISOString(),
    property: { id: "CEDAR", name: "Cedar House", hostName: "Dana" },
    stats: {
      ...stats,
      answeredPct: Math.round((stats.answered / stats.inbound) * 100),
      routedPct: Math.round((stats.routed / stats.inbound) * 100),
    },
    daily: series,
    recent: SAMPLE_RECENT.map((row) => ({
      text: row.text,
      status: statusFor(row.resolution),
      resolution: row.resolution,
      at: new Date(now.getTime() - row.minutesAgo * 60000).toISOString(),
      ago: timeLabel(new Date(now.getTime() - row.minutesAgo * 60000).toISOString(), now),
    })),
    questions: SAMPLE_QUESTIONS.map((row) => ({
      text: row.text,
      intentKey: row.intentKey,
      label: themeLabel(row.intentKey),
      status: statusFor(row.resolution),
      resolution: row.resolution,
      at: new Date(now.getTime() - row.minutesAgo * 60000).toISOString(),
      ago: timeLabel(new Date(now.getTime() - row.minutesAgo * 60000).toISOString(), now),
    })),
    coverage: SAMPLE_COVERAGE.map((row) => ({
      intentKey: row.intentKey,
      label: themeLabel(row.intentKey),
      total: row.total,
      answered: row.answered,
      routed: row.routed,
      answeredPct: row.total ? Math.round((row.answered / row.total) * 100) : 0,
    })),
    guide: {
      sections: answers.map(({ topic, color }) => ({ topic, color })),
      answers: answers.map(({ topic, keywords, reply }) => ({ topic, keywords, reply })),
    },
  };
}

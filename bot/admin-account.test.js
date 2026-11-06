import test from "node:test";
import assert from "node:assert/strict";
import worker from "./worker.ts";
import {
  ADMIN_SESSION_REMEMBER_TTL_SECONDS,
  adminSessionValid,
  createAdminSession,
} from "./admin-session.js";

class MemoryKV {
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
  async list({ prefix = "", cursor } = {}) {
    const names = [...this.values.keys()].filter((name) => name.startsWith(prefix)).sort();
    const start = cursor ? Number(cursor) : 0;
    const end = Math.min(start + 1000, names.length);
    return {
      keys: names.slice(start, end).map((name) => ({ name })),
      list_complete: end >= names.length,
      cursor: end >= names.length ? undefined : String(end),
    };
  }
}

// The D1 writes on these paths are audit rows; reads return the fixture.
function auditDB(inserts, events = []) {
  return {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() {
              inserts.push({ sql, args });
              return { meta: { changes: 1 } };
            },
            async all() {
              return { results: events };
            },
          };
        },
      };
    },
  };
}

function sessionCookie(response) {
  const cookies = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie") || ""];
  return cookies.find((cookie) => cookie.startsWith("admin_session=")) || "";
}

const OLD_PASSWORD = "old-admin-password";
const NEW_PASSWORD = "new-admin-password";

test("changing the password records an audit row without password material", async () => {
  const inserts = [];
  const env = { PROPERTIES: new MemoryKV(), ADMIN_PASSWORD: OLD_PASSWORD, DB: auditDB(inserts) };

  const response = await worker.fetch(new Request("https://worker.test/admin/api/password", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-admin-password": OLD_PASSWORD },
    body: JSON.stringify({ currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD }),
  }), env);

  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(inserts.length, 1, "exactly one audit row is written");
  assert.match(inserts[0].sql, /INSERT INTO admin_audit_log/);
  assert.equal(inserts[0].args.includes("admin_password_changed"), true);
  assert.equal(inserts[0].args[0], null, "a password change belongs to no property");
  const serialized = JSON.stringify(inserts);
  assert.equal(serialized.includes(OLD_PASSWORD), false);
  assert.equal(serialized.includes(NEW_PASSWORD), false);
});

test("remember-me extends the session while an ordinary sign-in ends with the browser", async () => {
  const env = { PROPERTIES: new MemoryKV(), ADMIN_PASSWORD: OLD_PASSWORD, DB: auditDB([]) };
  const login = (remember) => worker.fetch(new Request("https://worker.test/admin/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-admin-password": OLD_PASSWORD },
    body: JSON.stringify({ remember }),
  }), env);

  const ordinary = await login(false);
  assert.equal(ordinary.status, 200, await ordinary.clone().text());
  const ordinaryCookie = sessionCookie(ordinary);
  assert.match(ordinaryCookie, /admin_session=/);
  assert.equal(ordinaryCookie.includes("Max-Age="), false, "an ordinary session uses a browser-session cookie");

  const remembered = await login(true);
  assert.equal(remembered.status, 200, await remembered.clone().text());
  assert.match(
    sessionCookie(remembered),
    new RegExp(`Max-Age=${ADMIN_SESSION_REMEMBER_TTL_SECONDS}`),
  );
});

test("lists recent admin activity without changed-field details", async () => {
  const kv = new MemoryKV();
  await createAdminSession(kv, "current-session-token", { id: "CURRENT" });
  const events = [
    { createdAt: "2026-11-05 12:00:00", action: "admin_password_changed", propertyId: null, propertyName: null },
    { createdAt: "2026-11-04 11:00:00", action: "property_updated", propertyId: "SUNSET", propertyName: "Sunset Villa" },
  ];
  const env = { PROPERTIES: kv, ADMIN_PASSWORD: OLD_PASSWORD, DB: auditDB([], events) };

  const response = await worker.fetch(new Request("https://worker.test/admin/api/audit", {
    headers: { Cookie: "admin_session=current-session-token" },
  }), env);

  assert.equal(response.status, 200, await response.clone().text());
  const data = await response.json();
  assert.deepEqual(data.events, events);
  assert.equal(data.events.some((event) => "changedFields" in event), false);
});

test("lists signed-in browsers and revokes another one without signing out the caller", async () => {
  const kv = new MemoryKV();
  const env = { PROPERTIES: kv, ADMIN_PASSWORD: OLD_PASSWORD, DB: auditDB([]) };
  await createAdminSession(kv, "current-session-token", {
    id: "CURRENT",
    createdAt: "2026-11-05T12:00:00.000Z",
    ip: "203.0.113.5",
    userAgent: "Chrome on Windows",
  });
  await createAdminSession(kv, "other-session-token", {
    id: "OTHER",
    createdAt: "2026-11-04T12:00:00.000Z",
    ip: "198.51.100.9",
    userAgent: "Safari on macOS",
  });
  const cookies = { Cookie: "admin_session=current-session-token" };
  const call = (path, init = {}) =>
    worker.fetch(new Request("https://worker.test" + path, { ...init, headers: { ...cookies, ...(init.headers || {}) } }), env);

  const list = await call("/admin/api/sessions");
  assert.equal(list.status, 200);
  const data = await list.json();
  assert.deepEqual(
    data.sessions.map((session) => [session.id, session.current, session.ip]),
    [["CURRENT", true, "203.0.113.5"], ["OTHER", false, "198.51.100.9"]],
  );
  assert.equal("key" in data.sessions[0], false, "the stored session key is never returned");

  const revokeOther = await call("/admin/api/sessions?id=OTHER", { method: "DELETE" });
  assert.equal(revokeOther.status, 200, await revokeOther.clone().text());
  assert.equal(await adminSessionValid(kv, "other-session-token"), false);

  const revokeCurrent = await call("/admin/api/sessions?id=CURRENT", { method: "DELETE" });
  assert.equal(revokeCurrent.status, 400);
  assert.equal(await adminSessionValid(kv, "current-session-token"), true, "the caller stays signed in");
});

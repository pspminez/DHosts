// Tests for the admin side of the host portal: the Hosts tab data and the
// operator's ability to sign every host browser out of one property.

import test from "node:test";
import assert from "node:assert/strict";
import worker from "./worker.ts";
import {
  createHostSession,
  getHostSession,
  saveHostPasscode,
} from "./host-portal.js";

class MemoryKV {
  constructor() {
    this.values = new Map();
  }
  async get(key, type) {
    const value = this.values.get(key);
    if (value === undefined) return null;
    if (type === "json") {
      try {
        return JSON.parse(value);
      } catch {
        return null;
      }
    }
    return value;
  }
  async put(key, value) {
    this.values.set(key, value);
  }
  async delete(key) {
    this.values.delete(key);
  }
  async list({ prefix = "" } = {}) {
    const names = [...this.values.keys()].filter((name) => name.startsWith(prefix));
    return { keys: names.map((name) => ({ name })), list_complete: true, cursor: undefined };
  }
}

function hostsDB(rows, inserts = []) {
  return {
    prepare(sql) {
      const statement = {
        async all() {
          return { results: rows };
        },
        async first() {
          return rows[0] || null;
        },
        async run() {
          inserts.push({ sql, args: [] });
          return { meta: { changes: 1 } };
        },
        bind(...args) {
          return {
            async all() {
              return { results: rows };
            },
            async first() {
              return rows[0] || null;
            },
            async run() {
              inserts.push({ sql, args });
              return { meta: { changes: 1 } };
            },
          };
        },
      };
      return statement;
    },
  };
}

const PASSWORD = "host-admin-test-password";
const AUTH = { "x-admin-password": PASSWORD };

test("the admin hosts list reports portal state and guide size without credential material", async () => {
  const kv = new MemoryKV();
  const env = {
    PROPERTIES: kv,
    ADMIN_PASSWORD: PASSWORD,
    DB: hostsDB([
      { id: "SUNSET", name: "Sunset Villa", active: 1, hostId: "host_dana", hostName: "Dana", hostEmail: "dana@example.com" },
      { id: "HARBOR", name: "Harbor House", active: 1, hostId: "host_mo", hostName: "", hostEmail: "" },
    ]),
  };
  await saveHostPasscode(kv, "SUNSET", "porch-light-42");
  await kv.put("prop:SUNSET", JSON.stringify({
    answers: [
      { topic: "Wifi", keywords: ["wifi"], reply: "CedarGuest" },
      { topic: "Parking", keywords: ["park"], reply: "Driveway, two cars." },
    ],
  }));

  const response = await worker.fetch(new Request("https://worker.test/admin/api/hosts", {
    headers: AUTH,
  }), env);

  assert.equal(response.status, 200, await response.clone().text());
  const data = await response.json();
  assert.deepEqual(
    data.hosts.map((host) => ({
      id: host.id,
      configured: host.hostPortal.configured,
      guideSections: host.guideSections,
    })),
    [
      { id: "SUNSET", configured: true, guideSections: 2 },
      { id: "HARBOR", configured: false, guideSections: 0 },
    ],
  );
  assert.equal(JSON.stringify(data).includes("porch-light-42"), false);
  assert.equal(JSON.stringify(data).includes("host:credential"), false);
});

test("the admin hosts list is closed without an admin session", async () => {
  const env = {
    PROPERTIES: new MemoryKV(),
    ADMIN_PASSWORD: PASSWORD,
    DB: hostsDB([]),
  };
  const response = await worker.fetch(new Request("https://worker.test/admin/api/hosts"), env);
  assert.equal(response.status, 401);
});

test("an operator can sign out every host browser for one property", async () => {
  const kv = new MemoryKV();
  const inserts = [];
  const env = {
    PROPERTIES: kv,
    ADMIN_PASSWORD: PASSWORD,
    DB: hostsDB([{ id: "SUNSET" }], inserts),
  };
  await createHostSession(kv, "sunset-one", { propertyId: "SUNSET" }, 3600);
  await createHostSession(kv, "sunset-two", { propertyId: "SUNSET" }, 3600);
  await createHostSession(kv, "harbor-one", { propertyId: "HARBOR" }, 3600);

  const response = await worker.fetch(new Request(
    "https://worker.test/admin/api/host-portal/sessions?propertyId=SUNSET",
    { method: "DELETE", headers: AUTH },
  ), env);

  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(await getHostSession(kv, "sunset-one"), null);
  assert.equal(await getHostSession(kv, "sunset-two"), null);
  assert.equal((await getHostSession(kv, "harbor-one")).propertyId, "HARBOR");
  assert.equal(inserts.some((row) => row.args.includes("host_portal_sessions_revoked")), true);
});

test("saving a host name updates the host row and leaves the passcode alone", async () => {
  const kv = new MemoryKV();
  const inserts = [];
  const env = {
    PROPERTIES: kv,
    ADMIN_PASSWORD: PASSWORD,
    DB: hostsDB([
      {
        id: "SUNSET",
        name: "Sunset Villa",
        address: null,
        twilioNumber: null,
        rateLimitReply: null,
        unknownReply: null,
        stage: "live",
        active: 1,
      },
    ], inserts),
  };
  await saveHostPasscode(kv, "SUNSET", "porch-light-42");
  const credential = await kv.get("host:credential:SUNSET");

  const response = await worker.fetch(new Request("https://worker.test/admin/api/property?id=SUNSET", {
    method: "PUT",
    headers: { ...AUTH, "Content-Type": "application/json" },
    body: JSON.stringify({ hostName: "Dana" }),
  }), env);

  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(
    inserts.some((row) => /UPDATE hosts SET name/.test(row.sql) && row.args[0] === "Dana"),
    true,
  );
  assert.equal(await kv.get("host:credential:SUNSET"), credential);
});

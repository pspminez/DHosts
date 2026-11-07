import test from "node:test";
import assert from "node:assert/strict";
import worker from "./worker.ts";

// The regression: four production properties carried the same Messaging Service
// SID in their number column. Inbound matched on that value, took the first row,
// and would have answered one house's guest with another house's details.
class MemoryKV {
  constructor() {
    this.values = new Map();
  }
  async get(key) {
    return this.values.get(key) ?? null;
  }
  async put(key, value) {
    this.values.set(key, value);
  }
  async delete(key) {
    this.values.delete(key);
  }
}

const SHARED_LINE = "MG0fb969af1db78e37e0c50e306dfe6289";

function makeEnv(properties) {
  const runs = [];
  const db = {
    prepare(sql) {
      return {
        values: [],
        bind(...values) {
          this.values = values;
          return this;
        },
        // Permissive on purpose: the inbound reply path queries hosts, metadata,
        // policies and rules, and none of it should decide this test.
        async first() {
          return null;
        },
        async all() {
          if (/FROM properties WHERE twilio_number = \?1/.test(sql)) {
            return { results: properties.filter((row) => row.twilioNumber === this.values[0]) };
          }
          return { results: [] };
        },
        async run() {
          runs.push({ sql, values: this.values });
          return { meta: { changes: 1 } };
        },
      };
    },
  };
  return { DB: db, PROPERTIES: new MemoryKV(), runs, VALIDATE_SIGNATURE: "false" };
}

function inbound(body, to = SHARED_LINE) {
  return new Request("https://worker.test/sms", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ From: "+18635550142", To: to, Body: body }).toString(),
  });
}

const property = (id, twilioNumber) => ({
  id,
  houseCode: id,
  name: id + " House",
  hostId: "host_" + id,
  twilioNumber,
  rateLimitReply: null,
  unknownReply: null,
});

test("refuses to route a line shared by several properties", async () => {
  const env = makeEnv([property("PALM", SHARED_LINE), property("OAK", SHARED_LINE)]);
  const response = await worker.fetch(inbound("What's the wifi password?"), env);
  const text = await response.text();

  // TwiML is XML, so the apostrophe arrives escaped.
  assert.match(text, /set up yet/);
  assert.equal(
    env.runs.some((run) => /INSERT INTO messages/i.test(run.sql)),
    false,
    "an unrouted message must not be logged against a property",
  );
});

test("refuses a line nobody is onboarded for", async () => {
  const env = makeEnv([property("PALM", SHARED_LINE)]);
  const response = await worker.fetch(inbound("What's the wifi password?", "+18635550999"), env);
  assert.match(await response.text(), /set up yet/);
});

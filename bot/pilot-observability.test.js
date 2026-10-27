import test from "node:test";
import assert from "node:assert/strict";
import worker from "./worker.ts";

class MemoryKV {
  constructor() {
    this.values = new Map();
  }
  async get(key, type) {
    const value = this.values.get(key) ?? null;
    if (type === "json" && typeof value === "string") return JSON.parse(value);
    return value;
  }
  async put(key, value) {
    this.values.set(key, value);
  }
  async delete(key) {
    this.values.delete(key);
  }
}

const scorecard = {
  amountPaid: "49.00",
  incidents: "No incidents; private operator notes stay out of audit rows",
  decision: "expand",
};
const password = "audit-test-password";

function makeD1() {
  const rows = {
    properties: { id: "PILOTOBS", stage: "pilot", active: 1, twilioNumber: "+15550105678", hostId: "host_PILOTOBS" },
    pilot_profiles: {
      property_id: "PILOTOBS",
      lead_id: null,
      client_name: "Test Operator",
      contact_name: null,
      contact_email: null,
      contact_phone: null,
      location: null,
      started_at: "2026-10-26",
      ends_at: "2026-11-25",
      fee_cents: 4900,
      checklist_json: JSON.stringify(Object.fromEntries(Array.from({ length: 7 }, (_, i) => [String(i), true]))),
      scorecard_json: "{}",
      knowledge_json: JSON.stringify({ answers: [{ topic: "Wi-Fi", keywords: ["wifi"], reply: "Use the guest network." }], secrets: [] }),
    },
  };
  const events = [];
  const auditQueries = [];
  const auditEvents = [{ createdAt: "2026-10-26 12:00:00", action: "pilot_scorecard_saved", propertyId: "PILOTOBS", propertyName: "Test Property" }];
  const db = {
    prepare(sql) {
      const statement = {
        values: [],
        bind(...values) { this.values = values; return this; },
        async first() {
          if (/SELECT \* FROM pilot_profiles/.test(sql)) return { ...rows.pilot_profiles };
          if (/SELECT active, stage, twilio_number AS twilioNumber, host_id AS hostId/.test(sql)) return { ...rows.properties };
          if (/SELECT lead_id AS leadId FROM pilot_profiles/.test(sql)) return { leadId: null };
          if (/SELECT id, kv_key AS kvKey FROM property_change_requests/.test(sql)) return null;
          if (/SELECT phone FROM hosts/.test(sql)) return { phone: "+15550101234" };
          if (/SELECT id FROM property_change_requests/.test(sql)) return null;
          throw new Error("Unexpected first query: " + sql);
        },
        async all() {
          if (/SELECT kv_key AS kvKey FROM property_change_requests/.test(sql)) return { results: [] };
          if (/SELECT action, COUNT\(\*\) AS count FROM admin_audit_log/.test(sql)) {
            auditQueries.push(sql);
            return { results: [{ action: "pilot_launched", count: 1 }, { action: "pilot_scorecard_saved", count: 2 }] };
          }
          if (/SELECT a\.created_at AS createdAt, a\.action/.test(sql)) {
            auditQueries.push(sql);
            return { results: auditEvents };
          }
          throw new Error("Unexpected all query: " + sql);
        },
        async run() {
          if (/INSERT INTO admin_audit_log/.test(sql)) {
            events.push({ action: this.values[1], changedFields: JSON.parse(this.values[2]), rawSql: sql, boundValues: this.values });
            return { meta: { changes: 1 } };
          }
          if (/UPDATE properties SET stage = 'pilot', active = 1/.test(sql)) {
            rows.properties.stage = "pilot";
            rows.properties.active = 1;
            return { meta: { changes: 1 } };
          }
          if (/UPDATE properties SET stage = 'live'/.test(sql)) {
            rows.properties.stage = "live";
            return { meta: { changes: 1 } };
          }
          if (/UPDATE pilot_profiles SET/.test(sql)) {
            rows.pilot_profiles.scorecard_json = this.values[9];
            return { meta: { changes: 1 } };
          }
          throw new Error("Unexpected run query: " + sql);
        },
      };
      return statement;
    },
    async batch(statements) {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    },
  };
  return { DB: db, rows, events, auditQueries, auditEvents };
}

async function putScorecard(env) {
  const response = await worker.fetch(new Request("https://worker.test/admin/api/pilot", {
    method: "PUT",
    headers: { "Content-Type": "application/json", "x-admin-password": password },
    body: JSON.stringify({ propertyId: "PILOTOBS", scorecard }),
  }), env);
  return { response, data: await response.json() };
}

test("pilot launch, completion and scorecard audit records omit contents", async () => {
  const { DB, rows, events, auditQueries, auditEvents } = makeD1();
  const PROPERTIES = new MemoryKV();
  await PROPERTIES.put("prop:PILOTOBS", JSON.stringify({
    answers: [{ topic: "Wi-Fi", keywords: ["wifi"], reply: "Use the guest network." }],
    secrets: [],
  }));
  const env = { DB, PROPERTIES, ADMIN_PASSWORD: password };

  const anonymousAudit = await worker.fetch(new Request("https://worker.test/admin/api/pilot-audit"), env);
  assert.equal(anonymousAudit.status, 401);

  const scoreSave = await putScorecard(env);
  assert.equal(scoreSave.response.status, 200, JSON.stringify(scoreSave.data));
  assert.equal(rows.pilot_profiles.scorecard_json, JSON.stringify(scorecard));
  assert.deepEqual(events.map((event) => event.action), ["pilot_scorecard_saved"]);
  assert.deepEqual(events[0].changedFields, ["amountPaid", "decision", "incidents"]);
  assert.equal(events[0].boundValues.some((value) => typeof value === "string" && value.includes(scorecard.incidents)), false);
  assert.equal(JSON.stringify(events).includes(scorecard.incidents), false);

  rows.properties.active = 0;
  rows.pilot_profiles.scorecard_json = "{}";
  const launch = await putScorecard(env);
  assert.equal(launch.response.status, 200, JSON.stringify(launch.data));
  assert.ok(events.some((event) => event.action === "pilot_launched"));
  const complete = await worker.fetch(new Request("https://worker.test/admin/api/pilot", {
    method: "PUT",
    headers: { "Content-Type": "application/json", "x-admin-password": password },
    body: JSON.stringify({ propertyId: "PILOTOBS", stage: "live" }),
  }), env);
  assert.equal(complete.status, 200, await complete.clone().text());
  assert.ok(events.some((event) => event.action === "pilot_completed"));

  const audit = await worker.fetch(new Request("https://worker.test/admin/api/pilot-audit", {
    headers: { "x-admin-password": password },
  }), env);
  assert.equal(audit.status, 200);
  const auditData = await audit.json();
  assert.deepEqual(auditData.summary, { launched: 1, completed: 0, scorecardsSaved: 2 });
  assert.deepEqual(auditData.events, auditEvents);
  assert.equal(JSON.stringify(auditData).includes(scorecard.incidents), false);
  assert.equal(auditQueries.length, 2);
  assert.equal(auditQueries.some((sql) => /changed_fields_json|scorecard_json/.test(sql)), false);
});

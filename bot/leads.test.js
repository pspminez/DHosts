import test from "node:test";
import assert from "node:assert/strict";
import { LEADS } from "./leads.js";

test("every lead carries the fields the admin panel renders", () => {
  assert.ok(LEADS.length > 0);
  for (const lead of LEADS) {
    assert.ok(lead.id && typeof lead.id === "string", `missing id for ${lead.name}`);
    assert.ok(lead.name, `missing name for ${lead.id}`);
    assert.ok(lead.location, `missing location for ${lead.id}`);
    assert.match(lead.phone, /\d/, `missing phone for ${lead.id}`);
    assert.match(lead.website, /^https:\/\//, `website must be https for ${lead.id}`);
    assert.ok(Array.isArray(lead.sources) && lead.sources.length > 0, `missing sources for ${lead.id}`);
    assert.ok(["A", "B", "C"].includes(lead.fit), `invalid fit for ${lead.id}`);
    assert.ok(lead.pitchEmail.subject, `missing pitch subject for ${lead.id}`);
    assert.ok(lead.pitchEmail.body, `missing pitch body for ${lead.id}`);
    assert.ok(lead.pitchPhone, `missing phone script for ${lead.id}`);
    assert.ok(lead.followUpEmail.subject && lead.followUpEmail.body, `missing follow-up email for ${lead.id}`);
  }
});

test("lead ids are unique", () => {
  const ids = LEADS.map((lead) => lead.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("no fabricated contact data is present", () => {
  // Reject the North American fictional-number pattern (area code + 555 exchange,
  // or a 555 area code). A real number may still contain the digits 555.
  const fictionalPhone = /(?:\b555[-.\s)]?\d{3}[-.\s]?\d{4}\b|\d{3}[^0-9]?555[^0-9]\d{4})/;
  for (const lead of LEADS) {
    assert.doesNotMatch(lead.phone, fictionalPhone, `placeholder phone number for ${lead.id}`);
    assert.doesNotMatch(lead.email, /example|\.pm$|\.test$/i, `suspicious email for ${lead.id}`);
  }
});

test("a verified email always carries a public source and a check date", () => {
  for (const lead of LEADS) {
    if (lead.email) {
      assert.match(lead.email, /^[^\s@]+@[^\s@]+\.[^\s@]+$/, `invalid email for ${lead.id}`);
      assert.match(lead.emailSource, /^https:\/\//, `email without a public source for ${lead.id}`);
      assert.match(lead.emailCheckedAt, /^\d{4}-\d{2}-\d{2}$/, `email without a check date for ${lead.id}`);
    } else {
      assert.equal(lead.emailSource, "", `unverified lead ${lead.id} should not have an email source`);
      assert.equal(lead.emailCheckedAt, "", `unverified lead ${lead.id} should not have a check date`);
    }
  }
});

test("pitch emails use only the allowed sender placeholders", () => {
  const allowed = new Set(["[Your Name]", "[Your callback number]", "[Name]"]);
  for (const lead of LEADS) {
    const text = lead.pitchEmail.subject + "\n" + lead.pitchEmail.body;
    assert.ok(text.includes(lead.name), `pitch does not name ${lead.id}`);
    for (const match of text.matchAll(/\[[^\]]+\]/g)) {
      assert.ok(allowed.has(match[0]), `unexpected placeholder ${match[0]} in ${lead.id}`);
    }
  }
});

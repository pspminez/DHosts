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
    assert.match(lead.pitchSource, /^https:\/\//, `missing pitch source for ${lead.id}`);
    assert.ok(lead.sources.includes(lead.pitchSource), `pitch source must be in public sources for ${lead.id}`);
    assert.match(lead.pitchCheckedAt, /^\d{4}-\d{2}-\d{2}$/, `missing pitch check date for ${lead.id}`);
    assert.ok(["High", "Medium"].includes(lead.confidence), `invalid confidence for ${lead.id}`);
    assert.ok(lead.pitchPhone, `missing phone script for ${lead.id}`);
    assert.ok(lead.followUpEmail.subject && lead.followUpEmail.body, `missing follow-up email for ${lead.id}`);
  }
});

test("lead ids are unique and every email has a tailored pitch", () => {
  const ids = LEADS.map((lead) => lead.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const lead of LEADS) {
    assert.match(lead.pitchEmail.body, new RegExp(lead.name.split(" ")[0], "i"), `pitch does not refer to ${lead.name}`);
    assert.match(lead.pitchEmail.body, /not assum|not propos|not calling to suggest/i, `pitch should not invent a need for ${lead.id}`);
    assert.doesNotMatch(lead.pitchEmail.body, /after.hours gap|your guests frequently|your team struggles/i);
  }
});

test("no fabricated contact data is present", () => {
  // Reject the North American fictional-number pattern (area code + 555 exchange,
  // or a 555 area code). A real number may still contain the digits 555.
  const fictionalPhone = /(?:\b555[-.\s)]?\d{3}[-.\s]?\d{4}\b|\d{3}[^0-9]?555[^0-9]\d{4})/;
  for (const lead of LEADS) {
    assert.doesNotMatch(lead.phone, fictionalPhone, `placeholder phone number for ${lead.id}`);
    assert.doesNotMatch(lead.email, /example|\.pm$|\.test$/i, `suspicious email for ${lead.id}`);
    assert.ok(lead.sources.every((source) => /^https:\/\//.test(source)), `invalid source URL for ${lead.id}`);
    assert.equal(new URL(lead.website).protocol, "https:", `website must use HTTPS for ${lead.id}`);
  }
  assert.equal(LEADS.find((lead) => lead.id === "an-owners-dream-management")?.email, "", "do not use the guest-facing reservation inbox for outreach");
  assert.equal(LEADS.find((lead) => lead.id === "an-owners-dream-management")?.confidence, "Medium");
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

test("property knowledge templates and reference scripts contain no sample credentials or claims of live features", async () => {
  const { readFile } = await import("node:fs/promises");
  const template = JSON.parse(await readFile(new URL("./knowledge/template.json", import.meta.url), "utf8"));
  const emailScripts = JSON.parse(await readFile(new URL("./knowledge/email-scripts.json", import.meta.url), "utf8"));
  const phoneScripts = JSON.parse(await readFile(new URL("./knowledge/phone-scripts.json", import.meta.url), "utf8"));
  assert.equal(template.status, "TEMPLATE_ONLY_NOT_FOR_LIVE_USE");
  assert.deepEqual(template.secrets, []);
  assert.deepEqual(template.answers, [], "unconfirmed sample answers must not be importable as active property knowledge");
  assert.ok(template.answerExamples.every((answer) => /\[[A-Z0-9_]+\]/.test(answer.reply)), "example answers must contain a host-confirmed placeholder");
  assert.equal(emailScripts.status, "reference_only_not_sent_by_stayxi");
  assert.equal(phoneScripts.status, "reference_only_not_live");
  const sampleText = JSON.stringify({ emailScripts, phoneScripts });
  assert.doesNotMatch(sampleText, /4821|9911|SUNSHINE2026|KIDS-SWIMMING/i);
  assert.match(emailScripts.reviewBeforeUse, /does not currently send guest emails/i);
  assert.match(phoneScripts.reviewBeforeUse, /does not provide phone answering/i);
});

test("pitch emails use only the allowed sender placeholders", () => {
  const allowed = new Set(["[Your Name]", "[Your callback number]"]);
  for (const lead of LEADS) {
    const text = lead.pitchEmail.subject + "\n" + lead.pitchEmail.body;
    for (const match of text.matchAll(/\[[^\]]+\]/g)) {
      assert.ok(allowed.has(match[0]), `unexpected placeholder ${match[0]} in ${lead.id}`);
    }
    if (!lead.email) assert.match(lead.pitchEmail.body, /contact-form draft/i, `no-email pitch should be labeled as form-only for ${lead.id}`);
    assert.match(lead.followUpEmail.body, /Following up once|Following up once on/i);
  }
});

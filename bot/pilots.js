// Pilot properties — the pure parts.
//
// A pilot is a row in `properties` with stage 'draft' or 'pilot'. It has to be a
// real property because the bot answers guests by resolving a property from the
// Twilio number, and a pilot nobody can text cannot be measured. This module holds
// the parts that need no database or network, so the rules can be tested directly:
// the house code we mint, the shape of a client's questions and answers, and the
// arithmetic behind "measure the pilot".

export const PILOT_STAGES = ["draft", "pilot", "live"];

const MAX_ANSWERS = 200;
const MAX_SECRETS = 100;
const MAX_TOPIC = 80;
const MAX_KEYWORDS = 10;
const MAX_KEYWORD = 40;
const MAX_REPLY = 2000;

function text(value, limit) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function keywordList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((keyword) => text(keyword, MAX_KEYWORD))
    .filter(Boolean)
    .slice(0, MAX_KEYWORDS);
}

// Answers and secrets in the shape the property knowledge uses, so converting a
// pilot is a copy rather than a translation. Rows with no reply are dropped: an
// empty answer is worse than no answer, because it looks configured.
export function normaliseKnowledge(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const answers = (Array.isArray(source.answers) ? source.answers : [])
    .map((answer) => ({
      topic: text(answer?.topic, MAX_TOPIC),
      keywords: keywordList(answer?.keywords),
      reply: text(answer?.reply, MAX_REPLY),
    }))
    .filter((answer) => answer.reply)
    .slice(0, MAX_ANSWERS);
  const secrets = (Array.isArray(source.secrets) ? source.secrets : [])
    .map((secret) => ({
      keywords: keywordList(secret?.keywords),
      reply: text(secret?.reply, MAX_REPLY),
    }))
    .filter((secret) => secret.reply && secret.keywords.length > 0)
    .slice(0, MAX_SECRETS);
  return { answers, secrets };
}

export function knowledgeCount(knowledge) {
  const { answers, secrets } = normaliseKnowledge(knowledge);
  return { answers: answers.length, secrets: secrets.length };
}

// A PILOT code is the property id the operator will live with, so derive it from
// the property name and keep the same alphabet the rest of the panel validates.
export function pilotCode(name, taken = []) {
  const base = String(name || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 20);
  const safe = base.length >= 2 ? base : "PILOT";
  if (!taken.includes(safe)) return safe;
  for (let suffix = 2; suffix < 100; suffix++) {
    const candidate = (safe.slice(0, 20 - String(suffix).length - 1) + "-" + suffix).replace(/-+$/, "");
    if (!taken.includes(candidate)) return candidate;
  }
  throw new Error("No free pilot code for " + name);
}

// What a recurring guest question suggests we should quote separately. These are
// candidates to discuss with the operator, not features we claim to have: the
// pilot includes answers, not locks, PMS links or payment flows.
const ADD_ON_BY_INTENT = {
  gate: "Gate and entry questions repeat — a keypad or smart-lock integration is the obvious next step, quoted separately.",
  door: "Entry questions repeat — a keypad or smart-lock integration is the obvious next step, quoted separately.",
  lock: "Lock-out questions repeat — a keypad or smart-lock integration is the obvious next step, quoted separately.",
  wifi: "Wi-Fi questions repeat — a printed or pre-arrival Wi-Fi card would remove most of them.",
  checkout: "Checkout questions repeat — an automated checkout reminder is worth quoting once the pilot proves out.",
  checkin: "Check-in questions repeat — an automated pre-arrival message is worth quoting once the pilot proves out.",
  trash: "Bin-day questions repeat — a scheduled reminder would remove them.",
  pool: "Pool and heater questions repeat — a short amenity guide is the cheap fix; automation is not needed.",
  parking: "Parking questions repeat — a parking guide in the pre-arrival message would cover it.",
  late_checkout: "Late-checkout requests repeat — a paid request flow is worth quoting separately.",
  pets: "Pet questions repeat — a policy answer is already included; charging for pets is a separate product.",
};

export function addOnCandidates(topIntents = [], limit = 4) {
  const seen = new Set();
  const candidates = [];
  for (const row of topIntents) {
    const intent = String(row?.intent || "").toLowerCase();
    if (!intent || intent === "unrouted") continue;
    const suggestion = ADD_ON_BY_INTENT[intent];
    if (!suggestion || seen.has(suggestion)) continue;
    seen.add(suggestion);
    candidates.push({ intent, count: Number(row?.count) || 0, suggestion });
    if (candidates.length >= limit) break;
  }
  return candidates;
}

function rate(part, whole) {
  if (!whole) return null;
  return Math.round((part / whole) * 1000) / 10;
}

// The pilot's own numbers, in the shape the panel displays them. Rates are null
// rather than 0 when there were no guests, so an empty pilot does not look like a
// failing one.
export function measurePilot({
  guestMessages = 0,
  answered = 0,
  escalated = 0,
  unrouted = 0,
  openEscalations = 0,
  avgHostReplyMinutes = null,
  topIntents = [],
} = {}) {
  return {
    guestMessages,
    answered,
    escalated,
    unrouted,
    openEscalations,
    avgHostReplyMinutes,
    answeredRate: rate(answered, guestMessages),
    escalatedRate: rate(escalated, guestMessages),
    unroutedRate: rate(unrouted, guestMessages),
    addOns: addOnCandidates(topIntents),
  };
}

export function canLaunchPilot({
  checklist,
  startedAt,
  endsAt,
  now = Date.now(),
  knowledge,
  approvedKnowledge,
  hasPendingChanges = false,
  hasTextLine = false,
  hasHostContact = false,
} = {}) {
  const checks = checklist && typeof checklist === "object" && !Array.isArray(checklist)
    ? checklist
    : {};
  if (Object.keys(checks).length !== 7 || Array.from({ length: 7 }, (_, index) => String(index)).some((key) => checks[key] !== true)) {
    return false;
  }
  const validDate = (value) => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(value + "T00:00:00Z");
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  };
  if (!validDate(startedAt) || !validDate(endsAt)) return false;
  const today = new Date(now).toISOString().slice(0, 10);
  if (startedAt > today || endsAt < today || endsAt < startedAt) return false;
  if (hasPendingChanges || !hasTextLine || !hasHostContact) return false;

  const proposed = normaliseKnowledge(knowledge);
  const approved = normaliseKnowledge(approvedKnowledge);
  if (!proposed.answers.length && !proposed.secrets.length) return false;
  const proposedCritical = proposed.answers.filter((answer) => /\b(?:access|code|credential|door|emergency|evacuat|fire|gas|gate|lock|medical|safety|security|check[\s-]?(?:in|out)|911)\b/i
    .test(`${answer.topic} ${answer.keywords.join(" ")} ${answer.reply}`));
  const approvedCritical = approved.answers.filter((answer) => /\b(?:access|code|credential|door|emergency|evacuat|fire|gas|gate|lock|medical|safety|security|check[\s-]?(?:in|out)|911)\b/i
    .test(`${answer.topic} ${answer.keywords.join(" ")} ${answer.reply}`));
  return JSON.stringify(proposedCritical) === JSON.stringify(approvedCritical) &&
    JSON.stringify(proposed.secrets) === JSON.stringify(approved.secrets);
}

function normalise(value) {
  return ` ${String(value).toLowerCase().normalize("NFKD").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim()} `;
}

function containsAny(text, keywords) {
  return (keywords || []).some((keyword) => {
    const normalizedKeyword = normalise(keyword).trim();
    return normalizedKeyword && text.includes(` ${normalizedKeyword} `);
  });
}

export function matchKnownAnswer(body, property) {
  const text = normalise(body);

  for (const secret of property.secrets || []) {
    if (containsAny(text, secret.keywords)) {
      return { text: secret.reply, secret: true, topic: secret.topic || "secret" };
    }
  }
  for (const answer of property.answers || []) {
    if (containsAny(text, answer.keywords)) {
      return { text: answer.reply, secret: false, topic: answer.topic || "answer" };
    }
  }
  return null;
}

const EMERGENCY_PATTERNS = [
  { intentKey: "gas_fire_or_carbon_monoxide", pattern: /\b(?:gas (?:smell(?:s|ing)?|leak)|smell(?:ing)? gas|carbon monoxide|co alarm|fire|smoke in the (?:house|home|room)|burning smell)\b/ },
  { intentKey: "medical_emergency", pattern: /\b(?:medical (?:emergency|issue|problem|help)|ambulance|can't breathe|cannot breathe|not breathing|unconscious|severe bleeding|heart attack|stroke|serious injury)\b/ },
  { intentKey: "lockout", pattern: /\b(?:locked out|lockout|can't get in|cannot get in|can't enter|lost (?:the )?(?:key|keys)|key(?:s)? (?:lost|missing))\b/ },
  { intentKey: "water_leak_or_flood", pattern: /\b(?:water leak|leaking water|pipe (?:burst|broke)|burst pipe|flood(?:ing)?|water (?:is )?(?:pouring|coming) in)\b/ },
];

const HIGH_RISK_PATTERNS = [
  { intentKey: "legal_or_law_enforcement", pattern: /\b(?:lawyer|attorney|lawsuit|sue|legal advice|police report|law enforcement)\b/ },
  { intentKey: "refund_or_billing_dispute", pattern: /\b(?:refund|charge(?:d)? back|overcharg(?:e|ed)|billing dispute|compensation|money back)\b/ },
  { intentKey: "property_damage", pattern: /\b(?:damage(?:d)?|broke|broken|destroyed|stolen|theft|missing item)\b/ },
  { intentKey: "safety_or_security_concern", pattern: /\b(?:unsafe|not safe|security issue|intruder|threaten(?:ed)?|harass(?:ed|ment)?|injur(?:y|ed))\b/ },
];

const PROPERTY_TERMS = /\b(?:property|rental|villa|house|home|room|bedroom|bathroom|kitchen|amenit(?:y|ies)|guest|stay|reservation|booking|check[\s-]?(?:in|out)|arrival|departure|checkout|wifi|wi fi|internet|password|gate|door|key|lock|parking|pool|hot tub|heater|thermostat|air conditioning|a ?c|trash|garbage|pet|quiet hours|laundry|washer|dryer|dishwasher|towel|linen|tv|television|host|house rules|appliance|coffee|grill|maintenance|broken|not working|where is|how do i|can i|do you have|is there)\b/;

export function planGuestMessage(body, property) {
  const normalized = normalise(body).trim();
  if (!normalized) return { action: "clarify", risk: "low", intentKey: "empty_message" };

  for (const item of EMERGENCY_PATTERNS) {
    if (item.pattern.test(normalized)) {
      return { action: "emergency", risk: "emergency", intentKey: item.intentKey };
    }
  }
  for (const item of HIGH_RISK_PATTERNS) {
    if (item.pattern.test(normalized)) {
      return { action: "escalate", risk: "high", intentKey: item.intentKey };
    }
  }
  if (String(body).length > 500) return { action: "clarify", risk: "low", intentKey: "message_too_long" };

  const known = matchKnownAnswer(body, property);
  const propertyQuestion = known || PROPERTY_TERMS.test(normalized);
  if (!propertyQuestion) {
    return { action: "off_topic", risk: "low", intentKey: "not_property_related" };
  }
  if (normalized.split(/\s+/).length < 2 && !known) {
    return { action: "clarify", risk: "low", intentKey: "unclear_message" };
  }
  if (known) {
    return {
      action: "answer",
      risk: "low",
      intentKey: `faq_${String(known.topic || "answer").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`,
      answer: known,
    };
  }
  return { action: "ai", risk: "low", intentKey: "unmatched_property_question" };
}

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "but", "by", "can", "could",
  "do", "does", "for", "from", "had", "has", "have", "he", "her", "here", "hers",
  "him", "his", "i", "if", "in", "is", "it", "its", "me", "my", "no", "not", "of",
  "on", "or", "our", "please", "she", "so", "that", "the", "their", "them", "there",
  "they", "this", "to", "us", "was", "we", "were", "what", "when", "where", "which",
  "who", "will", "with", "would", "you", "your", "am", "pm",
]);

function tokens(value) {
  return String(value).toLowerCase().normalize("NFKD").match(/[a-z0-9]+/g) || [];
}

export function validateGroundedAnswer(answer, sourceData) {
  const text = String(answer || "").trim();
  if (!text || text.length > 300) {
    return { valid: false, unsupported: [] };
  }

  const sourceTokens = new Set(tokens(sourceData));
  const unsupported = [...new Set(tokens(text).filter((token) =>
    !STOP_WORDS.has(token) && !sourceTokens.has(token)
  ))];
  return { valid: unsupported.length === 0, unsupported };
}

export function redactForAudit(text, propertySecretValues = []) {
  let redacted = String(text);
  for (const secret of propertySecretValues) {
    if (!secret) continue;
    const escaped = String(secret).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    redacted = redacted.replace(new RegExp(escaped, "gi"), "[redacted]");
  }
  return redacted
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
    .replace(/\b(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}\b/g, "[phone]")
    .replace(/\b(?:code|password|passcode|pin|combination)\s*(?:is|:|=)?\s*[A-Z0-9-]{3,}\b/gi, "[credential]")
    .replace(/\b\d{3,}\b/g, "[number]");
}

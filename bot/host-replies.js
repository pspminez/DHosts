export function parseHostReply(body) {
  if (typeof body !== "string") return null;
  const match = /^#([1-9]\d{0,14})\s+([\s\S]{1,1200})$/.exec(body.trim());
  if (!match) return null;
  const id = Number(match[1]);
  const message = match[2].trim();
  if (!Number.isSafeInteger(id) || !message || message.length > 1200) return null;
  return { id, message };
}

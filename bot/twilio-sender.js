/**
 * Twilio accepts a `From` sender or a `MessagingServiceSid`, never both.
 *
 * A property's own number is the precise route, so it wins. The Messaging
 * Service is the shared sender pool for properties that have no line of their
 * own. Anything else is not something Twilio will send from: a service SID
 * pasted into a property's number field used to go out as `From`, and every
 * such send failed.
 *
 * Returns null when there is no usable sender, so the caller can skip the send
 * and say so instead of paying for a request Twilio will reject.
 */
export function buildTwilioSendParams(to, body, from, messagingServiceSid) {
  const recipient = String(to || "").trim();
  if (!recipient) return null;

  const params = new URLSearchParams({ To: recipient, Body: String(body ?? "") });
  const sender = String(from || "").trim();
  if (/^\+[1-9]\d{6,14}$/.test(sender)) {
    params.set("From", sender);
    return params;
  }

  // Only a real service SID is usable; a truncated or wrong secret would
  // otherwise reach Twilio as a malformed sender.
  const service = String(messagingServiceSid || "").trim();
  if (/^MG[0-9a-fA-F]{32}$/.test(service)) {
    params.set("MessagingServiceSid", service);
    return params;
  }

  return null;
}

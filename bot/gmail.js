const encoder = new TextEncoder();

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function base64Url(bytes) {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function wrappedBase64(value) {
  return value.match(/.{1,76}/g)?.join("\r\n") || "";
}

export function makeGmailRawMessage({ from, to, subject, body, unsubscribeUrl }) {
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(from) ||
      !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(to)) {
    throw new Error("A valid sender and recipient email are required.");
  }
  if (!subject.trim() || subject.length > 200 || /[\r\n]/.test(subject)) {
    throw new Error("Subject is invalid.");
  }
  if (!body.trim() || body.length > 12000 || /[\u0000]/.test(body)) {
    throw new Error("Email body is invalid.");
  }
  const unsubscribe = new URL(unsubscribeUrl);
  if (unsubscribe.protocol !== "https:") {
    throw new Error("Unsubscribe URL must use HTTPS.");
  }

  const encodedSubject = `=?UTF-8?B?${bytesToBase64(encoder.encode(subject))}?=`;
  const mime = [
    `From: StayXI <${from}>`,
    `To: ${to}`,
    `Subject: ${encodedSubject}`,
    `List-Unsubscribe: <${unsubscribe.href}>`,
    "List-Unsubscribe-Post: List-Unsubscribe=One-Click",
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrappedBase64(bytesToBase64(encoder.encode(body))),
  ].join("\r\n");
  return base64Url(encoder.encode(mime));
}

function getEncryptionKey(encodedKey) {
  let keyBytes;
  try {
    keyBytes = base64ToBytes(encodedKey);
  } catch {
    throw new Error("GMAIL_TOKEN_ENCRYPTION_KEY must be base64-encoded 32-byte key material.");
  }
  if (keyBytes.length !== 32) {
    throw new Error("GMAIL_TOKEN_ENCRYPTION_KEY must be base64-encoded 32-byte key material.");
  }
  return crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptRefreshToken(refreshToken, encodedKey) {
  const key = await getEncryptionKey(encodedKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await key,
    encoder.encode(refreshToken),
  );
  return JSON.stringify({
    version: 1,
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  });
}

export async function decryptRefreshToken(encrypted, encodedKey) {
  const record = JSON.parse(encrypted);
  if (!record || record.version !== 1 || typeof record.iv !== "string" || typeof record.ciphertext !== "string") {
    throw new Error("Stored Gmail credentials have an unsupported format.");
  }
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(record.iv) },
    await getEncryptionKey(encodedKey),
    base64ToBytes(record.ciphertext),
  );
  return new TextDecoder().decode(plaintext);
}

export function makeUnsubscribeToken() {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function hashOutreachValue(value) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value.trim().toLowerCase()));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hashUnsubscribeToken(token) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

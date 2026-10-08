/**
 * Davenport Host Co. — guest text line
 *
 * A Cloudflare Worker that sits between a guest's SMS and the host.
 * A guest texts the number printed on the fridge card for their house.
 * They get the answer in seconds. The host gets their evening back.
 *
 * Route map:
 *   POST /sms                  Twilio inbound-message webhook
 *   GET  /admin                password-protected editor for a property's answers
 *   GET  /admin/api/properties list properties
 *   GET  /admin/api/property   read one property   (?id=...)
 *   PUT  /admin/api/property   save one property   (?id=...)
 *
 * Secrets policy — read before editing:
 *   Gate/door codes live in `property.secrets` and are resolved HERE, locally,
 *   on an exact keyword match. They are never sent to the Claude API and never
 *   written to logs. `redactForModel()` strips them before any AI call.
 *   Do not "simplify" this away. See docs/data-policy.md.
 */

import { z } from "zod";

interface Env {
  OPENROUTER_API_KEY: string;
  TWILIO_ACCOUNT_SID: string;
  TWILIO_AUTH_TOKEN: string;
  ADMIN_PASSWORD: string;
  PUBLIC_URL?: string;
  VALIDATE_SIGNATURE?: string;
  PROPERTIES: KVNamespace;
  DB: D1Database;
}

interface Property {
  id: string;
  name: string;
  hostId: string;
  twilioNumber: string;
  hostPhone?: string;
  secrets?: { keywords: string[]; reply: string }[];
  answers?: { topic: string; keywords: string[]; reply: string }[];
  rateLimitReply?: string;
  unknownReply?: string;
}

interface LogEntry {
  from?: string;
  body?: string;
  reply?: string;
  via: "kb" | "ai" | "escalate" | "error";
  direction?: "in" | "out";
  body_redacted?: string;
  intent_key?: string;
  risk?: string;
  ai_model?: string;
  tokens_in?: number;
  tokens_out?: number;
  cost_estimate?: number;
}

const MODEL = "anthropic/claude-haiku-4.5"; // Using Haiku 4.5 for OpenRouter

// The AI must return a decision, not free prose. `escalate: true` means
// "I don't know" — which is always an acceptable answer, and always better
// than inventing a gate code.
const GuestReply = z.object({
  answer: z.string().describe("Reply to text back to the guest. Empty if escalating."),
  escalate: z.boolean().describe("True if the answer is not supported by the property info."),
});

export default {
  async fetch(request, env: Env) {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/sms") {
      return handleInbound(request, env);
    }
    if (request.method === "POST" && url.pathname === "/api/leads") {
      return handleLeadCapture(request, env);
    }
    if ((request.method === "POST" || request.method === "OPTIONS") && url.pathname === "/api/chat") {
      return handleDemoChat(request, env);
    }
    if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) {
      return handleAdmin(request, env, url);
    }
    return new Response("Davenport Host Co. text line is running.", { status: 200 });
  },
};

/* ------------------------------------------------------------------ *
 * Inbound guest text
 * ------------------------------------------------------------------ */

async function handleInbound(request, env) {
  const form = await request.formData();

  // Twilio sends the request from its own servers. Without this check,
  // anyone who finds the URL can make the bot text anyone.
  const valid = await verifyTwilioSignature(request, form, env);
  if (!valid) return twimlError("Invalid signature.");

  const from = String(form.get("From") || "");
  const to = String(form.get("To") || "");
  const messagingServiceSid = String(form.get("MessagingServiceSid") || "");
  const body = String(form.get("Body") || "").trim();

  if (!from || !to) return twimlError("Missing sender or recipient.");

  // Opt-out compliance (CTIA): STOP silences this guest, START resumes, HELP answers.
  // An opted-out guest gets complete silence — before property lookup, rate limits, or AI.
  const optKey = `optout:${from}`;
  let optedOut = false;
  try { optedOut = (await env.PROPERTIES.get(optKey)) === "true"; } catch { /* KV hiccup: treat as not opted out */ }
  const upper = body.toUpperCase();
  if (["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END"].includes(upper)) {
    try { await env.PROPERTIES.put(optKey, "true"); } catch { /* still confirm below */ }
    return twiml("You've been unsubscribed and will receive no further messages. Reply START to resubscribe.");
  }
  if (optedOut && ["START", "UNSTOP", "YES"].includes(upper)) {
    try { await env.PROPERTIES.delete(optKey); } catch { /* ignore */ }
    return twiml("Welcome back! Your guest text line is active again.");
  }
  if (optedOut) return new Response(null, { status: 200 });
  if (upper === "HELP" || upper === "INFO") {
    return twiml("Davenport Host Co. guest text line — text your question any time (gate code, WiFi, checkout, pool). Reply STOP to opt out.");
  }

  // Try lookup by MessagingServiceSid first (what Twilio actually sends when using Messaging Service)
  let property = null;
  if (messagingServiceSid) {
    property = await loadProperty(env, messagingServiceSid);
  }
  // Fallback to "To" field
  if (!property) {
    property = await loadProperty(env, to);
  }
  if (!property) {
    // A number nobody has been onboarded for. Don't guess; tell them to call.
    return twiml("This number isn't set up yet. Please contact your host directly.");
  }

  // Chatty guests are fine; abusive ones shouldn't cost money. Over the limit
  // we stop replying automatically and hand straight to the host.
  const overLimit = await bumpRateLimit(env, from);
  if (overLimit) {
    await escalate(env, property, from, body, "rate limit");
    return twiml(property.rateLimitReply || "Let me get the host to help you with this.");
  }

  const match = matchCanned(body, property);

  // 1. Exact keyword hit. This is the common case and it's instant + free.
  if (match) {
    await log(env, property, { from, body, reply: match.text, via: "kb" });
    return twiml(match.text);
  }

  // 2. Not a canned answer. Ask Claude, using the property's facts MINUS secrets.
  const ai = await askClaude(env, property, body);

  if (!ai || ai.escalate) {
    await escalate(env, property, from, body, ai ? "model unsure" : "model unavailable");
    await log(env, property, { from, body, reply: null, via: ai ? "escalate" : "error" });
    return twiml(property.unknownReply || "Good question — let me check with your host and get right back to you.");
  }

  await log(env, property, { from, body, reply: ai.answer, via: "ai" });
  return twiml(ai.answer);
}

/* ------------------------------------------------------------------ *
 * Answering
 * ------------------------------------------------------------------ */

/**
 * Look for a canned answer. Secrets are checked first and separately so that
 * a code is only ever released on a deliberate request for that code.
 */
function matchCanned(body, property) {
  const text = normalise(body);

  for (const secret of property.secrets || []) {
    if (containsAny(text, secret.keywords)) {
      return { text: secret.reply, secret: true };
    }
  }

  for (const entry of property.answers || []) {
    if (containsAny(text, entry.keywords)) {
      return { text: entry.reply, secret: false };
    }
  }

  return null;
}

function normalise(s) {
  return ` ${String(s).toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim()} `;
}

/** Word-boundary match, so "gate" doesn't fire on "investigate". */
function containsAny(text, keywords) {
  return (keywords || []).some((k) => text.includes(` ${normalise(k).trim()} `));
}

/**
 * Ask Claude to answer from this property's facts only.
 * `redactForModel` must run first — the model never sees a gate code.
 */
async function askClaude(env, property, guestText) {
  if (!env.OPENROUTER_API_KEY) return null;

  const facts = redactForModel(property);
  const system = [
    `You are the guest text line for "${property.name}", a vacation rental in Davenport, Florida.`,
    `A guest has texted a question. Answer it in under 300 characters, warm and plain — no emoji, no markdown.`,
    ``,
    `RULES:`,
    `- Use ONLY the property information below. It is the complete set of facts you have.`,
    `- If the information does not answer the question, set escalate to true and leave answer empty.`,
    `- Never invent a code, password, time, or rule. Never guess.`,
    `- Never mention that you are an AI. If asked, say the host will follow up.`,
    `- Escalating is always correct when you are unsure. A wrong answer is much worse than a slow one.`,
    ``,
    `PROPERTY INFORMATION:`,
    JSON.stringify(facts, null, 2),
  ].join("\n");

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: guestText }
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("OpenRouter API error:", response.status, errorText);
      return null;
    }

    const data = await response.json();
    const aiResponseContent = data.choices[0].message.content;

    let parsedOutput;
    try {
      parsedOutput = JSON.parse(aiResponseContent);
      GuestReply.parse(parsedOutput); // Validate with Zod
    } catch (e) {
      console.error("Error parsing or validating AI response:", e);
      return { escalate: true, answer: "" }; // Treat parsing/validation errors as escalation
    }

    return parsedOutput;
  } catch (err) {
    console.error("OpenRouter call failed:", err?.message || err);
    return null;
  }
}

/**
 * Demo chat endpoint for landing page.
 * Uses AI with a system prompt that allows friendly chat but steers back to rental tasks.
 */
async function handleDemoChat(request, env) {
  // CORS headers for cross-origin requests from Pages
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Content-Type": "application/json"
  };

  // Handle preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Rate limiting: 5 messages per IP per day
  const clientIp = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown";
  const rateLimitKey = `demo_chat_rate:${clientIp}`;
  const MAX_MESSAGES = 5;

  let currentCount = 0;
  try {
    currentCount = Number((await env.PROPERTIES.get(rateLimitKey)) || 0);
  } catch {
    currentCount = 0;
  }

  if (currentCount >= MAX_MESSAGES) {
    return new Response(JSON.stringify({
      error: "Demo limit reached",
      reply: "You've tried the demo! 🎉 To unlock unlimited access and get your own property text line, check out our packages below.",
      showPackage: true
    }), { headers: corsHeaders });
  }

  let messages;
  try {
    const body = await request.json();
    messages = body.messages;
    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: "Invalid request" }), { status: 400, headers: corsHeaders });
    }
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request" }), { status: 400, headers: corsHeaders });
  }

  // Demo property context (SUNSET)
  const demoProperty = {
    name: "Sunset Villa",
    answers: [
      { topic: "Gate Code", reply: "Your gate code is 4821." },
      { topic: "WiFi", reply: "Network: KIDS-SWIMMING-4\nPassword: SUNSHINE2026" },
      { topic: "Checkout", reply: "Checkout is 10:00 AM. Late checkout is not available." },
      { topic: "Trash", reply: "Trash pickup is Tuesday morning — bins go out Monday night." },
      { topic: "Pool", reply: "The pool heater is the grey panel on the lanai wall. Press HEAT, then the up arrow to 86. It takes about 4 hours to warm up." },
      { topic: "Parking", reply: "Two cars in the driveway. No street parking — HOA rule." },
      { topic: "Pets", reply: "No pets, per the HOA." },
      { topic: "Quiet Hours", reply: "Quiet hours are 10 PM to 8 AM." },
      { topic: "Hurricane Prep", reply: "Storm shutters are in the garage, labeled by window." },
    ],
    unknownReply: "Good question — let me check with your host and get right back to you."
  };

  // Premium concierge add-ons. In the demo these are NOT live — the guest gets
  // a clear explanation instead of a made-up answer. Once purchased they enable
  // real alerts, live weather, reservations, etc.
  const PREMIUM_SERVICES = [
    { keywords: ["weather", "storm", "hurricane", "forecast", "rain", "temperature", "alerts", "wind"], name: "Live Weather & Alerts", price: "$15/mo" },
    { keywords: ["events", "dining", "restaurant", "reservations", "things to do", "attraction", "tickets", "shows", "concerts"], name: "Local Events & Dining", price: "$20/mo" },
    { keywords: ["grocery", "groceries", "essentials", "stock", "fridge", "delivery", "supplies", "beach gear"], name: "Grocery & Essentials Delivery", price: "$25/mo" },
    { keywords: ["concierge", "24/7", "host backup", "maintenance", "personal assistant"], name: "Full Concierge", price: "$49/mo" },
  ];

  function detectPremium(message) {
    const lower = message.toLowerCase();
    for (const svc of PREMIUM_SERVICES) {
      if (svc.keywords.some(k => lower.includes(k))) {
        return svc;
      }
    }
    return null;
  }

  // Check the latest user message for premium-service questions BEFORE calling AI
  const lastUserMsg = [...messages].reverse().find(m => m.role === "user");
  if (lastUserMsg) {
    const premium = detectPremium(lastUserMsg.content);
    if (premium) {
      const reply =
        `That's a premium feature! ${premium.name} is a ${premium.price} add-on. ` +
        `The answers in this demo are examples only — not real-time or accurate. ` +
        `Once the add-on is purchased, it turns on live alerts, up-to-date weather, ` +
        `and real reservations.`;
      const newCount = currentCount + 1;
      await env.PROPERTIES.put(rateLimitKey, String(newCount), { expirationTtl: 86400 });
      return new Response(JSON.stringify({
        reply,
        remaining: Math.max(0, MAX_MESSAGES - newCount),
        premium: { name: premium.name, price: premium.price }
      }), { headers: corsHeaders });
    }
  }

  const systemPrompt = [
    `You are the friendly guest assistant for "${demoProperty.name}", a vacation rental in Davenport, Florida.`,
    `Guests text you questions. Answer warmly and helpfully.`,
    ``,
    `RULES:`,
    `- For questions about gate codes, WiFi, checkout, trash, pool, parking, pets, quiet hours, hurricane prep: answer from the property info below.`,
    `- For general chat (how are you, local small talk, etc.): respond briefly and naturally, then gently steer back to what you can help with (rental amenities).`,
    `- NEVER give out real-time weather, forecasts, storm alerts, restaurant reservations, event tickets, grocery deliveries, or 24/7 concierge help. These are premium paid add-ons and are not available in the demo. If a guest asks about them, say so plainly — this is a demo and those answers would be examples only, not real. Once purchased they turn on live alerts, up-to-date weather, and real reservations.`,
    `- Never invent codes, passwords, or rules. If unsure, say you'll check with the host.`,
    `- Keep responses under 300 characters. No markdown, no emoji unless the guest uses them first.`,
    `- You represent the host (Richard Harrell / Davenport Host Co.).`,
    ``,
    `PROPERTY INFORMATION:`,
    JSON.stringify(demoProperty.answers, null, 2),
  ].join("\n");

  const apiMessages = [
    { role: "system", content: systemPrompt },
    ...messages.slice(-8) // Keep last 8 messages for context
  ];

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://davenporthost.co",
        "X-Title": "Davenport Host Co. Demo Chat",
      },
      body: JSON.stringify({
        model: "anthropic/claude-haiku-4.5",
        messages: apiMessages,
        max_tokens: 300,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("OpenRouter API error:", response.status, errorText);
      return new Response(JSON.stringify({ error: `AI error: ${response.status} - ${errorText}` }), { status: 503, headers: corsHeaders });
    }

    const data = await response.json();
    const aiResponse = data.choices[0].message.content;

    const newCount = currentCount + 1;
    await env.PROPERTIES.put(rateLimitKey, String(newCount), { expirationTtl: 86400 }); // 24 hours

    return new Response(JSON.stringify({
      reply: aiResponse,
      remaining: Math.max(0, MAX_MESSAGES - newCount)
    }), {
      headers: corsHeaders
    });
  } catch (err) {
    console.error("Demo chat error:", err?.message || err);
    return new Response(JSON.stringify({ error: "Internal error" }), { status: 500, headers: corsHeaders });
  }
}

/**
 * THE SECURITY BOUNDARY. Everything the model is allowed to see.
 * Secrets are dropped entirely — not masked, dropped, so there is nothing to
 * leak and nothing to talk the model out of.
 */
function redactForModel(property) {
  return {
    name: property.name,
    answers: (property.answers || []).map((a) => ({ topic: a.topic, reply: a.reply })),
    rateLimitReply: property.rateLimitReply,
    unknownReply: property.unknownReply,
    note: "Gate, door and lock codes are deliberately not provided and cannot be answered here.",
  };
}

/* ------------------------------------------------------------------ *
 * Escalation, logging, rate limiting
 * ------------------------------------------------------------------ */

async function escalate(env: Env, property: Property, guestNumber: string, body: string, reason: string) {
  if (!property.hostPhone || !env.TWILIO_ACCOUNT_SID) return;

  // Log the escalation to D1
  try {
    await env.DB.prepare(
      "INSERT INTO escalations (property_id, guest_number, question, status, host_number) VALUES (?1, ?2, ?3, ?4, ?5)"
    ).bind(
      property.id,
      guestNumber,
      body,
      "open",
      property.hostPhone
    ).run();
  } catch (err) {
    console.error("Escalation log failed:", err?.message || err);
  }

  const text =
    `Guest text at ${property.name} needs you (${reason}).\n` +
    `From ${guestNumber}:\n"${String(body).slice(0, 300)}"`;

  await sendSms(env, property.hostPhone, text, property.twilioNumber);
}

async function sendSms(env, to, body, from) {
  const sid = env.TWILIO_ACCOUNT_SID;
  const token = env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return;

  const params = new URLSearchParams({ To: to, From: from, Body: body });

  try {
    await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${sid}:${token}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    });
  } catch (err) {
    console.error("Twilio send failed:", err?.message || err);
  }
}

/**
 * Rolling log per property. Strip anything secret — this log becomes the
 * host's monthly report ("what did guests actually ask?").
 */
async function log(env: Env, property: Property, entry: LogEntry) {
  try {
    await env.DB.prepare(
      "INSERT INTO messages (direction, property_id, from_number, body, body_redacted, intent_key, risk, resolution, ai_model, tokens_in, tokens_out, cost_estimate) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)"
    ).bind(
      entry.direction || (entry.via === "kb" || entry.via === "ai" ? "out" : "in"),
      property.id,
      entry.from || property.twilioNumber, // If direction is 'out', from is the property's Twilio number
      entry.body || entry.reply, // Original message if 'in', reply if 'out'
      entry.body_redacted || entry.body || entry.reply,
      entry.intent_key || null,
      entry.risk || null,
      entry.via,
      entry.ai_model || null,
      entry.tokens_in || 0,
      entry.tokens_out || 0,
      entry.cost_estimate || 0
    ).run();
  } catch (err) {
    console.error("Log write failed:", err?.message || err);
  }
}

/** 15 guest messages per 10 minutes per number. */
async function bumpRateLimit(env, from) {
  const key = `rate:${from}:${Math.floor(Date.now() / 600000)}`;
  try {
    const count = Number((await env.PROPERTIES.get(key)) || 0) + 1;
    await env.PROPERTIES.put(key, String(count), { expirationTtl: 900 });
    return count > 15;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * Storage
 * ------------------------------------------------------------------ */

async function loadProperty(env: Env, twilioNumber: string) {
  try {
    const { results } = await env.DB.prepare(
      "SELECT id, display_name as name, host_id as hostId, twilio_number as twilioNumber, rate_limit_reply as rateLimitReply, unknown_reply as unknownReply FROM properties WHERE twilio_number = ?1 AND active = 1"
    )
      .bind(twilioNumber)
      .all();
    if (results && results.length > 0) {
      const property = results[0];
      // Also load host details for escalation
      const { results: hostResults } = await env.DB.prepare(
        "SELECT * FROM hosts WHERE id = ?1"
      )
        .bind(property.hostId)
        .all();
      if (hostResults && hostResults.length > 0) {
        property.hostPhone = hostResults[0].phone;
      }
      // Load secrets and answers from KV for now (can be moved to D1 later if structured)
      const kvProperty = await env.PROPERTIES.get(`prop:${property.id}`, "json");
      if (kvProperty) {
        property.secrets = kvProperty.secrets;
        property.answers = kvProperty.answers;
      }
      return property;
    }
    return null;
  } catch (err) {
    console.error("Property load failed:", err?.message || err);
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Twilio helpers
 * ------------------------------------------------------------------ */

function twiml(message) {
  const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(message)}</Message></Response>`;
  return new Response(
    twimlResponse,
    { headers: { "Content-Type": "text/xml" } },
  );
}

function twimlError(message) {
  return new Response(message, { status: 403 });
}

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c],
  );
}

/**
 * Validate the X-Twilio-Signature header.
 * Twilio signs: the full webhook URL, then each POST param sorted by name as
 * key+value, HMAC-SHA1 with the auth token, base64.
 */
async function verifyTwilioSignature(request, form, env) {
  // Bypass signature validation if the secret is not set or explicitly false
  if (!env.VALIDATE_SIGNATURE || env.VALIDATE_SIGNATURE === "false") return true;

  if (!env.TWILIO_AUTH_TOKEN) return false;

  const signature = request.headers.get("X-Twilio-Signature");
  if (!signature) return false;

  // Must be the exact URL configured in the Twilio console.
  const url = env.PUBLIC_URL || request.url;

  const params = [...form.entries()]
    .map(([k, v]) => [k, String(v)])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  let payload = url;
  for (const [k, v] of params) payload += k + v;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.TWILIO_AUTH_TOKEN),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const expected = btoa(String.fromCharCode(...new Uint8Array(digest)));

  // Constant-time compare — both are base64 of a fixed-length SHA-1 HMAC.
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

async function handleLeadCapture(request: Request, env: Env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON." }, 400);
  }

  const email = body.email;

  if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: "Valid email is required." }, 400);
  }

  try {
    await env.DB.prepare(
      "INSERT INTO leads (email) VALUES (?1)"
    ).bind(email).run();
    return json({ success: true }, 201);
  } catch (err) {
    if (err.message && err.message.includes("UNIQUE constraint failed")) {
      return json({ error: "Email already subscribed." }, 409);
    }
    console.error("Lead capture failed:", err?.message || err);
    return json({ error: "Internal server error." }, 500);
  }
}

/* ------------------------------------------------------------------ *
 * Admin page + API
 * ------------------------------------------------------------------ */

/** Constant-time string compare for the admin password. */
function timingSafeEqualStr(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function handleAdmin(request, env, url) {
  // Helper for JSON responses with CORS
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Content-Type": "application/json"
  };

  // Handle preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Admin API: every request must carry the admin password. Fails closed
  // (401) when ADMIN_PASSWORD is not configured — the previous open
  // endpoints let anyone read gate codes and rewrite property data.
  if (url.pathname.startsWith("/admin/api/")) {
    const expected = env.ADMIN_PASSWORD;
    const got = request.headers.get("x-admin-password") || "";
    if (!expected || !timingSafeEqualStr(got, expected)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }
  }

  // Serve the admin HTML page
  if (url.pathname === "/admin" || url.pathname === "/admin/") {
    // Check password for admin page access
    const auth = request.headers.get("Authorization");
    const expectedPassword = env.ADMIN_PASSWORD;

    if (!expectedPassword) {
      return new Response("Unauthorized", {
        status: 401,
        headers: { "WWW-Authenticate": "Basic realm=\"Admin\"" }
      });
    }

    if (expectedPassword) {
      // For browser access, check cookie or basic auth
      const cookie = request.headers.get("Cookie") || "";
      const hasValidCookie = cookie.includes(`admin_auth=${btoa(expectedPassword)}`);
      const hasValidBasicAuth = auth && auth.startsWith("Basic ") && atob(auth.slice(6)) === `admin:${expectedPassword}`;

      if (!hasValidCookie && !hasValidBasicAuth) {
        return new Response("Unauthorized", {
          status: 401,
          headers: { "WWW-Authenticate": "Basic realm=\"Admin\"" }
        });
      }
    }

    return new Response(ADMIN_HTML, {
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  }

  // Admin API: List properties (with dashboard stats)
  if (url.pathname === "/admin/api/properties" && request.method === "GET") {
    try {
      const { results } = await env.DB.prepare(
        `SELECT p.id, p.display_name as name, p.twilio_number as twilioNumber, p.active,
           (SELECT COUNT(*) FROM messages m WHERE m.property_id = p.id AND m.direction = 'in') AS asked,
           (SELECT COUNT(*) FROM messages m WHERE m.property_id = p.id AND m.resolution IN ('escalate','escalated')) AS escalated,
           (SELECT COUNT(*) FROM escalations e WHERE e.property_id = p.id AND e.status = 'open') AS openEscalations,
           (SELECT MAX(m.created_at) FROM messages m WHERE m.property_id = p.id) AS lastActivity
         FROM properties p ORDER BY p.display_name, p.id`
      ).all();
      const properties = (results || []) as any[];
      // Enrich from KV: configured answers (setup status) + premium add-ons
      for (const p of properties) {
        const kv = (await env.PROPERTIES.get(`prop:${p.id}`, "json")) as any;
        p.answerCount = (kv?.answers || []).length;
        p.addons = kv?.addons || [];
      }
      return new Response(JSON.stringify({ properties }), { headers: corsHeaders });
    } catch (err) {
      return new Response(JSON.stringify({ error: err?.message || "Failed to load properties" }), { status: 500, headers: corsHeaders });
    }
  }

  // Admin API: Get single property
  if (url.pathname === "/admin/api/property" && request.method === "GET") {
    const id = url.searchParams.get("id");
    if (!id) return new Response(JSON.stringify({ error: "Property ID required" }), { status: 400, headers: corsHeaders });

    try {
      const { results } = await env.DB.prepare(
        "SELECT * FROM properties WHERE id = ?1"
      ).bind(id).all();

      if (!results || results.length === 0) {
        return new Response(JSON.stringify({ error: "Property not found" }), { status: 404, headers: corsHeaders });
      }

      const property = results[0] as any;

      // Load secrets/answers/addons from KV
      const kvProperty = (await env.PROPERTIES.get(`prop:${property.id}`, "json")) as any;
      if (kvProperty) {
        property.secrets = kvProperty.secrets || [];
        property.answers = kvProperty.answers || [];
        property.addons = kvProperty.addons || [];
      }
      property.answerCount = (property.answers || []).length;

      // Dashboard stats
      const stat = await env.DB.prepare(
        `SELECT
           (SELECT COUNT(*) FROM messages WHERE property_id = ?1 AND direction = 'in') AS asked,
           (SELECT COUNT(*) FROM messages WHERE property_id = ?1 AND resolution IN ('escalate','escalated')) AS escalated,
           (SELECT COUNT(*) FROM escalations WHERE property_id = ?1 AND status = 'open') AS openEscalations,
           (SELECT MAX(created_at) FROM messages WHERE property_id = ?1) AS lastActivity`
      ).bind(property.id).first();
      if (stat) {
        property.asked = stat.asked;
        property.escalated = stat.escalated;
        property.openEscalations = stat.openEscalations;
        property.lastActivity = stat.lastActivity;
      }

      // Host escalation phone lives in the hosts table
      const { results: hostRows } = await env.DB.prepare(
        "SELECT phone AS hostPhone FROM hosts WHERE id = ?1"
      ).bind(property.host_id).all();
      if (hostRows && hostRows.length > 0) {
        property.hostPhone = hostRows[0].hostPhone;
      }

      return new Response(JSON.stringify(property), { headers: corsHeaders });
    } catch (err) {
      return new Response(JSON.stringify({ error: err?.message || "Failed to load property" }), { status: 500, headers: corsHeaders });
    }
  }

  // Admin API: Save property
  if (url.pathname === "/admin/api/property" && request.method === "PUT") {
    try {
      const body = await request.json();
      // The editor sends the id as the ?id= query param (same as GET); accept
      // body.id too so API callers can pass it either way.
      const id = url.searchParams.get("id") || body.id;
      const { name, twilioNumber, hostPhone, rateLimitReply, unknownReply, secrets, answers, addons, active } = body;

      if (!id) return new Response(JSON.stringify({ error: "Property ID required" }), { status: 400, headers: corsHeaders });

      // Update D1 — host phone lives in the hosts table, not properties
      await env.DB.prepare(
        "UPDATE properties SET display_name = ?1, twilio_number = ?2, rate_limit_reply = ?3, unknown_reply = ?4, updated_at = datetime('now') WHERE id = ?5"
      ).bind(name, twilioNumber, rateLimitReply, unknownReply, id).run();

      if (active !== undefined) {
        await env.DB.prepare(
          "UPDATE properties SET active = ?1 WHERE id = ?2"
        ).bind(active ? 1 : 0, id).run();
      }

      if (hostPhone !== undefined) {
        await env.DB.prepare(
          "UPDATE hosts SET phone = ?1 WHERE id = (SELECT host_id FROM properties WHERE id = ?2)"
        ).bind(hostPhone, id).run();
      }

      // Update KV — merge so a partial save never wipes what it didn't send
      const existing = ((await env.PROPERTIES.get(`prop:${id}`, "json")) || {}) as any;
      await env.PROPERTIES.put(`prop:${id}`, JSON.stringify({
        secrets: secrets !== undefined ? secrets : (existing.secrets || []),
        answers: answers !== undefined ? answers : (existing.answers || []),
        addons: addons !== undefined ? addons : (existing.addons || []),
      }));

      return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
    } catch (err) {
      return new Response(JSON.stringify({ error: err?.message || "Failed to save property" }), { status: 500, headers: corsHeaders });
    }
  }

  // Admin API: Create property
  if (url.pathname === "/admin/api/property" && request.method === "POST") {
    try {
      const body = await request.json();
      const id = (body.id || "").trim().toUpperCase();
      if (!/^[A-Z0-9_-]{2,20}$/.test(id)) {
        return new Response(JSON.stringify({ error: "House code must be 2–20 letters, numbers or dashes" }), { status: 400, headers: corsHeaders });
      }
      const name = (body.name || "").trim();
      if (!name) {
        return new Response(JSON.stringify({ error: "Property name required" }), { status: 400, headers: corsHeaders });
      }

      // Auto-create a host row so escalation has a phone to reach
      const hostId = `host_${id}`;
      await env.DB.prepare(
        "INSERT INTO hosts (id, name, phone, active) VALUES (?1, ?2, ?3, 1)"
      ).bind(hostId, name, (body.hostPhone || "").trim() || null).run();

      await env.DB.prepare(
        "INSERT INTO properties (id, house_code, display_name, host_id, twilio_number, active) VALUES (?1, ?1, ?2, ?3, ?4, 1)"
      ).bind(id, name, hostId, (body.twilioNumber || "").trim() || null).run();

      await env.PROPERTIES.put(`prop:${id}`, JSON.stringify({ secrets: [], answers: [], addons: [] }));

      return new Response(JSON.stringify({ success: true, id }), { headers: corsHeaders });
    } catch (err) {
      return new Response(JSON.stringify({ error: err?.message || "Failed to create property" }), { status: 500, headers: corsHeaders });
    }
  }

  // Admin API: Delete property
  if (url.pathname === "/admin/api/property" && request.method === "DELETE") {
    const id = url.searchParams.get("id");
    if (!id) return new Response(JSON.stringify({ error: "Property ID required" }), { status: 400, headers: corsHeaders });

    try {
      await env.DB.prepare("DELETE FROM messages WHERE property_id = ?1").bind(id).run();
      await env.DB.prepare("DELETE FROM escalations WHERE property_id = ?1").bind(id).run();
      await env.DB.prepare("DELETE FROM properties WHERE id = ?1").bind(id).run();
      // Only touches the auto-created host from the create flow; hosts shared
      // or created by hand have other id shapes and are left alone.
      await env.DB.prepare("DELETE FROM hosts WHERE id = ?1").bind(`host_${id}`).run();
      await env.PROPERTIES.delete(`prop:${id}`);

      return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
    } catch (err) {
      return new Response(JSON.stringify({ error: err?.message || "Failed to delete property" }), { status: 500, headers: corsHeaders });
    }
  }

  return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: corsHeaders });
}

/* ------------------------------------------------------------------ *
 * Admin page (served inline so there is only one thing to deploy)
 * ------------------------------------------------------------------ */

const ADMIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Davenport Host Co. — Admin</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&display=swap" rel="stylesheet">
<style>
  :root { --bg:#0a1526; --card:#0f1e36; --surface:rgba(148,180,255,.05);
          --border:rgba(148,180,255,.14); --text:#f2f6ff; --muted:#93a5c9;
          --sun:#ff9e4a; --pool:#38e1c6; --pink:#ff5e8a; --gold:#ffd166;
          --sunset:linear-gradient(96deg,#ffd166,#ff9e4a 45%,#ff5e8a); }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { background:var(--bg); color:var(--text); -webkit-font-smoothing:antialiased;
         font:15px/1.6 "Bricolage Grotesque",ui-sans-serif,system-ui,"Segoe UI",sans-serif;
         max-width:46rem; margin:0 auto; padding:2.5rem 1.5rem 7rem; }
  body::before { content:""; position:fixed; top:-18rem; left:50%; translate:-50% 0;
         width:46rem; height:46rem; pointer-events:none;
         background:radial-gradient(circle,rgba(255,94,138,.12),transparent 60%); filter:blur(40px); }
  .badge { display:inline-flex; align-items:center; gap:.5rem; padding:.3rem .8rem; margin-bottom:1rem;
         border:1px solid var(--border); border-radius:999px; background:var(--surface);
         font-size:.75rem; color:var(--muted); }
  .dot { width:7px; height:7px; border-radius:50%; background:var(--pool); box-shadow:0 0 10px var(--pool); }
  h1 { font-size:1.7rem; font-weight:800; letter-spacing:-.02em; margin-bottom:.3rem; }
  .sub { color:var(--muted); font-size:.9rem; margin-bottom:2rem; }
  label { display:block; font-size:.8rem; font-weight:600; color:var(--muted); margin:1rem 0 .4rem; }
  input, select, textarea { width:100%; padding:.6rem .8rem; border-radius:12px;
         border:1px solid var(--border); background:var(--bg); color:var(--text); font:inherit; }
  input:focus, select:focus, textarea:focus { outline:2px solid var(--pool); outline-offset:1px; }
  textarea { min-height:4.5rem; resize:vertical; }
  .card { border:1px solid var(--border); background:var(--card); border-radius:18px;
         padding:1.4rem; margin-top:1.25rem; }
  .card h2 { font-size:1.05rem; font-weight:700; }
  .hint { font-size:.78rem; color:var(--muted); margin:.3rem 0 .2rem; }
  .secret { border-color:rgba(255,158,74,.4); }
  .secret h2 { color:var(--sun); }
  .row { display:flex; gap:.75rem; align-items:flex-end; }
  .row > * { flex:1; }
  .row button { flex:none; }
  .entry { border:1px solid var(--border); border-radius:14px; padding:1rem;
         margin-top:.9rem; background:var(--surface); }
  .entry .top { display:grid; grid-template-columns:1fr 1fr auto; gap:.75rem; }
  .entry textarea { margin-top:.75rem; }
  .remove { width:2.1rem; height:2.1rem; padding:0; border-radius:10px; border:1px solid var(--border);
         background:transparent; color:var(--muted); font:inherit; font-size:1rem; line-height:1;
         cursor:pointer; }
  .remove:hover { color:var(--pink); border-color:var(--pink); }
  .add { width:100%; margin-top:.9rem; padding:.7rem; border-radius:12px; border:1px dashed var(--pool);
         background:rgba(56,225,198,.05); color:var(--pool); font:inherit; font-weight:700; cursor:pointer; }
  .add:hover { background:rgba(56,225,198,.12); }
  button.primary { margin-top:1.5rem; padding:.75rem 1.4rem; border-radius:12px; border:0;
         background:var(--sunset); color:#1c0b06; font:inherit; font-weight:700; cursor:pointer; }
  button.primary.live { background:var(--pool); }
  button.ghost { margin-top:1.5rem; padding:.75rem 1.3rem; border-radius:12px; border:1px solid var(--border);
         background:transparent; color:var(--text); font:inherit; font-weight:600; cursor:pointer; }
  .status { margin-top:1rem; font-size:.85rem; color:var(--muted); min-height:1.2em; }
  .savebar { position:fixed; bottom:0; left:0; right:0; border-top:1px solid var(--border);
         background:rgba(10,21,38,.94); padding:.9rem 1.5rem; }
  .savebar .inner { max-width:46rem; margin:0 auto; display:flex; gap:.75rem; align-items:center; }
  .savebar button { margin-top:0; flex:none; }
  .savebar .status { margin-top:0; flex:1; text-align:right; }
  .hidden { display:none; }
  .list-head { display:flex; align-items:center; justify-content:space-between; margin-top:1.5rem; }
  .list-head h2 { font-size:1.15rem; font-weight:700; margin:0; }
  .list-head button { margin-top:0; flex:none; }
  .propcard { position:relative; border:1px solid var(--border); background:var(--card);
         border-radius:16px; padding:1.1rem 1.3rem; margin-top:.9rem; cursor:pointer;
         transition:border-color .15s ease; }
  .propcard:hover { border-color:var(--pool); }
  .pc-head { display:flex; align-items:center; gap:.5rem; flex-wrap:wrap; padding-right:2.4rem; }
  .pc-head .name { font-weight:700; font-size:1.05rem; }
  .propcard .meta { color:var(--muted); font-size:.8rem; margin-top:.15rem; }
  .propcard .statline { margin-top:.55rem; font-size:.82rem; color:var(--muted); }
  .pill { display:inline-block; padding:.15rem .7rem; border-radius:999px; font-size:.72rem; font-weight:700; }
  .pill.live { background:rgba(56,225,198,.15); color:var(--pool); border:1px solid rgba(56,225,198,.4); }
  .pill.pending { background:rgba(255,209,102,.12); color:var(--gold); border:1px solid rgba(255,209,102,.35); }
  .pill.paused { background:var(--surface); color:var(--muted); border:1px solid var(--border); }
  .pill.open-esc { background:rgba(255,94,138,.12); color:var(--pink); border:1px solid rgba(255,94,138,.4); }
  .del { position:absolute; top:1rem; right:1rem; width:2.1rem; height:2.1rem; padding:0;
         border-radius:10px; border:1px solid var(--border); background:transparent;
         color:var(--muted); font:inherit; font-size:1rem; line-height:1; cursor:pointer; }
  .del:hover { color:var(--pink); border-color:var(--pink); }
  .stats { display:flex; gap:1.75rem; flex-wrap:wrap; margin-top:.9rem; }
  .stat { color:var(--muted); font-size:.8rem; }
  .stat b { color:var(--text); font-size:1.05rem; margin-right:.3rem; }
  .chips { display:flex; gap:.5rem; flex-wrap:wrap; margin-top:.8rem; }
  .chip { padding:.4rem .95rem; border-radius:999px; border:1px solid var(--border);
         background:transparent; color:var(--muted); font:inherit; font-size:.8rem;
         font-weight:600; cursor:pointer; }
  .chip.on { background:rgba(56,225,198,.14); border-color:var(--pool); color:var(--pool); }
  .back { margin-top:1.5rem; padding:.45rem 1rem; font-size:.85rem; }
  .prop-head { display:flex; align-items:center; gap:.6rem; flex-wrap:wrap; margin-top:.5rem; }
  .prop-head h2 { font-size:1.4rem; font-weight:800; letter-spacing:-.01em; margin:0; }
  .check { display:flex; align-items:center; gap:.6rem; margin-top:1.2rem; }
  .check input { width:auto; }
  .check span { font-size:.9rem; color:var(--text); }
  @media (max-width:560px) {
    .entry .top { grid-template-columns:1fr; }
    .savebar .inner { flex-wrap:wrap; }
    .savebar .status { text-align:left; }
  }
</style>
</head>
<body>
  <div class="badge"><span class="dot"></span> Davenport Host Co. admin</div>
  <h1>Property manager</h1>
  <p class="sub">Pick a property to open its dashboard. Changes go live immediately — no redeploy, no code.</p>

  <div id="login" class="card">
    <label for="pw">Admin password</label>
    <div class="row">
      <input id="pw" type="password" autocomplete="current-password" placeholder="••••••••••">
      <button class="primary" onclick="unlock()">Unlock</button>
    </div>
    <p class="status" id="loginStatus"></p>
  </div>

  <div id="listView" class="hidden">
    <div class="list-head">
      <h2>Properties</h2>
      <button class="ghost" onclick="showAdd()">+ New property</button>
    </div>
    <div id="propList"></div>
    <p class="status" id="listStatus"></p>

    <div id="addForm" class="card hidden">
      <h2>New property</h2>
      <label for="newId">House code</label>
      <input id="newId" placeholder="SUNSET" spellcheck="false" autocomplete="off">
      <p class="hint">Short uppercase code — letters, numbers, dashes.</p>
      <label for="newName">Property name</label>
      <input id="newName" placeholder="Sunset Villa" autocomplete="off">
      <label for="newNumber">Text line number (E.164)</label>
      <input id="newNumber" placeholder="+18005551234" autocomplete="off">
      <label for="newHostPhone">Escalate to this phone</label>
      <input id="newHostPhone" placeholder="+18635551234" autocomplete="off">
      <button class="primary" onclick="createProperty()">Create property</button>
      <button class="ghost" onclick="hideAdd()">Cancel</button>
      <p class="status" id="addStatus"></p>
    </div>
  </div>

  <div id="propView" class="hidden">
    <button class="ghost back" onclick="showList()">← Back to properties</button>
    <div class="prop-head">
      <h2 id="propName"></h2>
      <span class="pill" id="propPill"></span>
      <span class="pill hidden" id="propEsc"></span>
    </div>
    <div class="stats" id="propStats"></div>

    <div class="card">
      <h2>Services</h2>
      <p class="hint">Premium add-ons enabled for this property. Tap to toggle, then save.</p>
      <div class="chips" id="addonChips"></div>
    </div>

    <div class="card">
      <h2>Settings</h2>
      <label for="name">Property name</label>
      <input id="name">
      <label for="twilioNumber">Text line number (the guest-facing number, E.164)</label>
      <input id="twilioNumber" placeholder="+18635551234">
      <label for="hostPhone">Escalate to this phone</label>
      <input id="hostPhone" placeholder="+18635551234">
      <label for="rateLimitReply">Rate limit reply</label>
      <input id="rateLimitReply" placeholder="Let me get the host to help you with this.">
      <label for="unknownReply">Unknown question reply</label>
      <input id="unknownReply" placeholder="Good question — let me check with your host and get right back to you.">
      <div class="check">
        <input type="checkbox" id="active">
        <span>Property is live — the text line answers guests</span>
      </div>
    </div>

    <div class="card secret">
      <h2>Gate &amp; door codes</h2>
      <p class="hint">Released only on an exact keyword match — never sent to the AI, never logged. Empty rows are skipped on save.</p>
      <div id="secretsList"></div>
      <button class="add" onclick="addSecret()">+ Add a code</button>
    </div>

    <div class="card">
      <h2>Answers</h2>
      <p class="hint">Canned replies matched by keyword — instant, and free. One row per topic. Empty rows are skipped on save.</p>
      <div id="answersList"></div>
      <button class="add" onclick="addAnswer()">+ Add an answer</button>
    </div>

    <div class="savebar" id="savebar">
      <div class="inner">
        <button id="saveButton" class="primary" onclick="save()">Save &amp; go live</button>
        <button class="ghost" onclick="openProperty(current.id)">Reload</button>
        <p class="status" id="saveStatus"></p>
      </div>
    </div>
  </div>

<script>
let password = "";
let properties = [];
let current = null;

const ADDONS = [
  ["weather", "Live Weather & Alerts"],
  ["events", "Local Events & Dining"],
  ["grocery", "Grocery & Essentials"],
  ["concierge", "24/7 Host Backup"],
];

const $ = (id) => document.getElementById(id);

function setButtonState(isDirty) {
  const saveButton = $("saveButton");
  if (isDirty) {
    saveButton.textContent = "Save & go live";
    saveButton.classList.remove("live");
  } else {
    saveButton.textContent = "LIVE!";
    saveButton.classList.add("live");
  }
}

function markDirty() {
  setButtonState(true);
  $("saveStatus").textContent = "";
}

// Any typing or change anywhere in the dashboard marks it dirty (rows included)
document.body.addEventListener("input", markDirty);
document.body.addEventListener("change", markDirty);

function parseKeywords(str) {
  return str.split(",").map((k) => k.trim()).filter((k) => k.length);
}

function removeButton(row) {
  const rm = document.createElement("button");
  rm.className = "remove";
  rm.type = "button";
  rm.title = "Remove";
  rm.textContent = "×";
  rm.onclick = () => { row.remove(); markDirty(); };
  return rm;
}

function addSecret(keywords, reply) {
  const row = document.createElement("div");
  row.className = "entry";
  const top = document.createElement("div");
  top.className = "top";
  const kw = document.createElement("input");
  kw.className = "kw";
  kw.placeholder = "Trigger words — gate, gate code";
  kw.value = keywords || "";
  const rp = document.createElement("input");
  rp.className = "rp";
  rp.placeholder = "Reply — Gate code is 4321, then press #";
  rp.value = reply || "";
  top.append(kw, rp, removeButton(row));
  row.append(top);
  $("secretsList").append(row);
}

function addAnswer(topic, keywords, reply) {
  const row = document.createElement("div");
  row.className = "entry";
  const top = document.createElement("div");
  top.className = "top";
  const tp = document.createElement("input");
  tp.className = "tp";
  tp.placeholder = "Topic — Trash day";
  tp.value = topic || "";
  const kw = document.createElement("input");
  kw.className = "kw";
  kw.placeholder = "Keywords, comma separated — trash, garbage, bins";
  kw.value = keywords || "";
  top.append(tp, kw, removeButton(row));
  const rp = document.createElement("textarea");
  rp.className = "rp";
  rp.placeholder = "Reply sent to the guest…";
  rp.value = reply || "";
  row.append(top, rp);
  $("answersList").append(row);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { "x-admin-password": password, "Content-Type": "application/json", ...(options.headers || {}) },
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
}

async function unlock() {
  password = $("pw").value;
  try {
    await api("/admin/api/properties");
    $("login").classList.add("hidden");
    showList();
  } catch (err) {
    $("loginStatus").textContent = err.message;
  }
}

function pillFor(p) {
  if (!p.active) return ["Paused", "paused"];
  if (!p.answerCount) return ["Awaiting setup", "pending"];
  return ["Live", "live"];
}

function escLabel(n) {
  return n + " open escalation" + (n === 1 ? "" : "s");
}

async function showList() {
  $("propView").classList.add("hidden");
  $("listView").classList.remove("hidden");
  hideAdd();
  try {
    const data = await api("/admin/api/properties");
    properties = data.properties || [];
    renderList();
  } catch (err) {
    $("listStatus").textContent = err.message;
  }
}

function renderList() {
  const list = $("propList");
  list.textContent = "";
  $("listStatus").textContent = properties.length ? "" : "No properties yet. Create your first one.";
  properties.forEach((p) => {
    const card = document.createElement("div");
    card.className = "propcard";
    card.onclick = () => openProperty(p.id);

    const head = document.createElement("div");
    head.className = "pc-head";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = p.name || p.id;
    head.append(name);
    const pill = document.createElement("span");
    const status = pillFor(p);
    pill.className = "pill " + status[1];
    pill.textContent = status[0];
    head.append(pill);
    if (p.openEscalations > 0) {
      const esc = document.createElement("span");
      esc.className = "pill open-esc";
      esc.textContent = escLabel(p.openEscalations);
      head.append(esc);
    }
    card.append(head);

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = p.id + (p.twilioNumber ? " · " + p.twilioNumber : "");
    card.append(meta);

    const statline = document.createElement("div");
    statline.className = "statline";
    statline.textContent = p.asked + " questions · " + p.escalated + " escalated · " +
      p.answerCount + " answers saved · " +
      (p.lastActivity ? "last activity " + p.lastActivity.slice(0, 10) : "no activity yet");
    card.append(statline);

    const del = document.createElement("button");
    del.className = "del";
    del.type = "button";
    del.title = "Delete property";
    del.textContent = "×";
    del.onclick = (e) => {
      e.stopPropagation();
      deleteProperty(p.id, p.name || p.id);
    };
    card.append(del);

    list.append(card);
  });
}

function showAdd() {
  $("addForm").classList.remove("hidden");
  $("addStatus").textContent = "";
  $("newId").focus();
}

function hideAdd() {
  $("addForm").classList.add("hidden");
}

async function createProperty() {
  try {
    const data = await api("/admin/api/property", {
      method: "POST",
      body: JSON.stringify({
        id: $("newId").value,
        name: $("newName").value,
        twilioNumber: $("newNumber").value,
        hostPhone: $("newHostPhone").value,
      }),
    });
    showList();
    openProperty(data.id);
  } catch (err) {
    $("addStatus").textContent = err.message;
  }
}

async function deleteProperty(id, name) {
  if (!confirm("Delete " + name + "? Messages and escalation history go with it.")) return;
  try {
    await api("/admin/api/property?id=" + encodeURIComponent(id), { method: "DELETE" });
    showList();
  } catch (err) {
    alert(err.message);
  }
}

async function openProperty(id) {
  try {
    current = await api("/admin/api/property?id=" + encodeURIComponent(id));

    $("propName").textContent = current.name || current.id;
    const status = pillFor(current);
    const pill = $("propPill");
    pill.className = "pill " + status[1];
    pill.textContent = status[0];
    const esc = $("propEsc");
    if (current.openEscalations > 0) {
      esc.className = "pill open-esc";
      esc.textContent = escLabel(current.openEscalations);
    } else {
      esc.className = "pill hidden";
      esc.textContent = "";
    }

    const stats = $("propStats");
    stats.textContent = "";
    const items = [
      [current.asked || 0, "questions asked"],
      [current.escalated || 0, "escalated"],
      [current.answerCount || 0, "answers saved"],
      [(current.addons || []).length, "add-ons on"],
    ];
    items.forEach((item) => {
      const el = document.createElement("div");
      el.className = "stat";
      const b = document.createElement("b");
      b.textContent = item[0];
      el.append(b, item[1]);
      stats.append(el);
    });
    if (current.lastActivity) {
      const el = document.createElement("div");
      el.className = "stat";
      el.textContent = "last activity " + current.lastActivity.slice(0, 10);
      stats.append(el);
    }

    $("active").checked = current.active != 0;
    $("name").value = current.name || "";
    $("twilioNumber").value = current.twilioNumber || "";
    $("hostPhone").value = current.hostPhone || "";
    $("rateLimitReply").value = current.rate_limit_reply || "";
    $("unknownReply").value = current.unknown_reply || "";

    renderAddons();
    $("secretsList").textContent = "";
    (current.secrets || []).forEach((s) => addSecret((s.keywords || []).join(", "), s.reply || ""));
    if (!(current.secrets || []).length) addSecret();

    $("answersList").textContent = "";
    (current.answers || []).forEach((a) => addAnswer(a.topic || "", (a.keywords || []).join(", "), a.reply || ""));
    if (!(current.answers || []).length) addAnswer();

    $("listView").classList.add("hidden");
    $("propView").classList.remove("hidden");
    $("saveStatus").textContent = "";
    setButtonState(false);
  } catch (err) {
    alert(err.message);
  }
}

function renderAddons() {
  const box = $("addonChips");
  box.textContent = "";
  const on = current.addons || [];
  ADDONS.forEach(([key, label]) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip" + (on.indexOf(key) >= 0 ? " on" : "");
    chip.textContent = label;
    chip.dataset.key = key;
    chip.onclick = () => {
      chip.classList.toggle("on");
      markDirty();
    };
    box.append(chip);
  });
}

function collect(selector, mapRow) {
  return Array.from(document.querySelectorAll(selector)).map(mapRow)
    .filter((r) => r.keywords.length && r.reply);
}

async function save() {
  if (!current || !current.id) return;
  const secrets = collect("#secretsList .entry", (row) => ({
    keywords: parseKeywords(row.querySelector(".kw").value),
    reply: row.querySelector(".rp").value.trim(),
  }));
  const answers = collect("#answersList .entry", (row) => ({
    topic: row.querySelector(".tp").value.trim(),
    keywords: parseKeywords(row.querySelector(".kw").value),
    reply: row.querySelector(".rp").value.trim(),
  }));
  const addons = Array.from(document.querySelectorAll("#addonChips .chip.on"))
    .map((c) => c.dataset.key);
  try {
    await api("/admin/api/property?id=" + encodeURIComponent(current.id), {
      method: "PUT",
      body: JSON.stringify({
        name: $("name").value,
        twilioNumber: $("twilioNumber").value,
        hostPhone: $("hostPhone").value,
        rateLimitReply: $("rateLimitReply").value,
        unknownReply: $("unknownReply").value,
        active: $("active").checked ? 1 : 0,
        secrets,
        answers,
        addons,
      }),
    });
    current.active = $("active").checked ? 1 : 0;
    const status = pillFor({ active: current.active, answerCount: answers.length });
    const pill = $("propPill");
    pill.className = "pill " + status[1];
    pill.textContent = status[0];
    $("saveStatus").textContent = "Saved. Live now.";
    setButtonState(false);
  } catch (err) {
    $("saveStatus").textContent = err.message;
  }
}

$("pw").addEventListener("keydown", (e) => { if (e.key === "Enter") unlock(); });
</script>
</body>
</html>`;

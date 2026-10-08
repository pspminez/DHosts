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
  host_id: string;
  twilioNumber: string;
  hostPhone?: string;
  secrets?: { keywords: string[]; reply: string }[];
  answers?: { topic: string; keywords: string[]; reply: string }[];
  rateLimitReply?: string;
  unknownReply?: string;
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

  // DEBUG: Log incoming fields
  console.log("Inbound SMS - From:", from, "To:", to, "MessagingServiceSid:", messagingServiceSid, "Body:", body);

  if (!from || !to) return twimlError("Missing sender or recipient.");

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
      return new Response(JSON.stringify({
        reply,
        remaining: Math.max(0, MAX_MESSAGES - currentCount),
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
  console.log("Generated TwiML:", twimlResponse);
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
async function handleLeadCapture(request: Request, env: Env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON." }, 400);
  }

  const email = body.email;

  if (!email || typeof email !== 'string' || !/^[^s@]+@[^s@]+.[^s@]+$/.test(email)) {
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

  // Serve the admin HTML page
  if (url.pathname === "/admin" || url.pathname === "/admin/") {
    // Check password for admin page access
    const auth = request.headers.get("Authorization");
    const expectedPassword = env.ADMIN_PASSWORD;

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

  // Admin API: List properties
  if (url.pathname === "/admin/api/properties" && request.method === "GET") {
    try {
      const { results } = await env.DB.prepare(
        "SELECT id, display_name as name, host_id as hostId, twilio_number as twilioNumber, active FROM properties WHERE active = 1 ORDER BY id"
      ).all();
      return new Response(JSON.stringify({ properties: results || [] }), { headers: corsHeaders });
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

      const property = results[0];

      // Load secrets/answers from KV
      const kvProperty = await env.PROPERTIES.get(`prop:${property.id}`, "json");
      if (kvProperty) {
        property.secrets = kvProperty.secrets;
        property.answers = kvProperty.answers;
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
      const { id, name, twilioNumber, hostPhone, rateLimitReply, unknownReply, secrets, answers } = body;

      if (!id) return new Response(JSON.stringify({ error: "Property ID required" }), { status: 400, headers: corsHeaders });

      // Update D1
      await env.DB.prepare(
        "UPDATE properties SET display_name = ?1, twilio_number = ?2, host_phone = ?3, rate_limit_reply = ?4, unknown_reply = ?5, updated_at = datetime('now') WHERE id = ?6"
      ).bind(name, twilioNumber, hostPhone, rateLimitReply, unknownReply, id).run();

      // Update KV
      if (secrets || answers) {
        await env.PROPERTIES.put(`prop:${id}`, JSON.stringify({ secrets: secrets || [], answers: answers || [] }));
      }

      return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
    } catch (err) {
      return new Response(JSON.stringify({ error: err?.message || "Failed to save property" }), { status: 500, headers: corsHeaders });
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
<style>
  :root { --bg:#0a0a0f; --surface:rgba(255,255,255,.03); --border:rgba(255,255,255,.08);
          --text:#e8e8ed; --muted:#8b8b9a; --accent:#7c5cff; --warn:#ff7a45; }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { background:var(--bg); color:var(--text); font:15px/1.6 ui-sans-serif,system-ui,"Segoe UI",sans-serif;
         max-width:60rem; margin:0 auto; padding:3rem 1.5rem 6rem; }
  h1 { font-size:1.6rem; letter-spacing:-.02em; margin-bottom:.35rem; }
  .sub { color:var(--muted); font-size:.9rem; margin-bottom:2rem; }
  label { display:block; font-size:.8rem; text-transform:uppercase; letter-spacing:.08em;
          color:var(--muted); margin:1.25rem 0 .4rem; }
  input, select, textarea { width:100%; padding:.65rem .8rem; border-radius:10px;
          border:1px solid var(--border); background:var(--surface); color:var(--text);
          font:inherit; }
  input:focus, textarea:focus { outline:2px solid var(--accent); outline-offset:1px; }
  textarea { min-height:5rem; font-family:ui-monospace,Menlo,Consolas,monospace; font-size:13px; }
  button { margin-top:1.5rem; padding:.75rem 1.4rem; border-radius:10px; border:0;
           background:var(--accent); color:#fff; font:inherit; font-weight:600; cursor:pointer; }
  button.ghost { background:var(--surface); border:1px solid var(--border); color:var(--text); }
  button.live { background:#4CAF50; /* Green */ }
  .row { display:flex; gap:.75rem; align-items:flex-end; }
  .row > * { flex:1; }
  .card { border:1px solid var(--border); background:var(--surface); border-radius:14px;
          padding:1.5rem; margin-top:1.5rem; }
  .secret { border-color:rgba(255,122,69,.35); }
  .secret label { color:var(--warn); }
  .status { margin-top:1rem; font-size:.9rem; color:var(--muted); }
  .hint { font-size:.8rem; color:var(--muted); margin-top:.4rem; }
  .hidden { display:none; }
</style>
</head>
<body>
  <h1>Davenport Host Co.</h1>
  <p class="sub">Property answer editor — changes go live immediately, no redeploy.</p>

  <div id="login">
    <label for="pw">Admin password</label>
    <div class="row">
      <input id="pw" type="password" autocomplete="current-password">
      <button onclick="unlock()">Unlock</button>
    </div>
    <p class="status" id="loginStatus"></p>
  </div>

  <div id="editor" class="hidden">
    <label for="prop">Property</label>
    <select id="prop" onchange="loadSelected()"></select>
    <p class="hint" id="propHint"></p>

    <div class="card">
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
    </div>

    <div class="card secret">
      <label for="secrets">Secrets — gate &amp; door codes</label>
      <textarea id="secrets" spellcheck="false"></textarea>
      <p class="hint">JSON. Never sent to the AI, never logged. Only released on an exact keyword match.</p>
    </div>

    <div class="card">
      <label for="answers">Answers</label>
      <textarea id="answers" spellcheck="false" style="min-height:16rem"></textarea>
      <p class="hint">JSON. One object per topic: <code>{"topic":"Trash","keywords":["trash"],"reply":"..."}</code></p>
    </div>

    <button id="saveButton" onclick="save()">Save &amp; go live</button>
    <button class="ghost" onclick="loadSelected()">Reload</button>
    <p class="status" id="saveStatus"></p>
  </div>

<script>
let password = "";
let current = null;
let dirty = false; // New flag to track unsaved changes

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
  dirty = isDirty;
}

// Function to mark inputs as dirty
function markDirty() {
  setButtonState(true);
  $("saveStatus").textContent = ""; // Clear status when changes are made
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
    const data = await api("/admin/api/properties");
    $("login").classList.add("hidden");
    $("editor").classList.remove("hidden");
    const select = $("prop");
    select.innerHTML = data.properties.map((p) =>
      \`<option value="\${p.id}">\${p.name || p.twilioNumber} (\${p.id})</option>\`).join("");
    if (!data.properties.length) {
      $("propHint").textContent = "No properties yet. Import one with the command in bot/README.md.";
    }
    loadSelected();
  } catch (err) {
    $("loginStatus").textContent = err.message;
  }
}

async function loadSelected() {
  const id = $("prop").value;
  if (!id) return;
  try {
    current = await api("/admin/api/property?id=" + encodeURIComponent(id));
    $("name").value = current.name || "";
    $("twilioNumber").value = current.twilioNumber || "";
    $("hostPhone").value = current.hostPhone || "";
    $("rateLimitReply").value = current.rate_limit_reply || "";
    $("unknownReply").value = current.unknown_reply || "";
    $("secrets").value = JSON.stringify(current.secrets || [], null, 2);
    $("answers").value = JSON.stringify(current.answers || [], null, 2);
    $("saveStatus").textContent = "";
    setButtonState(false); // Reset button state on load

    // Add change listeners to all relevant inputs
    const inputs = document.querySelectorAll("#editor input, #editor textarea");
    inputs.forEach(input => {
      input.removeEventListener("input", markDirty); // Avoid duplicate listeners
      input.addEventListener("input", markDirty);
    });

  } catch (err) {
    $("saveStatus").textContent = err.message;
  }
}

async function save() {
  const id = $("prop").value;
  let secrets, answers;
  try {
    secrets = JSON.parse($("secrets").value || "[]");
    answers = JSON.parse($("answers").value || "[]");
  } catch (err) {
    $("saveStatus").textContent = "JSON error: " + err.message;
    return;
  }
  try {
    await api("/admin/api/property?id=" + encodeURIComponent(id), {
      method: "PUT",
      body: JSON.stringify({
        name: $("name").value,
        twilioNumber: $("twilioNumber").value,
        hostPhone: $("hostPhone").value,
        rateLimitReply: $("rateLimitReply").value,
        unknownReply: $("unknownReply").value,
        secrets,
        answers,
      }),
    });
    $("saveStatus").textContent = "Saved. Live now.";
    setButtonState(false); // Mark as clean after successful save
  } catch (err) {
    $("saveStatus").textContent = err.message;
  }
}
</script>
</body>
</html>`;

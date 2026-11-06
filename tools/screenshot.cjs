#!/usr/bin/env node
// tools/screenshot.cjs — full-page screenshot of any admin tab.
//
//   node tools/screenshot.cjs <tab> [width] [out] [demo|live]
//   node tools/screenshot.cjs analytics 1440 analytics-demo
//   node tools/screenshot.cjs insights 390 insights-phone
//   node tools/screenshot.cjs login 1440 login-desktop   (the sign-in screen)
//   node tools/screenshot.cjs landing 1440 landing-desktop
//   node tools/screenshot.cjs landing 390 landing-phone   (the marketing site)
//
// Why this exists: every check in tools/ui-check.cjs is structural — it proves
// the script runs and the numbers are right, not that the result looks sane.
// This renders the real page (the same HTML/CSS/JS that ships) in Chrome and
// writes a PNG a person — or an agent — can actually look at.
//
// Two details worth knowing:
//   * `fetch` is shimmed so a tab can be shown without an admin session. The
//     shim returns the same demo payloads the server does.
//   * Narrow widths go through CDP device emulation. `--window-size` refuses to
//     go below 500px on Windows, which silently crops a 390px capture.
//
// Output lands in .shots/ (gitignored). Needs Chrome installed; no npm packages.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const CHROME = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = Number(process.env.CDP_PORT || 9333);
const OUT_DIR = path.join(process.cwd(), ".shots");

function extractPage() {
  const src = fs.readFileSync("bot/worker.ts", "utf8");
  const marker = "const ADMIN_HTML = `";
  const from = src.indexOf(marker) + marker.length;
  const to = src.lastIndexOf("`;");
  if (from < marker.length || to < 0) throw new Error("could not find ADMIN_HTML in bot/worker.ts");
  return new Function("return `" + src.slice(from, to) + "`;")();
}

// The host portal is a separate page module, so it gets its own extractor.
function extractHostPage() {
  const src = fs.readFileSync("bot/host-portal-page.js", "utf8");
  const marker = "export const HOST_HTML = `";
  const from = src.indexOf(marker) + marker.length;
  const to = src.lastIndexOf("`;");
  if (from < marker.length || to < 0) throw new Error("could not find HOST_HTML in bot/host-portal-page.js");
  return new Function("return `" + src.slice(from, to) + "`;")();
}

const HEALTH = {
  database: "ok",
  propertyStore: "ok",
  twilioConfigured: true,
  aiConfigured: true,
  signatureValidationEnabled: true,
  missingHostPhone: 0,
  missingTextNumber: 0,
};

const PROPERTIES = [
  { id: "SUNSET", name: "Sunset Villa", active: true, asked: 168, escalated: 14, answerCount: 12, twilioNumber: "+18635550142", openEscalations: 2, lastActivity: "2026-10-26T09:12:00Z" },
  { id: "HARBOR", name: "Harbor House", active: true, asked: 121, escalated: 11, answerCount: 9, twilioNumber: "+18635550143", openEscalations: 0, lastActivity: "2026-10-26T06:40:00Z" },
  { id: "LAKEVIEW", name: "Lakeview Lodge", active: true, asked: 74, escalated: 8, answerCount: 7, twilioNumber: "+18635550144", openEscalations: 1, lastActivity: "2026-10-25T18:05:00Z" },
  { id: "PALM", name: "Palm Court", active: true, asked: 39, escalated: 5, answerCount: 6, twilioNumber: "", openEscalations: 0, lastActivity: "2026-10-24T14:30:00Z" },
  { id: "OAK", name: "Oak Terrace", active: false, asked: 0, escalated: 0, answerCount: 0, twilioNumber: "", openEscalations: 0, lastActivity: null },
];

// Hosts tab rows, matching what /admin/api/hosts returns.
const HOSTS = [
  { id: "SUNSET", name: "Sunset Villa", active: 1, hostId: "host_dana", hostName: "Dana Whitfield", hostEmail: "dana@example.com", hostPortal: { configured: true, updatedAt: "2026-11-05T18:20:00Z" }, guideSections: 12 },
  { id: "HARBOR", name: "Harbor House", active: 1, hostId: "host_dana", hostName: "Dana Whitfield", hostEmail: "dana@example.com", hostPortal: { configured: true, updatedAt: "2026-11-05T18:20:00Z" }, guideSections: 9 },
  { id: "LAKEVIEW", name: "Lakeview Lodge", active: 1, hostId: "host_dana", hostName: "Dana Whitfield", hostEmail: "dana@example.com", hostPortal: { configured: false, updatedAt: null }, guideSections: 7 },
  { id: "PALM", name: "Palm Court", active: 1, hostId: "host_dana", hostName: "Dana Whitfield", hostEmail: "dana@example.com", hostPortal: { configured: false, updatedAt: null }, guideSections: 6 },
  { id: "OAK", name: "Oak Terrace", active: 0, hostId: "host_dana", hostName: "Dana Whitfield", hostEmail: "dana@example.com", hostPortal: { configured: false, updatedAt: null }, guideSections: 0 },
];

const SESSIONS = {
  sessions: [
    { id: "S1", current: true, ip: "203.0.113.24", userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36", createdAt: "2026-11-05T09:12:00Z" },
    { id: "S2", current: false, ip: "198.51.100.7", userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 Version/18.2 Mobile/15E148 Safari/604.1", createdAt: "2026-11-04T21:40:00Z" },
  ],
};

const AUDIT = {
  events: [
    { action: "admin_password_changed", createdAt: "2026-11-05 09:14", propertyName: "" },
    { action: "property_updated", createdAt: "2026-11-04 17:02", propertyName: "Sunset Villa" },
    { action: "admin_session_revoked", createdAt: "2026-11-03 08:31", propertyName: "" },
  ],
};

// What the live endpoint returns for the open queue, so a capture taken in live
// mode does not show the "queue unavailable" fallback instead of the card.
const AWAITING = {
  open: 3,
  oldestMinutes: 291,
  over1h: 2,
  over4h: 1,
  byProperty: [
    { name: "Sunset Villa", open: 2, oldestMinutes: 291 },
    { name: "Harbor House", open: 1, oldestMinutes: 47 },
  ],
};

// What the live endpoint returns for the day-part card, so a capture taken in
// live mode shows the card instead of its "no messages" fallback.
const DAY_PARTS = [
  { key: "overnight", label: "Overnight", hours: "12–6am", inbound: 1, share: 8.3 },
  { key: "morning", label: "Morning", hours: "6am–12pm", inbound: 4, share: 33.3 },
  { key: "afternoon", label: "Afternoon", hours: "12–6pm", inbound: 5, share: 41.7 },
  { key: "evening", label: "Evening", hours: "6pm–12am", inbound: 2, share: 16.7 },
];

const LIVE_METRICS = {
  guestMessages24h: 12,
  resolvedGuestMessages24h: 10,
  openEscalations: 2,
  escalations24h: 2,
  failedHostNotifications24h: 0,
  rateLimitedMessages24h: 0,
  failedAI24h: 0,
  aiInteractions24h: 13,
  aiAnswers24h: 11,
  avgAILatencyMs24h: 1180.5,
  avgHostResponseMinutes30d: 8.4,
  measuredAt: "2026-10-26 11:22:33",
};

// Set the state instead of toggling it. These flags are declared with `let` in
// the page script, which a later classic script can still assign, and an
// assignment stays correct however many times the driver runs.
const DRIVE = {
  analytics: "analyticsSample = true; loadAnalytics();",
  insights: "insightsSample = true; loadInsights();",
  operations: "operationsSample = true; loadOperations();",
  // Not a tab: the property editor and its knowledge-import card live behind a
  // card click, so they need the list up first and then the property opened.
  property: "openProperty('SUNSET');",
};

// One property in the shape the editor reads back from /admin/api/property.
const PROPERTY = {
  id: "SUNSET",
  name: "Sunset Villa",
  address: "123 Main St, Davenport, FL 33837",
  twilioNumber: "+18635550142",
  hostPhone: "+18635550100",
  hostEmail: "host@example.com",
  active: 1,
  asked: 168,
  escalated: 14,
  answerCount: 12,
  openEscalations: 2,
  lastActivity: "2026-10-26T09:12:00Z",
  // Shapes match what the editor reads back: topics/keywords/reply, not
  // question/answer — the renderer calls .join() on keywords directly.
  answers: [
    { topic: "Checkout", keywords: ["checkout", "check out"], reply: "Checkout is 10am. Late checkout is not guaranteed." },
    { topic: "Trash", keywords: ["bins", "trash"], reply: "Bins go out Tuesday night, at the side of the garage." },
  ],
  secrets: [{ keywords: ["gate code", "gate"], reply: "4821" }],
};

async function waitForDevtools(timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const list = await (await fetch("http://127.0.0.1:" + PORT + "/json/list")).json();
      const page = list.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      /* not listening yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error("Chrome devtools never came up on port " + PORT);
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let nextId = 1;
    const pending = new Map();
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (!msg.id || !pending.has(msg.id)) return;
      const { ok, fail } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) fail(new Error(msg.method + ": " + JSON.stringify(msg.error)));
      else ok(msg.result);
    });
    ws.addEventListener("error", reject);
    ws.addEventListener("open", () =>
      resolve({
        send(method, params = {}) {
          const id = nextId++;
          return new Promise((ok, fail) => {
            pending.set(id, { ok, fail });
            ws.send(JSON.stringify({ id, method, params }));
          });
        },
      }),
    );
  });
}

(async () => {
  const tab = process.argv[2] || "analytics";
  const width = Number(process.argv[3] || 1440);
  const name = process.argv[4] || tab + "-" + width;
  const mode = process.argv[5] || "demo";
  // "login" is not a tab: it is the state before unlock, so it must NOT be driven
  // past the password card.
  const isLogin = tab === "login";
  // The marketing site is served from site/ with relative asset paths, so it is
  // loaded in place rather than copied into .shots/ like the inline admin page.
  const isLanding = tab === "landing";
  // The host portal is its own page. "host" and "host-guide" render the sample
  // dashboard; "host-login" stops at the sign-in card.
  const isHost = tab === "host" || tab === "host-guide" || tab === "host-login";
  const isHostLogin = tab === "host-login";
  const hostView = tab === "host-guide" ? "guide" : "activity";

  const { sampleAnalytics } = await import("../bot/analytics.js");
  const { sampleHostOverview } = await import("../bot/host-portal.js");
  const { sampleOperations } = await import("../bot/operations.js");
  const { sampleInsights } = await import("../bot/insights.js");
  const { LEADS } = await import("../bot/leads.js");
  const now = new Date();

  const routes = {
    "/admin/api/analytics": { ...sampleAnalytics(now), sample: false },
    "/admin/api/analytics?sample=1": sampleAnalytics(now),
    "/admin/api/insights": { ...sampleInsights(now), sample: false },
    "/admin/api/insights?sample=1": sampleInsights(now),
    "/admin/api/operations": { sample: false, metrics: LIVE_METRICS, dayParts: DAY_PARTS, awaiting: AWAITING },
    "/admin/api/operations?sample=1": sampleOperations(now),
    "/admin/api/health": HEALTH,
    "/admin/api/features": { insights: true },
    "/admin/api/hosts": { hosts: HOSTS },
    "/admin/api/sessions": SESSIONS,
    "/admin/api/audit": AUDIT,
    "/admin/api/properties": { properties: PROPERTIES },
    "/admin/api/property?id=SUNSET": PROPERTY,
    // The real prospect list: a screenshot of empty rows proves nothing.
    "/admin/api/leads": { leads: LEADS, progress: {} },
    "/admin/api/gmail/status": { ready: false, missing: ["GMAIL_CLIENT_ID"], connected: false },
  };

  // Shim before the page script so its boot-time calls see it.
  const hostShim = [
    "<script>",
    "window.fetch = async function (url) {",
    isHostLogin
      ? "  return { ok: false, status: 401, statusText: 'Unauthorized', json: async function () { return { error: 'Sign in to view this dashboard.' }; } };"
      : "  return { ok: true, status: 200, statusText: 'OK', json: async function () { return " + JSON.stringify(sampleHostOverview("stay")) + "; } };",
    "};",
    "</script>",
  ].join("\n");

  const shim = [
    "<script>",
    "window.fetch = async function (url) {",
    // Signed out: refuse the session check so the sign-in card stays up instead
    // of restoreSession() hiding it behind the dashboard.
    isLogin
      ? "  return { ok: false, status: 403, statusText: 'Forbidden', json: async function () { return { error: 'unauthorized' }; } };"
      : "",
    "  var table = " + JSON.stringify(routes) + ";",
    "  var body = Object.prototype.hasOwnProperty.call(table, url) ? table[url] : { error: 'no route ' + url };",
    "  return { ok: true, status: 200, statusText: 'OK', json: async function () { return body; } };",
    "};",
    "</script>",
  ].join("\n");

  const switchCall = mode === "demo" ? DRIVE[tab] || "" : "";
  const drive = isLogin ? "" : [
    "<script>",
    "function reveal() {",
    "  document.getElementById('login').classList.add('hidden');",
    "  document.getElementById('tabBar').classList.remove('hidden');",
    "  showTab('" + (tab === 'property' ? 'properties' : tab) + "');",
    "}",
    "setTimeout(function () { reveal(); }, 200);",
    "setTimeout(function () { reveal(); " + switchCall + " }, 550);",
    "setTimeout(function () { reveal(); }, 1100);",
    "</script>",
  ].join("\n");

  // Transitions only: headless virtual time doesn't advance the compositor, so a
  // fading nav item would be captured half-applied and look like a state bug.
  const pinTransitions = "<style>*{transition:none!important;animation:none!important}</style>";

  fs.mkdirSync(OUT_DIR, { recursive: true });
  let pageFile = "";
  if (!isLanding) {
    let html = isHost ? extractHostPage() : extractPage();
    html = html.replace("</head>", pinTransitions + "</head>");
    html = html.replace("<script>", (isHost ? hostShim : shim) + "\n<script>");
    if (!isHost) html = html.replace("</body>", drive + "\n</body>");
    pageFile = path.join(OUT_DIR, name + ".html");
    fs.writeFileSync(pageFile, html);
  }

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "stayxi-shot-"));
  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--no-first-run",
      "--remote-debugging-port=" + PORT,
      "--user-data-dir=" + profile,
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  let client;
  try {
    client = await connect(await waitForDevtools(25000));
    await client.send("Page.enable");
    await client.send("Emulation.setDeviceMetricsOverride", {
      width,
      height: 900,
      deviceScaleFactor: 1,
      mobile: width < 900,
      screenWidth: width,
      screenHeight: 900,
    });
    let pageUrl = isLanding
      ? "file:///" + path.resolve("site/index.html").replace(/\\/g, "/")
      : "file:///" + path.resolve(pageFile).replace(/\\/g, "/");
    if (isHost) {
      pageUrl += isHostLogin ? "?signedout=1" : "?sample=1" + (hostView === "guide" ? "&view=guide" : "");
    }
    await client.send("Page.navigate", { url: pageUrl });
    await new Promise((resolve) => setTimeout(resolve, 2600));

    // Do not trust the in-page timers: on a narrow, emulated-mobile viewport
    // they sometimes had not run yet and the shot captured the login card.
    // Forcing the same reveal here makes the capture deterministic.
    if (isLanding) {
      // Reveal-on-scroll sections start hidden; a full-page capture never
      // scrolls them into view, so show them and stop the motion first.
      await client.send("Runtime.evaluate", {
        expression: "(() => { const style = document.createElement('style'); style.textContent = '*{transition:none!important;content-visibility:visible!important}'; document.head.appendChild(style); document.querySelectorAll('.reveal').forEach((el) => el.classList.add('in')); })()",
      });
      await new Promise((resolve) => setTimeout(resolve, 500));
    } else if (!isLogin && !isHost) {
      await client.send("Runtime.evaluate", { expression: "reveal(); " + switchCall });
      await new Promise((resolve) => setTimeout(resolve, 400));
    }

    const metrics = await client.send("Page.getLayoutMetrics");
    const size = metrics.cssContentSize || metrics.contentSize;
    const shot = await client.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width, height: Math.ceil(size.height), scale: 1 },
    });

    const outFile = path.join(OUT_DIR, name + ".png");
    fs.writeFileSync(outFile, Buffer.from(shot.data, "base64"));
    console.log(
      path.relative(process.cwd(), outFile) + "  " + width + "x" + Math.ceil(size.height) +
        "  " + Math.round(fs.statSync(outFile).size / 1024) + " KB",
    );
  } finally {
    try {
      if (client) await client.send("Browser.close");
    } catch {
      /* already gone */
    }
    chrome.kill();
  }
})().catch((err) => {
  console.log("screenshot failed: " + (err && err.message));
  process.exit(1);
});

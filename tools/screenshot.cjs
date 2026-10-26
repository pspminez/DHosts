#!/usr/bin/env node
// tools/screenshot.cjs — full-page screenshot of any admin tab.
//
//   node tools/screenshot.cjs <tab> [width] [out] [demo|live]
//   node tools/screenshot.cjs analytics 1440 analytics-demo
//   node tools/screenshot.cjs insights 390 insights-phone
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

const DRIVE = {
  analytics: "toggleSample();",
  insights: "toggleInsightsSample();",
  operations: "toggleOperationsSample();",
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

  const { sampleAnalytics } = await import("../bot/analytics.js");
  const { sampleOperations } = await import("../bot/operations.js");
  const { sampleInsights } = await import("../bot/insights.js");
  const now = new Date();

  const routes = {
    "/admin/api/analytics": { ...sampleAnalytics(now), sample: false },
    "/admin/api/analytics?sample=1": sampleAnalytics(now),
    "/admin/api/insights": { ...sampleInsights(now), sample: false },
    "/admin/api/insights?sample=1": sampleInsights(now),
    "/admin/api/operations": { sample: false, metrics: LIVE_METRICS },
    "/admin/api/operations?sample=1": sampleOperations(now),
    "/admin/api/health": HEALTH,
    "/admin/api/features": { insights: true },
    "/admin/api/properties": { properties: PROPERTIES },
  };

  // Shim before the page script so its boot-time calls see it.
  const shim = [
    "<script>",
    "window.fetch = async function (url) {",
    "  var table = " + JSON.stringify(routes) + ";",
    "  var body = Object.prototype.hasOwnProperty.call(table, url) ? table[url] : { error: 'no route ' + url };",
    "  return { ok: true, status: 200, statusText: 'OK', json: async function () { return body; } };",
    "};",
    "</script>",
  ].join("\n");

  const switchCall = mode === "demo" ? DRIVE[tab] || "" : "";
  const drive = [
    "<script>",
    "function reveal() {",
    "  document.getElementById('login').classList.add('hidden');",
    "  document.getElementById('tabBar').classList.remove('hidden');",
    "  showTab('" + tab + "');",
    "}",
    "setTimeout(function () { reveal(); }, 200);",
    "setTimeout(function () { reveal(); " + switchCall + " }, 550);",
    "setTimeout(function () { reveal(); }, 1100);",
    "</script>",
  ].join("\n");

  // Transitions only: headless virtual time doesn't advance the compositor, so a
  // fading nav item would be captured half-applied and look like a state bug.
  const pinTransitions = "<style>*{transition:none!important;animation:none!important}</style>";

  let html = extractPage();
  html = html.replace("</head>", pinTransitions + "</head>");
  html = html.replace("<script>", shim + "\n<script>");
  html = html.replace("</body>", drive + "\n</body>");

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const pageFile = path.join(OUT_DIR, name + ".html");
  fs.writeFileSync(pageFile, html);

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
    await client.send("Page.navigate", {
      url: "file:///" + path.resolve(pageFile).replace(/\\/g, "/"),
    });
    await new Promise((resolve) => setTimeout(resolve, 2600));

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

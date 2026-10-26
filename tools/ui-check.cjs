#!/usr/bin/env node
// tools/ui-check.cjs — the gate for edits to the inline admin page.
//
//   node tools/ui-check.cjs
//
// Three classes of failure this catches, all of which have actually happened in
// this file:
//   1. The page script stops parsing — every button silently does nothing.
//   2. The script looks up an element or handler that no longer exists.
//   3. A renderer throws or writes the wrong thing, e.g. appending stat tiles
//      twice because two loads overlapped.
//
// It runs the real page script against a stub DOM, so no browser or network is
// needed. Pair it with tools/screenshot.cjs when the question is "does it look
// right" rather than "does it work".

const fs = require("fs");

function missingScript(open, close, bodyEnd) {
  return open < 0 || close < 0 || close > bodyEnd;
}

function extract() {
  const src = fs.readFileSync("bot/worker.ts", "utf8");
  const marker = "const ADMIN_HTML = `";
  const from = src.indexOf(marker) + marker.length;
  const to = src.lastIndexOf("`;");
  if (from < marker.length || to < 0) throw new Error("could not find ADMIN_HTML in bot/worker.ts");
  const html = new Function("return `" + src.slice(from, to) + "`;")();
  // Find the page script relative to </body> rather than assuming it is the last
  // thing before it: the shell markup sits in between.
  const bodyEnd = html.lastIndexOf("</body>");
  const open = html.lastIndexOf("<script>", bodyEnd);
  const close = html.indexOf("</script>", open);
  if (missingScript(open, close, bodyEnd)) throw new Error("could not find the page script");
  return { html, script: html.slice(open + "<script>".length, close) };
}

function makeElement(tag) {
  const classes = new Set();
  const attrs = {};
  let text = "";
  const el = {
    tagName: tag,
    id: "",
    className: "",
    value: "",
    checked: false,
    title: "",
    href: "",
    style: {},
    dataset: {},
    children: [],
    __attrs: attrs,
    append(...nodes) {
      for (const node of nodes) el.children.push(node);
    },
    appendChild(node) {
      el.children.push(node);
      return node;
    },
    addEventListener() {},
    removeEventListener() {},
    setAttribute(name, value) {
      attrs[name] = String(value);
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null;
    },
    removeAttribute(name) {
      delete attrs[name];
    },
    click() {},
    focus() {},
    querySelectorAll() {
      return [];
    },
  };
  // clearNode() walks firstChild/removeChild, so both have to behave.
  Object.defineProperty(el, "firstChild", {
    get() {
      return el.children[0] || null;
    },
  });
  el.removeChild = (node) => {
    const index = el.children.indexOf(node);
    if (index >= 0) el.children.splice(index, 1);
    return node;
  };
  // Like the real DOM: writing "" drops the children.
  Object.defineProperty(el, "textContent", {
    get() {
      return text;
    },
    set(value) {
      text = value;
      if (value === "") el.children.length = 0;
    },
  });
  el.classList = {
    add(...names) {
      names.forEach((n) => classes.add(n));
    },
    remove(...names) {
      names.forEach((n) => classes.delete(n));
    },
    contains(n) {
      return classes.has(n);
    },
    toggle(n, force) {
      const want = force === undefined ? !classes.has(n) : Boolean(force);
      if (want) classes.add(n);
      else classes.delete(n);
      return want;
    },
  };
  return el;
}

async function runPage({ html, script, routes }) {
  const registry = {};
  for (const match of html.matchAll(/\bid="([^"]+)"/g)) {
    const el = makeElement("div");
    el.id = match[1];
    registry[match[1]] = el;
  }
  // Nav items are looked up by [data-tab], so the stub has to provide them or
  // the active-state logic is never exercised.
  const navItems = [...html.matchAll(/data-tab="([^"]+)"/g)].map((match) => {
    const el = makeElement("button");
    el.setAttribute("data-tab", match[1]);
    return el;
  });

  const documentStub = {
    getElementById: (id) => registry[id] || null,
    createElement: makeElement,
    createElementNS: (_ns, tag) => makeElement(tag),
    querySelectorAll: (selector) => (selector === "[data-tab]" ? navItems : []),
    querySelector: () => null,
    addEventListener: () => {},
    body: makeElement("body"),
    documentElement: makeElement("html"),
  };

  const calls = [];
  const requests = [];
  const fetchStub = async (url, init) => {
    calls.push(url);
    requests.push(((init && init.method) || "GET") + " " + url);
    if (!(url in routes)) {
      return { ok: false, status: 404, statusText: "Not Found", json: async () => ({ error: "no route " + url }) };
    }
    return { ok: true, status: 200, statusText: "OK", json: async () => routes[url] };
  };
  const windowStub = {
    location: { href: "", reload() {} },
    addEventListener() {},
    removeEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {} }),
  };

  const exported = [
    "loadOperations: loadOperations",
    "loadInsights: loadInsights",
    "loadAnalytics: loadAnalytics",
    "applyFeatures: applyFeatures",
    "toggleInsights: toggleInsightsSample",
    "renderList: renderList",
    "renderLeads: renderLeads",
    "showTab: showTab",
    "setProperties: (v) => { properties = v; }",
    "setLeads: (v) => { leads = v; }",
    "setCurrent: (v) => { current = v; }",
    "importKnowledge: importKnowledge",
  ].join(", ");

  const factory = new Function(
    "document", "window", "location", "localStorage", "navigator", "Blob", "URL", "fetch", "console", "confirm", "globalThis",
    script + "\n;globalThis.__exports = {" + exported + "};",
  );
  factory(
    documentStub,
    windowStub,
    { href: "", reload() {}, hash: "" },
    { getItem: () => null, setItem() {}, removeItem() {} },
    {},
    function Blob() {},
    { createObjectURL: () => "blob:x", revokeObjectURL() {} },
    fetchStub,
    console,
    () => true,
    globalThis,
  );

  const helpers = globalThis.__exports;
  delete globalThis.__exports;
  return { registry, navItems, calls, requests, helpers };
}

const checks = [];
function check(label, actual, expected) {
  checks.push({ ok: JSON.stringify(actual) === JSON.stringify(expected), label, actual, expected });
}

function wiring(html, script) {
  const failures = [];
  new Function(script); // throws on a syntax error

  const staticIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const dynamic = new Set();
  for (const m of script.matchAll(/\.id\s*=\s*["'`]([A-Za-z][\w-]*)/g)) dynamic.add(m[1]);
  for (const m of script.matchAll(/\bid\s*[:=]\s*["'`]([A-Za-z][\w-]*)/g)) dynamic.add(m[1]);
  const prefixes = [...dynamic];

  const wanted = new Set();
  for (const m of script.matchAll(/\$\(\s*["'`]([^"'`]+)["'`]\s*\)/g)) wanted.add(m[1]);
  for (const m of script.matchAll(/getElementById\(\s*["'`]([^"'`]+)["'`]\s*\)/g)) wanted.add(m[1]);
  const missing = [...wanted].filter(
    (id) => !staticIds.has(id) && !dynamic.has(id) && !prefixes.some((p) => p.endsWith("-") && id.startsWith(p)),
  );
  if (missing.length) failures.push("script looks up ids that do not exist: " + missing.join(", "));

  const defined = new Set();
  for (const m of script.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)) defined.add(m[1]);
  const allowed = new Set(["$", "alert", "confirm", "prompt", "fetch", "Number", "String", "Boolean", "JSON", "Math", "Date", "parseInt", "parseFloat", "encodeURIComponent", "setTimeout", "console", "event"]);
  const handlers = new Set();
  for (const m of html.matchAll(/\son(?:click|input|change|submit|keydown|keyup|blur|focus)="([^"]*)"/g)) {
    if (m[1].includes("$('")) continue; // calls the helper directly
    for (const call of m[1].matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)) handlers.add(call[1]);
  }
  const undefinedHandlers = [...handlers].filter((n) => !defined.has(n) && !allowed.has(n));
  if (undefinedHandlers.length) failures.push("inline handlers call undefined functions: " + undefinedHandlers.join(", "));

  console.log("wiring: " + staticIds.size + " ids, " + wanted.size + " referenced, " + handlers.size + " handlers");
  for (const failure of failures) console.log("  FAIL " + failure);
  return failures;
}

const HEALTH = { database: "ok", propertyStore: "ok", twilioConfigured: true, aiConfigured: true, signatureValidationEnabled: true, missingHostPhone: 0, missingTextNumber: 0 };
// Mirrors the demo shape: one property past the four-hour stale threshold and
// one inside it, so both the warn and ok styling are exercised.
const AWAITING = {
  open: 4,
  oldestMinutes: 291,
  over1h: 3,
  over4h: 1,
  byProperty: [
    { name: "Sunset Villa", open: 2, oldestMinutes: 291 },
    { name: "Harbor House", open: 1, oldestMinutes: 96 },
  ],
};

const LIVE_METRICS = { guestMessages24h: 12, resolvedGuestMessages24h: 10, openEscalations: 2, escalations24h: 2, failedHostNotifications24h: 0, rateLimitedMessages24h: 0, failedAI24h: 0, aiInteractions24h: 13, aiAnswers24h: 11, avgAILatencyMs24h: 1180.5, avgHostResponseMinutes30d: 8.4, measuredAt: "2026-10-26 11:22:33" };
const PROPERTIES = [
  { id: "sunset", name: "Sunset Villa", active: true, asked: 168, escalated: 14, answerCount: 12, twilioNumber: "+18635550142", openEscalations: 2, lastActivity: "2026-10-26T09:00:00Z" },
  { id: "harbor", name: "Harbor House", active: false, asked: 0, escalated: 0, answerCount: 0, twilioNumber: "", openEscalations: 0, lastActivity: null },
];
const SUNSET_PROPERTY = {
  id: "SUNSET",
  name: "Sunset Villa",
  address: "",
  hostId: "host_dana",
  twilioNumber: "+18635550142",
  rateLimitReply: "Let me get the host to help you with this.",
  unknownReply: "Good question — let me check with your host and get right back to you.",
  active: 1,
  secrets: [{ topic: "Gate code", keywords: ["gate"], reply: "Your gate code is 4821." }],
  answers: [{ topic: "Bins", keywords: ["bins"], reply: "Bins go out Monday night." }],
  answerCount: 1,
  checkinTime: "16:00",
  checkoutTime: "10:00",
  wifiSsid: "SunsetGuest",
  accessInstructions: "Gate code at the keypad.",
  emergencyContacts: "911",
  policies: [],
  escalationRules: [],
  asked: 168,
  escalated: 14,
  openEscalations: 2,
  lastActivity: "2026-10-26T09:00:00Z",
  hostPhone: "+18635550100",
  hostEmail: "host@example.com",
  criticalChangesPending: true,
};

const LEADS = [
  { name: "Real Joy Vacations", location: "Destin, FL", phone: "+18505551234", email: "stay@realjoy.com", website: "https://www.realjoy.com", leadStatus: "new", fit: "A", contactName: "Dana", propertyType: "Vacation rental operator", address: "1 Main St" },
  { name: "No Email Co", location: "Davenport, FL", phone: "", email: "", website: "https://x.com", leadStatus: "contacted", fit: "C", contactName: "", propertyType: "Vacation rental operator", address: "" },
];

(async () => {
  const { html, script } = extract();
  const failures = wiring(html, script);

  const { sampleAnalytics } = await import("../bot/analytics.js");
  const { sampleOperations } = await import("../bot/operations.js");
  const { sampleInsights } = await import("../bot/insights.js");
  const now = new Date(Date.UTC(2026, 9, 26, 12, 0, 0));

  const insightsSample = sampleInsights(now);
  const operationsSample = sampleOperations(now);
  const routes = {
    "/admin/api/analytics": { ...sampleAnalytics(now), sample: false },
    "/admin/api/analytics?sample=1": sampleAnalytics(now),
    "/admin/api/insights": { ...insightsSample, sample: false },
    "/admin/api/insights?sample=1": insightsSample,
    "/admin/api/operations": { sample: false, metrics: LIVE_METRICS, awaiting: AWAITING },
    "/admin/api/operations?sample=1": operationsSample,
    "/admin/api/features": { insights: true },
    "/admin/api/health": HEALTH,
    "/admin/api/properties": { properties: PROPERTIES },
    "/admin/api/property?id=SUNSET": SUNSET_PROPERTY,
  };

  // ---- shell: every view has a nav item, and showTab marks exactly one -----
  const page = await runPage({ html, script, routes });
  const views = ["properties", "leads", "analytics", "insights", "operations", "pilot"];
  check("every view has a nav item", views.filter((v) => page.navItems.some((n) => n.getAttribute("data-tab") === v)), views);
  page.helpers.showTab("insights");
  check(
    "showTab marks exactly one nav item active",
    page.navItems.filter((n) => n.classList.contains("active")).map((n) => n.getAttribute("data-tab")),
    ["insights"],
  );
  page.helpers.showTab("properties");
  check(
    "switching views moves the active marker",
    page.navItems.filter((n) => n.classList.contains("active")).map((n) => n.getAttribute("data-tab")),
    ["properties"],
  );
  // The properties view keeps its old id, so map it explicitly.
  const viewIds = { properties: "listView", leads: "leadsView", analytics: "analyticsView", insights: "insightsView", operations: "operationsView", pilot: "pilotView" };
  check(
    "only one view is visible at a time",
    views.filter((v) => !page.registry[viewIds[v]].classList.contains("hidden")),
    ["properties"],
  );

  // ---- properties list ----------------------------------------------------
  page.helpers.setProperties(PROPERTIES);
  page.helpers.renderList();
  check("property cards rendered", page.registry.propList.children.length, 2);
  check("property stamp", page.registry.listStamp.textContent, "2 properties · 1 live");
  check("property tiles", page.registry.propList.children[0].children[2].children.map((t) => t.children[0].textContent), ["168", "14", "12"]);

  // ---- leads list ---------------------------------------------------------
  page.helpers.setLeads(LEADS);
  page.helpers.renderLeads();
  check("lead rows rendered", page.registry.leadList.children.length, 2);
  check("lead summary", page.registry.leadsSummary.textContent, "1 of 2 leads have a verified public email");

  // ---- knowledge import ---------------------------------------------------
  // This path had no coverage at all. A wrong shape here replaces a property's
  // knowledge, and the staged-critical-changes rule is the only thing standing
  // between an import and a guest getting a stale gate code.
  const importFile = (payload, size) => {
    const input = {
      files: [
        {
          name: "sunset-knowledge.json",
          size: size === undefined ? 200 : size,
          text: async () => (typeof payload === "string" ? payload : JSON.stringify(payload)),
        },
      ],
      value: "C:\\fakepath\\sunset-knowledge.json",
    };
    return input;
  };

  const importer = await runPage({ html, script, routes });
  importer.helpers.setCurrent({ id: "SUNSET", name: "Sunset Villa" });
  const stagedFile = importFile({
    secrets: [],
    answers: [{ topic: "Bins", keywords: ["bins"], reply: "Bins go out Monday night." }],
  });
  await importer.helpers.importKnowledge(stagedFile);
  check(
    "import sends secrets and answers to the property endpoint",
    importer.requests.includes("PUT /admin/api/property?id=SUNSET"),
    true,
  );
  check(
    "import tells the host critical knowledge is staged",
    importer.registry.knowledgeStatus.textContent,
    "Imported. Critical knowledge is staged and requires review before publishing.",
  );
  check("import clears the file input so the same file can be picked again", stagedFile.value, "");

  const savedImport = await runPage({
    html,
    script,
    routes: { ...routes, "/admin/api/property?id=SUNSET": { ...SUNSET_PROPERTY, criticalChangesPending: false } },
  });
  savedImport.helpers.setCurrent({ id: "SUNSET", name: "Sunset Villa" });
  await savedImport.helpers.importKnowledge(importFile({ secrets: [], answers: [] }));
  check("import says so when nothing needed staging", savedImport.registry.knowledgeStatus.textContent, "Imported and saved.");

  const badImport = await runPage({ html, script, routes });
  badImport.helpers.setCurrent({ id: "SUNSET", name: "Sunset Villa" });
  await badImport.helpers.importKnowledge(importFile({ secrets: {}, answers: [] }));
  check(
    "import rejects a file without secrets and answers arrays",
    badImport.registry.knowledgeStatus.textContent,
    "Expected a JSON object with secrets and answers arrays.",
  );
  check(
    "a rejected import sends nothing to the server",
    badImport.requests.filter((request) => request.startsWith("PUT")).length,
    0,
  );
  await badImport.helpers.importKnowledge(importFile({ secrets: [], answers: [] }, 2 * 1024 * 1024));
  check(
    "import refuses a file over 1 MB",
    badImport.registry.knowledgeStatus.textContent,
    "Knowledge file must be 1 MB or smaller.",
  );

  // ---- analytics ----------------------------------------------------------
  // Added after a screenshot showed "themeLabel is not defined": the page script
  // had been made to call a server-side import, which the browser cannot see.
  // Rendering it here fails loudly instead of leaving a half-empty dashboard.
  const analyticsPage = await runPage({ html, script, routes });
  await analyticsPage.helpers.loadAnalytics();
  const analyticsSample = sampleAnalytics(now);
  check(
    "analytics hero matches the payload",
    analyticsPage.registry.heroAnswered.textContent,
    Number(analyticsSample.totals.inbound).toLocaleString(),
  );
  check("analytics donut drawn", analyticsPage.registry.mixDonut.children.length > 0, true);
  // The chart draws bars plus their labels plus a baseline, so count at least
  // one element per bucket rather than pinning the exact node count.
  check("analytics weekly bars drawn", analyticsPage.registry.weeklyBars.children.length >= 8, true);
  check(
    "analytics common-request rows",
    analyticsPage.registry.commonRequests.children.length,
    analyticsSample.commonRequests.length,
  );
  check(
    "analytics common-request label comes from the payload",
    analyticsPage.registry.commonRequests.children[0].children[0].textContent,
    analyticsSample.commonRequests[0].label,
  );
  check("analytics rendered without an error", analyticsPage.registry.dashStamp.textContent.startsWith("Updated"), true);

  // ---- insights -----------------------------------------------------------
  await page.helpers.loadInsights();
  check("insights total", page.registry.insightTotal.textContent, String(insightsSample.totals.messages));
  check("insights worst theme", page.registry.insightWorst.textContent, insightsSample.unanswered[0].label);
  check("insight theme rows", page.registry.insightThemesList.children.length, insightsSample.themes.length);
  check("insight property rows", page.registry.insightProperties.children[0].children[1].children.length, insightsSample.properties.length);
  page.helpers.toggleInsights();
  await new Promise((r) => setTimeout(r, 40));
  check("insights demo requests the sample endpoint", page.calls.includes("/admin/api/insights?sample=1"), true);
  check("insights banner follows the sample flag", page.registry.insightsBanner.classList.contains("hidden"), false);

  // ---- operations, including the overlapping-load regression --------------
  const ops = await runPage({ html, script, routes });
  const first = ops.helpers.loadOperations();
  const second = ops.helpers.loadOperations();
  await Promise.all([first, second]);
  check("overlapping loads leave six stat tiles, not twelve", ops.registry.operationMetrics.children.length, 6);
  check("overlapping loads leave seven health rows", ops.registry.operationHealth.children.length, 7);
  check("operations stamp", ops.registry.operationsStatus.textContent, "Updated 2026-10-26 11:22:33.");

  // ---- questions awaiting a host reply ------------------------------------
  check("awaiting count", ops.registry.opAwaitingCount.textContent, "4");
  check("awaiting oldest age", ops.registry.opAwaitingAge.textContent, "oldest waiting 4 h 51 m");
  check("awaiting ageing buckets", ops.registry.opAwaitingBuckets.textContent, "3 waiting over an hour · 1 over four hours");
  check("awaiting per-property rows", ops.registry.opAwaitingList.children.length, AWAITING.byProperty.length);
  check(
    "awaiting row shows count and age",
    ops.registry.opAwaitingList.children[0].children.map((cell) => cell.textContent).slice(1),
    ["Sunset Villa", "2 · 4 h 51 m"],
  );
  check("stale waiting row is flagged", ops.registry.opAwaitingList.children[0].children[0].className, "op-dot warn");
  check("fresh waiting row is not flagged", ops.registry.opAwaitingList.children[1].children[0].className, "op-dot ok");

  const noQueue = await runPage({
    html,
    script,
    routes: { ...routes, "/admin/api/operations": { sample: false, metrics: LIVE_METRICS, awaiting: null } },
  });
  await noQueue.helpers.loadOperations();
  check("unreadable queue degrades to a dash", noQueue.registry.opAwaitingCount.textContent, "—");
  check("unreadable queue says so", noQueue.registry.opAwaitingAge.textContent, "queue unavailable");

  const quietQueue = await runPage({
    html,
    script,
    routes: { ...routes, "/admin/api/operations": { sample: false, metrics: LIVE_METRICS, awaiting: { open: 0, oldestMinutes: null, over1h: 0, over4h: 0, byProperty: [] } } },
  });
  await quietQueue.helpers.loadOperations();
  check("empty queue says nothing is waiting", quietQueue.registry.opAwaitingAge.textContent, "nothing waiting");
  check("empty queue copy", quietQueue.registry.opAwaitingBuckets.textContent, "every guest question has an answer");

  // ---- insights entitlement gate ------------------------------------------
  const entitled = await runPage({ html, script, routes });
  await entitled.helpers.applyFeatures();
  check("entitled deployment shows the insights nav item", entitled.registry.navInsights.classList.contains("hidden"), false);

  const gated = await runPage({ html, script, routes: { ...routes, "/admin/api/features": { insights: false } } });
  await gated.helpers.applyFeatures();
  check("unentitled deployment hides the insights nav item", gated.registry.navInsights.classList.contains("hidden"), true);

  const failed = checks.filter((c) => !c.ok);
  for (const c of checks) {
    if (c.ok) console.log("  ok   " + c.label);
    else console.log("  FAIL " + c.label + "\n       expected " + JSON.stringify(c.expected) + "\n       actual   " + JSON.stringify(c.actual));
  }
  console.log((checks.length - failed.length) + "/" + checks.length + " checks passed");
  const bad = failed.length + failures.length;
  console.log(bad ? "RESULT: FAIL" : "RESULT: PASS");
  process.exit(bad ? 1 : 0);
})().catch((err) => {
  console.log("harness error: " + (err && err.stack ? err.stack : err));
  console.log("RESULT: FAIL");
  process.exit(1);
});

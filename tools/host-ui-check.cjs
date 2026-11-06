#!/usr/bin/env node
// tools/host-ui-check.cjs — the gate for the host portal page.
//
//   node tools/host-ui-check.cjs
//
// The host portal is a separate page module (bot/host-portal-page.js), so the
// admin harness never touched it. This runs its real script against a stub DOM
// and proves the flows that matter: the sign-in gate, a successful sign-in, view
// switching, prefill, refusing to save a question with no reply, sample mode
// locking editing, and sign-out. Pair it with tools/screenshot.cjs for looks.

const fs = require("fs");

function extract() {
  const src = fs.readFileSync("bot/host-portal-page.js", "utf8");
  const marker = "export const HOST_HTML = `";
  const from = src.indexOf(marker) + marker.length;
  const to = src.lastIndexOf("`;");
  if (from < marker.length || to < 0) throw new Error("could not find HOST_HTML in bot/host-portal-page.js");
  const html = new Function("return `" + src.slice(from, to) + "`;")();
  const bodyEnd = html.lastIndexOf("</body>");
  const open = html.lastIndexOf("<script>", bodyEnd);
  const close = html.indexOf("</script>", open);
  if (open < 0 || close < 0 || close > bodyEnd) throw new Error("could not find the host page script");
  return { html, script: html.slice(open + "<script>".length, close) };
}

function makeElement(tag) {
  const classes = new Set();
  const attrs = {};
  const listeners = {};
  let text = "";
  const el = {
    tagName: tag,
    id: "",
    className: "",
    value: "",
    checked: false,
    disabled: false,
    title: "",
    href: "",
    type: "",
    placeholder: "",
    style: {},
    dataset: {},
    children: [],
    __attrs: attrs,
    __listeners: listeners,
    append(...nodes) {
      for (const node of nodes) el.children.push(node);
    },
    appendChild(node) {
      el.children.push(node);
      return node;
    },
    addEventListener(type, fn) {
      (listeners[type] = listeners[type] || []).push(fn);
    },
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
    focus() {},
    scrollIntoView() {},
    click() {
      for (const fn of listeners.click || []) fn({ preventDefault() {}, target: el });
    },
    querySelector(selector) {
      return descendants(el).find((node) => matches(node, selector)) || null;
    },
    querySelectorAll(selector) {
      return descendants(el).filter((node) => matches(node, selector));
    },
  };
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
      // The real DOM stores a string; setText frequently passes numbers.
      text = String(value);
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

function descendants(node, out = []) {
  for (const child of node.children) {
    out.push(child);
    descendants(child, out);
  }
  return out;
}

function matches(node, selector) {
  if (/^[a-z]+$/i.test(selector)) return node.tagName === selector;
  if (selector.startsWith(".")) {
    return String(node.className || "").split(/\s+/).includes(selector.slice(1));
  }
  if (selector.startsWith("#")) {
    return node.id === selector.slice(1);
  }
  return false;
}

async function runHost({ search = "", routes }) {
  const { html, script } = extract();
  const registry = {};
  for (const match of html.matchAll(/\bid="([^"]+)"/g)) {
    const el = makeElement("div");
    el.id = match[1];
    registry[match[1]] = el;
  }

  // Nav buttons carry data-view; the range buttons live inside #rangeBar.
  const navItems = [...html.matchAll(/data-view="([^"]+)"/g)].map((match) => {
    const el = makeElement("button");
    el.className = "nav-item";
    el.dataset.view = match[1];
    return el;
  });
  for (const match of html.matchAll(/data-range="([^"]+)"/g)) {
    const el = makeElement("button");
    el.dataset.range = match[1];
    registry.rangeBar.appendChild(el);
  }

  const documentStub = {
    getElementById: (id) => registry[id] || null,
    createElement: makeElement,
    createElementNS: (_ns, tag) => makeElement(tag),
    querySelector: () => null,
    querySelectorAll: (selector) => {
      if (selector === ".nav-item[data-view]") return navItems;
      if (selector === "#rangeBar button") return registry.rangeBar.children;
      if (selector === ".guide-row") return registry.guideList.children;
      return [];
    },
    addEventListener: () => {},
    body: makeElement("body"),
    documentElement: makeElement("html"),
  };

  const requests = [];
  const bodies = [];
  const fetchStub = async (url, init) => {
    requests.push(((init && init.method) || "GET") + " " + url);
    bodies.push(init && init.body);
    const body = routes[url];
    if (body === undefined) {
      return { ok: false, status: 404, statusText: "Not Found", json: async () => ({ error: "no route " + url }) };
    }
    if (body && body.__error) {
      return {
        ok: false,
        status: body.__status || 400,
        statusText: "Error",
        json: async () => ({ error: body.__error }),
      };
    }
    return { ok: true, status: 200, statusText: "OK", json: async () => body };
  };

  const location = { search, href: "/host", reload() {} };
  const windowStub = {
    location,
    addEventListener() {},
    removeEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {} }),
  };

  const factory = new Function(
    "document", "window", "location", "localStorage", "navigator", "history", "fetch", "console", "setTimeout", "URLSearchParams",
    script,
  );
  factory(
    documentStub,
    windowStub,
    location,
    { getItem: () => null, setItem() {}, removeItem() {} },
    {},
    { replaceState() {} },
    fetchStub,
    console,
    setTimeout,
    URLSearchParams,
  );

  // boot() kicks off load(); let its promises settle.
  await new Promise((resolve) => setTimeout(resolve, 30));
  return { registry, navItems, requests, bodies, location };
}

function fixture() {
  return {
    sample: false,
    range: "today",
    rangeLabel: "Today",
    generatedAt: "2026-11-06T10:00:00Z",
    property: { id: "CEDAR", name: "Cedar House", hostName: "Dana" },
    stats: {
      inbound: 114,
      answered: 96,
      routed: 18,
      medianReplySeconds: 6,
      sectionsUsed: 4,
      answeredPct: 84,
      routedPct: 16,
    },
    daily: [
      { day: "2026-10-31", inbound: 12 },
      { day: "2026-11-01", inbound: 18 },
      { day: "2026-11-02", inbound: 9 },
      { day: "2026-11-03", inbound: 21 },
      { day: "2026-11-04", inbound: 14 },
      { day: "2026-11-05", inbound: 11 },
      { day: "2026-11-06", inbound: 14 },
    ],
    recent: [
      { text: "Wifi password?", status: "answered", resolution: "keyword", at: "2026-11-06T09:15:00Z", ago: "45m ago" },
      { text: "Can we check in early?", status: "routed", resolution: "escalated", at: "2026-11-06T09:48:00Z", ago: "12m ago" },
    ],
    questions: [
      { text: "Wifi password?", intentKey: "wifi", label: "Wi-Fi", status: "answered", resolution: "keyword", at: "2026-11-06T09:15:00Z", ago: "45m ago" },
    ],
    coverage: [
      { intentKey: "wifi", label: "Wi-Fi", total: 10, answered: 9, routed: 1, answeredPct: 90 },
    ],
    guide: {
      sections: [{ topic: "Wifi & parking", color: "#ff8a3d" }],
      answers: [{ topic: "Wifi & parking", keywords: ["wifi", "parking"], reply: "Network is CedarGuest." }],
    },
  };
}

const checks = [];
function check(label, actual, expected) {
  checks.push({ ok: JSON.stringify(actual) === JSON.stringify(expected), label, actual, expected });
}

// The page boots on the today range, so every fixture is registered there.
const OVERVIEW = "/host/api/overview?range=today";

function signIn(page, code = "cedar", passcode = "admin123") {
  page.registry.loginCode.value = code;
  page.registry.loginPasscode.value = passcode;
  const handler = (page.registry.loginForm.__listeners.submit || [])[0];
  handler({ preventDefault() {} });
  return new Promise((resolve) => setTimeout(resolve, 30));
}

(async () => {
  const { sampleHostOverview } = await import("../bot/host-portal.js");
  const sample = sampleHostOverview("today", new Date("2026-11-06T10:00:00Z"));

  // ---- signed out ---------------------------------------------------------
  const out = await runHost({
    routes: { [OVERVIEW]: { __status: 401, __error: "Sign in to view this dashboard." } },
  });
  check("signed-out visitors get the sign-in card", out.registry.loginScreen.classList.contains("hidden"), false);
  check("signed-out visitors do not see the dashboard", out.registry.app.classList.contains("hidden"), true);

  // ---- empty form ---------------------------------------------------------
  const empty = await runHost({ routes: { [OVERVIEW]: { __status: 401, __error: "Sign in." } } });
  (empty.registry.loginForm.__listeners.submit || [])[0]({ preventDefault() {} });
  await new Promise((resolve) => setTimeout(resolve, 20));
  check("an empty sign-in form is caught locally", empty.registry.loginStatus.textContent, "Enter your house code and passcode.");
  check("an empty sign-in sends nothing", empty.requests.includes("POST /host/api/login"), false);

  // ---- wrong passcode -----------------------------------------------------
  const wrong = await runHost({
    routes: {
      [OVERVIEW]: { __status: 401, __error: "Sign in." },
      "/host/api/login": { __status: 401, __error: "Incorrect house code or passcode." },
    },
  });
  await signIn(wrong, "cedar", "nope");
  check("a wrong passcode is reported on the card", wrong.registry.loginStatus.textContent, "Incorrect house code or passcode.");
  check("a wrong passcode leaves the sign-in card up", wrong.registry.loginScreen.classList.contains("hidden"), false);
  check("the sign-in button is re-enabled after a failure", wrong.registry.loginButton.disabled, false);
  check(
    "the house code is uppercased before it is sent",
    JSON.parse(wrong.bodies.filter(Boolean).pop()).houseCode,
    "CEDAR",
  );

  // ---- successful sign-in -------------------------------------------------
  const page = await runHost({
    routes: {
      [OVERVIEW]: fixture(),
      "/host/api/login": { success: true },
      "/host/api/guide": { success: true },
    },
  });
  await signIn(page);
  check("sign-in posts the house code and passcode", page.requests.includes("POST /host/api/login"), true);
  check("sign-in opens the dashboard", page.registry.app.classList.contains("hidden"), false);
  check("sign-in hides the login card", page.registry.loginScreen.classList.contains("hidden"), true);
  check("the property name comes from the payload", page.registry.propertyName.textContent, "Cedar House");
  check("the host name comes from the payload", page.registry.hostName.textContent, "Dana");
  check("the house code is shown in the sidebar", page.registry.houseCode.textContent, "CEDAR");
  check("answered count renders", page.registry.answeredValue.textContent, "96");
  check("routed count renders", page.registry.routedValue.textContent, "18");
  check("guide sections render", page.registry.sectionList.children.length, 1);
  check("recent messages render", page.registry.recentList.children.length, 2);
  check("a routed message is labeled", page.registry.recentList.children[1].children[2].textContent, "Routed");
  check("the passcode field is cleared after sign-in", page.registry.loginPasscode.value, "");

  // ---- view switching -----------------------------------------------------
  page.navItems.find((item) => item.dataset.view === "guide").click();
  check("the guide view opens", page.registry.viewGuide.classList.contains("hidden"), false);
  check("the activity view closes", page.registry.viewActivity.classList.contains("hidden"), true);
  check("the view title follows the nav", page.registry.viewTitle.textContent, "Guide");
  check("the time range is hidden outside activity", page.registry.rangeBar.classList.contains("hidden"), true);
  check(
    "exactly one nav item is active",
    page.navItems.filter((item) => item.classList.contains("active")).map((item) => item.dataset.view),
    ["guide"],
  );

  // ---- prefill and the reply requirement ----------------------------------
  page.registry.prefillGuide.click();
  // The fixture already covers wifi and parking, so those two are skipped.
  check("prefill adds only the common questions it does not already have", page.registry.guideList.children.length, 11);
  check(
    "prefill says how many questions it added",
    page.registry.guideStatus.textContent,
    "10 common questions added. Add a reply to each, then save.",
  );
  check("prefill marks the guide dirty", page.registry.saveGuide.disabled, false);

  page.registry.saveGuide.click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  check(
    "saving with an unanswered question names it",
    page.registry.guideStatus.textContent.startsWith("Add a reply for"),
    true,
  );
  check(
    "saving with an unanswered question sends nothing",
    page.requests.filter((request) => request.startsWith("PUT ")).length,
    0,
  );

  for (const row of page.registry.guideList.children) {
    const reply = row.querySelector("textarea");
    if (!reply || reply.value) continue;
    reply.value = "Answered for the test.";
    for (const fn of reply.__listeners.input || []) fn({});
  }
  page.registry.saveGuide.click();
  await new Promise((resolve) => setTimeout(resolve, 30));
  check("a complete guide saves", page.requests.includes("PUT /host/api/guide"), true);
  check(
    "the save sends every answer",
    JSON.parse(page.bodies.filter(Boolean).pop()).answers.length,
    11,
  );
  check(
    "the saved guide confirms",
    page.registry.guideStatus.textContent,
    "Saved. Guests get the new answers on their next message.",
  );

  // ---- sample mode --------------------------------------------------------
  const samplePage = await runHost({
    search: "?sample=1",
    routes: { [OVERVIEW + "&sample=1"]: sample },
  });
  check("sample mode skips the login card", samplePage.registry.loginScreen.classList.contains("hidden"), true);
  check("sample mode opens the dashboard", samplePage.registry.app.classList.contains("hidden"), false);
  check("sample mode shows its banner", samplePage.registry.sampleBanner.classList.contains("hidden"), false);
  check("sample mode disables prefill", samplePage.registry.prefillGuide.disabled, true);
  check("sample mode disables adding a section", samplePage.registry.addAnswer.disabled, true);
  check("sample mode disables saving", samplePage.registry.saveGuide.disabled, true);
  samplePage.navItems.find((item) => item.dataset.view === "guide").click();
  check(
    "sample guide replies are read-only",
    samplePage.registry.guideList.children.every((row) => row.querySelector("textarea").disabled),
    true,
  );

  // ---- sign out -----------------------------------------------------------
  page.registry.signOut.click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  check("sign out posts to the logout endpoint", page.requests.includes("POST /host/api/logout"), true);
  check("sign out returns to the portal root", page.location.href, "/host");

  const failed = checks.filter((item) => !item.ok);
  for (const item of checks) {
    if (item.ok) console.log("  ok   " + item.label);
    else console.log("  FAIL " + item.label + "\n       expected " + JSON.stringify(item.expected) + "\n       actual   " + JSON.stringify(item.actual));
  }
  console.log((checks.length - failed.length) + "/" + checks.length + " checks passed");
  console.log(failed.length ? "RESULT: FAIL" : "RESULT: PASS");
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.log("harness error: " + (err && err.stack ? err.stack : err));
  console.log("RESULT: FAIL");
  process.exit(1);
});

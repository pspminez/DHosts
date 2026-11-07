#!/usr/bin/env node
// tools/check-a11y.cjs — the WCAG 2.1 AA regression gate.
//
//   npm test            (runs last, after the structural checks)
//   node tools/check-a11y.cjs
//
// Runs axe-core against the pages that ship: the four marketing pages straight
// from site/, and the host portal plus the admin sign-in page rendered from the
// templates the Worker serves. The portal and admin fixtures shim `fetch` the
// same way tools/screenshot.cjs does, so the gate sees the real dashboard and
// the real sign-in card without needing a session or a deployed Worker.
//
// axe covers roughly a third of WCAG by itself and cannot judge whether a
// heading reads sensibly, so the few structural rules that matter most (one h1,
// a language, a title, a skip link) are asserted here as well.
//
// Needs Chrome (CHROME_PATH, or a browser in a standard location); no network.
// Exits non-zero on any violation.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

// Chrome lives somewhere different on every platform, and a CI runner has it in
// none of the places a desktop does. CHROME_PATH wins (CI exports it from
// setup-chrome); otherwise look where each platform usually installs it.
function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const windows = [
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, "Google\\Chrome\\Application\\chrome.exe"),
    process.env["PROGRAMFILES(X86)"] && path.join(process.env["PROGRAMFILES(X86)"], "Google\\Chrome\\Application\\chrome.exe"),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Google\\Chrome\\Application\\chrome.exe"),
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  ];
  const mac = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ];
  const linux = [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
  ];
  const candidates = process.platform === "win32" ? windows : process.platform === "darwin" ? mac : linux;
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    const found = spawnSync(process.platform === "win32" ? "where" : "which", [name], { encoding: "utf8" });
    const first = found.status === 0 && String(found.stdout || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)[0];
    if (first) return first;
  }
  return "";
}

const CHROME = findChrome();
const PORT = Number(process.env.A11Y_PORT || 9455);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "stayxi-a11y-"));
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"];

// Failing loudly beats reporting an accessibility pass without having looked at
// the page at all.
if (!CHROME) {
  console.log("A11Y CHECK: FAIL · no Chrome found. Set CHROME_PATH to a Chrome or Chromium binary.");
  process.exit(1);
}

// Chromium's own complaints are the only useful diagnostic when it refuses to
// start on a runner, so keep the tail of them for the error message.
const chromeLog = [];
function chromeLogTail() {
  const text = chromeLog.join("").trim();
  if (!text) return "";
  return "\nChrome said:\n" + text.split(/\r?\n/).slice(-10).join("\n");
}

function extract(marker, file) {
  const src = fs.readFileSync(file, "utf8");
  const from = src.indexOf(marker) + marker.length;
  const to = src.lastIndexOf("`;");
  if (from < marker.length || to < 0) throw new Error("could not find " + marker.trim() + " in " + file);
  return new Function("return `" + src.slice(from, to) + "`;")();
}

function fileUrl(target) {
  return "file:///" + path.resolve(target).replace(/\\/g, "/");
}

// A shim in front of the page script: `payload` for signed-in, or a status for
// signed-out so the sign-in card is the state under test.
function shim(payload) {
  const inner =
    payload && payload.__deny
      ? `return { ok:false, status:${payload.__deny}, statusText:"Unauthorized", json:async function(){ return { error:"Sign in to view this dashboard." }; } };`
      : `return { ok:true, status:200, statusText:"OK", json:async function(){ return ${JSON.stringify(payload)}; } };`;
  return "<script>window.fetch = async function(){ " + inner + " };</script>\n";
}

function fixture(name, html, mode) {
  // The shim has to run before the page's own script.
  const patched = html.replace("<script>", shim(mode) + "<script>");
  const file = path.join(TMP, name + ".html");
  fs.writeFileSync(file, patched);
  return fileUrl(file);
}

async function waitForDevtools(isDead) {
  for (let i = 0; i < 90; i++) {
    // Waiting the full 27 seconds for a browser that already exited only turns a
    // clear crash into a timeout.
    const dead = isDead();
    if (dead) throw new Error("Chrome exited before DevTools opened (" + dead + ")." + chromeLogTail());
    try {
      const list = await (await fetch("http://127.0.0.1:" + PORT + "/json/list")).json();
      const page = list.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      /* not listening yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error("Chrome devtools never came up on port " + PORT + "." + chromeLogTail());
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
      if (msg.error) fail(new Error(JSON.stringify(msg.error)));
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

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + " " + (result.exceptionDetails.exception || {}).description);
  return result.result.value;
}

async function main() {
  const axeSource = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
  const { sampleHostOverview } = await import("../bot/host-portal.js");
  const hostHtml = extract("export const HOST_HTML = `", "bot/host-portal-page.js");
  const adminHtml = extract("const ADMIN_HTML = `", "bot/worker.ts");

  const pages = [
    ["landing", fileUrl("site/index.html"), true],
    ["privacy", fileUrl("site/privacy.html"), true],
    ["accessibility", fileUrl("site/accessibility.html"), true],
    ["terms", fileUrl("site/terms.html"), true],
    ["host dashboard", fixture("host-dashboard", hostHtml, sampleHostOverview("stay")), true],
    ["host sign-in", fixture("host-login", hostHtml, { __deny: 401 }), true],
    ["admin sign-in", fixture("admin-login", adminHtml, { __deny: 403 }), true],
  ];

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "stayxi-a11y-profile-"));
  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--no-first-run",
      // A runner image or container has no usable sandbox for Chromium; without
      // this the browser exits before it ever opens its DevTools endpoint.
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--remote-debugging-port=" + PORT,
      "--user-data-dir=" + profile,
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let exitReason = null;
  chrome.on("exit", (code, signal) => {
    exitReason = signal ? "signal " + signal : "exit code " + code;
  });
  chrome.stderr.on("data", (chunk) => {
    chromeLog.push(String(chunk));
    if (chromeLog.length > 60) chromeLog.shift();
  });

  let failed = 0;
  let client;
  try {
    client = await connect(await waitForDevtools(() => exitReason));
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: 1280,
      screenHeight: 900,
    });

    for (const [name, url] of pages) {
      await client.send("Page.navigate", { url });
      await new Promise((resolve) => setTimeout(resolve, 2200));
      await evaluate(client, axeSource);
      const raw = await evaluate(
        client,
        `axe.run(document, { runOnly: { type: "tag", values: ${JSON.stringify(TAGS)} } }).then(function (r) {
          return JSON.stringify({
            violations: r.violations.map(function (v) {
              return { id: v.id, impact: v.impact, help: v.help, count: v.nodes.length,
                nodes: v.nodes.slice(0, 3).map(function (n) { return { target: n.target.join(" "), summary: (n.failureSummary || "").split("\\n").slice(0, 2).join(" | ") }; }) };
            }),
            passes: r.passes.length,
            incomplete: r.incomplete.map(function (v) { return v.id; })
          });
        })`,
      );
      const result = JSON.parse(raw);
      const structure = JSON.parse(
        await evaluate(
          client,
          `JSON.stringify({
            lang: document.documentElement.lang,
            title: document.title.trim(),
            h1: [].filter.call(document.querySelectorAll("h1"), function (el) { return el.getClientRects().length > 0; }).length,
            skip: !!document.querySelector(".skip-link"),
            navLinks: document.querySelectorAll("nav a, nav button").length,
            unlabeled: [].filter.call(document.querySelectorAll("input,textarea,select"), function (el) {
              if (el.getClientRects().length === 0) return false;
              return !(el.labels && el.labels.length) && !el.getAttribute("aria-label") && !el.getAttribute("aria-labelledby");
            }).map(function (el) { return el.outerHTML.slice(0, 150); })
          })`,
        ),
      );

      const problems = [];
      if (!structure.lang) problems.push("no lang on <html>");
      if (!structure.title) problems.push("no title");
      if (structure.h1 !== 1) problems.push(structure.h1 + " visible h1 elements (want exactly 1)");
      // A skip link only earns its place when there is repeated chrome to skip.
      if (structure.navLinks >= 3 && !structure.skip) problems.push("no skip link before " + structure.navLinks + " nav controls");
      if (structure.unlabeled.length) {
        problems.push(structure.unlabeled.length + " unlabeled form fields");
        for (const field of structure.unlabeled) problems.push("    " + field);
      }
      for (const v of result.violations) {
        problems.push(v.id + " x" + v.count + " (" + v.impact + ") — " + v.help);
        for (const node of v.nodes) problems.push("    " + node.target + " :: " + node.summary);
      }

      const ok = problems.length === 0;
      if (!ok) failed++;
      console.log((ok ? "  ok   " : "  FAIL ") + name + " — " + result.passes + " rules passed" + (ok ? "" : ", " + result.violations.length + " violation(s)"));
      for (const problem of problems) console.log("       " + problem);
      if (result.incomplete.length) console.log("       needs manual review: " + result.incomplete.join(", "));
    }

    console.log(failed ? "A11Y CHECK: FAIL" : "A11Y CHECK: PASS");
  } finally {
    try {
      if (client) await client.send("Browser.close");
    } catch {
      /* already closed */
    }
    chrome.kill();
    fs.rmSync(TMP, { recursive: true, force: true });
  }
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.log("A11Y CHECK: FAIL · " + (error && error.message));
  process.exit(1);
});

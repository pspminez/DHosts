#!/usr/bin/env node
// tools/og-card.cjs — render site/og.png from the real light-theme palette.
//
//   node tools/og-card.cjs
//
// The social card is a 1200x630 page rendered in Chrome and screenshotted, so it
// uses the same fonts the site ships and needs no image library. Rerun it after
// a brand, font or headline change; site/dist picks it up on the next build.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const CHROME = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = Number(process.env.CDP_PORT || 9334);
const WIDTH = 1200;
const HEIGHT = 630;
const TMP_HTML = path.join("site", ".og-card.tmp.html");
const OUT = path.join("site", "og.png");

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  @font-face { font-family: "Fraunces"; src: url("fonts/fraunces-600-latin.woff2") format("woff2"); font-weight: 600; font-style: normal; font-display: block; }
  @font-face { font-family: "Instrument Sans"; src: url("fonts/instrument-sans-latin.woff2") format("woff2"); font-weight: 400 700; font-display: block; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${WIDTH}px; height: ${HEIGHT}px; }
  body {
    position: relative; overflow: hidden;
    background: #faf5ec; color: #1a1410;
    font-family: "Instrument Sans", ui-sans-serif, system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .wash {
    position: absolute; inset: 0;
    background:
      radial-gradient(680px 420px at 88% -12%, rgba(194,65,12,.16), transparent 62%),
      radial-gradient(520px 360px at 4% 104%, rgba(180,83,9,.13), transparent 60%),
      linear-gradient(160deg, #fffdf8 0%, #f8f1e5 52%, #faf5ec 100%);
  }
  .frame { position: absolute; inset: 34px; border: 1px solid rgba(26,20,16,.14); border-radius: 26px; }
  .inner { position: relative; height: 100%; padding: 66px 72px 62px; display: flex; flex-direction: column; }
  .brand { display: flex; align-items: center; gap: 13px; font-size: 27px; font-weight: 600; letter-spacing: -.02em; }
  .mark { display: grid; width: 46px; height: 46px; place-items: center; border-radius: 14px; background: #fffdf8; box-shadow: inset 0 0 0 1px rgba(26,20,16,.14), 0 10px 24px -18px #1a1410; }
  .mark svg { width: 25px; height: 25px; }
  h1 { margin-top: 40px; font-family: "Fraunces", Georgia, serif; font-weight: 600; font-size: 76px; line-height: 1.02; letter-spacing: -.028em; max-width: 900px; }
  .grad { background: linear-gradient(96deg, #7a2a08, #a63c15 46%, #7a4c00); -webkit-background-clip: text; background-clip: text; color: transparent; }
  p.lede { margin-top: 26px; max-width: 760px; color: #544a40; font-size: 26px; line-height: 1.38; letter-spacing: -.012em; }
  .foot { margin-top: auto; display: flex; align-items: center; justify-content: space-between; font-size: 21px; color: #6a5f54; }
  .foot strong { font-weight: 600; color: #1a1410; }
  .pill { display: inline-flex; align-items: center; gap: 9px; padding: 9px 17px; border-radius: 999px; background: #fffdf8; box-shadow: inset 0 0 0 1px rgba(26,20,16,.14); font-size: 19px; color: #544a40; }
  .dot { width: 9px; height: 9px; border-radius: 999px; background: #a63c15; }
</style>
</head>
<body>
  <div class="wash"></div>
  <div class="frame"></div>
  <div class="inner">
    <div class="brand">
      <span class="mark">
        <svg viewBox="0 0 24 24" fill="none" stroke="#a63c15" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
          <path d="M6 16 12 6l6 10"></path>
          <circle cx="12" cy="18.5" r="1.2" fill="#7a4c00" stroke="none"></circle>
        </svg>
      </span>
      StayXI
    </div>
    <h1>Your guests text.<br>Your house <span class="grad">texts back</span>.</h1>
    <p class="lede">Each property gets its own text number. Guests get an answer in seconds, from the guide you approved — at 3pm or 3am.</p>
    <div class="foot">
      <span><strong>stayxi.com</strong> · built for Florida rentals</span>
      <span class="pill"><span class="dot"></span>14-day trial, setup included</span>
    </div>
  </div>
</body>
</html>`;

async function waitForDevtools() {
  for (let i = 0; i < 90; i++) {
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

(async () => {
  if (!fs.existsSync("site/index.html")) throw new Error("run this from the repository root");
  fs.writeFileSync(TMP_HTML, HTML);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "stayxi-og-"));
  const chrome = spawn(
    CHROME,
    ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--remote-debugging-port=" + PORT, "--user-data-dir=" + profile, "about:blank"],
    { stdio: "ignore" },
  );

  let client;
  try {
    client = await connect(await waitForDevtools());
    await client.send("Page.enable");
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: WIDTH,
      height: HEIGHT,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: WIDTH,
      screenHeight: HEIGHT,
    });
    await client.send("Page.navigate", { url: "file:///" + path.resolve(TMP_HTML).replace(/\\/g, "/") });
    await new Promise((resolve) => setTimeout(resolve, 600));
    // Screenshot before the fonts land would silently fall back to Georgia.
    await client.send("Runtime.evaluate", { expression: "document.fonts.ready.then(() => true)", awaitPromise: true });
    await new Promise((resolve) => setTimeout(resolve, 400));
    const shot = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    fs.writeFileSync(OUT, Buffer.from(shot.data, "base64"));
    console.log(OUT + "  " + WIDTH + "x" + HEIGHT + "  " + Math.round(fs.statSync(OUT).size / 1024) + " KB");
  } finally {
    try {
      if (client) await client.send("Browser.close");
    } catch {
      /* already gone */
    }
    chrome.kill();
    fs.rmSync(TMP_HTML, { force: true });
  }
})().catch((error) => {
  console.log("og card failed: " + (error && error.message));
  fs.rmSync(TMP_HTML, { force: true });
  process.exit(1);
});

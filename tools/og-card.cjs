#!/usr/bin/env node
// tools/og-card.cjs — render site/og.png from the site's dark theme.
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
  @font-face { font-family: "Space Grotesk"; src: url("fonts/space-grotesk-latin.woff2") format("woff2"); font-weight: 300 700; font-display: block; }
  @font-face { font-family: "Instrument Sans"; src: url("fonts/instrument-sans-latin.woff2") format("woff2"); font-weight: 400 700; font-display: block; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${WIDTH}px; height: ${HEIGHT}px; }
  body {
    position: relative; overflow: hidden;
    background: #0b0908; color: #f3ede8;
    font-family: "Instrument Sans", ui-sans-serif, system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .wash {
    position: absolute; inset: 0;
    background:
      radial-gradient(760px 460px at 92% -18%, rgba(255,122,69,.22), transparent 64%),
      radial-gradient(620px 420px at -8% 108%, rgba(255,181,71,.14), transparent 62%),
      radial-gradient(520px 320px at 46% 122%, rgba(255,77,109,.10), transparent 64%);
  }
  .grid {
    position: absolute; inset: 0;
    background-image: linear-gradient(rgba(255,236,224,.055) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255,236,224,.055) 1px, transparent 1px);
    background-size: 72px 72px;
    -webkit-mask-image: radial-gradient(90% 80% at 50% 30%, #000 20%, transparent 78%);
    mask-image: radial-gradient(90% 80% at 50% 30%, #000 20%, transparent 78%);
  }
  .frame { position: absolute; inset: 34px; border: 1px solid rgba(255,236,224,.13); border-radius: 26px; }
  .inner { position: relative; height: 100%; padding: 66px 72px 62px; display: flex; flex-direction: column; }
  .brand { display: flex; align-items: center; gap: 13px; font-size: 26px; font-weight: 600; letter-spacing: -.01em; }
  .mark { display: grid; width: 46px; height: 46px; place-items: center; border-radius: 14px;
    background: linear-gradient(135deg, #241c18, #191412); box-shadow: inset 0 0 0 1px rgba(255,236,224,.14); }
  .mark svg { width: 25px; height: 25px; }
  h1 { margin-top: 38px; font-family: "Space Grotesk", ui-sans-serif, sans-serif; font-weight: 700;
    font-size: 78px; line-height: 1.02; letter-spacing: -.035em; max-width: 940px; }
  .grad { background: linear-gradient(96deg, #ff9a6b, #ff7a45 48%, #ffb547); -webkit-background-clip: text; background-clip: text; color: transparent; }
  p.lede { margin-top: 24px; max-width: 780px; color: #a89e97; font-size: 25px; line-height: 1.4; letter-spacing: -.008em; }
  .foot { margin-top: auto; display: flex; align-items: center; justify-content: space-between; font-size: 20px; color: #8b807a; }
  .foot strong { font-weight: 600; color: #f3ede8; }
  .pill { display: inline-flex; align-items: center; gap: 9px; padding: 9px 17px; border-radius: 999px;
    background: rgba(255,255,255,.045); box-shadow: inset 0 0 0 1px rgba(255,236,224,.14); font-size: 18px; color: #d7cec7; }
  .dot { width: 9px; height: 9px; border-radius: 999px; background: #ff7a45; box-shadow: 0 0 12px 1px rgba(255,122,69,.6); }
</style>
</head>
<body>
  <div class="wash"></div>
  <div class="grid"></div>
  <div class="frame"></div>
  <div class="inner">
    <div class="brand">
      <span class="mark">
        <svg viewBox="0 0 24 24" fill="none" stroke="#ff9a6b" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
          <path d="M6 16 12 6l6 10"></path>
          <circle cx="12" cy="18.5" r="1.2" fill="#ffc46b" stroke="none"></circle>
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
    // Screenshot before the fonts land would silently fall back to a system face.
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

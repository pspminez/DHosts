#!/usr/bin/env node
// tools/build-site.cjs — stage the marketing site for deployment.
//
//   npm run build:site
//   cd site && npx wrangler pages deploy dist --branch main
//
// site/ is the readable source: index.html links styles.css by relative path, so
// the copy in site/dist keeps every file name and only the stylesheets change
// (minified). That keeps the local preview and the screenshot tool honest — they
// read the source — while the bytes a visitor downloads are minified.
//
// Minification runs through npx (like tools/lighthouse.cjs, so no dependency is
// added). The target list keeps the -webkit- prefixes the page actually relies
// on: background-clip:text, line-clamp and backdrop-filter.

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const SRC = path.join(__dirname, "..", "site");
const OUT = path.join(SRC, "dist");
const ESBUILD = ["--yes", "esbuild@0.25.0"];
const TARGETS = "safari15,chrome100,firefox100";

// A minifier that drops a declaration the page depends on is worse than no
// minifier, so these are asserted on the output rather than trusted.
const MUST_SURVIVE = [
  "-webkit-background-clip",
  "-webkit-line-clamp",
  "-webkit-backdrop-filter",
  "backdrop-filter",
  "@font-face",
  "prefers-reduced-motion",
  "content-visibility",
];

function minify(file, outFile) {
  const tmp = outFile + ".build";
  const run = spawnSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    [...ESBUILD, file, "--minify", "--target=" + TARGETS, "--outfile=" + tmp],
    { stdio: "inherit", shell: process.platform === "win32" }
  );
  if (run.error) throw new Error("could not run esbuild: " + run.error.message);
  if (run.status !== 0) throw new Error("esbuild exited with status " + run.status);
  fs.renameSync(tmp, outFile);
}

function main() {
  if (!fs.existsSync(path.join(SRC, "index.html"))) {
    throw new Error("site/index.html is missing; run this from the repository root");
  }
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  // Copied entry by entry: fs.cpSync refuses to copy a directory into its own
  // subdirectory, which is exactly what staging inside site/ looks like.
  for (const entry of fs.readdirSync(SRC)) {
    if (entry === "dist") continue;
    fs.cpSync(path.join(SRC, entry), path.join(OUT, entry), { recursive: true });
  }

  const css = fs.readdirSync(OUT).filter((name) => name.endsWith(".css"));
  if (!css.length) throw new Error("no stylesheets found in site/");

  let before = 0;
  let after = 0;
  for (const name of css) {
    const outFile = path.join(OUT, name);
    const original = fs.readFileSync(outFile, "utf8");
    before += original.length;
    minify(outFile, outFile);
    const minified = fs.readFileSync(outFile, "utf8");
    after += minified.length;
    for (const marker of MUST_SURVIVE) {
      if (original.includes(marker) && !minified.includes(marker)) {
        throw new Error(`${name}: minification dropped ${marker}`);
      }
    }
    console.log(`  ${name}  ${original.length.toLocaleString("en-US")} -> ${minified.length.toLocaleString("en-US")} bytes`);
  }

  const saved = Math.round((1 - after / before) * 100);
  console.log(`SITE BUILD: staged ${OUT} (stylesheets ${saved}% smaller)`);
}

try {
  main();
} catch (error) {
  console.error("SITE BUILD: FAIL · " + error.message);
  process.exit(1);
}

#!/usr/bin/env node
// tools/check-setup-docs.cjs — proves the first-property commands in bot/README.md run.
//
//   node tools/check-setup-docs.cjs
//
// Why: the README told operators to insert a host and a property before a pilot
// could start, and four separate things in those two lines were wrong — a missing
// NOT NULL column, a missing host name, the wrong order for a foreign key, and a
// `wrangler kv:key` command this version no longer has. Every one of them was
// only discoverable by running the text. This runs it.
//
// It never touches your dev database or production: the whole check happens in a
// throwaway directory under the system temp folder, using --local --persist-to.
// The one thing it cannot use as written is the KV example's --path, which points
// at a private file the repo does not contain, so that argument is repointed at a
// temp file with the same contents shape.

const { execSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const README = "bot/README.md";
const store = fs.mkdtempSync(path.join(os.tmpdir(), "stayxi-setup-"));
const knowledge = path.join(store, "SUNSET-knowledge.json");
fs.writeFileSync(knowledge, JSON.stringify({ answers: [], secrets: [] }, null, 2));

let failures = 0;
function say(ok, what, detail) {
  console.log((ok ? "  ok   " : "  FAIL ") + what + (ok || !detail ? "" : "\n       " + detail));
  if (!ok) failures++;
}

// Wrangler prints a table; an error is either a non-zero exit or an X [ERROR] line.
function run(command) {
  try {
    const out = execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" } });
    const err = /X \[ERROR\]/.test(out) ? out.split("\n").find((l) => /X \[ERROR\]/.test(l)) : "";
    return { ok: !err, out, err };
  } catch (error) {
    const text = String(error.stdout || "") + String(error.stderr || "");
    const line = text.split("\n").find((l) => /X \[ERROR\]|Error/.test(l)) || error.message;
    return { ok: false, out: text, err: line.trim() };
  }
}

// The commands to gate: the D1 inserts that stand up a first property and the KV
// write that gives it knowledge. Anything else in the README is prose.
const readme = fs.readFileSync(README, "utf8");
const documented = readme
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => /^(npx\s+)?wrangler\s+/.test(line) && /INSERT INTO (hosts|properties)|kv key put/.test(line));

if (documented.length < 3) {
  say(false, "found the setup commands in " + README, "expected a hosts insert, a properties insert and a KV write; found " + documented.length);
  fs.rmSync(store, { recursive: true, force: true });
  console.log("\nSETUP DOCS: FAIL");
  process.exit(1);
}

const db = (documented.join(" ").match(/d1 execute ([a-z0-9-]+)/) || [])[1] || "davenport-host-co-db";

// A fresh database, built only the way an operator would build one.
const migrated = run("npx wrangler d1 migrations apply " + db + " --local --persist-to " + store);
say(migrated.ok, "migrations build a database from empty", migrated.err);

for (const line of documented) {
  const command = line
    .replace(/^npx\s+/, "")
    .replace(/^wrangler\s+/, "")
    .replace(/--remote/g, "")
    .replace(/--path=\S+/g, "--path=" + knowledge)
    .replace(/--persist-to\s+\S+/g, "");
  const full = "npx wrangler " + command + " --local --persist-to " + store;
  const result = run(full);
  const label = /INSERT INTO hosts/.test(line) ? "hosts insert" : /INSERT INTO properties/.test(line) ? "properties insert" : "kv key put";
  say(result.ok, label, result.err);
}

// The rows have to be joinable, or the inserts "worked" without a property the
// panel can open.
const rows = run("npx wrangler d1 execute " + db + " --local --persist-to " + store + " --json --command \"SELECT p.id AS id, h.phone AS phone FROM properties p JOIN hosts h ON h.id = p.host_id\"");
say(rows.ok && /"id"/.test(rows.out), "the property joins its host", rows.err || "no row came back");

const stored = run("npx wrangler kv key get --binding=PROPERTIES prop:SUNSET --local --persist-to " + store);
say(stored.ok && /"answers"/.test(stored.out), "the KV entry reads back", stored.err);

fs.rmSync(store, { recursive: true, force: true });
console.log(failures ? "\nSETUP DOCS: " + failures + " failing" : "\nSETUP DOCS: PASS");
process.exit(failures ? 1 : 0);

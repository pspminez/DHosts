const fs = require('fs');
const src = fs.readFileSync('dist/worker.js', 'utf8');
const i = src.indexOf('var ADMIN_HTML');
const start = src.indexOf('`', i) + 1;
const end = src.indexOf('`;', start);
const html = src.slice(start, end);
fs.writeFileSync('admin_built.html', html);
const m = html.match(/<script[^>]*>([\s\S]*?)<\/script>/);
if (!m) { console.log('no script tag found'); process.exit(1); }
const js = m[1];
fs.writeFileSync('admin_built.js', js);
const lines = js.split('\n');
console.log('script lines:', lines.length, 'len:', js.length);
try {
  new Function(js);
  console.log('SYNTAX OK');
} catch (e) {
  console.log('SYNTAX ERROR:', e.message);
  // find the reported line
  const mm = /(\d+):(\d+)/.exec(e.stack || '');
  const off = js.split('\n');
  // brute force: try progressively truncating
  for (let n = 1; n <= off.length; n++) {
    const chunk = off.slice(0, n).join('\n');
    try { new Function(chunk + '\n}'.repeat(0)); } catch (err) {
      if (!/Unexpected end of input|Unexpected token '}'|missing \) after|Unterminated/.test(err.message)) {
        console.log('first bad line', n, ':', off[n - 1]);
        console.log('  err:', err.message);
        break;
      }
    }
  }
}

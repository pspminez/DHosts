const fs = require('fs');
const html = fs.readFileSync('live_admin.html', 'utf8');
const m = html.match(/<script[^>]*>([\s\S]*?)<\/script>/);
if (!m) { console.log('no script tag found'); process.exit(1); }
const js = m[1];
fs.writeFileSync('live_admin.js', js);
console.log('script lines:', js.split('\n').length, 'len:', js.length);
try {
  new Function(js);
  console.log('SYNTAX OK');
} catch (e) {
  console.log('SYNTAX ERROR:', e.message);
  const lines = js.split('\n');
  const stack = e.stack || '';
  console.log(stack.split('\n').slice(0, 6).join('\n'));
  // locate: find the line by trying eval of prefixes
  for (let n = 1; n <= lines.length; n++) {
    const chunk = lines.slice(0, n).join('\n');
    try { new Function(chunk); } catch (err) {
      if (!/Unexpected end of input|Unterminated|missing \) after|Unexpected token '\)'|Unexpected token '}'|Unexpected token 'else'|Unexpected token 'catch'|Unexpected token 'finally'/.test(err.message)) {
        console.log('first bad line ' + n + ':', JSON.stringify(lines[n - 1]));
        console.log('  ->', err.message);
        break;
      }
    }
  }
}

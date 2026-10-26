const fs = require('fs');
const html = fs.readFileSync('live_admin.html', 'utf8');
const js = fs.readFileSync('live_admin.js', 'utf8');

const htmlIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
const jsIds = new Set();
for (const m of js.matchAll(/\$\('([^']+)'\)/g)) jsIds.add(m[1]);
for (const m of js.matchAll(/\$\("([^"]+)"\)/g)) jsIds.add(m[1]);

const missing = [...jsIds].filter((id) => !htmlIds.has(id));
console.log('HTML ids:', htmlIds.size, '| JS $() refs:', jsIds.size);
console.log('MISSING (JS refs an id not in HTML):', missing.length ? missing.join(', ') : 'none');

const unused = [...htmlIds].filter((id) => !jsIds.has(id) && !html.includes('for="' + id + '"'));
console.log('HTML ids never referenced by $() or label[for]:', unused.length ? unused.join(', ') : 'none');

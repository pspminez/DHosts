// site/api.js

// Every call goes to this site's own /api/* path. The Pages Function in
// functions/api/[[path]].js forwards those requests to the Worker, so the page
// works on the pages.dev alias, on every preview deployment, and on stayxi.com
// without a hostname check, a CORS preflight, or a domain decision.
const API_BASE_URL = "";

export async function callWorkerApi(path, options = {}) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new Error(errorBody.error || res.statusText);
  }

  return res.json();
}

export async function sendDemoMessage(message) {
  return callWorkerApi('/api/chat', {
    method: 'POST',
    body: JSON.stringify({
      messages: [{ role: 'user', content: message }]
    })
  });
}

export async function submitLead(email) {
  return callWorkerApi('/api/leads', { method: 'POST', body: JSON.stringify({ email }) });
}

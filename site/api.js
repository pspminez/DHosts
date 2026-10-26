// site/api.js

// Hosted Pages deployments (production alias and every per-commit preview like
// <hash>.davenport-host-co.pages.dev) talk to the Worker's workers.dev URL,
// because api.stayxi.com is not configured yet. Once the custom domain is live,
// only the real custom domain should use it.
const API_BASE_URL = window.location.hostname.endsWith('davenport-host-co.pages.dev')
  ? 'https://davenport-host-co-bot.davenport-host-co-bot.workers.dev'
  : 'https://api.stayxi.com';

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
// site/api.js

// ONE place to change the API host. Keep this on the Worker's workers.dev
// hostname until api.stayxi.com has a DNS record and a Worker custom domain;
// pointing it at the custom domain early breaks the sample and trial form.
// There is deliberately no per-host branching and no fallback, so the form and
// sample behave the same on Pages, a preview host, or stayxi.com.
const API_BASE_URL = "https://davenport-host-co-bot.davenport-host-co-bot.workers.dev";

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

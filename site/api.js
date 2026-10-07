// site/api.js

// This will be updated during deployment to point to the actual worker URL
const API_BASE_URL = window.location.origin;

function getApiBase() {
  // If we're on the Pages dev domain, use the worker URL
  if (window.location.hostname.includes('.pages.dev')) {
    return 'https://davenport-host-co-bot.davenport-host-co-bot.workers.dev';
  }
  return API_BASE_URL;
}

export async function callWorkerApi(path, options = {}) {
  const base = getApiBase();
  const res = await fetch(`${base}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new Error(errorBody.error || res.statusText);
  }

  return res.json();
}

export async function sendMessageToAI(message) {
  // Call the worker's demo chat endpoint
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

// Premium services catalog for upsells
export const PREMIUM_SERVICES = [
  {
    id: 'weather',
    name: 'Live Weather & Alerts',
    description: 'Real-time weather, storm alerts, hurricane tracking for your property',
    price: '$15/mo',
    icon: '🌤️'
  },
  {
    id: 'events',
    name: 'Local Events & Dining',
    description: 'Curated events, restaurant reservations, attraction tickets for guests',
    price: '$20/mo',
    icon: '🎭'
  },
  {
    id: 'groceries',
    name: 'Grocery & Essentials Delivery',
    description: 'Pre-stock fridge, toiletries, beach gear before guests arrive',
    price: '$25/mo',
    icon: '🛒'
  },
  {
    id: 'concierge',
    name: 'Full Concierge',
    description: 'All of the above + 24/7 host backup, maintenance coordination',
    price: '$49/mo',
    icon: '⭐'
  }
];
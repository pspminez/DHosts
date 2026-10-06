// site/api.js

// This will be updated during deployment to point to the actual worker URL
const API_BASE_URL = window.location.origin;

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

// Placeholder for future API calls, e.g., for chat or lead capture
export async function sendMessageToAI(message) {
  // Implement logic to send message to AI endpoint
  console.log("Sending message to AI:", message);
  // return callWorkerApi('/api/chat', { method: 'POST', body: JSON.stringify({ message }) });
  return { reply: "This is a placeholder AI response." };
}

export async function submitLead(email) {
    return callWorkerApi('/api/leads', { method: 'POST', body: JSON.stringify({ email }) });
}

// Same-origin proxy for the public API.
//
// The marketing site is static and the API lives in the Worker. Calling the
// Worker from the browser would hard-code its host and break the moment the
// site moves to stayxi.com. Routing through this function keeps the browser on
// the same origin as the page: no hostname branch, no CORS.
//
// Change WORKER_ORIGIN to https://api.stayxi.com once that domain exists and
// the Worker is bound to it.

const WORKER_ORIGIN = "https://davenport-host-co-bot.davenport-host-co-bot.workers.dev";

export async function onRequest(context) {
  const incoming = context.request;
  const url = new URL(incoming.url);
  const target = WORKER_ORIGIN + url.pathname + url.search;

  const upstreamRequest = { method: incoming.method, headers: new Headers() };
  const contentType = incoming.headers.get("Content-Type");
  if (contentType) upstreamRequest.headers.set("Content-Type", contentType);
  if (incoming.method !== "GET" && incoming.method !== "HEAD") {
    upstreamRequest.body = await incoming.arrayBuffer();
  }

  const upstream = await fetch(target, upstreamRequest);

  const headers = new Headers();
  const upstreamType = upstream.headers.get("Content-Type");
  if (upstreamType) headers.set("Content-Type", upstreamType);
  headers.set("Cache-Control", "no-store");

  return new Response(upstream.body, { status: upstream.status, headers });
}

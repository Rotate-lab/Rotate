// Rotate · service worker (offline)
// - pagina: prima la rete (così gli aggiornamenti arrivano subito), senza rete la copia salvata
// - librerie e caratteri: copia salvata, aggiornata in background
// - meteo, Google Drive, portali: sempre e solo dalla rete (mai in cache)
const CACHE = "rotate-v1.2.13"; // keep equal to VER in index.html
const CORE = ["./", "./manifest.json", "./icon-180.png", "./icon-192.png", "./icon-512.png"];
const LIBS = [
  "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js",
  "https://fonts.googleapis.com/css2?family=B612+Mono:wght@400;700&family=Barlow:wght@400;500;600&family=Barlow+Semi+Condensed:wght@500;600;700&display=swap",
];
const STATIC_HOSTS = ["cdn.jsdelivr.net", "cdnjs.cloudflare.com", "fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(CORE);
    // le librerie esterne non devono bloccare l'installazione se una CDN non risponde
    await Promise.allSettled(LIBS.map(u => c.add(new Request(u, { mode: "cors" }))));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function networkFirst(req) {
  const c = await caches.open(CACHE);
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 4000); // rete lenta: dopo 4 s usa la copia salvata
    const res = await fetch(req, { signal: ctl.signal, cache: "no-cache" }); // always asks the server; 304 when unchanged
    clearTimeout(t);
    const p = new URL(req.url).pathname;
    if (res.ok && /\/(index\.html)?$/.test(p)) c.put("./index.html", res.clone());
    return res;
  } catch (_) {
    return (await c.match("./index.html")) || (await c.match("./")) || Response.error();
  }
}

async function staleWhileRevalidate(req, ev) {
  const c = await caches.open(CACHE);
  const hit = await c.match(req);
  // solo risposte valide e leggibili: una risposta opaca potrebbe essere una pagina di errore della CDN
  const net = fetch(req).then(async res => { if (res && res.ok) { try { await c.put(req, res.clone()); } catch (_) {} } return res; }).catch(() => null);
  if (hit) { ev.waitUntil(net); return hit; }
  return (await net) || Response.error();
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (req.mode === "navigate" && url.origin === location.origin) return e.respondWith(networkFirst(req));
  if (url.origin === location.origin && /\.(png|json|svg|ico)$/.test(url.pathname)) return e.respondWith(staleWhileRevalidate(req, e));
  if (STATIC_HOSTS.includes(url.hostname)) return e.respondWith(staleWhileRevalidate(req, e));
  // tutto il resto (meteo, Google, portali) passa direttamente alla rete
});

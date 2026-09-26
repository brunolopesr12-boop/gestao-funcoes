/* Service worker — Vila Rica · Gestão de Cozinha
 * - páginas: rede primeiro, cache como reserva (e /offline quando nada existe)
 * - arquivos estáticos do Next (/_next/static): cache primeiro (são versionados)
 * - chamadas à API/Supabase nunca são cacheadas
 */
const VERSION = "vr-v1";
const STATIC = `${VERSION}-static`;
const PAGES = `${VERSION}-pages`;
const OFFLINE_URL = "/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(PAGES).then((c) => c.addAll([OFFLINE_URL, "/manifest.webmanifest", "/icon.svg"]).catch(() => undefined)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase e terceiros: sempre rede
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return;

  if (url.pathname.startsWith("/_next/static/") || url.pathname === "/icon.svg") {
    event.respondWith(
      caches.open(STATIC).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          if (res.ok) {
            const cache = await caches.open(PAGES);
            cache.put(req, res.clone());
          }
          return res;
        } catch {
          const cache = await caches.open(PAGES);
          return (await cache.match(req)) || (await cache.match(OFFLINE_URL)) || new Response("Sem conexão", { status: 503 });
        }
      })(),
    );
  }
});

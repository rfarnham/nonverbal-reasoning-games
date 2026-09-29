/* Cache contains encrypted packs and public application assets, never keys or decrypted questions. */
const CACHE = "question-search-offline-v1";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    let cache;
    try { cache = await caches.open(CACHE); } catch { /* Online use survives blocked storage. */ }
    const savedResponse = async () => {
      try { return await cache?.match(request); } catch { return undefined; }
    };
    const url = new URL(request.url);
    const mutable = request.mode === "navigate" || url.pathname.endsWith("/manifest.json");
    if (!mutable) {
      const saved = await savedResponse();
      if (saved) return saved;
    }
    try {
      const response = await fetch(request);
      if (response.ok) {
        try { await cache?.put(request, response.clone()); } catch { /* storage may be full or blocked */ }
      }
      return response;
    } catch (error) {
      const saved = await savedResponse();
      if (saved) return saved;
      throw error;
    }
  })());
});

const CACHE_NAME = "cryptohunter-v1";
const OFFLINE_URL = "/offline";

const urlsToCache = ["/", "/offline", "/favicon.png", "/miner.png", "/logo.svg", "/manifest.json"];

// Install event - cache resources
self.addEventListener("install", event => {
  console.log("[SW] Install event");
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      console.log("[SW] Caching app shell");
      await cache.addAll(urlsToCache);
    })(),
  );
  // Skip waiting to activate immediately
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener("activate", event => {
  console.log("[SW] Activate event");
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log("[SW] Deleting old cache:", cacheName);
            return caches.delete(cacheName);
          }
        }),
      );
    })(),
  );
  // Take control of all pages immediately
  self.clients.claim();
});

// Fetch event - serve cached content when offline
self.addEventListener("fetch", event => {
  const { request } = event;

  // Handle navigation requests
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          // Try to fetch from network
          const response = await fetch(request);
          return response;
        } catch {
          // If network fails, serve cached page or offline fallback
          console.log("[SW] Network failed, serving offline page");
          const cache = await caches.open(CACHE_NAME);
          const cachedResponse = await cache.match(OFFLINE_URL);
          return cachedResponse;
        }
      })(),
    );
    return;
  }

  // Handle other requests (CSS, JS, images, etc.)
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cachedResponse = await cache.match(request);

      if (cachedResponse) {
        return cachedResponse;
      }

      try {
        const response = await fetch(request);
        // Cache successful responses
        if (response.status === 200) {
          cache.put(request, response.clone());
        }
        return response;
      } catch (error) {
        console.log("[SW] Fetch failed:", error);
        // Return a fallback response for failed requests
        return new Response("Network error", { status: 503 });
      }
    })(),
  );
});

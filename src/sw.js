const CACHE_NAME = "proof-of-pothole-v2";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./feed.html",
  "./styles.css",
  "./app.js",
  "./classify.js",
  "./map.js",
  "./utils.js",
  "./csv.js",
  "./crypto.js",
  "./canonical.js",
  "./id.js",
  "./pack.js",
  "./ipfs.js",
  "./firebase.js",
  "./config.js",
  "./config.example.js",
  "./feed.js",
  "./verify.html",
  "./verify.js",
  "./manifest.webmanifest",
  "../public/icon-192.png",
  "../public/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        Promise.allSettled(
          CORE_ASSETS.map((asset) =>
            cache.add(asset).catch((err) => {
              console.warn("Skipping cache asset", asset, err);
            })
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        return cached;
      }
      return fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match("./index.html"));
    })
  );
});

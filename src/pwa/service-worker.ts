import { CACHE_PREFIX } from "./config";

export const shellFiles = ["./", "./index.html", "./manifest.webmanifest", "./icons/icon-192.svg", "./icons/icon-512.svg", "./icons/maskable.svg", "./icons/favicon.svg"];

const cacheId = (files: string[]): string => {
  let hash = 5381;
  for (const character of files.join("|")) hash = (hash * 33) ^ character.charCodeAt(0);
  return `${CACHE_PREFIX}${(hash >>> 0).toString(36)}`;
};

export const buildServiceWorker = (bundleFiles: string[]): string => {
  const precache = [...shellFiles, ...bundleFiles.map(file => `./${file}`)];
  const cacheName = cacheId(precache);
  return `const CACHE_NAME = ${JSON.stringify(cacheName)};
const CACHE_PREFIX = ${JSON.stringify(CACHE_PREFIX)};
const PRECACHE = ${JSON.stringify(precache)};

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE)));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(names => Promise.all(names
    .filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
    .map(name => caches.delete(name))
  )).then(() => self.clients.claim()));
});

self.addEventListener("message", event => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).then(response => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
      return response;
    }).catch(() => caches.match(event.request).then(response => response || caches.match("./"))));
    return;
  }
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
    const copy = response.clone();
    event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy)));
    return response;
  })));
});`;
};

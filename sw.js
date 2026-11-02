// Service worker : permet l'installation sur l'écran d'accueil et ouvre
// l'application plus vite. Les données (Supabase) ne sont jamais mises en cache.
// Changer VERSION à chaque mise à jour pour que les téléphones reprennent les nouveaux fichiers.
const VERSION = "gc-inventaire-v5";
const COQUILLE = [
  "./",
  "./index.html",
  "./config.js",
  "./manifest.webmanifest",
  "./app.css",
  "./app.js",
  "./data.js",
  "./utils.js",
  "./images.js",
  "./icons.js",
  "./importer.js",
  "./transfert.js",
  "./contours.svg",
  "./icon.svg",
  "./icon-192.png",
  "./manrope.woff2",
  "./instrument-serif.woff2",
  "./instrument-serif-italic.woff2",
  "./jetbrains-mono.woff2",
  "./supabase.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(COQUILLE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((cles) => Promise.all(cles.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Réseau d'abord (pour avoir la dernière version). Si le réseau est absent
// ou trop lent (plus de 4 s), la copie enregistrée est utilisée.
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const copie = await cache.match(req, { ignoreSearch: true });
    const reseau = fetch(req).then((rep) => {
      if (rep.ok) cache.put(req, rep.clone());
      return rep;
    });
    if (!copie) {
      return reseau.catch(async () => (await cache.match("./index.html")) || Response.error());
    }
    const delai = new Promise((resolve) => setTimeout(() => resolve(copie), 4000));
    return Promise.race([reseau.catch(() => copie), delai]);
  })());
});

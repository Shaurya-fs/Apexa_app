// Network first, cache as fallback: a git push shows up on the next launch,
// and the app still opens with no signal.
const CACHE = "race-engineer-v1";
const SHELL = [
  "./", "./index.html", "./manifest.json", "./support.js", "./image-slot.js",
  "./auth.js", "./race-catalogue.js", "./engineer-roster.js", "./engineer-brain.js",
  "./live-delta.js", "./race-coach.js", "./lap-trace.js", "./race-strategy.js",
  "./pages/crew.js", "./pages/records.js", "./pages/analysis.js",
  "./pages/pro.js", "./pages/strategy.js",
  "./portraits/wren.png", "./portraits/marchetti.png",
  "./portraits/sato.png", "./portraits/adeola.png",
  "./icons/icon-192.png", "./icons/icon-512.png"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const r = e.request;
  if (r.method !== "GET") return;
  const url = new URL(r.url);
  if (url.origin !== location.origin) return;   // Firebase and fonts go straight out
  e.respondWith(
    fetch(r)
      .then(res => {
        if (res && res.ok) caches.open(CACHE).then(c => c.put(r, res.clone()));
        return res;
      })
      .catch(() => caches.match(r).then(hit => hit || caches.match("./index.html")))
  );
});

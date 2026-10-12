const CACHE = 'drive-link-motorista-v1';
const ARQUIVOS_BASE = ['./index.html', './app.js', '../shared/style.css', '../shared/config.js'];

self.addEventListener('install', (evento) => {
  evento.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ARQUIVOS_BASE)));
  self.skipWaiting();
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys().then((chaves) =>
      Promise.all(chaves.filter((c) => c !== CACHE).map((c) => caches.delete(c)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (evento) => {
  evento.respondWith(
    fetch(evento.request).catch(() => caches.match(evento.request))
  );
});

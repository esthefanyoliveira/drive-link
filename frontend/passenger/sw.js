// Service worker mínimo — só o necessário para o navegador permitir instalar
// o site como aplicativo. Não guarda dados em cache agressivamente porque o
// app depende de informações sempre atualizadas (corridas, localização etc.).
const CACHE = 'drive-link-passageiro-v1';
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

// Estratégia "rede primeiro": sempre tenta buscar a versão mais nova; só usa
// o cache como reserva se o dispositivo estiver sem internet.
self.addEventListener('fetch', (evento) => {
  evento.respondWith(
    fetch(evento.request).catch(() => caches.match(evento.request))
  );
});

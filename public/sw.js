// Service Worker básico para PWA do Aplicativo do Ministro
// Cache estritamente limitado a assets públicos estáticos (não armazena APIs, tokens ou dados pessoais)

const CACHE_NAME = 'comieadepa-ministro-static-v1';
const STATIC_ASSETS = [
  '/img/bg_app1.png',
  '/img/logo_comieadepa.png',
  '/favicon.ico',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // NUNCA interceptar ou cachear requisições para a API ou rotas de autenticação
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/portal-ministro/login')) {
    return;
  }

  // Apenas intercepta requisições GET para imagens estáticas pré-cacheadas
  if (event.request.method === 'GET' && STATIC_ASSETS.includes(url.pathname)) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        return cachedResponse || fetch(event.request);
      })
    );
  }
});

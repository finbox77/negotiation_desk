/* sw.js — оболочка PWA «Стол переговоров».
 *
 * Кешируем только статику и index.html. /api/** всегда идёт в сеть: сообщения
 * и допуски нельзя показывать из устаревшего кеша. При офлайне навигация
 * падает обратно на сохранённую оболочку, а приложение показывает баннер
 * «нет сети».
 *
 * Меняете оболочку — поднимите VERSION, иначе старый кеш останется у людей.
 */

const VERSION = 'desk-shell-v1';
const STATIC_CACHE = `${VERSION}-static`;

self.addEventListener('install', (event) => {
  const scope = self.registration.scope;
  const shell = [
    scope,
    new URL('index.html', scope).href,
    new URL('manifest.webmanifest', scope).href,
    new URL('favicon.svg', scope).href,
    new URL('icons/icon-192.png', scope).href,
    new URL('icons/icon-512.png', scope).href,
  ];

  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(shell))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== STATIC_CACHE).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('/api/')) return; // данные — только из сети

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(new URL('index.html', self.registration.scope).href),
      ),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    }),
  );
});

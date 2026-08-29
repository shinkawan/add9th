// Cyber-Deck OS Service Worker
const CACHE_NAME = 'cyber-deck-v7';
const ASSETS = [
    './',
    'index.html',
    'style.css',
    'main.js',
    'logo.png',
    'icon-512.png',
    'manifest.json',
    'hatsukoi.m4a',
    'okashina_koibito.m4a',
    'kaseijin_no_uta.m4a'
];

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS);
        })
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('PURGING OLD CACHE:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request).then((response) => {
            return response || fetch(event.request);
        })
    );
});

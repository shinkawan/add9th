// Minimal Service Worker to satisfy PWA requirements
const CACHE_NAME = 'cyber-deck-v6';
const ASSETS = [
    './',
    'index.html',
    'style.css',
    'main.js',
    'logo.png',
    'manifest.json',
    'hatsukoi.m4a',
    'okashina_koibito.m4a',
    'kaseijin_no_uta.m4a'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS);
        })
    );
});

self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request).then((response) => {
            return response || fetch(event.request);
        })
    );
});

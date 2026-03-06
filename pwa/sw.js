const CACHE = 'nrf-finder-v1';
const ASSETS = [
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/nrf-analysis.js',
  './js/sensors.js',
  './manifest.webmanifest'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener('fetch', (event) => {
  event.respondWith(caches.match(event.request).then((res) => res || fetch(event.request)));
});

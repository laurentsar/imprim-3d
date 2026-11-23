/* Imprim 3D — service worker (version web uniquement). Cache l'app shell, y
   compris le trancheur (4 Mo) : il tranche hors ligne. Les API (Printables,
   Thingiverse, MakerWorld, OctoPrint, GitHub) ne sont jamais mises en cache. */
const CACHE = 'imprim-3d-v1.4';
const SHELL = [
  'index.html', 'styles.css', 'app.js', 'sources.js', 'mesh.js', 'viewer.js',
  'octoprint.js', 'slicer-settings.js', 'lithophane.js', 'update-check.js', 'autobackup.js',
  'manifest.webmanifest', 'img/icon-192.png', 'img/icon-512.png',
  'vendor/jszip.min.js', 'vendor/three/three.module.min.js', 'vendor/three/OrbitControls.js',
  'vendor/cura-wasm.es.js', 'vendor/ender3.def.json',
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});

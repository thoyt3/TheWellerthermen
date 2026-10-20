// Offline support. The app shell and location data are kept per release; forecasts,
// tides and place lookups are fetched fresh when there is signal and the last copy
// is served when there is not.
const VERSION = 'dev'; // replaced with the commit id at deploy time
const SHELL = `shell-${VERSION}`;
const SAVED = 'saved-forecasts';
const SAVED_LIMIT = 80;
const SHELL_FILES = [
  './',
  'index.html',
  `style.css?v=${VERSION}`,
  `app.js?v=${VERSION}`,
  'manifest.webmanifest',
  'images/default.jpg',
  'images/golf.jpg',
  'images/hiking.jpg',
  'images/scuba_diving.jpg',
  'images/surfing.jpg',
  'images/icon-192.png',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
];
const LIVE_HOSTS = [
  'api.open-meteo.com',
  'marine-api.open-meteo.com',
  'air-quality-api.open-meteo.com',
  'geocoding-api.open-meteo.com',
  'api.tidesandcurrents.noaa.gov',
  'nominatim.openstreetmap.org',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== SHELL && n !== SAVED).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

async function trim(cache) {
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - SAVED_LIMIT)).map((key) => cache.delete(key)));
}

// Fresh when possible, the saved copy when not.
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone());
      if (cacheName === SAVED) trim(cache);
    }
    return response;
  } catch (error) {
    // a page asked for with a different search still gets the saved app
    const saved = await cache.match(request) || (request.mode === 'navigate' && await cache.match('./'));
    if (saved) return saved;
    throw error;
  }
}

// The saved copy straight away, with a fetch behind it for next time.
async function cacheFirst(request) {
  const cache = await caches.open(SHELL);
  const saved = await cache.match(request);
  if (saved) return saved;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (LIVE_HOSTS.includes(url.hostname)) {
    event.respondWith(networkFirst(request, SAVED));
  } else if (url.origin === self.location.origin) {
    // pages go to the network first so a new release shows up; versioned files never change
    const isPage = request.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('.html');
    event.respondWith(isPage ? networkFirst(request, SHELL) : cacheFirst(request));
  } else if (url.hostname === 'unpkg.com') {
    event.respondWith(cacheFirst(request));
  }
  // map tiles and everything else go straight to the network
});

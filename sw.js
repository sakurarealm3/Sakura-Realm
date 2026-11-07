/* Sakura Realm - offline app shell.
   Page images are NOT cached here (downloaded chapters live in IndexedDB), so this uses almost no storage / bandwidth. */
const CACHE = 'sakura-shell-v17';
const SHELL = ['./', 'index.html', 'style.css', 'script.js', 'i18n.js', 'lang-my.js'];
const CDN = /(^|\.)(gstatic\.com|googleapis\.com|cdnjs\.cloudflare\.com|cdn\.tailwindcss\.com|jsdelivr\.net)$/;

self.addEventListener('install', (e) => {
    e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
    e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
    const req = e.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    const sameOrigin = url.origin === location.origin;
    const isCdn = CDN.test(url.hostname);
    if (!sameOrigin && !isCdn) return;                       // manga images, Firebase data, etc. -> untouched
    if (sameOrigin && /\.(webp|png|jpe?g|gif)$/i.test(url.pathname) === false && !/\.(html|css|js)$|\/$/.test(url.pathname)) return;

    if (isCdn) {
        // libraries / fonts / icons never change for a given URL: cache-first = no repeat downloads
        // ask for a CORS response when the CDN allows it, so the saved size can be measured in Settings
        const getIt = () => fetch(new Request(req.url, { mode: 'cors', credentials: 'omit' })).catch(() => fetch(req));
        e.respondWith(caches.match(req).then(hit => hit || getIt().then(res => {
            if (res && (res.ok || res.type === 'opaque')) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(req, cp)); }
            return res;
        })));
        return;
    }
    // own files: network first (updates show up), fall back to the saved copy when offline
    e.respondWith(fetch(req).then(res => {
        if (res && res.ok) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(req, cp)); }
        return res;
    }).catch(() => caches.match(req).then(hit => hit || (req.mode === 'navigate' ? caches.match('index.html') : Response.error()))));
});

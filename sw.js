const CACHE = "snipai-v1";
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days in ms

// Assets to cache on install
const PRECACHE = [
    "/",
    "/index.html",
    "/style.css",
    "/app.js",
    "/manifest.json",
    "/icons/icon-192.svg",
    "/icons/icon-512.svg"
];

// ── Install: precache all shell assets ─────────────────────
self.addEventListener("install", e => {
    e.waitUntil(
        caches
            .open(CACHE)
            .then(cache => cache.addAll(PRECACHE))
            .then(() => self.skipWaiting())
    );
});

// ── Activate: remove old caches ────────────────────────────
self.addEventListener("activate", e => {
    e.waitUntil(
        caches
            .keys()
            .then(keys =>
                Promise.all(
                    keys.filter(k => k !== CACHE).map(k => caches.delete(k))
                )
            )
            .then(() => self.clients.claim())
    );
});

// ── Fetch: network-first for API, cache-first for assets ───
self.addEventListener("fetch", e => {
    const url = new URL(e.request.url);

    // Always go network-first for API calls — never serve stale AI results
    if (
        url.pathname.startsWith("/snippets") ||
        url.pathname.startsWith("/ai")
    ) {
        e.respondWith(
            fetch(e.request).catch(
                () =>
                    new Response(
                        JSON.stringify({
                            success: false,
                            error: "You are offline"
                        }),
                        { headers: { "Content-Type": "application/json" } }
                    )
            )
        );
        return;
    }

    // Cache-first for Monaco CDN and static assets
    e.respondWith(
        caches.match(e.request).then(cached => {
            if (cached) return cached;

            return fetch(e.request)
                .then(response => {
                    // Only cache valid same-origin or CDN responses
                    if (
                        response.ok &&
                        (url.origin === self.location.origin ||
                            url.hostname === "cdnjs.cloudflare.com")
                    ) {
                        const clone = response.clone();
                        caches
                            .open(CACHE)
                            .then(cache => cache.put(e.request, clone));
                    }
                    return response;
                })
                .catch(() => {
                    // Offline fallback for navigation requests
                    if (e.request.mode === "navigate") {
                        return caches.match("/index.html");
                    }
                });
        })
    );
});

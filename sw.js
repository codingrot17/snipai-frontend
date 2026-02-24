// ── Cache version — CHANGE THIS STRING on every deploy ─────
// Vercel injects VITE_VERCEL_GIT_COMMIT_SHA but we use a timestamp fallback
const CACHE_VERSION = "snipai-v1771944478604650217";
const CACHE = CACHE_VERSION;

// Only cache third-party CDN assets (Monaco, Appwrite SDK)
// Our OWN files always go network-first so updates appear instantly
const CDN_CACHE = "snipai-cdn-v1";

const CDN_HOSTS = [
    "cdnjs.cloudflare.com",
    "cdn.jsdelivr.net",
    "fonts.googleapis.com",
    "fonts.gstatic.com"
];

const PRECACHE_URLS = [
    "/",
    "/index.html",
    "/style.css",
    "/auth.css",
    "/app.js",
    "/auth.js",
    "/appwrite.js",
    "/manifest.json"
];

// ── Install ────────────────────────────────────────────────
self.addEventListener("install", e => {
    // Skip waiting immediately so new SW activates right away
    self.skipWaiting();
    e.waitUntil(
        caches.open(CACHE).then(cache =>
            // Don't let precache failures block install
            Promise.allSettled(
                PRECACHE_URLS.map(url =>
                    fetch(url, { cache: "no-store" })
                        .then(res => {
                            if (res.ok) cache.put(url, res);
                        })
                        .catch(() => {})
                )
            )
        )
    );
});

// ── Activate ───────────────────────────────────────────────
self.addEventListener("activate", e => {
    e.waitUntil(
        caches
            .keys()
            .then(keys =>
                Promise.all(
                    keys
                        .filter(k => k !== CACHE && k !== CDN_CACHE)
                        .map(k => caches.delete(k))
                )
            )
            .then(() => self.clients.claim()) // take control immediately
    );
});

// ── Fetch ──────────────────────────────────────────────────
self.addEventListener("fetch", e => {
    const url = new URL(e.request.url);

    // 1. CDN assets — cache-first (they never change for a given URL)
    if (CDN_HOSTS.some(h => url.hostname === h)) {
        e.respondWith(
            caches.open(CDN_CACHE).then(cache =>
                cache.match(e.request).then(cached => {
                    if (cached) return cached;
                    return fetch(e.request).then(res => {
                        if (res.ok) cache.put(e.request, res.clone());
                        return res;
                    });
                })
            )
        );
        return;
    }

    // 2. API / AI calls — always network, never cache
    if (
        url.hostname.includes("appwrite.io") ||
        url.hostname.includes("groq.com")
    ) {
        e.respondWith(
            fetch(e.request).catch(
                () =>
                    new Response(
                        JSON.stringify({ success: false, error: "Offline" }),
                        {
                            headers: { "Content-Type": "application/json" }
                        }
                    )
            )
        );
        return;
    }

    // 3. Our own app files — NETWORK FIRST, fall back to cache
    // This ensures updates are seen immediately after deploy
    e.respondWith(
        fetch(e.request, { cache: "no-cache" })
            .then(res => {
                if (res.ok) {
                    const clone = res.clone();
                    caches.open(CACHE).then(c => c.put(e.request, clone));
                }
                return res;
            })
            .catch(() =>
                caches
                    .match(e.request)
                    .then(
                        cached =>
                            cached ||
                            (e.request.mode === "navigate"
                                ? caches.match("/index.html")
                                : new Response("Offline", { status: 503 }))
                    )
            )
    );
});

// ── Message: force update from app ────────────────────────
self.addEventListener("message", e => {
    if (e.data === "SKIP_WAITING") self.skipWaiting();
});

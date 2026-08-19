// Offline play.
//
// The game is a fixed bundle plus a seeded generator -- there is no server, no content to fetch and
// no session to keep alive. That makes offline the natural state rather than a feature: once the
// bundle is cached the whole game runs, and a phone on the underground does not care.
//
// Strategy is deliberately split rather than uniform:
//
//   navigations   network first, cache as fallback. A stale HTML shell pinned in cache is how a
//                 PWA ends up serving last month's build forever, and the shell is one small
//                 request.
//   /music/       stale while revalidating. Cache first for speed, then quietly refetch and replace, so a
//                 re-mastered track reaches a returning player on their next visit.
//   everything    cache first. Vite fingerprints its assets, so a cached hit for a hashed URL is
//                 by definition the right bytes, and going to the network to confirm that is pure
//                 latency.
//
// That middle rule exists because the reasoning behind the last one does not extend to it. `/music/` is the
// one place in the build with *stable* URLs -- `bgm-explore.opus` is always `bgm-explore.opus` -- so a cached
// hit there is not "by definition the right bytes", it is whatever was true the first time somebody loaded the
// page, pinned until the cache name changes. Replacing a mix and having returning players never hear it is a
// bug with no symptom the player could report.
//
// Saves live in localStorage and are not touched here.

// Bumping this is the whole release mechanism: `activate` deletes every other generation. Bumped for the
// audio, which the previous version had pinned under the wrong strategy.
const CACHE = "orekenoid-v2";
/** Stable, unhashed URLs, where a cached copy is a guess about freshness rather than a certainty. */
const REVALIDATE = "/music/";
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (event) => {
  // Individually, so one 404 in the shell list cannot fail the whole install.
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(SHELL.map((url) => cache.add(url).catch(() => undefined)));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Drop every older cache generation. Bumping CACHE is the whole release mechanism.
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  // Only GET, and only this origin. A POST is not cacheable and a cross-origin request is somebody
  // else's business.
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        const cache = await caches.open(CACHE);
        void cache.put(request, fresh.clone());
        return fresh;
      } catch {
        // Offline. Fall back to whatever shell we have, by URL and then by the root.
        const cached = await caches.match(request) ?? await caches.match("/index.html");
        if (cached) return cached;
        throw new Error("offline and no cached shell");
      }
    })());
    return;
  }

  if (url.pathname.startsWith(REVALIDATE)) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      // Not awaited when there is a cached copy: the point is to answer instantly and be right next time.
      const refresh = (async () => {
        try {
          const fresh = await fetch(request);
          if (fresh.ok && fresh.type === "basic") {
            const cache = await caches.open(CACHE);
            await cache.put(request, fresh.clone());
          }
          return fresh;
        } catch {
          return null;
        }
      })();
      if (cached) {
        event.waitUntil(refresh);
        return cached;
      }
      const fresh = await refresh;
      if (fresh) return fresh;
      throw new Error("offline and nothing cached");
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    const fresh = await fetch(request);
    // Opaque and error responses are not worth keeping: caching them would pin a failure.
    if (fresh.ok && fresh.type === "basic") {
      const cache = await caches.open(CACHE);
      void cache.put(request, fresh.clone());
    }
    return fresh;
  })());
});

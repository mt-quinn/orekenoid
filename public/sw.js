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
//   media         not touched at all. See below -- this one is not a preference, it is a correctness rule.
//   /music/       stale while revalidating, for the plain `fetch` the sound effects use. Cache first for speed,
//                 then quietly refetch and replace, so a re-mastered track reaches a returning player on their
//                 next visit.
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

// Bumping this is the whole release mechanism: `activate` deletes every other generation. Bumped again for the
// audio: stale-while-revalidate serves the cached copy first, which meant a browser that had already stored the
// mono AAC kept being handed the one file WebKit refuses, for at least one more visit, after it was fixed.
// Bumped again: the previous generation holds full-file 200 responses for the music, which is what this worker
// used to hand a media element instead of a range.
const CACHE = "orekenoid-v4";
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

  // Media is handed straight back to the browser, and this is the most expensive thing in this file to have
  // learned.
  //
  // A media element streams by asking for byte ranges. This worker answered a ranged request with the whole file
  // out of the cache -- a 200 where the element required a 206 -- and Safari's reaction to that is to refuse the
  // source outright: `readyState` 0, `MediaError.code` 4, `SRC_NOT_SUPPORTED`, which reads exactly like an
  // unplayable file and is nothing of the sort. Measured: the same bytes played instantly from a `blob:` URL,
  // while a `fetch` with a Range header came back 200 with no `content-range` through the worker and 206
  // straight from the server.
  //
  // The small sound effects survived it, because a whole-file response for seven kilobytes is something Safari
  // will accept; ten megabytes it will not. So the symptom appeared only for the score, which sent every
  // diagnosis after the score's own files.
  //
  // `destination` catches the element; the Range header catches anything else that streams. Either is enough to
  // stay out of the way. The cost is that the score is not available offline, which is worth paying: the
  // alternative is a worker quietly breaking the one request type it cannot represent.
  if (request.destination === "audio" || request.destination === "video" || request.headers.has("range")) return;

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

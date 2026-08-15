# @bunker/cache

The Cache API — `Request`/`Response` pairs, in the window and in a service worker.

```javascript
import { createCache } from '@bunker/cache';

const cache = createCache({ name: 'sheets' });
const css   = await cache.staleWhileRevalidate('/app.ass', { transform: compile, type: 'text/css' });
```

## Why this one fixes render blocking

The other packages store *values*. This one stores responses, which means a service
worker can answer the browser's own request:

```javascript
self.addEventListener('fetch', (event) => {
  if (!event.request.url.endsWith('.ass')) return;
  event.respondWith(cache.staleWhileRevalidate(event.request, { transform: compile, type: 'text/css' }));
});
```

`keepAlive` matters here: a service worker may be killed the moment it has answered,
which would lose the refresh it just started. Passing `event.waitUntil` keeps it alive
until the revalidation settles.

The `<link rel=stylesheet>` stays an ordinary render-blocking link. The browser waits
for it, but only on a cache hit. No JavaScript on the critical path, no flash, and the
compile is paid once instead of on every navigation.

It does not cover the very first visit — a service worker has to be installed first —
and it needs HTTPS or localhost. For that gap, see `@bunker/storage` and the
synchronous boot path.

## Revalidation is conditional

The source's `ETag` and `Last-Modified` are stored next to the body under their own
headers. That separation matters once `transform` is involved: after an ASS → CSS
compile the upstream validator describes the *source*, which is exactly what the
revalidation needs to ask about.

So an unchanged file costs a 304 and no body at all, and `onRevalidate` stays quiet —
a 304 is not a change.

```javascript
await cache.staleWhileRevalidate(request, {
  ttl          : 60_000,                    // younger than this: no network at all
  transform    : compile,
  onRevalidate : (fresh) => swapIn(fresh),  // only when the body actually changed
});
```

A failing revalidation is reported through `onError` and leaves the cached copy in
place. Going offline must not blank the page.

Concurrent requests for one URL collapse into a single fetch.

## Metadata

Stored responses carry three extra headers:

```
x-bunker-at               when it was stored
x-bunker-source-etag      the source's ETag
x-bunker-source-modified  the source's Last-Modified
```

## As a key-value driver

```javascript
const policy = createPolicy({ driver: cache.driver() });
```

JSON bodies under synthetic URLs, for when compiled output belongs in the Cache API
rather than IndexedDB.

## Key access

```javascript
const sheet = await cache.proxy['/app.css'];
cache.proxy['/app.css'] = new Response(css, { headers: { 'content-type': 'text/css' } });
delete cache.proxy['/app.css'];
```

Sugar over `match`, `put` and `delete`. It sits on `.proxy` rather than on the cache
itself so a key named `keys` or `match` cannot be shadowed by the method.

## Degrading

Where the Cache API is missing — an insecure context, a browser without it —
`match()` answers `null`, `put()` answers `false`, and `staleWhileRevalidate()` still
fetches and transforms. Nothing throws.

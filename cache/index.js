// @bunker/cache
// @ts-self-types="./index.d.ts"

import { createReport, proxyOf } from '@bunker/core';
import { once }                  from '@bunker/utils/once.js';
import { createSingleFlight }    from '@bunker/utils/singleFlight.js';

/*
  the cache api stores Request/Response pairs rather than values, which is exactly
  why it is the one that fixes render blocking: a service worker answers the real
  request for a stylesheet from here, so the browser's own loading path is untouched
  and no javascript sits on the critical path.

  metadata rides along as headers on the stored response. the source validators are
  kept separately from any the transformed body might carry: after an ass -> css
  transform the upstream etag describes the *source*, which is precisely what a
  conditional revalidation needs to ask about.
*/
const STAMP           = 'x-bunker-at';
const SOURCE_ETAG     = 'x-bunker-source-etag';
const SOURCE_MODIFIED = 'x-bunker-source-modified';

const isSupported = ()        => typeof caches !== 'undefined';
const urlOf       = (request) => typeof request === 'string' ? request : request.url;

// a conditional revalidation attaches If-None-Match / If-Modified-Since, neither of which
// is a cors-safelisted request header. adding them to a cross-origin request forces a
// preflight that the asset hosts (code.pulgasari.dev, the icon api) do not answer, so
// cross-origin revalidates with a plain simple GET instead. outside a browsing/worker
// context (the node test run) there is no origin to compare against — treat that as
// same-origin so the conditional still goes out.
function sameOrigin (url) {
  if (typeof self === 'undefined' || !self.location) return true;
  try   { return new URL(url, self.location.href).origin === self.location.origin; }
  catch { return true; }
}

// a stored response carries our stamp plus whatever validators the source had
function stamp (response, body, { at = Date.now(), etag = null, modified = null, type = null } = {}) {
  const headers = new Headers(response.headers);

  headers.set(STAMP, String(at));
  if (etag)     headers.set(SOURCE_ETAG, etag);
  if (modified) headers.set(SOURCE_MODIFIED, modified);
  if (type)     headers.set('content-type', type);

  return new Response(body, { headers, status: response.status, statusText: response.statusText });
}

const ageOf = (response) => {
  const at = Number(response.headers.get(STAMP));
  return Number.isFinite(at) && at > 0 ? Date.now() - at : Infinity;
};

// :::::: FILES ::::::::::::::::::::::::::::::::::::::::::::::::::

export function createCache (options = {}) {
  const { name = 'bunker', onError = null, onSuccess = null } = options;
  const flight = createSingleFlight();
  const { attempt, done, fail, over } = createReport({ onError, onSuccess });

  // opened once, a failure is reported and tried again on the next call
  const opening = once(async () => { const cache = await caches.open(name); done('open', name); return cache; });
  const open    = () => isSupported() ? attempt('open', name, null, opening) : Promise.resolve(null);
  const op      = over(open);

  const match = op('match', null, { detail: hit => ({ hit: hit !== null }), key: urlOf })(
    async (cache, request) => (await cache.match(request)) ?? null
  );

  // an opaque response has status 0 and cache.put() rejects on it outright
  const store = op('put', false, { key: urlOf })(
    async (cache, request, response) => { await cache.put(request, response); return true; }
  );
  const put = (request, response) => response.type === 'opaque' || response.status === 0 ? Promise.resolve(false) : store(request, response);

  const remove = op('delete', false, { detail: deleted => ({ deleted }), key: urlOf })(
    (cache, request) => cache.delete(request)
  );

  const keys = op('keys', [], { detail: stored => ({ count: stored.length }), key: () => null })(
    cache => cache.keys()
  );

  async function clear () {
    if (!isSupported()) return false;
    opening.reset();
    return attempt('clear', name, false, () => caches.delete(name), { detail: deleted => ({ deleted }) });
  }

  // :::::: fetch + transform + store

  // a conditional request, so an unchanged source costs a 304 and no body at all.
  // cross-origin skips it: the validators are not cors-safelisted and would force a
  // preflight the source host does not answer, so a plain GET revalidation is left instead.
  function conditional (request, cached) {
    const etag     = cached?.headers.get(SOURCE_ETAG);
    const modified = cached?.headers.get(SOURCE_MODIFIED);
    if (!etag && !modified)          return request;
    if (!sameOrigin(urlOf(request))) return request;

    try {
      const headers = new Headers(request instanceof Request ? request.headers : undefined);
      if (etag)     headers.set('If-None-Match', etag);
      if (modified) headers.set('If-Modified-Since', modified);
      return new Request(request, { headers });
    } catch {
      // navigation requests and a few other modes cannot be reconstructed. no
      // conditional then, just a plain refetch.
      return request;
    }
  }

  async function keep (request, response, transform, type) {
    const meta = {
      etag     : response.headers.get('etag'),
      modified : response.headers.get('last-modified'),
      type,
    };

    if (!transform) { // keep one copy for the cache and hand the other back, a body reads once
      const stored = stamp(response, await response.clone().arrayBuffer(), meta);
      await put(request, stored.clone());
      return stored;
    }

    const source      = await response.text();
    const transformed = await transform(source, { request, response });
    const stored      = stamp(response, transformed, meta);

    await put(request, stored.clone());
    return stored;
  }

  /*
    the anti-flicker primitive.

    a cached response is returned immediately and revalidated in the background.
    with `ttl` set, a response younger than it skips the revalidation entirely.

    `transform` turns the source into what gets stored, which is where an
    ass -> css compile hooks in: the compile is paid once, not on every navigation.

    `keepAlive` receives the background revalidation. a service worker passes its
    event.waitUntil here — without it the worker may be killed the moment it has
    answered, and the refresh it started is lost.
  */
  async function staleWhileRevalidate (request, options = {}) {
    const { keepAlive = null, onRevalidate = null, transform = null, ttl = 0, type = null } = options;

    const cached = await match(request);
    if (cached && ttl > 0 && ageOf(cached) < ttl) return cached;

    const revalidate = () => flight(urlOf(request), async () => {
      const response = await fetch(conditional(request, cached));

      // unchanged: keep the stored body, just refresh its age. re-read from the
      // cache rather than reusing `cached`, whose body the caller may already be
      // consuming — clone() only works while a body is still untouched.
      if (response.status === 304 && cached) {
        const stored = await match(request);
        if (stored) {
          await put(request, stamp(stored, await stored.arrayBuffer(), {
            etag     : stored.headers.get(SOURCE_ETAG),
            modified : stored.headers.get(SOURCE_MODIFIED),
          }));
        }
        done('revalidate', urlOf(request), { notModified: true, status: 304 });
        return null;
      }

      if (!response.ok) throw new Error(`[bunker] ${response.status} ${response.statusText} for ${urlOf(request)}`);
      const stored = await keep(request, response, transform, type);
      done('revalidate', urlOf(request), { notModified: false, status: response.status });
      return stored;
    });

    if (cached) {
      const pending = revalidate()
        .then(fresh => { if (fresh && onRevalidate) onRevalidate(fresh.clone()); })
        .catch(error => fail('revalidate', urlOf(request), error)); // offline keeps the stale copy

      keepAlive?.(pending);
      return cached;
    }

    return revalidate();
  }

  // :::::: DRIVER :::::::::::::::::::::::::::::::::::::::::::::::

  /*
    a @bunker/core driver over text bodies, so compiled output can live in the cache
    api instead of indexeddb. keys become urls under `origin`, which never leave the
    cache and only have to be stable and unique.
  */
  function driver ({ origin = 'https://bunker.invalid/' } = {}) {
    const toUrl = (key) => new URL(encodeURIComponent(key), origin).href;

    return {
      name   : `cache-api:${name}`,
      sync   : false,
      clear  : ()           => clear(),
      delete : (key)        => remove(toUrl(key)).then(() => undefined),
      set    : (key, value) => put(toUrl(key), new Response(JSON.stringify(value))).then(() => undefined),

      async get (key) {
        const response = await match(toUrl(key));
        if (!response) return null;
        try   { return JSON.parse(await response.text()); }
        catch { return null; } // a body written by something else is a miss, not a crash
      },

      async keys (prefix = '') {
        const stored = await keys();
        return stored
          .map(request => decodeURIComponent(new URL(request.url).pathname.slice(1)))
          .filter(key => key.startsWith(prefix));
      },
    };
  }

  const api = {
    name, driver, isSupported,
    clear, keys, match, open, put, staleWhileRevalidate,
    delete : remove,
  };

  // lazy, because a Proxy costs nothing until someone actually wants the sugar
  let proxy = null;
  Object.defineProperty(api, 'proxy', { get: () => proxy ??= createProxy(api) });

  return api;
}

// :::::: PROXY ::::::::::::::::::::::::::::::::::::::::::::::::::

// cache.proxy['/app.css'] -> Promise<Response | null>  /  delete cache.proxy['/app.css']
const createProxy = (cache) => proxyOf({ delete: cache.delete, get: cache.match, set: cache.put });

export const cache = createCache();

// :::::: EXPORT :::::::::::::::::::::::::::::::::::::::::::::::::

export {
  createProxy,
};

export default createCache;

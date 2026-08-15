// @bunker/cache
// @ts-self-types="./index.d.ts"

import { createSingleFlight } from './../utils/singleFlight.js'; // from '@bunker/utils/singleFlight.js';

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
  const { name = 'bunker', onError = null } = options;
  const once = createSingleFlight();
  const fail = (operation, key, error) => { onError?.({ error, key, operation }); };
  let opened = null;

  function open () {
    if (!isSupported()) return Promise.resolve(null);
    return opened ??= caches.open(name).catch(error => { fail('open', name, error); opened = null; return null; });
  }

  async function match (request) {
    const cache = await open(); if (!cache) return null;
    try       { return (await cache.match(request)) ?? null; }
    catch (e) { fail('match', urlOf(request), e); return null; }
  }

  async function put (request, response) {
    const cache = await open(); if (!cache) return false;

    // an opaque response has status 0 and cache.put() rejects on it outright
    if (response.type === 'opaque' || response.status === 0) return false;

    try       { await cache.put(request, response); return true; }
    catch (e) { fail('put', urlOf(request), e); return false; }
  }

  async function remove (request) {
    const cache = await open(); if (!cache) return false;
    try       { return await cache.delete(request); }
    catch (e) { fail('delete', urlOf(request), e); return false; }
  }

  async function keys () {
    const cache = await open(); if (!cache) return [];
    try       { return await cache.keys(); }
    catch (e) { fail('keys', null, e); return []; }
  }

  async function clear () {
    if (!isSupported()) return false;
    opened = null;
    try       { return await caches.delete(name); }
    catch (e) { fail('clear', name, e); return false; }
  }

  // :::::: fetch + transform + store

  // a conditional request, so an unchanged source costs a 304 and no body at all
  function conditional (request, cached) {
    const etag     = cached?.headers.get(SOURCE_ETAG);
    const modified = cached?.headers.get(SOURCE_MODIFIED);
    if (!etag && !modified) return request;

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

  async function store (request, response, transform, type) {
    const meta = {
      etag     : response.headers.get('etag'),
      modified : response.headers.get('last-modified'),
      type,
    };

    if (!transform) {
      // keep one copy for the cache and hand the other back, a body reads once
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
  */
  async function staleWhileRevalidate (request, options = {}) {
    const { onRevalidate = null, transform = null, ttl = 0, type = null } = options;

    const cached = await match(request);
    if (cached && ttl > 0 && ageOf(cached) < ttl) return cached;

    const revalidate = () => once(urlOf(request), async () => {
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
        return null;
      }

      if (!response.ok) throw new Error(`[bunker] ${response.status} ${response.statusText} for ${urlOf(request)}`);
      return store(request, response, transform, type);
    });

    if (cached) {
      revalidate()
        .then(fresh => { if (fresh && onRevalidate) onRevalidate(fresh.clone()); })
        .catch(error => fail('revalidate', urlOf(request), error)); // offline keeps the stale copy
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

  return {
    name, driver, isSupported,
    clear, keys, match, open, put, staleWhileRevalidate,
    delete : remove,
  };
}

export const cache = createCache();
export default createCache;

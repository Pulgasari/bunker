// minimal in-memory CacheStorage + fetch stub.
// node has Request/Response/Headers but no cache api, and the point of the files
// suite is our logic against that surface, not the browser's implementation of it.

const urlOf = (request) => typeof request === 'string' ? request : request.url;

class FakeCache {
  #entries = new Map;

  async match (request) {
    const stored = this.#entries.get(urlOf(request));
    return stored ? stored.clone() : undefined;
  }

  async put (request, response) {
    if (response.status === 0) throw new TypeError('cannot cache an opaque response');
    this.#entries.set(urlOf(request), response);
  }

  async delete (request) { return this.#entries.delete(urlOf(request)); }
  async keys ()          { return [...this.#entries.keys()].map(url => new Request(url)); }
}

export function installCacheApi () {
  const caches = new Map;

  globalThis.caches = {
    open   : async (name) => { if (!caches.has(name)) caches.set(name, new FakeCache); return caches.get(name); },
    delete : async (name) => caches.delete(name),
    has    : async (name) => caches.has(name),
  };

  return caches;
}

/**
 * A fetch stub over a { url -> { body, etag, type } } map, counting calls and
 * honouring If-None-Match so conditional revalidation can be observed.
 */
export function installFetch (routes) {
  const calls = { conditional: 0, total: 0 };

  globalThis.fetch = async (input) => {
    const url     = urlOf(input);
    const headers = input instanceof Request ? input.headers : new Headers;
    const route   = routes[url];

    calls.total++;
    if (headers.get('if-none-match')) calls.conditional++;

    if (!route) return new Response('not found', { status: 404, statusText: 'Not Found' });

    if (route.etag && headers.get('if-none-match') === route.etag) {
      calls.notModified = (calls.notModified ?? 0) + 1;
      return new Response(null, { status: 304, statusText: 'Not Modified' });
    }

    return new Response(route.body, {
      headers: {
        'content-type': route.type ?? 'text/plain',
        ...(route.etag ? { etag: route.etag } : {}),
      },
      status: 200,
    });
  };

  return calls;
}

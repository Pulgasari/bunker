// @bunker/core/proxy.js

/*
  property sugar over a store: proxy.theme reads, proxy.theme = 'oled' writes,
  delete proxy.theme removes. `has` and `keys` add `in` and Object.keys().

  kept off the store itself on purpose: a key named `get` or `keys` would
  otherwise be shadowed by the method of the same name.
*/

export function proxyOf ({ delete: remove, get, has = null, keys = null, set }) {
  const traps = {
    deleteProperty : (_, key)        => { remove(key); return true; },
    get            : (_, key)        => typeof key === 'symbol' ? undefined : get(key),
    set            : (_, key, value) => { set(key, value); return true; },
  };

  if (has)         traps.has     = (_, key) => typeof key !== 'symbol' && has(key);
  if (has && keys) {
    traps.ownKeys                  = ()       => keys();
    traps.getOwnPropertyDescriptor = (_, key) => has(key) ? { configurable: true, enumerable: true, value: get(key) } : undefined;
  }

  return new Proxy(Object.create(null), traps);
}

export default proxyOf;

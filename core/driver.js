// @bunker/core/driver.js

import { NO_KEYSPACE } from './keys.js';

// every driver implements this async surface. it is the whole contract:
// storage policy (ttl, eviction, revalidation) lives in @bunker/cache, never here,
// so a driver only ever moves opaque values in and out.
export const DRIVER_METHODS = ['clear', 'delete', 'get', 'keys', 'set'];

// drivers backed by a synchronous api additionally expose getSync/setSync/deleteSync
// and set `sync: true`. only @bunker/storage can, and the anti-flicker boot path
// depends on it: nothing asynchronous can land before the first paint.
export const DRIVER_METHODS_SYNC = ['deleteSync', 'getSync', 'setSync'];

export function isDriver (value) {
  return Boolean(value) && DRIVER_METHODS.every(method => typeof value[method] === 'function');
}

export function isSyncDriver (value) {
  return isDriver(value) && DRIVER_METHODS_SYNC.every(method => typeof value[method] === 'function');
}

export function assertDriver (value, label = 'driver') {
  if (isDriver(value)) return value;
  const missing = DRIVER_METHODS.filter(method => typeof value?.[method] !== 'function');
  throw new TypeError(`[bunker] ${label} is missing: ${missing.join(', ')}`);
}

export function createMemoryDriver () {
  const map = new Map;

  return {
    name : 'memory',
    sync : true,

    get size () { return map.size; },

    deleteSync : (key) => { map.delete(key); },
    getSync    : (key) => map.has(key) ? map.get(key) : null,
    setSync    : (key, value) => { map.set(key, value); },

    clear  : ()             => { map.clear(); return Promise.resolve(); },
    delete : (key)          => { map.delete(key); return Promise.resolve(); },
    get    : (key)          => Promise.resolve(map.has(key) ? map.get(key) : null),
    set    : (key, value)   => { map.set(key, value); return Promise.resolve(); },
    keys   : (prefix = '')  => Promise.resolve([...map.keys()].filter(key => key.startsWith(prefix))),
  };
}

// wraps a driver so every key it sees is namespaced. keeps prefixing in one place
// instead of repeating it in storage, db and cache. clear() only drops what the
// keyspace owns, so two namespaces can share one backing store safely.
export function withKeyspace (driver, keyspace = NO_KEYSPACE) {
  assertDriver(driver);
  if (keyspace === NO_KEYSPACE) return driver;

  const { decode, encode, prefix } = keyspace;

  const wrapped = {
    name : `${driver.name ?? 'driver'}+keyspace`,
    sync : Boolean(driver.sync),

    clear  : async ()            => { for (const key of await wrapped.keys()) await driver.delete(encode(key)); },
    delete : (key)               => driver.delete(encode(key)),
    get    : (key)               => driver.get(encode(key)),
    set    : (key, value)        => driver.set(encode(key), value),
    keys   : async (scope = '')  => (await driver.keys(prefix + scope)).map(decode).filter(key => key !== null),
  };

  if (driver.sync) {
    wrapped.deleteSync = (key)        => driver.deleteSync(encode(key));
    wrapped.getSync    = (key)        => driver.getSync(encode(key));
    wrapped.setSync    = (key, value) => driver.setSync(encode(key), value);
  }

  return wrapped;
}

// one pending promise per key. two concurrent misses must not both hit the network,
// which is exactly what the old AufbauCache did.
export function createSingleFlight () {
  const inflight = new Map;

  const run = (key, factory) => {
    const pending = inflight.get(key);
    if (pending) return pending;

    const promise = Promise.resolve().then(factory).finally(() => inflight.delete(key));
    inflight.set(key, promise);
    return promise;
  };

  run.has    = (key) => inflight.has(key);
  run.size   = ()    => inflight.size;
  run.abort  = (key) => inflight.delete(key);
  run.clear  = ()    => inflight.clear();

  return run;
}

// @bunker/core/driver.js

import { NO_KEYSPACE } from './keys.js';

// every driver implements this async surface. it is the whole contract:
// storage policy (ttl, eviction, revalidation) lives in @bunker/policy, never here,
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

// the async contract over a synchronous surface (clearSync, deleteSync, getSync,
// keysSync, setSync), for the drivers that are synchronous underneath
export function asyncDriver (surface) {
  return {
    clear  : ()            => { surface.clearSync();          return Promise.resolve(); },
    delete : (key)         => { surface.deleteSync(key);      return Promise.resolve(); },
    get    : (key)         => Promise.resolve(surface.getSync(key)),
    keys   : (prefix = '') => Promise.resolve(surface.keysSync(prefix)),
    set    : (key, value)  => { surface.setSync(key, value);  return Promise.resolve(); },
  };
}

export function createMemoryDriver () {
  const map = new Map;

  const surface = {
    clearSync  : ()            => { map.clear(); },
    deleteSync : (key)         => { map.delete(key); },
    getSync    : (key)         => map.has(key) ? map.get(key) : null,
    keysSync   : (prefix = '') => [...map.keys()].filter(key => key.startsWith(prefix)),
    setSync    : (key, value)  => { map.set(key, value); },
  };

  return {
    name : 'memory',
    sync : true,
    get size () { return map.size; },
    ...surface,
    ...asyncDriver(surface),
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

    clear  : async ()            => { await Promise.all((await wrapped.keys()).map(key => driver.delete(encode(key)))); },
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

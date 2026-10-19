// @bunker/core/driver.js

import { NO_KEYSPACE } from './keys.js';

/*
export const 
DRIVER_METHODS      = ['clear', 'delete', 'get', 'keys', 'set'],
DRIVER_METHODS_SYNC = ['deleteSync', 'getSync', 'setSync'];

const
isEmpty = (arr)    => arr.length === 0,
isFn    = (sth)    => typeof sth === 'function',
pipe    = (...fns) => (value) => fns.reduce((acc, fn) => fn(acc), value),
curry   = (fn)     => function curried(...args) {
  if (args.length >= fn.length) return fn.apply(this, args);
  return (...nextArgs) => curried.apply(this, args.concat(nextArgs));
};


// Pure curried method inspection logic
export const 
findMissingInMethods = curry((methods, val) => methods.filter((method) => !isFn(val?.[method])) ),
getMissingMethods    = (...lists) => findMissingInMethods(lists.flat()),
hasMethods           = (...lists) => pipe( getMissingMethods(...lists), isEmpty );

const assertNoMissing = curry((label, val, missing) => {
  if (!isEmpty(missing)) throw new TypeError(`[bunker] ${label} is missing:${missing.join(', ')}`);
  return val;
});

export const assertMethods = (...lists) => {
  const getMissing = getMissingMethods(...lists);
  return (val, label = 'driver') =>
    pipe(
      getMissing,
      assertNoMissing(label, val)
    )(val);
};

export const 
isDriver         = hasMethods(DRIVER_METHODS),
isSyncDriver     = hasMethods(DRIVER_METHODS, DRIVER_METHODS_SYNC);
assertDriver     = assertMethods(DRIVER_METHODS),
assertSyncDriver = assertMethods(DRIVER_METHODS, DRIVER_METHODS_SYNC);
*/

/*
// Step 2: Core inspector – returns missing method names
export const getMissingMethods = (...lists) => {
  const methods = lists.flat();
  return (val) => methods.filter((m) => !isFn(val?.[m]));
};

// Step 3: Boolean predicate builder – derived from Step 2
export const hasMethods = (...lists) => {
  const getMissing = getMissingMethods(...lists);
  return (val) => getMissing(val).length === 0;
};

// Step 4: Assertion function builder – derived from Step 2
export const assertMethods = (...lists) => {
  const getMissing = getMissingMethods(...lists);
  return (value, label = 'driver') => {
    const missing = getMissing(value);
    if (missing.length === 0) return value;
    throw new TypeError(`[bunker] ${label} is missing:${missing.join(', ')}`);
  };
};

// Step 5: High-level exports created via partial application / composition
export const 
isDriver         = hasMethods(DRIVER_METHODS),
isSyncDriver     = hasMethods(DRIVER_METHODS, DRIVER_METHODS_SYNC);
assertDriver     = assertMethods(DRIVER_METHODS),
assertSyncDriver = assertMethods(DRIVER_METHODS, DRIVER_METHODS_SYNC);
*/




export const 
DRIVER_METHODS      = ['clear', 'delete', 'get', 'keys', 'set'],
DRIVER_METHODS_SYNC = ['deleteSync', 'getSync', 'setSync'];

const isFn = (sth) => typeof sth === 'function';
const hasMethods = (...lists) => val => lists.flat().every(m => isFn(val?.[m]));

export const 
isDriver     = hasMethods(DRIVER_METHODS),
isSyncDriver = hasMethods(DRIVER_METHODS, DRIVER_METHODS_SYNC);

export function assertDriver (value, label = 'driver') {
  if (isDriver(value)) return value;
  const missing = DRIVER_METHODS.filter(method => !isFn(value?.[method]));
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

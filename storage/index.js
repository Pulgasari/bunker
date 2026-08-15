// @bunker/storage
// @ts-self-types="./index.d.ts"

import { NO_KEYSPACE, codecs, createKeyspace } from './../core/index.js'; // from '@bunker/core';

const PROBE = '__bunker_probe__';

// :::::: AREA :::::::::::::::::::::::::::::::::::::::::::::::::::

// the web storage surface we actually use, so the memory fallback can stand in
// for it without anything above noticing.

// one map per area, shared by every instance of it. two stores over the same area
// see each other's keys through real web storage, and the fallback has to behave
// the same way or namespacing and sweeping quietly stop working without it.
const memoryAreas = new Map;

function createMemoryArea (area) {
  let map = memoryAreas.get(area);
  if (!map) memoryAreas.set(area, map = new Map);

  return {
    persistent : false,
    key        : (i)          => [...map.keys()][i] ?? null,
    getItem    : (key)        => map.has(key) ? map.get(key) : null,
    setItem    : (key, value) => { map.set(key, String(value)); },
    removeItem : (key)        => { map.delete(key); },
    get length () { return map.size; },
  };
}

// safari in private mode used to hand out a working localStorage that threw on
// every write, so presence is not enough — the write has to be probed.
function resolveArea (area) {
  try {
    const native = area === 'session' ? globalThis.sessionStorage : globalThis.localStorage;
    if (!native) return createMemoryArea(area);

    native.setItem(PROBE, '1');
    native.removeItem(PROBE);

    return {
      persistent : true,
      key        : (i)          => native.key(i),
      getItem    : (key)        => native.getItem(key),
      setItem    : (key, value) => native.setItem(key, value),
      removeItem : (key)        => native.removeItem(key),
      get length () { return native.length; },
    };
  } 
  // private mode, a blocked cookie policy, or a full disk. persistence is gone,
  // the app is not: fall through to memory and keep every call working.
  catch { return createMemoryArea(area); }
}

// :::::: STORAGE ::::::::::::::::::::::::::::::::::::::::::::::::

export function createStorage (options = {}) {
  const {
    area      = 'local',
    codec     = codecs.json,
    namespace = null,
    version   = 1,
    onError   = null,
  } = options;

  const backing   = resolveArea(area);
  const keyspace  = namespace ? createKeyspace({ namespace, version }) : NO_KEYSPACE;
  const listeners = new Set;
  const fail      = (operation, key, error) => { onError?.({ error, key, operation }); };
  const emit      = (change)                => { for (const listener of listeners) listener(change); };

  // the native storage event fires in every *other* tab of the origin, and only
  // for localStorage. our own writes are emitted separately, so a single subscribe()
  // sees both without the caller caring which tab moved.
  const onStorageEvent = (event) => {
    if (event.storageArea && event.storageArea !== globalThis.localStorage) return;
    if (event.key === null) return emit({ key: null, source: 'remote', value: null });

    const key = keyspace.decode(event.key);
    if (key === null) return;

    emit({ key, source: 'remote', value: event.newValue === null ? null : codec.decode(event.newValue) });
  };

  if (area === 'local' && backing.persistent) globalThis.addEventListener?.('storage', onStorageEvent);

  // :::::: sync core. everything else is a wrapper around these three.

  function getSync (key, fallback = null) {
    try {
      const raw = backing.getItem(keyspace.encode(key));
      if (raw === null) return fallback;
      const value = codec.decode(raw);
      return value === null ? fallback : value;
    } catch (error) {
      fail('get', key, error);
      return fallback;
    }
  }

  function setSync (key, value) {
    try {
      backing.setItem(keyspace.encode(key), codec.encode(value));
      emit({ key, source: 'local', value });
      return true;
    } 
    // most often QuotaExceededError. the caller gets a false and decides;
    // a store write is never worth taking the page down for.
    catch (error) { fail('set', key, error); return false; }
  }

  function deleteSync (key) {
    try {
      backing.removeItem(keyspace.encode(key));
      emit({ key, source: 'local', value: null });
      return true;
    } catch (error) {
      fail('delete', key, error);
      return false;
    }
  }

  // :::::: enumeration

  function keysSync (prefix = '') {
    const scope = keyspace.prefix + prefix;
    const found = [];

    try {
      for (let index = 0; index < backing.length; index++) {
        const full = backing.key(index);
        if (full !== null && full.startsWith(scope)) found.push(keyspace.decode(full));
      }
    } catch (error) {
      fail('keys', prefix, error);
    }

    return found.filter(key => key !== null);
  }

  function clearSync () {
    for (const key of keysSync()) deleteSync(key);
  }

  // removes entries this namespace wrote under an older version. call it once at
  // boot after bumping `version`; without it they sit there until the quota fills.
  function sweepSync () {
    if (keyspace === NO_KEYSPACE) return 0;

    const doomed = [];
    try {
      for (let index = 0; index < backing.length; index++) {
        const full = backing.key(index);
        if (full !== null && keyspace.stale(full)) doomed.push(full);
      }
    }
    catch (error) { fail('sweep', null, error); }

    for (const full of doomed) {
      try       { backing.removeItem(full); } 
      catch (e) { fail('sweep', full, e); }
    }
    return doomed.length;
  }

  const storage = {
    name : `storage:${area}`,
    sync : true,
    area, codec, keyspace,
    get persistent () { return backing.persistent; },

    // synchronous surface. the reason this package exists.
    clearSync, deleteSync, getSync, keysSync, setSync, sweepSync,

    // note: a stored `null` is indistinguishable from an absent key on read,
    // hasSync() is the way to tell them apart.
    hasSync (key) {
      try       { return backing.getItem(keyspace.encode(key)) !== null; }
      catch (e) { fail('has', key, e); return false; }
    },

    // driver contract, so @bunker/policy and friends can take this as a backend
    clear  : ()            => { clearSync(); return Promise.resolve(); },
    delete : (key)         => { deleteSync(key); return Promise.resolve(); },
    get    : (key)         => Promise.resolve(getSync(key)),
    keys   : (prefix = '') => Promise.resolve(keysSync(prefix)),
    set    : (key, value)  => { setSync(key, value); return Promise.resolve(); },

    subscribe (listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    dispose () {
      listeners.clear();
      if (area === 'local' && backing.persistent) globalThis.removeEventListener?.('storage', onStorageEvent);
    },
  };

  // lazy, because a Proxy costs nothing until someone actually wants the sugar
  let proxy = null;
  Object.defineProperty(storage, 'proxy', { get: () => proxy ??= createProxy(storage) });

  return storage;
}

// :::::: PROXY ::::::::::::::::::::::::::::::::::::::::::::::::::

// store.proxy.theme = 'oled'  /  delete store.proxy.theme  /  'theme' in store.proxy
// kept off the storage object itself on purpose: a key named `get` or `keys` would
// otherwise be shadowed by the method of the same name.
export function createProxy (storage) {
  return new Proxy(Object.create(null), {
    get            : (_, key)        => typeof key === 'symbol' ? undefined : storage.getSync(key),
    set            : (_, key, value) => { storage.setSync(key, value); return true; },
    has            : (_, key)        => typeof key !== 'symbol' && storage.hasSync(key),
    deleteProperty : (_, key)        => { storage.deleteSync(key); return true; },
    ownKeys        : ()              => storage.keysSync(),
    getOwnPropertyDescriptor : (_, key) =>
      storage.hasSync(key) ? { configurable: true, enumerable: true, value: storage.getSync(key) } : undefined,
  });
}

// :::::: DEFAULTS :::::::::::::::::::::::::::::::::::::::::::::::

export const 
local   = createStorage({ area: 'local'   }),
session = createStorage({ area: 'session' });

export default local;

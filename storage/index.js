// @bunker/storage
// @ts-self-types="./index.d.ts"

import { NO_KEYSPACE, asyncDriver, codecs, createKeyspace, createReport, proxyOf } from '@bunker/core';
import { createEmitter }                                                              from '@bunker/utils/emitter.js';

const PROBE = '__bunker_probe__';

// :::::: AREA :::::::::::::::::::::::::::::::::::::::::::::::::::

// the web storage surface we actually use,
// so the memory fallback can stand in for it without anything above noticing.

// one map per area, shared by every instance of it. 
// two stores over the same area see each other's keys through real web storage,
// and the fallback has to behave the same way 
// or namespacing and sweeping quietly stop working without it.
const memoryAreas = new Map;

function createMemoryArea (area) {
  let map = memoryAreas.get(area);
  if (!map) memoryAreas.set(area, map = new Map);

  return {
    persistent : false,
    getItem    : (key)        => map.has(key) ? map.get(key) : null,
    names      : ()           => [...map.keys()],
    removeItem : (key)        => { map.delete(key); },
    setItem    : (key, value) => { map.set(key, String(value)); },
  };
}

// safari in private mode used to hand out a working localStorage that threw on every write, 
// so presence is not enough — the write has to be probed.
function resolveArea (area) {
  try {
    const native = area === 'session' ? globalThis.sessionStorage : globalThis.localStorage;
    if (!native) return createMemoryArea(area);

    native.setItem    (PROBE, '1');
    native.removeItem (PROBE);

    return {
      persistent : true,
      getItem    : (key)        => native.getItem(key),
      names      : ()           => Array.from({ length: native.length }, (_, index) => native.key(index)),
      removeItem : (key)        => native.removeItem(key),
      setItem    : (key, value) => native.setItem(key, value),
    };
  } 
  // private mode, a blocked cookie policy, or a full disk. persistence is gone,
  // the app is not: fall through to memory and keep every call working.
  catch { return createMemoryArea(area); }
}

// :::::: STORAGE ::::::::::::::::::::::::::::::::::::::::::::::::

function createStorage (options = {}) {
  const {
    area      = 'local',
    codec     = codecs.json,
    namespace = null,
    onError   = null,
    onSuccess = null,
    version   = 1,
  } = options;

  const backing  = resolveArea(area);
  const keyspace = namespace ? createKeyspace({ namespace, version }) : NO_KEYSPACE;
  const changes  = createEmitter();
  const { attempt } = createReport({ onError, onSuccess });

  // the native storage event fires in every *other* tab of the origin,
  // and only for localStorage. our own writes are emitted separately,
  // so a single subscribe() sees both without the caller caring which tab moved.
  const onStorageEvent = (event) => {
    if (event.storageArea && event.storageArea !== globalThis.localStorage) return;
    if (event.key === null) return changes.emit({ key: null, source: 'remote', value: null });

    const key = keyspace.decode(event.key);
    if (key === null) return;

    changes.emit({ key, source: 'remote', value: event.newValue === null ? null : codec.decode(event.newValue) });
  };

  if (area === 'local' && backing.persistent) globalThis.addEventListener?.('storage', onStorageEvent);

  // :::::: sync core. everything else is a wrapper around these.

  function getSync (key, fallback = null) {
    return attempt('get', key, fallback, () => {
      const raw = backing.getItem(keyspace.encode(key));
      const value = raw === null ? null : codec.decode(raw);
      return value === null ? fallback : value;
    });
  }

  // a false is most often QuotaExceededError. the caller decides,
  // a store write is never worth taking the page down for.
  function setSync (key, value) {
    return attempt('set', key, false, () => {
      backing.setItem(keyspace.encode(key), codec.encode(value));
      changes.emit({ key, source: 'local', value });
      return true;
    });
  }

  function deleteSync (key) {
    return attempt('delete', key, false, () => {
      backing.removeItem(keyspace.encode(key));
      changes.emit({ key, source: 'local', value: null });
      return true;
    });
  }

  // note: a stored `null` is indistinguishable from an absent key on read,
  // hasSync() is the way to tell them apart.
  const hasSync = (key) => attempt('has', key, false, () => backing.getItem(keyspace.encode(key)) !== null);

  // :::::: enumeration. one walk over the area, the keys and the sweep filter it

  const names = (operation, key) => attempt(operation, key, [], () => backing.names().filter(full => full !== null));

  function keysSync (prefix = '') {
    const scope = keyspace.prefix + prefix;
    return names('keys', prefix).filter(full => full.startsWith(scope)).map(keyspace.decode).filter(key => key !== null);
  }

  function clearSync () {
    for (const key of keysSync()) deleteSync(key);
  }

  // removes entries this namespace wrote under an older version. call it once at
  // boot after bumping `version`; without it they sit there until the quota fills.
  function sweepSync () {
    if (keyspace === NO_KEYSPACE) return 0;
    const doomed = names('sweep', null).filter(keyspace.stale);
    for (const full of doomed) attempt('sweep', full, null, () => backing.removeItem(full));
    return doomed.length;
  }

  const surface = { clearSync, deleteSync, getSync, hasSync, keysSync, setSync, sweepSync };

  const storage = {
    name : `storage:${area}`,
    sync : true,
    area, codec, keyspace,
    get persistent () { return backing.persistent; },

    // synchronous surface. the reason this package exists.
    ...surface,

    // driver contract, so @bunker/policy and friends can take this as a backend
    ...asyncDriver(surface),

    subscribe : changes.subscribe,

    dispose () {
      changes.clear();
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
const createProxy = (storage) => proxyOf({
  delete : storage.deleteSync,
  get    : storage.getSync,
  has    : storage.hasSync,
  keys   : storage.keysSync,
  set    : storage.setSync,
});

// :::::: DEFAULTS :::::::::::::::::::::::::::::::::::::::::::::::

export const 
local   = createStorage({ area: 'local'   }),
session = createStorage({ area: 'session' });

export { createProxy, createStorage };
export default local;

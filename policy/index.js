// @bunker/policy
// @ts-self-types="./index.d.ts"

import {
  NO_KEYSPACE,
  createKeyspace,
  createMemoryDriver,
  createReport,
  withKeyspace,
} from './../core/index.js';            // from '@bunker/core';
import { createSingleFlight } from './../utils/singleFlight.js'; // from '@bunker/utils/singleFlight.js';

// :::::: ENTRIES ::::::::::::::::::::::::::::::::::::::::::::::::

const
DEAD  = 'dead',
FRESH = 'fresh',
MISS  = 'miss',
STALE = 'stale';


function createEntry (value, ttl, staleTtl, now) {
  const expire = ttl ? now + ttl : null;
  return {
    at         : now,
    staleUntil : expire && staleTtl ? expire + staleTtl : expire,
    expire, value,
  };
}

function stateOf (entry, now) {
  if (!entry) return MISS;
  if (!entry.expire    || entry.expire     > now) return FRESH;
  if (entry.staleUntil && entry.staleUntil > now) return STALE;
  return DEAD;
}

// :::::: CACHE ::::::::::::::::::::::::::::::::::::::::::::::::::

export function createPolicy (options = {}) {
  const {
    driver     = createMemoryDriver(),
    max        = 0,
    maxEntries = 0,
    namespace  = null,
    onError    = null,
    onSuccess  = null,
    staleTtl   = 0,
    ttl        = null,
    version    = 1,
  } = options;

  const keyspace = namespace ? createKeyspace({ namespace, version }) : NO_KEYSPACE;
  const store    = withKeyspace(driver, keyspace);
  const memory   = new Map;         // l1. insertion order doubles as lru order.
  const once     = createSingleFlight();
  const now      = () => Date.now();
  const { attempt, fail } = createReport({ onError, onSuccess });

  // l2 calls, a failing store is reported and read as empty
  const 
  writeThrough = (key, entry) => attempt('set',    key, null, () => store.set    (key, entry)),
   dropThrough = (key)        => attempt('delete', key, null, () => store.delete (key)),
   readThrough = (key)        => attempt('get',    key, null, () => store.get    (key));

  function remember (key, entry) {
    memory.delete(key);
    memory.set(key, entry);
    if (max > 0) while (memory.size > max) memory.delete(memory.keys().next().value);
  }

  async function readEntry (key) {
    const cached = memory.get(key);
    if (cached) { remember(key, cached); return cached; }

    const entry = await readThrough(key);

    // an l2 written by an older version of the code may not look like an entry
    if (!entry || typeof entry !== 'object' || !('value' in entry)) return null;

    remember(key, entry);
    return entry;
  }

  // :::::: reads

  const absent = () => ({ at: null, expire: null, staleUntil: null, state: MISS, value: null });

  async function entry (key) {
    const found = await readEntry(key);
    const state = stateOf(found, now());

    if (state === DEAD) { await remove(key); return absent(); }
    if (state === MISS) return absent();

    return { at: found.at, expire: found.expire, staleUntil: found.staleUntil, state, value: found.value };
  }

  async function get (key, { allowStale = false } = {}) {
    const found = await entry(key);
    if (found.state === FRESH)               return found.value;
    if (found.state === STALE && allowStale) return found.value;
    return null;
  }

  async function has (key) {
    return (await entry(key)).state !== MISS;
  }

  // :::::: writes

  async function set (key, value, overrides = {}) {
    const created = createEntry(value, overrides.ttl ?? ttl, overrides.staleTtl ?? staleTtl, now());
    remember(key, created);
    await writeThrough(key, created);
    return value;
  }

  async function remove (key) {
    memory.delete(key);
    once.abort(key);
    await dropThrough(key);
  }

  async function clear () {
    memory.clear();
    once.clear();
    await attempt('clear', null, null, () => store.clear());
  }

  async function keys (prefix = '') {
    const found = await attempt('keys', prefix, null, () => store.keys(prefix));
    return found ?? [...memory.keys()].filter(key => key.startsWith(prefix));
  }

  async function prune (prefix = '') {
    const stamp   = now();
    const removed = new Set; // a key living in both layers must count once, not twice

    for (const [key, cached] of memory) {
      if (key.startsWith(prefix) && stateOf(cached, stamp) === DEAD) { memory.delete(key); removed.add(key); }
    }

    const survivors = [];

    for (const key of await keys(prefix)) {
      const stored = await attempt('get', key, undefined, () => store.get(key));
      if (stored === undefined) continue;   // unreadable, reported

      if (stateOf(stored, stamp) === DEAD) {
        memory.delete(key);
        await dropThrough(key);
        removed.add(key);
      } else if (maxEntries > 0) {
        survivors.push([key, stored?.at ?? 0]);
      }
    }

    // oldest first, drop whatever is over the ceiling
    if (maxEntries > 0 && survivors.length > maxEntries) {
      survivors.sort((a, b) => a[1] - b[1]);
      for (const [key] of survivors.slice(0, survivors.length - maxEntries)) {
        memory.delete(key);
        await dropThrough(key);
        removed.add(key);
      }
    }

    return removed.size;
  }

  // :::::: stale-while-revalidate
  
  async function swr (key, fetcher, overrides = {}) {
    const found = await entry(key);

    if (found.state === FRESH) return found.value;

    const revalidate = () => once(key, async () => {
      const fresh = await fetcher(key);
      await set(key, fresh, overrides);
      return fresh;
    });

    if (found.state === STALE) {
      const { onRevalidate } = overrides;

      revalidate()
        .then(fresh => { if (onRevalidate && !Object.is(fresh, found.value)) onRevalidate(fresh, found.value); })
        .catch(error => fail('revalidate', key, error)); // keep serving stale, the network can fail

      return found.value;
    }

    return revalidate();
  }

  return {
    delete : remove,
    driver : store, keyspace,
    name   : `policy(${store.name ?? 'driver'})`,
    clear, entry, get, has, keys, prune, set, swr,
    get size () { return memory.size; },
  };
}

export default createPolicy;

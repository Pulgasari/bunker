// @bunker/cache
// @ts-self-types="./index.d.ts"

import {
  NO_KEYSPACE, createKeyspace, createMemoryDriver, createSingleFlight, withKeyspace,
} from '@bunker/core';

// :::::: ENTRIES ::::::::::::::::::::::::::::::::::::::::::::::::

/*
  an entry is fresh until `expire`, then servable-but-stale until `staleUntil`,
  then dead. a null `expire` means it never ages at all.

  the two windows are separate on purpose: ttl is how long the value is trusted,
  staleTtl is how long it may still be handed out while a fresh one is fetched.
*/
const FRESH = 'fresh', STALE = 'stale', DEAD = 'dead', MISS = 'miss';

function createEntry (value, ttl, staleTtl, now) {
  const expire = ttl ? now + ttl : null;
  return {
    at         : now,
    expire,
    staleUntil : expire && staleTtl ? expire + staleTtl : expire,
    value,
  };
}

function stateOf (entry, now) {
  if (!entry) return MISS;
  if (!entry.expire || entry.expire > now) return FRESH;
  if (entry.staleUntil && entry.staleUntil > now) return STALE;
  return DEAD;
}

// :::::: CACHE ::::::::::::::::::::::::::::::::::::::::::::::::::

export function createCache (options = {}) {
  const {
    driver     = createMemoryDriver(),
    max        = 0,
    maxEntries = 0,
    namespace  = null,
    onError    = null,
    staleTtl   = 0,
    ttl        = null,
    version    = 1,
  } = options;

  const keyspace = namespace ? createKeyspace({ namespace, version }) : NO_KEYSPACE;
  const store    = withKeyspace(driver, keyspace);
  const memory   = new Map;         // l1. insertion order doubles as lru order.
  const once     = createSingleFlight();

  const now  = () => Date.now();
  const fail = (operation, key, error) => { onError?.({ error, key, operation }); };

  // l2 must never take the caller down with it: a cache write that fails is a cache
  // miss later, not an exception now. the old AufbauCache rejected here, which turned
  // every fire-and-forget set() into an unhandled rejection.
  const writeThrough = async (key, entry) => {
    try { await store.set(key, entry); }
    catch (error) { fail('set', key, error); }
  };

  const dropThrough = async (key) => {
    try { await store.delete(key); }
    catch (error) { fail('delete', key, error); }
  };

  /*
    touch on read, so the lru order reflects use and not just insertion.

    `max` bounds l1 only, and evicting from l1 deliberately leaves l2 alone: l1 is
    also filled by reads, so writing the eviction through would delete entries from
    the persistent layer merely because they scrolled out of the memory window.
    the l2 ceiling is `maxEntries` and lives in prune().
  */
  function remember (key, entry) {
    memory.delete(key);
    memory.set(key, entry);
    if (max > 0) while (memory.size > max) memory.delete(memory.keys().next().value);
  }

  async function readEntry (key) {
    const cached = memory.get(key);
    if (cached) { remember(key, cached); return cached; }

    let entry = null;
    try { entry = await store.get(key); }
    catch (error) { fail('get', key, error); return null; }

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
    if (found.state === FRESH) return found.value;
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
    try { await store.clear(); }
    catch (error) { fail('clear', null, error); }
  }

  async function keys (prefix = '') {
    try { return await store.keys(prefix); }
    catch (error) { fail('keys', prefix, error); return [...memory.keys()].filter(key => key.startsWith(prefix)); }
  }

  /*
    entries only expire lazily on read, so a key nobody reads again is never
    reclaimed. prune sweeps actively, and is also where the l2 ceiling is enforced:
    it already walks every key, so capping costs nothing extra here, whereas doing
    it per write would mean a full scan on every set().

    counts both layers, and reports what it removed even when there is no l2 —
    the old implementation returned 0 in that case despite having emptied l1.
  */
  async function prune (prefix = '') {
    const stamp = now();
    // a key living in both layers must count once, not twice
    const removed = new Set;

    for (const [key, cached] of memory) {
      if (key.startsWith(prefix) && stateOf(cached, stamp) === DEAD) { memory.delete(key); removed.add(key); }
    }

    const survivors = [];

    for (const key of await keys(prefix)) {
      let stored = null;
      try { stored = await store.get(key); }
      catch (error) { fail('get', key, error); continue; }

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

  /*
    the primitive everything else here exists for.

    fresh  -> the cached value
    stale  -> the cached value immediately, and a revalidation in the background
    miss   -> awaits the fetcher

    onRevalidate fires only when the background fetch produced something different.
    that is what lets a caller show the old value now and decide for itself whether
    a late swap is worth the reflow.
  */
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
    name : `cache(${store.name ?? 'driver'})`,

    driver : store, keyspace,
    get size () { return memory.size; },

    clear, entry, get, has, keys, prune, set, swr,
    delete : remove,
  };
}

export default createCache;

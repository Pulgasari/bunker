# @bunker/policy

Caching policy — TTL, staleness, revalidation, eviction — over any driver.

This package knows nothing about IndexedDB, localStorage or the Cache API. It takes a
driver and applies a policy to it. That is the whole point of the split: swapping the
backend is a one-line change and none of the logic here moves.

```javascript
import { createPolicy } from '@bunker/policy';
import { createDb }    from '@bunker/db';

const cache = createPolicy({
  driver   : createDb('myapp').driver('kv'),  // L2, optional. memory-only without it
  ttl      : 60_000,                          // how long a value is trusted
  staleTtl : 24 * 60 * 60_000,                // how long it may still be served after that
});
```

## Two windows, not one

An entry is **fresh** until `ttl` runs out, then **stale** but still servable for
`staleTtl`, then dead.

```javascript
await cache.entry('k'); // { at, expire, staleUntil, state, value }
```

`get()` returns `null` for a stale entry unless you ask for it:

```javascript
await cache.get('k');                        // null once stale
await cache.get('k', { allowStale: true });  // the old value
```

## stale-while-revalidate

```javascript
const css = await cache.swr('app.ass', fetchAndCompile, {
  onRevalidate: (fresh, stale) => console.log('changed while you were reading'),
});
```

- **fresh** → the cached value, no fetch
- **stale** → the cached value *immediately*, revalidating in the background
- **miss** → awaits the fetcher

`onRevalidate` fires only when the background fetch produced something *different*.
That is deliberate: it lets a caller render the old value now and decide for itself
whether a late swap is worth the reflow. For stylesheets it usually is not — write the
new version, apply it on the next load.

A failing revalidation is reported through `onError` and leaves the stale value in
place. Losing the network should not blank the page.

## Single flight

Concurrent misses on one key collapse into a single fetch:

```javascript
await Promise.all([cache.swr('k', fetcher), cache.swr('k', fetcher)]); // fetcher ran once
```

## Eviction

Two ceilings, because the layers cannot share one:

- **`max`** bounds L1, the in-memory layer, least-recently-used first. Evicting from
  L1 leaves L2 alone on purpose — L1 is filled by reads as well as writes, so writing
  the eviction through would delete persistent entries merely because they scrolled
  out of the memory window.
- **`maxEntries`** bounds L2, enforced by `prune()`, oldest first.

```javascript
await cache.prune();        // drop dead entries, then apply maxEntries
await cache.prune('css:');  // only under this prefix
```

Entries otherwise expire lazily, on read. A key nobody reads again is never reclaimed
on its own, so `prune()` at boot or on an idle callback is worth it.

`prune()` returns the number of **distinct** keys removed — a key living in both layers
counts once.

## Failure

A cache that throws is worse than a cache that misses. `set()` never rejects: a failed
L2 write is reported through `onError` and the value stays an L1 hit. A value in L2
that does not look like an entry — written by an older build, say — reads as a miss
rather than blowing up.

```javascript
createPolicy({ onError: ({ operation, key }) => report(operation, key) });
```

## Namespaces

```javascript
createPolicy({ driver, namespace: 'aufbau', version: 2 });
```

Several caches can share one driver without colliding. Bumping `version` orphans
everything written before it.

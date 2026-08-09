import assert from 'node:assert/strict';
import { createMemoryDriver } from '@bunker/core';
import { createCache } from '@bunker/cache';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// background revalidation settles on its own schedule, so poll for the outcome
// instead of guessing a sleep long enough to cover it.
async function waitFor (predicate, { label = 'condition', timeout = 1000 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await sleep(5);
  }
  throw new Error(`timed out waiting for ${label}`);
}

// :::::: basics, memory only
{
  const cache = createCache();
  assert.equal(await cache.get('missing'), null);
  await cache.set('a', { n: 1 });
  assert.deepEqual(await cache.get('a'), { n: 1 });
  assert.equal(await cache.has('a'), true);
  await cache.delete('a');
  assert.equal(await cache.has('a'), false);
}

// :::::: ttl and the stale window are separate
{
  const cache = createCache({ staleTtl: 60, ttl: 30 });
  await cache.set('k', 'v');
  assert.equal((await cache.entry('k')).state, 'fresh');
  assert.equal(await cache.get('k'), 'v');

  await sleep(45);
  assert.equal((await cache.entry('k')).state, 'stale');
  assert.equal(await cache.get('k'), null, 'get must not serve stale by default');
  assert.equal(await cache.get('k', { allowStale: true }), 'v');

  await sleep(60);
  assert.equal((await cache.entry('k')).state, 'miss', 'past staleUntil the entry is gone');
}

// :::::: a null ttl never ages
{
  const cache = createCache();
  await cache.set('forever', 1);
  await sleep(20);
  assert.equal((await cache.entry('forever')).state, 'fresh');
}

// :::::: swr: fresh serves cache, miss awaits, stale serves old and revalidates
{
  let calls = 0;
  const fetcher = async () => { calls++; return `v${calls}`; };
  const cache   = createCache({ staleTtl: 500, ttl: 30 });

  assert.equal(await cache.swr('k', fetcher), 'v1', 'a miss awaits the fetcher');
  assert.equal(calls, 1);

  assert.equal(await cache.swr('k', fetcher), 'v1', 'a fresh entry does not refetch');
  assert.equal(calls, 1);

  await sleep(45);

  const swapped = [];
  const served  = await cache.swr('k', fetcher, { onRevalidate: (fresh, old) => swapped.push([old, fresh]) });
  assert.equal(served, 'v1', 'a stale entry is served immediately');

  await waitFor(() => swapped.length === 1, { label: 'the background revalidation' });
  assert.equal(calls, 2, 'and revalidated in the background');
  assert.deepEqual(swapped, [['v1', 'v2']], 'onRevalidate reports the swap');
  // the replacement carries the same short ttl, so assert on the value, not its freshness
  assert.equal((await cache.entry('k')).value, 'v2', 'the fresh value replaced it');
}

// :::::: onRevalidate stays quiet when nothing changed
{
  let calls = 0;
  const cache   = createCache({ staleTtl: 500, ttl: 20 });
  const fetcher = async () => { calls++; return 'same'; };

  await cache.swr('k', fetcher);
  await sleep(30);

  let fired = 0;
  await cache.swr('k', fetcher, { onRevalidate: () => fired++ });
  await waitFor(() => calls === 2, { label: 'the second fetch' });
  await sleep(10); // room for onRevalidate to fire, if it were going to
  assert.equal(fired, 0, 'an unchanged revalidation must not trigger a swap');
}

// :::::: a failing revalidation keeps serving stale
{
  const errors  = [];
  const failing = createCache({ onError: e => errors.push(e.operation), staleTtl: 500, ttl: 20 });

  await failing.set('k', 'cached');
  await sleep(30);

  const served = await failing.swr('k', async () => { throw new Error('offline'); });
  assert.equal(served, 'cached', 'a stale hit is returned before the fetch is even attempted');
  await waitFor(() => errors.includes('revalidate'), { label: 'the revalidation failure' });
  assert.deepEqual(errors, ['revalidate'], 'the failure is reported, not thrown');
  assert.equal(await failing.get('k', { allowStale: true }), 'cached', 'and the stale value survives');
}

// :::::: single flight: concurrent misses collapse into one fetch
{
  let calls = 0;
  const cache = createCache();
  const slow  = async () => { calls++; await sleep(20); return 'once'; };

  const all = await Promise.all([cache.swr('k', slow), cache.swr('k', slow), cache.swr('k', slow)]);
  assert.deepEqual(all, ['once', 'once', 'once']);
  assert.equal(calls, 1, 'three concurrent misses must fetch once');
}

// :::::: `max` is an l1 ceiling and must not delete from l2
{
  const driver = createMemoryDriver();
  const cache  = createCache({ driver, max: 3 });

  for (const key of ['a', 'b', 'c']) await cache.set(key, key);
  await cache.get('a');            // touch, so 'b' becomes the oldest
  await cache.set('d', 'd');

  assert.equal(cache.size, 3, 'l1 stays at the ceiling');
  assert.equal((await driver.keys()).length, 4, 'l2 keeps every entry');
  assert.equal(await cache.get('b'), 'b', 'an l1-evicted key still resolves from l2');
}

// :::::: `maxEntries` is the l2 ceiling, enforced by prune
{
  const driver = createMemoryDriver();
  const cache  = createCache({ driver, maxEntries: 2 });

  for (const key of ['a', 'b', 'c', 'd']) { await cache.set(key, key); await sleep(2); }
  assert.equal((await driver.keys()).length, 4, 'writes are not capped inline');

  const removed = await cache.prune();
  assert.equal(removed, 2, 'prune drops what is over the ceiling');
  assert.deepEqual((await driver.keys()).sort(), ['c', 'd'], 'the oldest entries go first');
  assert.equal(await cache.get('a'), null);
  assert.equal(await cache.get('d'), 'd');
}

// :::::: prune counts both layers, and reports without an l2 too
{
  const memoryOnly = createCache({ ttl: 20 });
  await memoryOnly.set('x', 1);
  await memoryOnly.set('y', 2);
  await sleep(30);
  assert.equal(await memoryOnly.prune(), 2, 'memory-only prune must still report what it removed');

  const driver = createMemoryDriver();
  const cache  = createCache({ driver, ttl: 20 });
  await cache.set('css:a', 1);
  await cache.set('css:b', 2);
  await cache.set('font:a', 3);
  await sleep(30);

  assert.equal(await cache.prune('css:'), 2, 'prune respects the prefix');
  assert.equal((await driver.keys()).length, 1, 'and clears l2, not just l1');
  assert.equal(await cache.get('font:a', { allowStale: true }), null);
}

// :::::: l2 survives a fresh cache instance over the same driver
{
  const driver = createMemoryDriver();
  const first  = createCache({ driver, namespace: 'aufbau' });
  await first.set('theme', 'oled');

  const second = createCache({ driver, namespace: 'aufbau' });
  assert.equal(await second.get('theme'), 'oled', 'a cold l1 must fall through to l2');

  const other = createCache({ driver, namespace: 'docs' });
  assert.equal(await other.get('theme'), null, 'namespaces must not collide in a shared driver');
}

// :::::: a failing l2 write does not reject the caller
{
  const broken = {
    name   : 'broken',
    clear  : async () => { throw new Error('nope'); },
    delete : async () => { throw new Error('nope'); },
    get    : async () => { throw new Error('nope'); },
    keys   : async () => { throw new Error('nope'); },
    set    : async () => { throw new Error('nope'); },
  };

  const errors = [];
  const cache  = createCache({ driver: broken, onError: e => errors.push(e.operation) });

  await cache.set('k', 'v');                       // must not throw
  assert.equal(await cache.get('k'), 'v', 'l1 still answers when l2 is broken');
  assert.ok(errors.includes('set'), 'the l2 failure is reported');
}

// :::::: garbage in l2 reads as a miss rather than blowing up
{
  const driver = createMemoryDriver();
  await driver.set('legacy', 'a bare string from an older build');
  const cache = createCache({ driver });
  assert.equal(await cache.get('legacy'), null, 'a value that is not an entry must read as a miss');
}

console.log('cache: all assertions passed');

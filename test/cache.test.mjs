import assert from 'node:assert/strict';
import { installCacheApi, installFetch } from './helpers/cache-api.mjs';
import { isDriver } from '@bunker/core';

installCacheApi();

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor (predicate, { label = 'condition', timeout = 1000 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await sleep(5);
  }
  throw new Error(`timed out waiting for ${label}`);
}

const { createCache } = await import('@bunker/cache');

const SHEET = 'https://example.test/app.ass';

// :::::: a miss fetches, transforms and stores
{
  const routes = { [SHEET]: { body: 'aufbau-center: both;', etag: 'v1' } };
  const calls  = installFetch(routes);
  const cache  = createCache({ name: 'sheets-1' });

  const transform = (source) => source.replace('aufbau-center: both;', 'display:grid;place-items:center;');
  const first = await cache.staleWhileRevalidate(SHEET, { transform, type: 'text/css' });

  assert.equal(await first.text(), 'display:grid;place-items:center;');
  assert.equal(calls.total, 1);

  const stored = await cache.match(SHEET);
  assert.equal(await stored.text(), 'display:grid;place-items:center;', 'the transformed body is what got stored');
  assert.equal(stored.headers.get('content-type'), 'text/css');
  assert.equal(stored.headers.get('x-bunker-source-etag'), 'v1', 'the source validator is kept for revalidation');
  assert.ok(Number(stored.headers.get('x-bunker-at')) > 0);
}

// :::::: a fresh entry inside ttl skips the network entirely
{
  const routes = { [SHEET]: { body: 'a{}', etag: 'v1' } };
  const calls  = installFetch(routes);
  const cache  = createCache({ name: 'sheets-2' });

  await cache.staleWhileRevalidate(SHEET, { ttl: 60_000 });
  assert.equal(calls.total, 1);

  await cache.staleWhileRevalidate(SHEET, { ttl: 60_000 });
  await cache.staleWhileRevalidate(SHEET, { ttl: 60_000 });
  assert.equal(calls.total, 1, 'a response younger than ttl must not be revalidated');
}

// :::::: stale serves the cached copy immediately and revalidates behind it
{
  const routes = { [SHEET]: { body: 'old{}', etag: 'v1' } };
  const calls  = installFetch(routes);
  const cache  = createCache({ name: 'sheets-3' });

  await cache.staleWhileRevalidate(SHEET, { ttl: 20 });
  await sleep(30);

  routes[SHEET] = { body: 'new{}', etag: 'v2' };

  const swapped = [];
  const served  = await cache.staleWhileRevalidate(SHEET, {
    onRevalidate : (fresh) => swapped.push(fresh),
    ttl          : 20,
  });

  assert.equal(await served.text(), 'old{}', 'the stale copy is served without waiting');
  await waitFor(() => swapped.length === 1, { label: 'the background revalidation' });
  assert.equal(await swapped[0].text(), 'new{}', 'onRevalidate hands over the fresh response');
  assert.equal(await (await cache.match(SHEET)).text(), 'new{}', 'and the cache was updated');
}

// :::::: an unchanged source costs a 304 and keeps the stored body
{
  const routes = { [SHEET]: { body: 'same{}', etag: 'v1' } };
  const calls  = installFetch(routes);
  const cache  = createCache({ name: 'sheets-4' });

  await cache.staleWhileRevalidate(SHEET, { ttl: 20 });
  await sleep(30);

  const swapped = [];
  await cache.staleWhileRevalidate(SHEET, { onRevalidate: (r) => swapped.push(r), ttl: 20 });

  await waitFor(() => calls.notModified === 1, { label: 'the conditional request' });
  assert.equal(calls.conditional, 1, 'revalidation sends If-None-Match');
  await sleep(20);
  assert.equal(swapped.length, 0, 'a 304 is not a change, so no swap is announced');
  assert.equal(await (await cache.match(SHEET)).text(), 'same{}', 'the stored body survives');
}

// :::::: a failing revalidation leaves the stale copy in place
{
  const routes = { [SHEET]: { body: 'cached{}', etag: 'v1' } };
  installFetch(routes);
  const errors = [];
  const cache  = createCache({ name: 'sheets-5', onError: e => errors.push(e.operation) });

  await cache.staleWhileRevalidate(SHEET, { ttl: 20 });
  await sleep(30);

  delete routes[SHEET]; // now a 404
  const served = await cache.staleWhileRevalidate(SHEET, { ttl: 20 });

  assert.equal(await served.text(), 'cached{}');
  await waitFor(() => errors.includes('revalidate'), { label: 'the failure report' });
  assert.equal(await (await cache.match(SHEET)).text(), 'cached{}', 'going offline must not blank the cache');
}

// :::::: concurrent misses collapse into one fetch
{
  const routes = { [SHEET]: { body: 'x{}', etag: 'v1' } };
  const calls  = installFetch(routes);
  const cache  = createCache({ name: 'sheets-6' });

  await Promise.all([
    cache.staleWhileRevalidate(SHEET),
    cache.staleWhileRevalidate(SHEET),
    cache.staleWhileRevalidate(SHEET),
  ]);
  assert.equal(calls.total, 1, 'three concurrent misses must fetch once');
}

// :::::: driver contract over text bodies
{
  installFetch({});
  const cache  = createCache({ name: 'sheets-7' });
  const driver = cache.driver();

  assert.ok(isDriver(driver));
  await driver.set('css:app', { rules: 2 });
  assert.deepEqual(await driver.get('css:app'), { rules: 2 });
  assert.equal(await driver.get('absent'), null);

  await driver.set('css:docs', 1);
  await driver.set('font:inter', 1);
  assert.deepEqual((await driver.keys('css:')).sort(), ['css:app', 'css:docs']);

  await driver.delete('css:app');
  assert.equal(await driver.get('css:app'), null);
}

// :::::: everything degrades when the cache api is missing
{
  const saved = globalThis.caches;
  delete globalThis.caches;

  const routes = { [SHEET]: { body: 'direct{}' } };
  const calls  = installFetch(routes);
  const cache  = createCache({ name: 'sheets-8' });

  assert.equal(await cache.match(SHEET), null);
  assert.equal(await cache.open(), null);

  const served = await cache.staleWhileRevalidate(SHEET);
  assert.equal(await served.text(), 'direct{}', 'without a cache it still fetches');
  assert.equal(calls.total, 1);

  globalThis.caches = saved;
}

// :::::: keepAlive hands the revalidation to the caller
{
  const routes = { [SHEET]: { body: 'a{}', etag: 'v1' } };
  installFetch(routes);
  const cache = createCache({ name: 'sheets-10' });

  await cache.staleWhileRevalidate(SHEET);          // seed
  routes[SHEET] = { body: 'b{}', etag: 'v2' };

  let pending = null;
  const served = await cache.staleWhileRevalidate(SHEET, { keepAlive: (promise) => pending = promise });

  assert.equal(await served.text(), 'a{}', 'the stale copy goes out first');
  assert.ok(pending instanceof Promise, 'keepAlive receives the revalidation');
  await pending;
  assert.equal(await (await cache.match(SHEET)).text(), 'b{}', 'awaiting it settles the refresh');
}

// :::::: proxy sugar
{
  const cache = createCache({ name: 'sheets-9' });
  const key   = 'https://example.test/proxied.css';

  cache.proxy[key] = new Response('a{}');
  await waitFor(async () => await cache.match(key), { label: 'the proxied put' });
  assert.equal(await (await cache.proxy[key]).text(), 'a{}', 'proxy reads through match');

  delete cache.proxy[key];
  await waitFor(async () => (await cache.match(key)) === null, { label: 'the proxied delete' });
}

console.log('cache: all assertions passed');

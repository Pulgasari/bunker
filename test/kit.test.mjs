import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { installCacheApi, installFetch } from './helpers/cache-api.mjs';

installCacheApi();
installFetch({ 'https://example.test/app.ass': { body: 'a{}', etag: 'v1' } });

const { createBunker, bunker } = await import('@bunker/kit');

// :::::: the shared instance is wired end to end
assert.ok(bunker.cache && bunker.core && bunker.db && bunker.files && bunker.local && bunker.session);
assert.equal(bunker.db.name, 'bunker');
assert.equal(bunker.files.name, 'bunker');

// :::::: one namespace covers every layer
const store = createBunker({ namespace: 'aufbau', staleTtl: 5_000, ttl: 50, version: 2 });

assert.equal(store.db.name, 'aufbau');
assert.equal(store.files.name, 'aufbau');
assert.equal(store.local.keyspace.prefix, 'aufbau:v2:');
assert.equal(store.session.keyspace.prefix, 'aufbau:v2:');
assert.equal(store.cache.keyspace.prefix, 'aufbau:v2:');

// :::::: the cache really is backed by indexeddb, not just memory
await store.cache.set('theme', 'oled');
assert.equal(await store.cache.get('theme'), 'oled');
assert.deepEqual(await store.db.keys('kv'), ['aufbau:v2:theme'], 'the entry landed in the db table');

// a second kit over the same namespace starts with a cold l1 and must find it in l2
const reopened = createBunker({ namespace: 'aufbau', ttl: 50, version: 2 });
assert.equal(reopened.cache.size, 0);
assert.equal(await reopened.cache.get('theme'), 'oled', 'l2 survives a fresh instance');

// :::::: storage and cache do not collide despite sharing a namespace
store.local.setSync('theme', 'classic');
assert.equal(store.local.getSync('theme'), 'classic');
assert.equal(await store.cache.get('theme'), 'oled');

// :::::: files is usable through the kit
const response = await store.files.staleWhileRevalidate('https://example.test/app.ass', { ttl: 60_000 });
assert.equal(await response.text(), 'a{}');

await store.cache.clear();
store.local.clearSync();
store.db.close();
reopened.db.close();
bunker.db.close();

console.log('kit: all assertions passed');

import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { installCacheApi, installFetch } from './helpers/cache-api.mjs';

installCacheApi();
installFetch({ 'https://example.test/app.ass': { body: 'a{}', etag: 'v1' } });

const { createBunker, bunker } = await import('@bunker/kit');

// :::::: the shared instance is wired end to end
assert.ok(bunker.cache && bunker.core && bunker.db && bunker.policy && bunker.local && bunker.session && bunker.utils);
assert.equal(bunker.db.name, 'bunker');
assert.equal(bunker.cache.name, 'bunker');

// :::::: one namespace covers every layer
const store = createBunker({ namespace: 'aufbau', staleTtl: 5_000, ttl: 50, version: 2 });

assert.equal(store.db.name, 'aufbau');
assert.equal(store.cache.name, 'aufbau');
assert.equal(store.local.keyspace.prefix, 'aufbau:v2:');
assert.equal(store.session.keyspace.prefix, 'aufbau:v2:');
assert.equal(store.policy.keyspace.prefix, 'aufbau:v2:');

// :::::: the policy layer really is backed by indexeddb, not just memory
await store.policy.set('theme', 'oled');
assert.equal(await store.policy.get('theme'), 'oled');
assert.deepEqual(await store.db.keys('kv'), ['aufbau:v2:theme'], 'the entry landed in the db table');

// a second kit over the same namespace starts with a cold l1 and must find it in l2
const reopened = createBunker({ namespace: 'aufbau', ttl: 50, version: 2 });
assert.equal(reopened.policy.size, 0);
assert.equal(await reopened.policy.get('theme'), 'oled', 'l2 survives a fresh instance');

// :::::: storage and policy do not collide despite sharing a namespace
store.local.setSync('theme', 'classic');
assert.equal(store.local.getSync('theme'), 'classic');
assert.equal(await store.policy.get('theme'), 'oled');

// :::::: the cache is usable through the kit
const response = await store.cache.staleWhileRevalidate('https://example.test/app.ass', { ttl: 60_000 });
assert.equal(await response.text(), 'a{}');

await store.policy.clear();
store.local.clearSync();
store.db.close();
reopened.db.close();
bunker.db.close();

console.log('kit: all assertions passed');

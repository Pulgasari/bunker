import assert from 'node:assert/strict';
import {
  assertDriver, codecs, createChannel, createKeyspace, createMemoryDriver,
  createSingleFlight, isDriver, isSyncDriver, quota, withKeyspace,
} from '@bunker/core';

// :::::: keyspace
const keys = createKeyspace({ namespace: 'aufbau', version: 2 });
assert.equal(keys.encode('css/app.ass'), 'aufbau:v2:css/app.ass');
assert.equal(keys.decode('aufbau:v2:css/app.ass'), 'css/app.ass');
assert.equal(keys.decode('other:v1:x'), null);
assert.equal(keys.owns('aufbau:v2:x'), true);
assert.equal(keys.stale('aufbau:v1:x'), true);
assert.equal(keys.stale('aufbau:v2:x'), false);
assert.equal(keys.stale('aufbau-docs:v1:x'), false, 'namespace must not match by prefix alone');

// :::::: codecs
assert.equal(codecs.json.decode(codecs.json.encode({ a: 1 })).a, 1);
assert.equal(codecs.json.decode('{ broken'), null);
assert.equal(codecs.json.decode(undefined), null);
assert.equal(codecs.text.encode('body{}'), 'body{}');
assert.equal(codecs.text.decode(null), null);
assert.equal(codecs.none.decode(undefined), null);

// :::::: memory driver
const memory = createMemoryDriver();
assert.ok(isDriver(memory) && isSyncDriver(memory));
assert.equal(await memory.get('nope'), null);
await memory.set('a', { x: 1 });
assert.equal((await memory.get('a')).x, 1);
memory.setSync('b', 2);
assert.equal(memory.getSync('b'), 2);
assert.deepEqual((await memory.keys()).sort(), ['a', 'b']);
await memory.delete('a');
assert.equal(await memory.get('a'), null);

// :::::: keyspace wrapper
const backing = createMemoryDriver();
const scoped  = withKeyspace(backing, keys);
const other   = withKeyspace(backing, createKeyspace({ namespace: 'docs' }));

await scoped.set('theme', 'oled');
await other.set('theme', 'classic');
assert.equal(await scoped.get('theme'), 'oled');
assert.equal(await other.get('theme'), 'classic');
assert.equal(backing.getSync('aufbau:v2:theme'), 'oled');
assert.deepEqual(await scoped.keys(), ['theme']);

scoped.setSync('sync-key', 1);
assert.equal(scoped.getSync('sync-key'), 1);

// clear must only drop what the keyspace owns
await scoped.clear();
assert.deepEqual(await scoped.keys(), []);
assert.equal(await other.get('theme'), 'classic', 'foreign namespace survived clear');

assert.equal(withKeyspace(backing), backing, 'NO_KEYSPACE must not wrap');

// :::::: single flight
const once = createSingleFlight();
let calls  = 0;
const slow = () => new Promise(resolve => setTimeout(() => { calls++; resolve('v'); }, 10));
const [a, b] = await Promise.all([once('k', slow), once('k', slow)]);
assert.equal(calls, 1, 'concurrent misses must collapse');
assert.equal(a, b);
assert.equal(once.size(), 0, 'entry must be released after settle');
await once('k', slow);
assert.equal(calls, 2, 'a later call must run again');

let failed = 0;
await once('bad', () => { throw new Error('boom'); }).catch(() => failed++);
assert.equal(failed, 1, 'a sync throw must reject, not escape');
assert.equal(once.size(), 0, 'a rejection must not poison the slot');

// :::::: assertDriver
assert.throws(() => assertDriver({ get: () => {} }), /missing: clear, delete, keys, set/);

// :::::: quota + channel degrade instead of throwing
assert.equal(typeof (await quota.estimate()).supported, 'boolean');
assert.equal(await quota.persist(), false);
const channel = createChannel('smoke');
channel.post({ hello: 1 });
channel.close();

console.log('core: all assertions passed');

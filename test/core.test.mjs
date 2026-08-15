import assert from 'node:assert/strict';
import {
  assertDriver, codecs, createKeyspace, createMemoryDriver,
  isDriver, isSyncDriver, withKeyspace,
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

// :::::: assertDriver
assert.throws(() => assertDriver({ get: () => {} }), /missing: clear, delete, keys, set/);

console.log('core: all assertions passed');

import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { BunkerDB, createDb, createDbDriver } from '@bunker/db';
import { isDriver } from '@bunker/core';

assert.equal(BunkerDB.isSupported(), true);

const db = createDb('bunker-test');

// :::::: tables are created on first touch
await db.set('users', 'ada', { role: 'admin' });
assert.deepEqual(await db.get('users', 'ada'), { role: 'admin' });
assert.equal(await db.get('users', 'nobody'), null, 'a miss must be null, not undefined');
assert.equal(await db.has('users', 'ada'), true);
assert.equal(await db.has('users', 'nobody'), false);
assert.deepEqual(db.tables, ['users']);

// :::::: concurrent writes to unknown tables must not race the upgrade cycle
await Promise.all([
  db.set('a', 'k', 1), db.set('b', 'k', 2), db.set('c', 'k', 3), db.set('d', 'k', 4),
]);
assert.deepEqual(db.tables.sort(), ['a', 'b', 'c', 'd', 'users']);
assert.deepEqual(
  await Promise.all([db.get('a', 'k'), db.get('b', 'k'), db.get('c', 'k'), db.get('d', 'k')]),
  [1, 2, 3, 4],
);

// :::::: prefix scans
await db.set('kv', 'css:app', 'a{}');
await db.set('kv', 'css:docs', 'b{}');
await db.set('kv', 'font:inter', 'x');
assert.deepEqual((await db.keys('kv')).sort(), ['css:app', 'css:docs', 'font:inter']);
assert.deepEqual((await db.keys('kv', 'css:')).sort(), ['css:app', 'css:docs']);
assert.deepEqual(await db.getAll('kv', 'css:'), { 'css:app': 'a{}', 'css:docs': 'b{}' });
assert.equal((await db.entries('kv', 'css:')).length, 2);
assert.equal(await db.count('kv'), 3);

// :::::: toggle is read+write in one transaction
assert.equal(await db.toggle('flags', 'dark'), true);
assert.equal(await db.toggle('flags', 'dark'), false);
assert.equal(await db.get('flags', 'dark'), false);

// :::::: proxy tables
assert.equal(await db.users.get('ada').then(u => u.role), 'admin');
assert.deepEqual(await db.users.ada, { role: 'admin' }, 'unknown props read as keys');
assert.deepEqual((await db.kv.keys('css:')).sort(), ['css:app', 'css:docs']);
assert.deepEqual(await db.kv.getAll('css:'), { 'css:app': 'a{}', 'css:docs': 'b{}' });
assert.equal(await db.users.has('ada'), true);

// :::::: setup is idempotent, so a page reload does not inflate the version
const schema = { posts: { keyPath: 'id', indexes: ['author'] } };
await db.setup(schema);
const versionAfterSetup = db.version;
assert.ok(db.tables.includes('posts'));

await db.setup(schema);
await db.setup(schema);
assert.equal(db.version, versionAfterSetup, 'repeated setup must not bump the version');

// adding an index to an existing table is a real change and must upgrade once
await db.setup({ posts: { keyPath: 'id', indexes: ['author', 'title'] } });
assert.equal(db.version, versionAfterSetup + 1, 'a new index must upgrade exactly once');
await db.setup({ posts: { keyPath: 'id', indexes: ['author', 'title'] } });
assert.equal(db.version, versionAfterSetup + 1, 'and then settle again');

// :::::: indexes
await db.task('posts', 'readwrite', os => os.put({ author: 'ada', id: 1, title: 'one' }));
await db.task('posts', 'readwrite', os => os.put({ author: 'ada', id: 2, title: 'two' }));
await db.task('posts', 'readwrite', os => os.put({ author: 'bob', id: 3, title: 'three' }));
assert.equal((await db.find('posts', 'author', 'ada')).length, 2);

// :::::: criteria queries
// an object spec matches on the records' own properties; a stored primitive can
// never match one, so it is skipped rather than throwing.
assert.equal((await db.posts.get({ author: 'bob' }))?.id, 3);
assert.equal(await db.posts.get({ author: 'nobody' }), null);
assert.equal((await db.posts.toValues({ author: 'ada' })).length, 2);
assert.equal((await db.posts.toValues({ author: 'ada', title: 'two' })).length, 1);
assert.equal(await db.posts.count({ author: 'ada' }), 2);
assert.equal(await db.posts.has({ author: 'bob' }), true);
assert.equal(await db.posts.has({ author: 'zoe' }), false);
assert.equal((await db.posts.toKeys({ author: 'ada' })).length, 2);

await db.set('mixed', 'rec', { kind: 'a' });
await db.set('mixed', 'raw', 'just a string');
assert.equal((await db.toValues('mixed', { kind: 'a' })).length, 1, 'primitives are skipped, not matched');
assert.equal((await db.toValues('mixed', {})).length, 1, 'empty criteria still means records only');

// :::::: changes
// settle on a macrotask: handlers run in a microtask, one turn after the emit.
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

const seen = [];
const stop = db.onChange('notes', change => seen.push(change));

await db.notes.set('n1', { text: 'one' });
await settle();
assert.equal(seen.length, 1);
assert.deepEqual(seen[0].keys, ['n1'], 'keys is always an array');
assert.equal(seen[0].type, 'set');
assert.equal(seen[0].origin, db.origin, 'a change names the instance that wrote it');

// a batch is one change carrying every key, not one change per key
seen.length = 0;
await db.notes.setMany([['n2', {}], ['n3', {}], ['n4', {}]]);
await settle();
assert.equal(seen.length, 1, 'setMany emits once for the whole batch');
assert.deepEqual(seen[0].keys.sort(), ['n2', 'n3', 'n4']);

seen.length = 0;
await db.notes.deleteMany(['n2', 'n3']);
await settle();
assert.equal(seen.length, 1, 'deleteMany emits once for the whole batch');
assert.deepEqual(seen[0].keys.sort(), ['n2', 'n3']);

// changes raised in the same turn merge, so the count depends on timing — what must
// hold either way is that merging never loses a key
seen.length = 0;
await Promise.all([db.notes.set('n5', {}), db.notes.set('n6', {})]);
await settle();
assert.deepEqual(seen.flatMap(change => change.keys).sort(), ['n5', 'n6'], 'merging must not drop keys');

// a set and a delete describe different things and must never merge
seen.length = 0;
await Promise.all([db.notes.set('n7', {}), db.notes.delete('n6')]);
await settle();
assert.equal(seen.filter(c => c.type === 'set').length, 1);
assert.equal(seen.filter(c => c.type === 'delete').length, 1);

// clear takes the whole table, so it names no keys
seen.length = 0;
await db.clear('notes');
await settle();
assert.equal(seen[0].type, 'clear');
assert.deepEqual(seen[0].keys, []);

// a table listener hears only its own table, and stops when told to
seen.length = 0;
await db.set('elsewhere', 'k', 1);
await settle();
assert.equal(seen.length, 0, 'a table listener ignores other tables');

stop();
await db.notes.set('n8', {});
await settle();
assert.equal(seen.length, 0, 'onChange returns a working unsubscribe');

// :::::: reading never changes the schema
// a write to an unknown table creates it; a read of one must not, or every read
// would upgrade the other tabs out of their connection.
const versionBeforeReads = db.version;
assert.deepEqual(await db.ghost.toValues(), []);
assert.deepEqual(await db.ghost.toMap(), {});
assert.deepEqual(await db.ghost.toKeys(), []);
assert.equal(await db.ghost.get('x'), null);
assert.equal(await db.ghost.count(), 0);
assert.equal(await db.ghost.has('x'), false);
assert.equal(db.version, versionBeforeReads, 'reads must not bump the version');
assert.equal(db.tables.includes('ghost'), false, 'reads must not create the table');

await db.ghost.set('x', 1);
assert.equal(db.tables.includes('ghost'), true, 'a write still creates it');
assert.equal(await db.ghost.get('x'), 1);

// :::::: driver contract
const driver = db.driver('kv');
assert.ok(isDriver(driver));
assert.equal(driver.sync, false);
await driver.set('via-driver', { ok: true });
assert.deepEqual(await driver.get('via-driver'), { ok: true });
assert.equal(await driver.get('absent'), null);
assert.ok((await driver.keys('css:')).length === 2);
await driver.delete('via-driver');
assert.equal(await driver.get('via-driver'), null);

assert.ok(isDriver(createDbDriver({ name: 'bunker-test-driver' })));

// :::::: clear and drop
await db.clear('kv');
assert.deepEqual(await db.keys('kv'), []);
await db.dropTable('kv');
assert.equal(db.tables.includes('kv'), false);

// :::::: a rejected transaction does not settle as success
await assert.rejects(db.task('users', 'readonly', () => { throw new Error('boom'); }), /boom/);

await db.destroy();
console.log('db: all assertions passed');

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

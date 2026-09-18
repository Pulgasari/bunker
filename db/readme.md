# @bunker/db

IndexedDB without the ceremony. tables appear when you write to them.

## base shape of api

```javascript
import { createDB } from '@bunker/db';

const db = createDB('myapp');

await db.set('users', 'ada', { role: 'admin' });
await db.get('users', 'ada');       // { role: 'admin' }
await db.get('users', 'nobody');    // null
```

## sugar shape of api (by proxyfied tables)

### get

```javascript
await db.users.get('bob');
await db.users.bob; // any unknown property reads as a key
```

### set

```javascript
db.users.bob = { role: 'guest' };
```

### drop

```javascript
await db.users.drop();
```

### keys

```javascript
await db.users.toKeys('admin:');
```

## Reading several

`toMap`, `toValues`, `toEntries` and `toKeys` all take the same optional spec — a key
prefix or criteria (below) — and differ only in the shape they hand back.

```javascript
await db.kv.toMap('css:');      // { 'css:app': 'a{}', 'css:docs': 'b{}' }
await db.kv.toValues('css:');   // ['a{}', 'b{}']
await db.kv.toEntries('css:');  // [['css:app', 'a{}'], …]
await db.kv.toKeys('css:');     // ['css:app', 'css:docs']
```

`getAll`, `keys`, `entries` and `find` are the old names for these and still work.

## Writing several

```javascript
await db.users.setMany([['ada', { role: 'admin' }], ['bob', { role: 'guest' }]]);
await db.users.setMany({ ada: { role: 'admin' } });   // an object works too
await db.users.deleteMany(['ada', 'bob']);
```

One transaction for the whole batch, so an abort rolls back every key — and one
change for the whole batch, not one per key.

## Prefix scans

Keys are strings and IndexedDB sorts them lexicographically, so a prefix scan is a
plain bound range. No secondary index required.

```javascript
await db.toKeys('kv', 'css:');     // ['css:app', 'css:docs']
await db.toMap('kv', 'css:');      // { 'css:app': 'a{}', 'css:docs': 'b{}' }
```

## Criteria

Pass an object instead of a prefix to match on the records' own properties, with
strict equality on every key. A stored value that is not a record can never match, so
primitives kept next to records are skipped rather than throwing.

```javascript
await db.posts.get({ id: 'p2' });               // the first match, or null
await db.posts.toValues({ author: 'ada' });     // every match
await db.posts.count({ author: 'ada' });
await db.posts.has({ author: 'ada' });
```

Without an index this is a cursor walk. Declare one and it is used automatically —
the first criteria key that has an index narrows the scan, the rest are matched on
the way past.

## Schema when you want one

```javascript
await db.setup({
  posts: { keyPath: 'id', indexes: ['author'] },
});

await db.posts.toValues({ author: 'ada' });
```

`setup()` is idempotent. It compares the live schema first and only opens an upgrade
transaction when something is genuinely missing — calling it on every page load does
not inflate the version, which is what makes it safe to put at boot.

## Changes

`onChange` reports every write, in this tab and in the others.

```javascript
const stop = db.onChange(change => {
  if (change.origin === db.origin) return;   // our own write, we already know
  reload(change.table);
});

// change = { table, type: 'set'|'delete'|'clear'|'drop'|'destroy', keys, origin }
```

`onChange(table, handler)` narrows it to one table. `keys` is always an array, empty
for `clear` / `drop` / `destroy`, which take the whole table.

No value is shipped, deliberately: handlers re-read what they need, which keeps
cross-tab traffic small and makes a local change identical to a remote one apart from
`origin`. `origin` names the instance that wrote it, so a listener can tell a write it
already applied from one it has to go and fetch.

Changes raised in the same turn are merged per table and type before anyone hears
about them, so writing a record and then a batch of its children is two operations but
one notification.

## What it gets right

Four things that are easy to get wrong with raw IndexedDB, and that cost real
debugging when you do:

**Upgrades are serialized.** Every connection change runs through one queue, so
concurrent writes to tables that do not exist yet cannot race into overlapping
`open`/`upgrade` cycles.

**Other tabs are never blocked.** `onversionchange` closes our connection when
another tab wants to upgrade, and `onblocked` rejects with a clear message instead of
hanging forever.

**A write settles when it commits.** `task()` waits for `tx.oncomplete`, not for the
request's `onsuccess`. In a readwrite transaction the request succeeds *before* the
transaction commits, so resolving on it would report a write as done that a later
abort still undoes.

**Reading does not change the schema.** A write to a table that does not exist yet
creates it; a read of one comes back empty (`[]`, `{}`, `null`, `0`) and leaves the
version alone. Reading is not a schema change, and bumping the version for it would
upgrade every other tab out of its connection.

## Escape hatch

`task()` is the raw transaction. It does not emit a change, so anything written
through it is invisible to `onChange` — reach for `setMany` / `deleteMany` unless you
need a cursor or a read-modify-write of your own.

```javascript
await db.task('kv', 'readwrite', store => store.put(value, key));
```

## As a cache backend

```javascript
import { createPolicy } from '@bunker/policy';

const cache = createPolicy({ driver: db.driver('kv') });
```

`driver(table)` hands back a plain `@bunker/core` driver, which is how `@bunker/policy`
gets an IndexedDB L2 without ever importing this package.

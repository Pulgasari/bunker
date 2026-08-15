# @bunker/db

IndexedDB without the ceremony. Tables appear when you touch them.

```javascript
import { createDb } from '@bunker/db';

const db = createDb('myapp');

await db.set('users', 'ada', { role: 'admin' });
await db.get('users', 'ada');       // { role: 'admin' }
await db.get('users', 'nobody');    // null
```

## Proxy tables

```javascript
await db.users.get('ada');
await db.users.ada;              // any unknown property reads as a key
db.users.bob = { role: 'guest' }; // fire and forget
await db.users.keys('admin:');
await db.users.drop();
```

## Prefix scans

Keys are strings and IndexedDB sorts them lexicographically, so a prefix scan is a
plain bound range. No secondary index required.

```javascript
await db.keys('kv', 'css:');     // ['css:app', 'css:docs']
await db.getAll('kv', 'css:');   // { 'css:app': 'a{}', 'css:docs': 'b{}' }
await db.entries('kv', 'css:');  // [['css:app', 'a{}'], …]
```

## Schema when you want one

```javascript
await db.setup({
  posts: { keyPath: 'id', indexes: ['author'] },
});

await db.find('posts', 'author', 'ada');
```

`setup()` is idempotent. It compares the live schema first and only opens an upgrade
transaction when something is genuinely missing — calling it on every page load does
not inflate the version, which is what makes it safe to put at boot.

## What it gets right

Three things that are easy to get wrong with raw IndexedDB, and that cost real
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

## As a cache backend

```javascript
import { createPolicy } from '@bunker/policy';

const cache = createPolicy({ driver: db.driver('kv') });
```

`driver(table)` hands back a plain `@bunker/core` driver, which is how `@bunker/policy`
gets an IndexedDB L2 without ever importing this package.

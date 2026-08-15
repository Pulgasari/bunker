# @bunker/kit

Every bunker package, pre-wired under one namespace.

```javascript
import bunker from '@bunker/kit';

bunker.local.setSync('theme', 'oled');            // synchronous, survives reload
await bunker.policy.swr('config', fetchConfig);   // ttl + revalidation over IndexedDB
await bunker.db.set('users', 'ada', { … });       // structured storage
await bunker.cache.staleWhileRevalidate('/app.ass', { transform: compile });
```

Or with your own settings:

```javascript
import { createBunker } from '@bunker/kit';

const store = createBunker({
  namespace : 'aufbau',
  ttl       : 60_000,
  staleTtl  : 24 * 60 * 60_000,
  version   : 2,
});
```

One `namespace` covers all of it: the IndexedDB database name, the Cache API cache
name, and the keyspace both storages write under.

## What it gives you

| | |
| --------- | ------------------------------------------------------------ |
| `cache`   | Cache API, for anything with a URL |
| `db`      | IndexedDB directly |
| `policy`  | TTL and eviction over an IndexedDB L2 |
| `local`   | `localStorage` — synchronous, readable before the first paint |
| `session` | `sessionStorage` |
| `core`    | the driver contract and its primitives |
| `utils`   | memoize, single flight, content hash, quota, cross-tab |

## This is the only package that couples them

Everywhere else in this repo, a package depends on `@bunker/core` and nothing more.
`@bunker/policy` in particular does not import `@bunker/db` — it takes a driver and has
no idea what is behind it.

That is what makes the wiring a one-liner here, and it is also why you can skip this
package entirely and assemble your own:

```javascript
import { createPolicy } from '@bunker/policy';
import { createDb }    from '@bunker/db';

const cache = createPolicy({ driver: createDb('myapp').driver('kv'), ttl: 60_000 });
```

Importing the kit constructs the shared `bunker` instance, which probes web storage
once to find out whether it is usable. Use `createBunker()` if you would rather decide
when that happens.

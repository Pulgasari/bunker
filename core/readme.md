# @bunker/core

The pieces every other bunker package builds on. Nothing here touches a storage API
directly except the memory driver.

```javascript
import { createKeyspace, createMemoryDriver, withKeyspace } from '@bunker/core';
```

## Driver contract

A driver moves opaque values in and out. That is all it does — TTL, eviction and
revalidation live in `@bunker/policy`, never in a driver.

```javascript
{
  clear  ()                -> Promise<void>
  delete (key)             -> Promise<void>
  get    (key)             -> Promise<value|null>
  keys   (prefix = '')     -> Promise<string[]>
  set    (key, value)      -> Promise<void>
}
```

Drivers backed by a synchronous API add `deleteSync`, `getSync` and `setSync` and set
`sync: true`. Only `@bunker/storage` qualifies, and it matters: the anti-flicker boot
path needs a value **before the first paint**, and nothing asynchronous can be there
in time.

`assertDriver(value)` throws a `TypeError` naming the missing methods.

## Keyspaces

```javascript
const keys = createKeyspace({ namespace: 'aufbau', version: 2 });

keys.encode('css/app.ass'); // 'aufbau:v2:css/app.ass'
keys.stale('aufbau:v1:x');  // true  -> sweep target after the bump
keys.stale('other:v1:x');   // false -> not ours
```

Bumping `version` orphans every existing entry at once. That is what a deploy needs
when the shape of what you cached has changed.

`withKeyspace(driver, keyspace)` applies this to every key a driver sees, so prefixing
is written once rather than in each package. Its `clear()` only drops what the keyspace
owns, which lets several namespaces share one backing store.

## Codecs

`codecs.json` is the default. `codecs.text` skips JSON's quoting and escaping for
values that are already strings — worth it when the synchronous boot read pulls a whole
stylesheet out of localStorage. `codecs.none` is for drivers with native structured
clone.

A malformed entry decodes to `null`, i.e. reads as a cache miss. It never throws.

## What moved out

`createSingleFlight`, `quota` and `createChannel` live in
[`@bunker/utils`](../utils/readme.md). None of them touched the driver contract, and
keeping them here made core look like a grab bag. What is left is the contract and the
keyspaces every backend shares.

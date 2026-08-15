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

## Single flight

```javascript
const once = createSingleFlight();
await Promise.all([once('key', fetcher), once('key', fetcher)]); // fetcher ran once
```

## Quota

```javascript
import { quota } from '@bunker/core';

await quota.persist();          // opt out of eviction; false is a normal answer
await quota.estimate();         // { quota, ratio, supported, usage }
await quota.isUnderPressure();  // ratio >= 0.9
```

IndexedDB and the Cache API share one origin quota and are evicted per origin under
disk pressure. localStorage is not covered by any of it.

## Cross-tab

```javascript
const channel = createChannel('aufbau:theme');
const off     = channel.subscribe(message => console.log(message));

channel.post({ theme: 'oled' });
```

`BroadcastChannel` where available (window, worker and service worker), otherwise the
localStorage `storage` event. Neither delivers to the sender.

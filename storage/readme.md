# @bunker/storage

`localStorage` and `sessionStorage`, namespaced and codec-aware, with a memory
fallback that never throws.

```javascript
import { createStorage } from '@bunker/storage';

const store = createStorage({ namespace: 'aufbau', version: 1 });

store.setSync('theme', 'oled');
store.getSync('theme');            // 'oled'
store.getSync('missing', 'light'); // 'light'
```

## Why synchronous is the point

This is the only web storage API that can be read **before the first paint**.
IndexedDB and the Cache API cannot, and `fetch` certainly cannot — they are all at
least one tick late, which is exactly the tick in which a page flashes unstyled.

So the synchronous methods are the primary surface here, not a convenience:

```javascript
clearSync  ()                     -> void
deleteSync (key)                  -> boolean
getSync    (key, fallback = null) -> value|fallback
hasSync    (key)                  -> boolean
keysSync   (prefix = '')          -> string[]
setSync    (key, value)           -> boolean
sweepSync  ()                     -> number
```

The async `@bunker/core` driver contract is implemented too, so a storage instance
can back a `@bunker/cache` like any other driver.

## Nothing throws

A write returns `false` instead of throwing — a full quota is the common case, and it
is not worth taking a page down for. Pass `onError` when you want to see them:

```javascript
createStorage({ namespace: 'aufbau', onError: ({ operation, key }) => report(operation, key) });
```

When the backing store is unavailable altogether — private mode, a blocked cookie
policy, a full disk — the instance falls back to memory and reports
`persistent: false`. Every method keeps working; nothing survives the reload.

## Namespaces and versions

```javascript
const v2 = createStorage({ namespace: 'aufbau', version: 2 });

v2.clearSync(); // only this keyspace, other namespaces in the area are untouched
v2.sweepSync(); // drops what 'aufbau' wrote at version 1, returns the count
```

Bump `version` when the shape of what you store changes. Call `sweepSync()` once at
boot afterwards, otherwise the orphans sit there until the quota fills.

## Codecs

`codecs.json` is the default. For values that are already strings, `codecs.text` skips
the quoting and escaping — worth it when the boot path reads a whole stylesheet
synchronously:

```javascript
import { codecs } from '@bunker/core';

const sheets = createStorage({ codec: codecs.text, namespace: 'css' });
```

A stored `null` reads back as the fallback. Use `hasSync()` to tell an absent key from
one holding `null`.

## Changes

```javascript
const off = store.subscribe(({ key, source, value }) => {
  if (source === 'remote') applyFromOtherTab(key, value);
});
```

Local writes are reported too, which the native `storage` event does not do. Remote
changes only arrive for the `local` area — `sessionStorage` is per-tab by design.

## Proxy sugar

```javascript
const state = store.proxy;

state.theme = 'oled';
'theme' in state;     // true
Object.keys(state);   // ['theme']
delete state.theme;
```

It lives on `.proxy` rather than on the store itself so that a key named `get` or
`keys` is not shadowed by the method of the same name.

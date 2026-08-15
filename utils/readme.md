# @bunker/utils

Small in-process helpers. One file per thing, each importable on its own:

```javascript
import { lru }     from '@bunker/utils/lru.js';
import { memoize } from '@bunker/utils/memoize.js';
```

Or all of them:

```javascript
import { contentHash, createChannel, createSingleFlight, lazy, lru, memoize, quota } from '@bunker/utils';
```

## What lives here

The bar is narrow on purpose: **no I/O, and no value that survives a reload.**
Anything that persists is a driver and belongs in a backend package — `@bunker/db`,
`@bunker/storage`, `@bunker/cache`.

| | |
| ---------------- | -------------------------------------------------------------- |
| `channel.js`     | cross-tab signalling, `BroadcastChannel` or the `storage` event |
| `hash.js`        | a short fingerprint of a string body                            |
| `lazy.js`        | run a factory once, remember the result                         |
| `lru.js`         | a bounded map ordered by use                                    |
| `memoize.js`     | cache by a key derived from the arguments                       |
| `quota.js`       | `navigator.storage` — estimate, persist, pressure               |
| `singleFlight.js`| one pending promise per key                                     |

## Notes worth knowing

**`memoize` drops rejected promises.** A failed call is retried on the next
invocation instead of being remembered forever, which is what makes it usable as a
once-per-session loader for something that can fail:

```javascript
const load = memoize((name) => import(cdn + name));
```

**`channel` never delivers to the sender.** Neither transport does, so a subscriber
sees other tabs only — the same shape whichever one is available.

**`quota` covers IndexedDB and the Cache API, not localStorage.** They share one
origin quota, and under disk pressure the browser evicts whole origins by
least-recent-use. `persist()` opts out of that; a `false` answer is normal, not an
error.

MIT.

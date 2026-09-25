# @bunker/opfs

The origin private file system as a key value store. Files the origin owns outright,
no picker and no permission prompt. One store is one directory, one key one file.

```javascript
import { createOpfs } from '@bunker/opfs';

const thumbs = createOpfs({ directory: 'zugriff/thumbs' });

await thumbs.set('a1b2@250.webp', blob);
const file = await thumbs.get('a1b2@250.webp');   // File, backed by the disk
image.src  = URL.createObjectURL(file);
```

## What it stores

- **Bytes** (`Blob`, `File`, `ArrayBuffer`, typed arrays) are written as they are. The
  directory holds real files that any OPFS explorer can open, and `get()` returns
  them as a `File`. A MIME type is not kept for raw bytes, OPFS files have none.
- **Everything else** is JSON in a small container, with every binary part inside it
  appended after the header. That is what lets `@bunker/policy` keep its
  `{ at, expire, value: Blob }` entries here, without base64 and without a second store.
  Binary parts come back as `Blob` slices and keep their type.

Reading never copies. A returned `File` or slice points at the file on disk and
becomes unreadable (`NotReadableError`) once its key is written again. Read what you
need before overwriting.

## API

```javascript
await store.set(key, value);   // true, or false when it failed
await store.get(key);          // the value, null when missing
await store.file(key);         // the stored File itself
await store.has(key);
await store.delete(key);       // false when there was nothing to delete
await store.keys(prefix);
await store.entries(prefix);   // [{ key, lastModified, size }]
await store.size(prefix);      // bytes on disk
await store.clear();           // empties the directory, keeps it
```

Keys are file names. Only what a file name cannot hold is escaped (`%`, `/`, `\`,
control characters, `.` and `..`), so names stay readable in an explorer.

Errors go to `onError`, a missing key is a miss and not an error. Without OPFS every
call is a quiet miss.

## As a driver

```javascript
import { createPolicy } from '@bunker/policy';

const cache = createPolicy({
  driver     : createOpfs({ directory: 'thumbs' }).driver(),
  ttl        : 30 * 24 * 60 * 60_000,
  maxEntries : 2000,
});
```

## Support

`createWritable()` is used where the window has it. Older Safari only writes from a
worker, through `createSyncAccessHandle()`, which the store falls back to there. In
a window without either, `set()` reports the failure through `onError`.

OPFS shares the origin quota and eviction with IndexedDB and the Cache API.
`navigator.storage.persist()` protects all of them alike.

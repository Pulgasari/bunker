# bunker

Browser storage, split along the lines the platform actually draws.

The three web storage APIs are not three flavours of the same thing — they differ in
the one property that decides what you can build on them:

|                  | synchronous          | holds                                | quota         | in a worker |
| ---------------- | -------------------- | ------------------------------------ | ------------- | ----------- |
| `localStorage`   | **yes, the only one**| strings                              | ~5 MB         | no          |
| `IndexedDB`      | no                   | structured clone, `Blob`, `ArrayBuffer` | origin quota | yes         |
| Cache API        | no                   | `Request` / `Response`               | origin quota  | yes         |

bunker gives each one a package, and keeps caching *policy* out of all of them.

```
@bunker/core      driver contract, keyspaces, codecs, quota, cross-tab, single flight
@bunker/db        IndexedDB
@bunker/storage   localStorage / sessionStorage, synchronous
@bunker/files     Cache API, window and service worker
@bunker/cache     TTL and stale-while-revalidate over any driver
@bunker/kit       the five above, pre-wired
```

## Layering

Every package depends on `@bunker/core` and on nothing else:

```
core
 ├── db       -> exports a driver
 ├── storage  -> exports a driver
 ├── files    -> exports a driver
 └── cache    -> takes a driver, knows none of them
```

`@bunker/cache` does not import `db`, `storage` or `files`. Want an IndexedDB L2? Hand
it that driver. This keeps `cache` usable on its own (memory only) and keeps the
packages from growing into each other. `@bunker/kit` is the single place where the
wiring happens.

## Which one for what

- **`storage`** — small, render-critical strings that must be readable *before the first
  paint*: theme, skin, critical CSS, font metrics. Synchronous is the feature here.
- **`db`** — anything structured or large that may be async: compiled output, datasets,
  blobs, offline data.
- **`files`** — anything with a URL: stylesheets, `woff2`, images, wasm. A service worker
  answers the real request from here, so the browser's own loading path is untouched.
- **`cache`** — not a place to put things. A policy you wrap around one of the above.

## Why the split matters: rendering without a flash

Only a **synchronously readable** value can be applied before the first paint.
IndexedDB, the Cache API read from the window, and `fetch` are all at least one tick
late — which leaves a flash of unstyled content, or hiding `<body>`, which is its own
kind of flicker. That rules IndexedDB out for render-critical CSS, however convenient
it is otherwise.

Two paths, and they complement each other:

**A service worker over `@bunker/files`** answers the request for your stylesheet from
the cache and revalidates in the background. The `<link rel=stylesheet>` stays an
ordinary render-blocking link — the browser waits, but only on a cache hit. No JS on
the critical path. It does not cover the very first visit, and it needs HTTPS or
localhost.

**A blocking classic script over `@bunker/storage`** covers that first visit and the
no-service-worker case. It reads synchronously in `<head>` and appends a `<style>`
before the parser reaches the `<link>`.

Applying a *fresh* stylesheet mid-session is the part worth being careful about: if it
differs, the reflow lands late, which is usually worse than a short wait up front.
Write the new version, apply it on the next load.

## Status

Early. Nothing is published yet, the API is still moving.

MIT.

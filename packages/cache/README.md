# @bunker/cache

```
pull        =  private. pull from source, transform, store.
               returns null when the source is unchanged, unreachable or not ok.
getAndPull  =  returns the cached value right away, pulls in any case.
               pulled resolves to null when nothing changed. await it on a cold start, ignore it otherwise.
getOrPull   =  pulls only on a miss. a hit guarantees zero requests.

--- createResponseCache
getAndPull  =   pulled resolves to null when offline or not ok, so guard before responding with it.
```

// @bunker/cache

import type { Driver } from '@bunker/core';

export type CacheOperation = 'clear' | 'delete' | 'keys' | 'match' | 'open' | 'put' | 'revalidate';

export interface CacheError {
  error: unknown;
  key: string | null;
  operation: CacheOperation;
}

export interface CacheSuccess {
  /**
   * Operation-specific extra: `{ hit }` for `match`, `{ deleted }` for `delete`/`clear`,
   * `{ count }` for `keys`, `{ status, notModified }` for `revalidate`.
   */
  detail?: { count?: number; deleted?: boolean; hit?: boolean; notModified?: boolean; status?: number } | null;
  key: string | null;
  operation: CacheOperation;
}

export interface CacheOptions {
  /** Cache name passed to `caches.open()`. Defaults to `bunker`. */
  name?: string;
  /** Called when a cache operation fails. */
  onError?: (error: CacheError) => void;
  /** The counterpart to `onError`: called when an operation succeeds, for logging hit rate and revalidation outcomes. */
  onSuccess?: (success: CacheSuccess) => void;
}

export type Transform = (
  source: string,
  context: { request: RequestInfo; response: Response },
) => string | Promise<string>;

export interface SwrOptions {
  /** Receives the background revalidation. A service worker passes `event.waitUntil`. */
  keepAlive?: (pending: Promise<unknown>) => void;
  /** Called with a clone of the fresh response, only when revalidation produced a new body. */
  onRevalidate?: (fresh: Response) => void;
  /** Turns the source into what gets stored — where an ASS → CSS compile hooks in. */
  transform?: Transform;
  /** A stored response younger than this skips revalidation entirely. `0` always revalidates. */
  ttl?: number;
  /** `content-type` for the stored response. Set it when `transform` changes the format. */
  type?: string;
}

export interface Cache {
  readonly name: string;
  isSupported(): boolean;

  clear(): Promise<boolean>;
  delete(request: RequestInfo): Promise<boolean>;
  keys(): Promise<Request[]>;
  match(request: RequestInfo): Promise<Response | null>;
  /** `null` when the Cache API is unavailable. */
  open(): Promise<globalThis.Cache | null>;
  /** `false` for an opaque response, which `cache.put()` rejects outright. */
  put(request: RequestInfo, response: Response): Promise<boolean>;

  /**
   * The anti-flicker primitive. A cached response comes back immediately and is
   * revalidated in the background; a miss awaits the network.
   *
   * Revalidation is conditional — the source's `ETag`/`Last-Modified` are stored
   * alongside the (possibly transformed) body, so an unchanged source costs a 304
   * and no body at all. A failing revalidation keeps the stale copy.
   */
  staleWhileRevalidate(request: RequestInfo, options?: SwrOptions): Promise<Response>;

  /**
   * A `@bunker/core` driver over JSON text bodies, for keeping compiled output in the
   * Cache API instead of IndexedDB. Keys become URLs under `origin`; they never leave
   * the cache and only need to be stable and unique.
   */
  driver(options?: { origin?: string }): Driver;

  /** `cache.proxy['/app.css']` reads, assigning puts, `delete` removes. */
  readonly proxy: CacheProxy;
}

/** Key access over a cache. Reads answer a promise; there is no synchronous form. */
export interface CacheProxy {
  [key: string]: Promise<Response | null> | Response;
}

export declare function createProxy(cache: Cache): CacheProxy;

export declare function createCache(options?: CacheOptions): Cache;

/** Shared instance over the `bunker` cache. */
export declare const cache: Cache;

export default createCache;

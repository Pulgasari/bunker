// @bunker/files

import type { Driver } from '@bunker/core';

export interface FilesError {
  error: unknown;
  key: string | null;
  operation: 'clear' | 'delete' | 'keys' | 'match' | 'open' | 'put' | 'revalidate';
}

export interface FilesOptions {
  /** Cache name passed to `caches.open()`. Defaults to `bunker`. */
  name?: string;
  onError?: (error: FilesError) => void;
}

export type Transform = (
  source: string,
  context: { request: RequestInfo; response: Response },
) => string | Promise<string>;

export interface SwrOptions {
  /** Called with a clone of the fresh response, only when revalidation produced a new body. */
  onRevalidate?: (fresh: Response) => void;
  /** Turns the source into what gets stored — where an ASS → CSS compile hooks in. */
  transform?: Transform;
  /** A stored response younger than this skips revalidation entirely. `0` always revalidates. */
  ttl?: number;
  /** `content-type` for the stored response. Set it when `transform` changes the format. */
  type?: string;
}

export interface Files {
  readonly name: string;
  isSupported(): boolean;

  clear(): Promise<boolean>;
  delete(request: RequestInfo): Promise<boolean>;
  keys(): Promise<Request[]>;
  match(request: RequestInfo): Promise<Response | null>;
  /** `null` when the Cache API is unavailable. */
  open(): Promise<Cache | null>;
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
}

export declare function createFiles(options?: FilesOptions): Files;

/** Shared instance over the `bunker` cache. */
export declare const files: Files;

export default createFiles;

// @bunker/cache

import type { Driver, Keyspace } from '@bunker/core';

/**
 * - `fresh` — inside its TTL.
 * - `stale` — past the TTL but inside the grace window, so still servable.
 * - `miss`  — absent, or past the grace window and therefore dropped on read.
 */
export type EntryState = 'fresh' | 'stale' | 'miss';

export interface CacheEntry<T = unknown> {
  /** When the value was written, or `null` on a miss. */
  at: number | null;
  /** When it stops being fresh. `null` means it never ages. */
  expire: number | null;
  /** When it stops being servable at all. */
  staleUntil: number | null;
  state: EntryState;
  value: T | null;
}

export interface CacheError {
  error: unknown;
  key: string | null;
  operation: 'clear' | 'delete' | 'get' | 'keys' | 'revalidate' | 'set';
}

export interface CacheOptions {
  /** L2 backend. Defaults to an in-memory driver; pass `db.driver('kv')` for IndexedDB. */
  driver?: Driver;
  /**
   * L1 (in-memory) entry ceiling, least-recently-used first. `0` disables it.
   * Evicting from L1 deliberately leaves L2 untouched — L1 is filled by reads too,
   * so writing the eviction through would delete entries merely for scrolling out
   * of the memory window.
   */
  max?: number;
  /** L2 entry ceiling, enforced by {@link Cache.prune}, oldest first. `0` disables it. */
  maxEntries?: number;
  namespace?: string;
  onError?: (error: CacheError) => void;
  /** Grace window past `ttl` in which an entry may still be served while revalidating. */
  staleTtl?: number;
  /** Default freshness in milliseconds. `null` means entries never age. */
  ttl?: number | null;
  version?: number;
}

export interface WriteOptions {
  staleTtl?: number;
  ttl?: number | null;
}

export interface SwrOptions extends WriteOptions {
  /**
   * Fires only when a background revalidation produced a value different from the
   * stale one that was served. Lets the caller show the old value now and decide
   * for itself whether a late swap is worth the reflow.
   */
  onRevalidate?: (fresh: unknown, stale: unknown) => void;
}

export interface Cache {
  readonly name: string;
  /** The L2 driver, already wrapped in the cache's keyspace. */
  readonly driver: Driver;
  readonly keyspace: Keyspace;
  /** Number of entries currently held in L1. */
  readonly size: number;

  clear(): Promise<void>;
  delete(key: string): Promise<void>;
  /** Full entry with its metadata. Reading a dead entry drops it and reports `miss`. */
  entry<T = unknown>(key: string): Promise<CacheEntry<T>>;
  /** `null` unless the entry is fresh, or stale with `allowStale`. */
  get<T = unknown>(key: string, options?: { allowStale?: boolean }): Promise<T | null>;
  has(key: string): Promise<boolean>;
  keys(prefix?: string): Promise<string[]>;
  /**
   * Actively removes dead entries and enforces `maxEntries`. Entries otherwise only
   * expire on read, so a key nobody reads again is never reclaimed. Returns the
   * number of distinct keys removed across both layers.
   */
  prune(prefix?: string): Promise<number>;
  /** Never rejects: a failed L2 write is reported through `onError` and stays an L1 hit. */
  set<T>(key: string, value: T, options?: WriteOptions): Promise<T>;

  /**
   * Stale-while-revalidate — the primitive the rest of this package exists for.
   *
   * - fresh → the cached value
   * - stale → the cached value immediately, revalidating in the background
   * - miss  → awaits the fetcher
   *
   * Concurrent misses on one key collapse into a single fetch. A failing background
   * revalidation keeps the stale value in place.
   */
  swr<T>(key: string, fetcher: (key: string) => T | Promise<T>, options?: SwrOptions): Promise<T>;
}

export declare function createCache(options?: CacheOptions): Cache;

export default createCache;

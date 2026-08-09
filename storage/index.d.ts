// @bunker/storage

import type { Codec, Driver, Keyspace, SyncDriver } from '@bunker/core';

export type StorageArea = 'local' | 'session';

export interface StorageError {
  error: unknown;
  /** `null` for operations that are not tied to a single key. */
  key: string | null;
  operation: 'delete' | 'get' | 'has' | 'keys' | 'set' | 'sweep';
}

export interface StorageChange<T = unknown> {
  /** `null` when another tab cleared the whole area. */
  key: string | null;
  /** `local` for writes made through this instance, `remote` for another tab. */
  source: 'local' | 'remote';
  /** `null` on delete. */
  value: T | null;
}

export interface StorageOptions {
  /** Defaults to `local`. */
  area?: StorageArea;
  /** Defaults to `codecs.json`. Use `codecs.text` for values that are already strings. */
  codec?: Codec<string>;
  /** Omitting it leaves keys unprefixed and disables `sweepSync()`. */
  namespace?: string;
  /** Defaults to `1`. Bump it to orphan every entry this namespace wrote before. */
  version?: number;
  /** Called instead of throwing. Writes fail on a full quota far more often than anything else. */
  onError?: (error: StorageError) => void;
}

export interface Storage extends SyncDriver {
  readonly name: string;
  readonly area: StorageArea;
  readonly codec: Codec<string>;
  readonly keyspace: Keyspace;
  /**
   * `false` once the backing store was unavailable and this instance fell back to
   * memory — private mode, a blocked cookie policy, a full disk. Every method keeps
   * working, nothing survives the reload.
   */
  readonly persistent: boolean;

  /**
   * Ergonomic accessor. Memoised, and deliberately not the storage object itself:
   * a key named `get` or `keys` would otherwise be shadowed by the method.
   *
   * ```javascript
   * store.proxy.theme = 'oled';
   * delete store.proxy.theme;
   * ```
   */
  readonly proxy: Record<string, any>;

  // :::::: synchronous surface — the reason this package exists

  /** Reads before the first paint. Returns `fallback` on a miss, a decode failure, or a stored `null`. */
  getSync<T = unknown>(key: string, fallback?: T | null): T | null;
  /** `false` when the write failed, most often `QuotaExceededError`. Never throws. */
  setSync<T = unknown>(key: string, value: T): boolean;
  deleteSync(key: string): boolean;
  /** Distinguishes a stored `null` from an absent key, which `getSync()` cannot. */
  hasSync(key: string): boolean;
  keysSync(prefix?: string): string[];
  /** Removes every key of this keyspace, leaving other namespaces in the area untouched. */
  clearSync(): void;
  /**
   * Removes entries this namespace wrote under an older `version` and returns how
   * many went. Call it once at boot after a bump; without it they sit there until
   * the quota fills. A no-op when no namespace is set.
   */
  sweepSync(): number;

  /** Reports local writes and, for the `local` area, writes from other tabs. Returns an unsubscribe function. */
  subscribe(listener: (change: StorageChange) => void): () => void;

  /** Drops subscribers and detaches the cross-tab listener. */
  dispose(): void;
}

export declare function createStorage(options?: StorageOptions): Storage;

/** Builds the `proxy` accessor by hand, for wrapping a storage instance you did not create. */
export declare function createProxy(storage: Storage): Record<string, any>;

/** Shared unnamespaced instances over `localStorage` and `sessionStorage`. */
export declare const local: Storage;
export declare const session: Storage;

export default local;

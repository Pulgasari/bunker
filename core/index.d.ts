// @bunker/core

// :::::: DRIVER

/** The full contract every driver implements. Values move through opaque — expiry and eviction are `@bunker/policy`'s job. */
export interface Driver {
  /** Identifies the backing store, e.g. `memory`, `local`, `indexeddb`. */
  readonly name?: string;
  /** `true` when the driver also implements {@link SyncDriver}. */
  readonly sync?: boolean;

  clear(): Promise<void>;
  delete(key: string): Promise<void>;
  get<T = unknown>(key: string): Promise<T | null>;
  /** Keys starting with `prefix`, already stripped of any keyspace prefix. */
  keys(prefix?: string): Promise<string[]>;
  set<T = unknown>(key: string, value: T): Promise<void>;
}

/**
 * A driver backed by a synchronous API. Only `@bunker/storage` qualifies, and the
 * anti-flicker boot path depends on it: nothing asynchronous can land before the
 * first paint.
 */
export interface SyncDriver extends Driver {
  readonly sync: true;
  deleteSync(key: string): void;
  getSync<T = unknown>(key: string): T | null;
  setSync<T = unknown>(key: string, value: T): void;
}

export declare const DRIVER_METHODS: readonly ['clear', 'delete', 'get', 'keys', 'set'];
export declare const DRIVER_METHODS_SYNC: readonly ['deleteSync', 'getSync', 'setSync'];

export declare function isDriver(value: unknown): value is Driver;
export declare function isSyncDriver(value: unknown): value is SyncDriver;

/** Returns `value` when it satisfies {@link Driver}, throws a `TypeError` naming the missing methods otherwise. */
export declare function assertDriver(value: unknown, label?: string): Driver;

/** In-memory reference driver. Also the fallback whenever a backing store is unavailable. */
export declare function createMemoryDriver(): SyncDriver & { readonly size: number };

/**
 * Namespaces every key the driver sees. `clear()` drops only what the keyspace
 * owns, so several namespaces can share one backing store.
 * Passing {@link NO_KEYSPACE} returns the driver unwrapped.
 */
export declare function withKeyspace<T extends Driver>(driver: T, keyspace?: Keyspace): T;

}

// :::::: KEYS

export declare const SEPARATOR: ':';

export interface KeyspaceOptions {
  /** Defaults to `bunker`. */
  namespace?: string;
  /** Defaults to `1`. Bumping it orphans every existing entry at once. */
  version?: number;
}

export interface Keyspace {
  readonly namespace: string;
  readonly version: number;
  /** The full prefix, e.g. `aufbau:v2:`. */
  readonly prefix: string;

  encode(key: string): string;
  /** The bare key, or `null` when the key belongs to another keyspace. */
  decode(full: string): string | null;
  owns(full: string): boolean;
  /** `true` for keys of the same namespace at an older version — the sweep target after a bump. */
  stale(full: string): boolean;
}

export declare function createKeyspace(options?: KeyspaceOptions): Keyspace;

/** Identity keyspace. `withKeyspace()` short-circuits on it, so there is no wrapper overhead. */
export declare const NO_KEYSPACE: Keyspace;

export interface Codec<Encoded = unknown> {
  encode(value: unknown): Encoded;
  decode(encoded: Encoded): unknown;
}

/**
 * Bridges the gap between what a driver can hold and what the caller passes.
 * - `json` — the default; anything a string store can carry. Malformed entries read as `null` rather than throwing.
 * - `text` — for values that are already strings; skips the escaping JSON adds, which matters for the synchronous boot read.
 * - `none` — for drivers with native structured clone.
 */
export declare const codecs: {
  json: Codec<string>;
  text: Codec<string>;
  none: Codec<unknown>;
};

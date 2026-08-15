// @bunker/db

import type { Driver } from '@bunker/core';

export interface TableSchema {
  autoIncrement?: boolean;
  /** Index names. Each becomes an index on the property of the same name. */
  indexes?: string[];
  keyPath?: string | string[];
}

export type Schema = Record<string, TableSchema>;

/** Reachable as `db.<table>.<method>()`. Any other property reads as a key lookup. */
export interface Table<T = any> {
  clear(): Promise<void>;
  count(range?: IDBKeyRange | IDBValidKey): Promise<number>;
  delete(key: IDBValidKey): Promise<void>;
  entries(prefix?: string): Promise<Array<[IDBValidKey, T]>>;
  find(index: string, value: IDBValidKey): Promise<T[]>;
  get(key: IDBValidKey): Promise<T | null>;
  getAll(prefix?: string): Promise<Record<string, T>>;
  has(key: IDBValidKey): Promise<boolean>;
  keys(prefix?: string): Promise<IDBValidKey[]>;
  set(key: IDBValidKey, value: T): Promise<void>;
  toggle(key: IDBValidKey): Promise<boolean>;
  /** Deletes the object store itself. */
  drop(): Promise<IDBDatabase>;

  [key: string]: any;
}

export declare class BunkerDB {
  constructor(dbName?: string);

  static isSupported(): boolean;

  readonly name: string;
  readonly tables: string[];
  /** `null` until the first connection. Every schema change bumps it by one. */
  readonly version: number | null;

  /** Tables are created on first touch, so this resolves even for a store that did not exist. */
  [table: string]: any;

  // :::::: engine

  /**
   * Runs `callback` inside a transaction. The callback either returns an
   * `IDBRequest`, whose result is collected automatically, or calls `collect()`
   * itself for cursor walks.
   *
   * Settlement waits for `tx.oncomplete`, not the request's `onsuccess`: in a
   * readwrite transaction the request succeeds before the transaction commits, so
   * resolving early would report a write as done that a later abort still undoes.
   */
  task<T = unknown>(
    table: string,
    mode: IDBTransactionMode,
    callback: (store: IDBObjectStore, collect: (value: T) => void, reject: (error: unknown) => void) => IDBRequest | void,
  ): Promise<T>;

  // :::::: schema

  /**
   * Creates missing tables and indexes. Idempotent — calling it on every page load
   * does not bump the version, which is what makes it safe at boot.
   */
  setup(schema: Schema): Promise<IDBDatabase>;
  dropTable(table: string): Promise<IDBDatabase>;
  close(): void;
  /** Closes and deletes the database. */
  destroy(): Promise<boolean>;

  // :::::: operations

  clear(...tables: string[]): Promise<void>;
  count(table: string, range?: IDBKeyRange | IDBValidKey): Promise<number>;
  delete(table: string, key: IDBValidKey): Promise<void>;
  /** Entries whose string key starts with `prefix`, as a bound range scan — no index needed. */
  entries<T = unknown>(table: string, prefix?: string): Promise<Array<[IDBValidKey, T]>>;
  find<T = unknown>(table: string, index: string, value: IDBValidKey): Promise<T[]>;
  /** `null` on a miss, where IndexedDB itself answers `undefined`. */
  get<T = unknown>(table: string, key: IDBValidKey): Promise<T | null>;
  getAll<T = unknown>(table: string, prefix?: string): Promise<Record<string, T>>;
  has(table: string, key: IDBValidKey): Promise<boolean>;
  keys(table: string, prefix?: string): Promise<IDBValidKey[]>;
  set<T = unknown>(table: string, key: IDBValidKey, value: T): Promise<void>;
  /** Reads and writes in one transaction, so two tabs cannot interleave between them. */
  toggle(table: string, key: IDBValidKey): Promise<boolean>;

  /**
   * A `@bunker/core` driver over a single table, so `@bunker/policy` can use this as
   * an L2 without importing `@bunker/db` itself.
   */
  driver(table?: string): Driver;
}

export declare function createDb(dbName?: string): BunkerDB;

export declare function createDbDriver(options?: { name?: string; table?: string }): Driver;

export default BunkerDB;

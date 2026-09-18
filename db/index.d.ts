// @bunker/db

import type { Driver } from '@bunker/core';

export interface TableSchema {
  autoIncrement?: boolean;
  /** Index names. Each becomes an index on the property of the same name. */
  indexes?: string[];
  keyPath?: string | string[];
}

export type Schema = Record<string, TableSchema>;

/**
 * A key prefix (`'css:'`), or criteria matched against each record's own properties
 * (`{ author: 'ada' }`). Criteria use strict equality on every key; a stored value
 * that is not a record can never match, so primitives kept next to records are
 * skipped rather than throwing. When one criteria key has an index, that index
 * narrows the scan.
 */
export type Spec = string | Record<string, unknown>;

/** What a listener is handed. No value is shipped — re-read what you need. */
export interface Change {
  /** `null` for `destroy`, which takes the whole database. */
  table: string | null;
  type: 'set' | 'delete' | 'clear' | 'drop' | 'destroy';
  /** The keys touched. Empty for `clear` / `drop` / `destroy`. */
  keys: IDBValidKey[];
  /** The instance that wrote it. Compare with `db.origin` to skip your own writes. */
  origin: string;
}

export type ChangeHandler = (change: Change) => void;
/** Call to stop listening. */
export type Unsubscribe = () => void;

/** Reachable as `db.<table>.<method>()`. Any other property reads as a key lookup. */
export interface Table<T = any> {
  clear(): Promise<void>;
  count(spec?: Spec | IDBKeyRange | IDBValidKey): Promise<number>;
  delete(key: IDBValidKey): Promise<void>;
  deleteMany(keys: Iterable<IDBValidKey>): Promise<void>;
  get(spec: IDBValidKey | Record<string, unknown>): Promise<T | null>;
  has(spec?: Spec | IDBValidKey): Promise<boolean>;
  onChange(handler: ChangeHandler): Unsubscribe;
  set(key: IDBValidKey, value: T): Promise<void>;
  setMany(entries: Iterable<[IDBValidKey, T]> | Record<string, T>): Promise<void>;
  toggle(key: IDBValidKey): Promise<boolean>;

  toEntries(spec?: Spec): Promise<Array<[IDBValidKey, T]>>;
  toKeys(spec?: Spec): Promise<IDBValidKey[]>;
  toMap(spec?: Spec): Promise<Record<string, T>>;
  toValues(spec?: Spec): Promise<T[]>;

  /** @deprecated use `toMap` */
  getAll(prefix?: string): Promise<Record<string, T>>;
  /** @deprecated use `toKeys` */
  keys(prefix?: string): Promise<IDBValidKey[]>;
  /** @deprecated use `toEntries` */
  entries(prefix?: string): Promise<Array<[IDBValidKey, T]>>;
  /** @deprecated use `toValues({ [index]: value })` */
  find(index: string, value: IDBValidKey): Promise<T[]>;

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
  /** Identifies this instance in every change it emits. */
  readonly origin: string;

  /** Tables are created on first write, so this resolves even for a store that did not exist. */
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
   *
   * A `readonly` task on a table that does not exist resolves to `undefined` without
   * creating it. This is the raw engine: it does not emit a change, so a write made
   * through it is invisible to `onChange`.
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
  count(table: string, spec?: Spec | IDBKeyRange | IDBValidKey): Promise<number>;
  delete(table: string, key: IDBValidKey): Promise<void>;
  /** One transaction for the whole batch, and one change for the whole batch. */
  deleteMany(table: string, keys: Iterable<IDBValidKey>): Promise<void>;
  /** By key, or the first record matching criteria. `null` on a miss. */
  get<T = unknown>(table: string, spec: IDBValidKey | Record<string, unknown>): Promise<T | null>;
  has(table: string, spec?: Spec | IDBValidKey): Promise<boolean>;
  set<T = unknown>(table: string, key: IDBValidKey, value: T): Promise<void>;
  /** One transaction for the whole batch, and one change for the whole batch. */
  setMany<T = unknown>(table: string, entries: Iterable<[IDBValidKey, T]> | Record<string, T>): Promise<void>;
  /** Reads and writes in one transaction, so two tabs cannot interleave between them. */
  toggle(table: string, key: IDBValidKey): Promise<boolean>;

  toEntries<T = unknown>(table: string, spec?: Spec): Promise<Array<[IDBValidKey, T]>>;
  toKeys(table: string, spec?: Spec): Promise<IDBValidKey[]>;
  toMap<T = unknown>(table: string, spec?: Spec): Promise<Record<string, T>>;
  toValues<T = unknown>(table: string, spec?: Spec): Promise<T[]>;

  /** @deprecated use `toMap` */
  getAll<T = unknown>(table: string, prefix?: string): Promise<Record<string, T>>;
  /** @deprecated use `toKeys` */
  keys(table: string, prefix?: string): Promise<IDBValidKey[]>;
  /** @deprecated use `toEntries` */
  entries<T = unknown>(table: string, prefix?: string): Promise<Array<[IDBValidKey, T]>>;
  /** @deprecated use `toValues({ [index]: value })` */
  find<T = unknown>(table: string, index: string, value: IDBValidKey): Promise<T[]>;

  // :::::: changes

  /**
   * `onChange(handler)` listens on every table, `onChange(table, handler)` on one.
   * Changes raised in the same turn are merged per table and type before delivery,
   * and reach every other tab through a `BroadcastChannel`.
   */
  onChange(handler: ChangeHandler): Unsubscribe;
  onChange(table: string | null, handler: ChangeHandler): Unsubscribe;

  /**
   * A `@bunker/core` driver over a single table, so `@bunker/policy` can use this as
   * an L2 without importing `@bunker/db` itself.
   */
  driver(table?: string): Driver;
}

export declare function createDb(dbName?: string): BunkerDB;
export declare function createDB(dbName?: string): BunkerDB;

export declare function createDbDriver(options?: { name?: string; table?: string }): Driver;

export default BunkerDB;

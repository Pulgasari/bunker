// @bunker/kit

import type * as core from '@bunker/core';
import type * as utils from '@bunker/utils';
import type { Cache } from '@bunker/cache';
import type { BunkerDB } from '@bunker/db';
import type { Policy } from '@bunker/policy';
import type { Storage } from '@bunker/storage';

export interface BunkerOptions {
  /** L1 entry ceiling for the policy layer. */
  max?: number;
  /** L2 entry ceiling for the policy layer, enforced by `policy.prune()`. */
  maxEntries?: number;
  /** Shared across every layer: IndexedDB name, Cache API name, storage keyspace. Defaults to `bunker`. */
  namespace?: string;
  onError?: (error: { error: unknown; key: string | null; operation: string }) => void;
  staleTtl?: number;
  /** IndexedDB table backing the policy layer. Defaults to `kv`. */
  table?: string;
  ttl?: number | null;
  version?: number;
}

export interface Bunker {
  readonly core: typeof core;
  readonly utils: typeof utils;
  readonly cache: Cache;
  readonly db: BunkerDB;
  /** TTL and eviction over an IndexedDB L2. */
  readonly policy: Policy;
  /** Synchronous, and the only layer readable before the first paint. */
  readonly local: Storage;
  readonly session: Storage;
}

/** Wires every package into one pre-configured namespace. */
export declare function createBunker(options?: BunkerOptions): Bunker;

/** Shared instance under the `bunker` namespace. */
export declare const bunker: Bunker;

export { createCache } from '@bunker/cache';
export { createDb } from '@bunker/db';
export { createPolicy } from '@bunker/policy';
export { createStorage } from '@bunker/storage';
export { core, utils };

export default bunker;

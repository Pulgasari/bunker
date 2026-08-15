// @bunker/utils

// :::::: channel.js

export interface Channel {
  readonly transport: 'broadcast-channel' | 'storage-event' | 'none';
  close(): void;
  post(message: unknown): void;
  subscribe(listener: (message: unknown) => void): () => void;
}

/** Cross-tab notification. Never delivers to the sender, whichever transport is used. */
export declare function createChannel(name: string): Channel;

// :::::: hash.js

/** A short, stable fingerprint of a string body. Not collision proof — see the source. */
export declare function contentHash(text: string): string;

// :::::: lazy.js

export interface Lazy<T> {
  (): T;
  clear(): void;
}

/** Runs the factory on first call and remembers the result. */
export declare function lazy<T>(factory: () => T): Lazy<T>;

// :::::: lru.js

export interface Lru<K = unknown, V = unknown> {
  readonly size: number;
  clear(): void;
  delete(key: K): boolean;
  get(key: K): V | undefined;
  has(key: K): boolean;
  keys(): IterableIterator<K>;
  set(key: K, value: V): V;
}

/** A bounded map whose iteration order is use order, oldest first. */
export declare function lru<K = unknown, V = unknown>(max?: number): Lru<K, V>;

// :::::: memoize.js

export interface MemoizeOptions<A extends unknown[]> {
  /** Derives the cache key from the arguments. Defaults to the first one. */
  key?: (...args: A) => unknown;
  /** Bounds the store as an LRU. `0` leaves it unbounded. */
  max?: number;
}

export interface Memoized<A extends unknown[], R> {
  (...args: A): R;
  cache: Map<unknown, R> | Lru<unknown, R>;
  clear(): void;
}

/** Caches by a key derived from the arguments. A rejected promise is dropped again. */
export declare function memoize<A extends unknown[], R>(
  callback: (...args: A) => R,
  options?: MemoizeOptions<A>,
): Memoized<A, R>;

// :::::: quota.js

export interface Estimate {
  quota: number;
  ratio: number;
  supported: boolean;
  usage: number;
}

export declare const quota: {
  estimate(): Promise<Estimate>;
  isPersisted(): Promise<boolean>;
  isSupported(): boolean;
  /** True when the origin is close enough to its quota that writes are at risk. */
  isUnderPressure(threshold?: number): Promise<boolean>;
  /** Asks the browser to exempt this origin from eviction. A `false` is normal. */
  persist(): Promise<boolean>;
};

// :::::: singleFlight.js

export interface SingleFlight {
  <T>(key: string, factory: () => T | Promise<T>): Promise<T>;
  abort(key: string): boolean;
  clear(): void;
  has(key: string): boolean;
  size(): number;
}

/** One pending promise per key, so concurrent misses collapse into a single call. */
export declare function createSingleFlight(): SingleFlight;

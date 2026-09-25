// @bunker/opfs

import type { Driver } from '@bunker/core';

export type OpfsOperation = 'clear' | 'delete' | 'entries' | 'file' | 'get' | 'keys' | 'open' | 'set';

export interface OpfsError {
  error: unknown;
  key: string | null;
  operation: OpfsOperation;
}

export interface OpfsSuccess {
  /** `{ hit }` for `get`, `{ removed }` for `clear`. */
  detail?: { hit?: boolean; removed?: number } | null;
  key: string | null;
  operation: OpfsOperation;
}

export interface OpfsOptions {
  /** Directory below the OPFS root, `/` nests. Created on first use. Defaults to `bunker`. */
  directory?: string;
  /** Called when an operation fails. A missing key is a miss, not an error. */
  onError?: (error: OpfsError) => void;
  onSuccess?: (success: OpfsSuccess) => void;
}

export interface OpfsEntry {
  key: string;
  lastModified: number;
  /** Bytes on disk, the container header included for non-binary values. */
  size: number;
}

/** A value stored as is. Everything else is kept as JSON with its binary parts appended. */
export type Binary = Blob | ArrayBuffer | ArrayBufferView;

export interface Opfs {
  /** The directory path below the OPFS root. */
  readonly directory: string;

  clear(): Promise<boolean>;
  delete(key: string): Promise<boolean>;
  /** A @bunker/core driver over this directory, e.g. the l2 of `@bunker/policy`. */
  driver(): Driver;
  entries(prefix?: string): Promise<OpfsEntry[]>;
  /** The stored file itself, `null` when missing. */
  file(key: string): Promise<File | null>;
  /**
   * Binary values come back as a `File`, blobs inside other values as slices of it.
   * Both are backed by the file on disk and become unreadable once the key is written again.
   */
  get<T = unknown>(key: string): Promise<T | File | null>;
  has(key: string): Promise<boolean>;
  isSupported(): boolean;
  keys(prefix?: string): Promise<string[]>;
  /** The directory handle, `null` without OPFS. */
  open(): Promise<FileSystemDirectoryHandle | null>;
  set(key: string, value: Binary | unknown): Promise<boolean>;
  /** Bytes on disk, summed over the stored files. */
  size(prefix?: string): Promise<number>;
}

export function createOpfs(options?: OpfsOptions): Opfs;
export function isSupported(): boolean;
export default createOpfs;

// @bunker/opfs
// @ts-self-types="./index.d.ts"

/*
  the origin private file system: files the origin owns outright, no picker, no
  prompt. one store is one directory, one key is one file in it.

  bytes (Blob, File, ArrayBuffer, a typed array) are written as they are, so the
  directory holds real files that any opfs explorer can open. everything else is
  wrapped in a small container: a json header with the binary parts appended
  after it. that is what lets @bunker/policy keep { at, expire, value: Blob }
  entries here without base64 or a second store.

  reading never copies: get() hands back the File, or slices of it, both backed
  by the file on disk. such a File goes stale once its key is written again, so
  read what you need before overwriting.
*/

const BINARY      = '$bunker:binary';
const MAGIC       = new Uint8Array([0x42, 0x55, 0x4e, 0x4b, 0x45, 0x52, 0x00, 0x01]); // "BUNKER" 0 1
const HEADER      = MAGIC.length + 4;                                                  // magic, uint32 header length
const SWAP        = /\.crswap$/;                                                       // chrome's pending write, not an entry
const textEncoder = new TextEncoder();

const isSupported = () => typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function';
const isBinary    = (val) => val instanceof Blob || val instanceof ArrayBuffer || ArrayBuffer.isView(val);
const isNotFound  = (err) => err?.name === 'NotFoundError';

// names stay readable: '%' '/' '\\' controls and '.' '..' escaped
const escape = (c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0').toUpperCase();
const toName = (k) => { const n = String(k).replace(/[%/\\\x00-\x1f]/g, escape); return n === '.' || n === '..' ? n.replace(/\./g, escape) : n; };
const toKey  = (n) => { try { return decodeURIComponent(n); } catch { return n; } };

// :::::: CONTAINER :::::::::::::::::::::::::::::::::::::::::::::

function pack (value) {
  const parts = [];
  let offset  = 0;

  const valueJson = JSON.stringify(value, (_k, item) => {
    if (!isBinary(item)) return item;
    const blob = item instanceof Blob ? item : new Blob([item]);
    parts.push({ blob, offset, size: blob.size, type: blob.type });
    offset += blob.size;
    return { [BINARY]: parts.length - 1 };
  }) ?? 'null';

  const partsJson = JSON.stringify(parts.map(p => [p.offset, p.size, p.type]));
  const header    = textEncoder.encode(`{"parts":${partsJson},"value":${valueJson}}`);
  const prefix    = new Uint8Array(HEADER);
  prefix.set(MAGIC);
  new DataView(prefix.buffer).setUint32(MAGIC.length, header.length, true);

  return new Blob([prefix, header, ...parts.map(p => p.blob)]);
}

async function isPacked (file) {
  if (file.size < HEADER) return false;
  const head = new Uint8Array(await file.slice(0, MAGIC.length).arrayBuffer());
  return MAGIC.every((b, i) => head[i] === b);
}

async function unpack (file) {
  const length = new DataView(await file.slice(MAGIC.length, HEADER).arrayBuffer()).getUint32(0, true);
  const { parts, value } = JSON.parse(await file.slice(HEADER, HEADER + length).text());
  const start = HEADER + length;

  const revive = (item) => {
    if (Array.isArray(item)) return item.map(revive);
    if (!item || typeof item !== 'object') return item;
    if (BINARY in item) {
      const [off, size, type] = parts[item[BINARY]];
      return file.slice(start + off, start + off + size, type);
    }
    for (const k of Object.keys(item)) item[k] = revive(item[k]);
    return item;
  };

  return revive(value);
}

// write strategy wrapper
async function write (handle, data) {
  if (typeof handle.createWritable === 'function') {
    const w = await handle.createWritable();
    await w.write(data);
    return w.close();
  }

  if (typeof handle.createSyncAccessHandle === 'function') {
    const access = await handle.createSyncAccessHandle();
    try     { access.truncate(0); access.write(new Uint8Array(await new Blob([data]).arrayBuffer()), { at: 0 }); access.flush(); }
    finally { access.close(); }
    return;
  }

  throw new Error('[bunker] this browser can only write to the opfs from a worker');
}

// :::::: STORE :::::::::::::::::::::::::::::::::::::::::::::::::

function createOPFS (options = {}) {
  let opened = null;
  const { directory = 'bunker', onError = null, onSuccess = null } = options;
  const segments = String(directory).split('/').filter(Boolean);
  const done     = (operation, key, detail = null) => onError ? null : onSuccess?.({ detail, key, operation });
  const fail     = (operation, key, error)         => onError?.({ error, key, operation });

  /** execution boundary helper handling dir resolution and error boundaries */
  async function guard (operation, key, fn, fallback = false, ignoreNotFound = false) {
    const dir = await open();
    if (!dir) return fallback;

    try {
      const [result, detail] = await fn(dir);
      done(operation, key, detail);
      return result;
    }
    catch (error) {
      if (!ignoreNotFound || !isNotFound(error)) fail(operation, key, error);
      return fallback;
    }
  }

  /** directory handle memoized on first access */
  function open () {
    if (!isSupported()) return Promise.resolve(null);
    return opened ??= (async () => {
      let handle = await navigator.storage.getDirectory();
      for (const seg of segments) handle = await handle.getDirectoryHandle(seg, { create: true });
      return handle;
    })().catch(err => { fail('open', directory, err); opened = null; return null; });
  }

  /** generator yielding valid [key, handle] pairs */
  async function* iterateFiles (prefix = '') {
    const dir = await open(); if (!dir) return;

    for await (const [name, handle] of dir.entries()) {
      if (handle.kind === 'file' && !SWAP.test(name)) {
        const key = toKey(name);
        if (key.startsWith(prefix)) yield [key, handle];
      }
    }
  }

  const file = (key) => guard('file', key, async (dir) => [
    await (await dir.getFileHandle(toName(key))).getFile()
  ], null, true);

  const get = async (key) => {
    const found = await file(key);
    if (!found) { done('get', key, { hit: false }); return null; }

    return guard('get', key, async () => [
      await isPacked(found) ? await unpack(found) : found,
      { hit: true }
    ], null);
  };

  const set = (key, val) => guard('set', key, async (dir) => {
    await write(await dir.getFileHandle(toName(key), { create: true }), isBinary(val) ? val : pack(val));
    return [true];
  });

  const remove = (key) => guard('delete', key, async (dir) => {
    await dir.removeEntry(toName(key));
    return [true];
  }, false, true);

  const has = async (key) => (await file(key)) !== null;

  const entries = (prefix = '') => guard('entries', prefix, async () => [
    await Array.fromAsync(iterateFiles(prefix), async ([key, handle]) => {
      const { lastModified, size } = await handle.getFile();
      return { key, lastModified, size };
    })
  ], []);

  const keys = (prefix = '') => guard('keys', prefix, async () => [
    await Array.fromAsync(iterateFiles(prefix), ([key]) => key)
  ], []);

  const size = async (prefix = '') => (await entries(prefix)).reduce((acc, entry) => acc + entry.size, 0);

  const clear = () => guard('clear', directory, async (dir) => {
    const names = [];
    for await (const name of dir.keys()) names.push(name);
    for       (const name of names)      await dir.removeEntry(name, { recursive: true });
    return [true, { removed: names.length }];
  });

  // :::::: DRIVER :::::::::::::::::::::::::::::::::::::::::::::::

  const driver = () => ({
    name   : `opfs:${segments.join('/')}`,
    sync   : false,
    clear  : ()           => clear().then(() => undefined),
    delete : (key)        => remove(key).then(() => undefined),
    get    : (key)        => get(key),
    keys   : (prefix)     => keys(prefix),
    set    : async (key, val) => { if (!await set(key, val)) throw new Error(`[bunker] could not write "${key}" to the opfs`); },
  });

  return {
    directory: segments.join('/'),
    delete: remove,
    clear, driver, entries, file, get, has, isSupported, keys, open, set, size,
  };
}

// :::::: ALIASES & EXPORTS

const createOpfs = createOPFS;

export { createOPFS, isSupported };
export default createOPFS;

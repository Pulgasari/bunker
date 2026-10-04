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
const isBinary    = (value) => value instanceof Blob || value instanceof ArrayBuffer || ArrayBuffer.isView(value);
const isNotFound  = (error) => error?.name === 'NotFoundError';

// only what a file name cannot hold is escaped, so names stay readable in an
// explorer: '%', '/', '\\', control characters, and the names '.' and '..'
const escape = (char) => '%' + char.charCodeAt(0).toString(16).padStart(2, '0').toUpperCase();
const toName = (key)  => { const name = String(key).replace(/[%/\\\x00-\x1f]/g, escape); return name === '.' || name === '..' ? name.replace(/\./g, escape) : name; };
const toKey  = (name) => { try { return decodeURIComponent(name); } catch { return name; } };

// :::::: CONTAINER :::::::::::::::::::::::::::::::::::::::::::::

function pack (value) {
  const parts = [];
  let offset  = 0;

  const valueJson = JSON.stringify(value, (_key, item) => {
    if (!isBinary(item)) return item;
    const blob = item instanceof Blob ? item : new Blob([item]);
    parts.push({ blob, offset, size: blob.size, type: blob.type });
    offset += blob.size;
    return { [BINARY]: parts.length - 1 };
  }) ?? 'null';

  const partsJson = JSON.stringify(parts.map(({ offset, size, type }) => [offset, size, type]));
  const header    = textEncoder.encode(`{"parts":${partsJson},"value":${valueJson}}`);

  const prefix = new Uint8Array(HEADER);
  prefix.set(MAGIC);
  new DataView(prefix.buffer).setUint32(MAGIC.length, header.length, true);

  return new Blob([prefix, header, ...parts.map(part => part.blob)]);
}

async function isPacked (file) {
  if (file.size < HEADER) return false;
  const head = new Uint8Array(await file.slice(0, MAGIC.length).arrayBuffer());
  return MAGIC.every((byte, index) => head[index] === byte);
}

async function unpack (file) {
  const length = new DataView(await file.slice(MAGIC.length, HEADER).arrayBuffer()).getUint32(0, true);
  const { parts, value } = JSON.parse(await file.slice(HEADER, HEADER + length).text());
  const start = HEADER + length;

  const revive = (item) => {
    if (Array.isArray(item)) return item.map(revive);
    if (!item || typeof item !== 'object') return item;
    if (BINARY in item) {
      const [offset, size, type] = parts[item[BINARY]];
      return file.slice(start + offset, start + offset + size, type);
    }
    for (const key of Object.keys(item)) item[key] = revive(item[key]);
    return item;
  };

  return revive(value);
}

// createWritable is missing on older safari outside a worker. inside one the
// sync access handle is always there
async function write (handle, data) {
  if (typeof handle.createWritable === 'function') {
    const writable = await handle.createWritable();
    await writable.write(data);
    await writable.close();
    return;
  }

  if (typeof handle.createSyncAccessHandle === 'function') {
    const bytes  = new Uint8Array(await new Blob([data]).arrayBuffer());
    const access = await handle.createSyncAccessHandle();
    try     { access.truncate(0); access.write(bytes, { at: 0 }); access.flush(); }
    finally { access.close(); }
    return;
  }

  throw new Error('[bunker] this browser can only write to the opfs from a worker');
}

// :::::: STORE :::::::::::::::::::::::::::::::::::::::::::::::::

function createOPFS (options = {}) {
  const { directory = 'bunker', onError = null, onSuccess = null } = options;
  const segments = String(directory).split('/').filter(Boolean);
  const fail     = (operation, key, error)         => { onError?.({ error, key, operation }); };
  const done     = (operation, key, detail = null) => { onSuccess?.({ detail, key, operation }); };
  let opened = null;

  /** the directory handle, created on first use. null without opfs */
  function open () {
    if (!isSupported()) return Promise.resolve(null);
    return opened ??= (async () => {
      let handle = await navigator.storage.getDirectory();
      for (const segment of segments) handle = await handle.getDirectoryHandle(segment, { create: true });
      return handle;
    })().catch(error => { fail('open', directory, error); opened = null; return null; });
  }

  /** generator yielding valid [key, handle] pairs matching prefix */
  async function* iterateFiles (prefix = '') {
    const dir = await open();
    if (!dir) return;

    for await (const [name, handle] of dir.entries()) {
      if (handle.kind !== 'file' || SWAP.test(name)) continue;
      const key = toKey(name);
      if (key.startsWith(prefix)) yield [key, handle];
    }
  }

  /** the stored file itself, null when missing */
  async function file (key) {
    const dir = await open(); if (!dir) return null;
    try {
      const handle = await dir.getFileHandle(toName(key));
      return await handle.getFile();
    }
    catch (error) {
      if (!isNotFound(error)) fail('file', key, error);
      return null;
    }
  }

  /** bytes come back as a File, everything else as it was stored */
  async function get (key) {
    const found = await file(key);
    if (!found) { done('get', key, { hit: false }); return null; }

    try {
      const value = await isPacked(found) ? await unpack(found) : found;
      done('get', key, { hit: true });
      return value;
    }
    catch (error) { fail('get', key, error); return null; }
  }

  async function set (key, value) {
    const dir = await open(); if (!dir) return false;
    try {
      const handle = await dir.getFileHandle(toName(key), { create: true });
      await write(handle, isBinary(value) ? value : pack(value));
      done('set', key);
      return true;
    }
    catch (error) { fail('set', key, error); return false; }
  }

  async function remove (key) {
    const dir = await open(); if (!dir) return false;
    try {
      await dir.removeEntry(toName(key));
      done('delete', key);
      return true;
    }
    catch (error) {
      if (!isNotFound(error)) fail('delete', key, error);
      return false;
    }
  }

  const has = async (key) => (await file(key)) !== null;

  /** { key, lastModified, size } per stored file */
  async function entries (prefix = '') {
    const list = [];
    try {
      for await (const [key, handle] of iterateFiles(prefix)) {
        const { lastModified, size } = await handle.getFile();
        list.push({ key, lastModified, size });
      }
    }
    catch (error) { fail('entries', prefix, error); }
    return list;
  }

  async function keys (prefix = '') {
    const list = [];
    try {
      for await (const [key] of iterateFiles(prefix)) {
        list.push(key);
      }
    }
    catch (error) { fail('keys', prefix, error); }
    return list;
  }

  /** bytes on disk, summed over the stored files */
  const size = async (prefix = '') => (await entries(prefix)).reduce((total, entry) => total + entry.size, 0);

  // empties the directory but keeps it, so the cached handle stays valid
  async function clear () {
    const dir = await open(); if (!dir) return false;
    try {
      const names = [];
      for await (const name of dir.keys()) names.push(name);
      for       (const name of names)      await dir.removeEntry(name, { recursive: true });
      done('clear', directory, { removed: names.length });
      return true;
    }
    catch (error) { fail('clear', directory, error); return false; }
  }

  // :::::: DRIVER :::::::::::::::::::::::::::::::::::::::::::::::

  /** a @bunker/core driver, e.g. the l2 of @bunker/policy */
  function driver () {
    return {
      name   : `opfs:${segments.join('/')}`,
      sync   : false,
      clear  : ()           => clear().then(() => undefined),
      delete : (key)        => remove(key).then(() => undefined),
      get    : (key)        => get(key),
      keys   : (prefix)     => keys(prefix),
      set    : async (key, value) => { if (!await set(key, value)) throw new Error(`[bunker] could not write "${key}" to the opfs`); },
    };
  }

  return {
    directory : segments.join('/'),
    delete    : remove,
    clear, driver, entries, file, get, has, isSupported, keys, open, set, size,
  };
}

// :::::: ALIASES

const createOpfs = createOPFS;

// :::::: EXPORT

export { createOPFS, isSupported };
export default createOPFS;

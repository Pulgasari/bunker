// @bunker/db
// @ts-self-types="./index.d.ts"

/*
naming inside the idb plumbing, kept short because it repeats constantly:
- os = objectStore
- rq = request
- tx = transaction

RANGE_END:
highest code unit, the upper bound of a prefix range scan. 
keys are strings and indexeddb sorts them lexicographically, 
so a prefix scan is a plain bound range and needs no separate index.

TABLE_API:
every method reachable as db.<table>.<method>(). 
anything not listed here is read as a key,
so a method left out would silently turn into a lookup.
*/

// :::::: CONSTANTS

const RANGE_END = '￿';
const TABLE_API = ['clear', 'count', 'delete', 'entries', 'find', 'get', 'getAll', 'getAllByCriteria', 'getByCriteria', 'has', 'keys', 'onChange', 'set', 'toggle'];       

// :::::: HELPERS

const isFn     = sth => typeof sth === 'function';
const isRecord = sth => typeof sth === 'object';
const isString = sth => typeof sth === 'string';
const isSymbol = sth => typeof sth === 'symbol';

// strict equality on every criteria key. non-objects can never match, so
// primitives stored next to records are skipped instead of throwing.
const matchesCriteria = (value, criteria) => {
  if (!value || typeof value !== 'object') return false;
  for (const [key, expected] of Object.entries(criteria)) if (value[key] !== expected) return false;
  return true;
};

// :::::: MAIN

export class BunkerDB {

  #db = null; 
  #dbName; 
  #queue  = Promise.resolve(); 
  #tables = new Set;

  static isSupported () { return typeof indexedDB !== 'undefined'; }

  constructor (dbName = 'bunker') {
    this.#dbName = dbName;

    return new Proxy(this, {
      get: (target, prop) => {
        // symbols pass straight through
        if (typeof prop === 'symbol') return target[prop];
        // without this, awaiting the proxy would treat it as a thenable
        if (prop === 'then') return undefined;
        // bind class methods to the real target, otherwise private fields are unreachable
        if (prop in target) {
          const value = target[prop];
          return typeof value === 'function' ? value.bind(target) : value;
        }
        // anything else names a table
        return this.#createTableProxy(prop);
      },
    });
  }

  get name    () { return this.#dbName; }
  get tables  () { return [...this.#tables]; }
  get version () { return this.#db?.version ?? null; } // null until the first connection. every schema change bumps it by one.

  // :::::: CONNECTION ::::::::::::::::::::::::::::::::::::::::::

  // serializes every connection change, so two callers cannot race into
  // overlapping open/upgrade cycles.
  #lock (fn) {
    const run   = this.#queue.then(fn, fn);
    this.#queue = run.catch(() => {});
    return run;
  }

  #syncTables (db) {
    this.#tables = new Set(db.objectStoreNames);
    // never block another tab's upgrade: drop our connection when it asks
    db.onversionchange = () => { db.close(); if (this.#db === db) this.#db = null; };
    return db;
  }

  // version=null opens at whatever version is on disk, which is the no-upgrade path.
  #open (version = null, upgrade = null) {
    if (!BunkerDB.isSupported()) return Promise.reject(new Error(`[bunker] indexedDB is unavailable, cannot open "${this.#dbName}"`));    
    if (this.#db) { this.#db.close(); this.#db = null; }

    return new Promise ((resolve, reject) => {
      const request = version ? indexedDB.open(this.#dbName, version) : indexedDB.open(this.#dbName);

      request.onupgradeneeded = (event) => upgrade?.(event.target.result, request.transaction);
      request.onsuccess       = ()      => resolve(this.#db = this.#syncTables(request.result));
      request.onerror         = ()      => reject(request.error);
      request.onblocked       = ()      => reject(new Error(`[bunker] "${this.#dbName}": upgrade blocked by another connection`));
    });
  }

  #connect () { return this.#db ?? this.#open(); }

  async #getDB (table = null) {
    // fast path: connection is live and the store is already known
    if (this.#db && (!table || this.#tables.has(table))) return this.#db;

    return this.#lock(async () => {
      await this.#connect();
      // re-check inside the lock, a queued call may have created it already
      if (!table || this.#tables.has(table)) return this.#db;
      return this.#open(this.#db.version + 1, (db) => db.createObjectStore(table));
    });
  }

  #createTableProxy (table) {
    const api = TABLE_API.reduce((acc, method) => {
      acc[method] = (...args) => this[method](table, ...args);
      return acc;
    }, { drop: () => this.dropTable(table) });

    return new Proxy(api, {
      get : (target, key)        => key in target ? target[key] : this.get(table, key),
      set : (target, key, value) => { this.set(table, key, value); return true; },
    });
  }

  // :::::: ENGINE ::::::::::::::::::::::::::::::::::::::::::::::
  
  async task (table, mode, callback) {
    const db = await this.#getDB(table);

    return new Promise ((resolve, reject) => {
      let   value   = undefined;
      const tx      = db.transaction(table, mode);
      const collect = result => value = result;

      const request = callback(tx.objectStore(table), collect, reject);
      if (request instanceof IDBRequest) {
        request.onsuccess = () => collect (request.result);
        request.onerror   = () => reject  (request.error);
      }

      tx.oncomplete = () => resolve(value);
      tx.onabort    = () => reject(tx.error ?? new DOMException(`[bunker] "${table}" transaction aborted`, 'AbortError'));
      tx.onerror    = () => reject(tx.error);
    });
  }

  // :::::: SCHEMA ::::::::::::::::::::::::::::::::::::::::::::::

  async setup (schema) {
    return this.#lock(async () => {
      await this.#connect();
      if (!this.#needsUpgrade(schema)) return this.#db;

      return this.#open(this.#db.version + 1, (db, tx) => {
        for (const [name, options = {}] of Object.entries(schema)) {
          const store = db.objectStoreNames.contains(name)
            ? tx.objectStore(name)
            : db.createObjectStore(name, { autoIncrement: options.autoIncrement, keyPath: options.keyPath });

          options.indexes?.forEach(index => !store.indexNames.contains(index) && store.createIndex(index, index));
        }
      });
    });
  }

  // without this, calling setup() on every page load would bump the version every time.
  #needsUpgrade (schema) {
    const names = Object.keys(schema);
    if (names.some(name => !this.#tables.has(name))) return true;

    const indexed = names.filter(name => schema[name].indexes?.length);
    if (!indexed.length) return false;

    const tx = this.#db.transaction(indexed, 'readonly');
    return indexed.some(name => {
      const store = tx.objectStore(name);
      return schema[name].indexes.some(index => !store.indexNames.contains(index));
    });
  }

  async dropTable (table) {
    return this.#lock(async () => {
      await this.#connect();
      if (!this.#tables.has(table)) return this.#db;
      return this.#open(this.#db.version + 1, (db) => db.deleteObjectStore(table));
    });
  }

  close () {
    this.#db?.close();
    this.#db = null;
  }

  async destroy () {
    this.close();
    return this.#lock(() => new Promise ((resolve, reject) => {
      const request = indexedDB.deleteDatabase(this.#dbName);
      request.onsuccess = () => { this.#tables = new Set; resolve(true); };
      request.onerror   = () => reject(request.error);
      request.onblocked = () => reject(new Error(`[bunker] "${this.#dbName}": delete blocked by another connection`));
    }));
  }

  // :::::: OPERATIONS ::::::::::::::::::::::::::::::::::::::::::

  async clear  (...tables)     { for (const table of tables) await this.task(table, 'readwrite', os => os.clear()); }
  async count  (table, range)  { return this.task(table, 'readonly',  os => os.count(range)); }
  async delete (table, key)    { await this.task(table, 'readwrite', os => os.delete(key)); }
  async has    (table, key)    { return (await this.count(table, key)) > 0; }
  async set    (table, key, v) { await this.task(table, 'readwrite', os => os.put(v, key)); }
//async get    (table, key)    { return (await this.task(table, 'readonly', os => os.get(key))) ?? null; }

  async getByKey         (table, key)           { return (await this.task(table, 'readonly', os => os.get(key))) ?? null; }
  async getByCriteria    (table, criteria = {}) { const [hit] = await this.#scan(table, criteria, 1); return hit?.[1] ?? null; }
  async get (table, spec) {
    if (isString(spec)) return this.getByKey      (table, spec);
    if (isRecord(spec)) return this.getByCriteria (table, spec);
    return null;
  }

  async getAllByCriteria (table, criteria = {}) { return (await this.#scan(table, criteria)).map(([, value]) => value); }
  async getAllByPrefix   (table, prefix   = '') { return Object.fromEntries(await this.entries(table, prefix)); }

  async getAll (table, spec) {
    if (isString(spec)) return this.getAllByPrefix   (table, spec);
    if (isRecord(spec)) return this.getAllByCriteria (table, spec);
    return Object.fromEntries(await this.entries(table));
  }
    
  async keys (table, prefix = '') {
    const range = prefix ? IDBKeyRange.bound(prefix, prefix + RANGE_END) : undefined;
    return (await this.task(table, 'readonly', os => os.getAllKeys(range))) ?? [];
  }

  async entries (table, prefix = '') {
    const range = prefix ? IDBKeyRange.bound(prefix, prefix + RANGE_END) : undefined;

    return this.task(table, 'readonly', (os, collect, reject) => {
      const request = os.openCursor(range);
      const out     = [];

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          out.push([cursor.key, cursor.value]); 
          cursor.continue();
        }
        else collect(out);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async find (table, index, value) {
    return this.task(table, 'readonly', (os, collect, reject) => {
      const request = os.index(index).getAll(value);
      request.onsuccess = () => collect (request.result);
      request.onerror   = () => reject  (request.error);
    });
  }

  // reads and writes in one transaction, so two tabs cannot interleave between them
  async toggle (table, key) {
    return this.task(table, 'readwrite', (os, collect, reject) => {
      const read = os.get(key);

      read.onsuccess = () => {
        const next  = !read.result;
        const write = os.put(next, key);
        write.onsuccess = () => collect(next);
        write.onerror   = () => reject(write.error);
      };
      read.onerror = () => reject(read.error);
    });
  }

  // :::::: DRIVER :::::::::::::::::::::::::::::::::::::::::::::::

  // a @bunker/core driver over a single table, so @bunker/policy can use this as L2
  // without ever importing @bunker/db.
  driver (table = 'kv') {
    return {
      name   : `indexeddb:${this.#dbName}/${table}`,
      sync   : false,
      clear  : ()            => this.clear  (table),
      delete : (key)         => this.delete (table, key),
      get    : (key)         => this.get    (table, key),
      keys   : (prefix = '') => this.keys   (table, prefix),
      set    : (key, value)  => this.set    (table, key, value),
    };
  }
}

// :::::: EXPORT

export const
createDb = (name) => new BunkerDB (name),
createDB = (name) => new BunkerDB (name),
createDbDriver = ({ name = 'bunker', table = 'kv' } = {}) => createDB(name).driver(table);

export default BunkerDB;

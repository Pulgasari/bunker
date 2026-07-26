// @bunker

import { isSymbol } from './is.js';
import { storage } from './persistence.js';

/*

os = objectStore
rq = request
tx = transaction

-- parameters:
e = event
k = key
i = index
r = range
s = store
t = table OR ...tables
v = value

// 3. Range counting (Advanced)
// Count how many keys start between 'A' and 'M'
const range = IDBKeyRange.bound('A', 'M');
const count = await bunker.users.count(range);

*/


export class BunkerDB {
  #db; #dbName; #version; #tables = new Set();
  
  /*
  constructor(dbName) {
    this.#dbName  = dbName;
    this.storage  = storage[`_bunker_v_${this.#dbName}`];
    this.#version = parseInt(this.storage) || 1;
    this.#db      = null;

    return new Proxy(this, {
      get: (target, prop) => {
        if (prop in target || typeof prop === 'symbol') return target[prop];
        return this.#createTableProxy(prop);
      }
    });
  }
  */
  constructor(dbName) {
    this.#dbName  = dbName;
    this.storage  = storage[`_bunker_v_${this.#dbName}`];
    this.#version = parseInt(this.storage) || 1;
    this.#db      = null;
    
    return new Proxy(this, {
      get: (target, prop) => {
        // 1. Pass symbols straight through
        if (typeof prop === 'symbol') return target[prop];
        // 2. Prevent async/await from treating the Proxy as a Promise
        if (prop === 'then') return undefined;
        // 3. Bind class methods to the original target to preserve private field access
        if (prop in target) {
          const value = target[prop];
          return typeof value === 'function' ? value.bind(target) : value;
        }
        // 4. Dynamic table proxy fallback
        return this.#createTableProxy(prop);
      }
    });
  }

  // --- Internal Helpers ---
  #syncTables (db) {
    this.#tables = new Set(db.objectStoreNames);
    return db;
  }
  async #open( upgradeFn=null ) {
    if (this.#db) {
      this.#db.close();
      this.#db = null;
    }
    if (upgradeFn) this.#version++;

    return new Promise((resolve, reject) => {
      let rx = indexedDB.open( this.#dbName, this.#version );
      rx.onupgradeneeded = e => {
        let db = e.target.result;
        if (upgradeFn) upgradeFn(db, rx.transaction);
        this.#syncTables(db);
        this.storage = this.#version;
      };
      rx.onsuccess = () => { this.#db = this.#syncTables(rx.result); resolve(this.#db); };
      rx.onerror   = () => reject(rx.error);
    });
  }
  async #getDB ( table=null) {
    if (this.#db && (!table || this.#tables.has(table))) return this.#db;
    // Auto-create table if missing
    return this.#open( db => {
      if (table && !db.objectStoreNames.contains(table)) db.createObjectStore(table);
    });
  }
  #createTableProxy (table) {
    let api = ['get', 'set', 'has', 'count', 'delete', 'clear', 'getAll', 'find', 'toggle'];
    let proxyObj = api.reduce((acc, method) => {
      acc[method] = (...args) => this[method](table, ...args);
      return acc;
    }, { drop: () => this.dropTable(table) });

    return new Proxy( proxyObj, {
      get: (target, key) => key in target ? target[key] : this.get(table, key),
      set: (target, key, value) => { this.set(table, key, value); return true; }
    });
  }

  /**
   * The "Engine": Handles transactions and requests.
   */
  async task (table, mode, callback) {
    let db = await this.#getDB(table);
    return new Promise((resolve, reject) => {
      let tx = db.transaction(table, mode);
      let rx = callback( tx.objectStore(table), resolve, reject );
      if (rx instanceof IDBRequest) {
        rx.onsuccess = () => resolve(rx.result ?? true);
        rx.onerror   = () => reject(rx.error);
      }
      tx.oncomplete = () => resolve(true);
      tx.onerror    = () => reject(tx.error);
    });
  }
  // --- API Methods ---
  async setup (schema) {
    return this.#open((db, tx) => {
      for (let [name, opt] of Object.entries(schema)) {
        let store = db.objectStoreNames.contains(name) 
          ? tx.objectStore(name) 
          : db.createObjectStore(name, { keyPath: opt.keyPath, autoIncrement: opt.autoIncrement });
        
        opt.indexes?.forEach(i => !store.indexNames.contains(i) && store.createIndex(i, i));
      }
    });
  }
  async dropTable (table) {
    return this.#open( db => db.objectStoreNames.contains(table) && db.deleteObjectStore(table) );
  }
  // --- API Methods ---
  async clear  (...T)  { for (let table of T) await this.task(table, 'readwrite', s => s.clear()); }
  async has    (t,k)   { return (await this.count(t,k)) > 0; }
  async count  (t,r)   { return this.task( t, 'readonly',  s => s.count(r)  )}
  async delete (t,k)   { return this.task( t, 'readwrite', s => s.delete(k) )}
  async get    (t,k)   { return this.task( t, 'readonly',  s => s.get(k)    )}
  async set    (t,k,v) { return this.task( t, 'readwrite', s => s.put(v,k)  )}
  async toggle (t,k)   {
    return this.task(t, 'readwrite', (s, resolve, reject) => {
      let rx = s.get(k); // get current value
      rx.onsuccess = () => {
        let newValue   = !rx.result; // negate current value
        let putRequest = s.put(newValue, k);
        // resolve with the NEW value
        putRequest.onsuccess = () => resolve(newValue);
        putRequest.onerror   = () => reject(putRequest.error);
      };
      rx.onerror = () => reject(rx.error);
    });
  }
  //
  async getAll (t) {
    return this.task(t, 'readonly', (s, resolve) => {
      let req = s.openCursor(), res = {};
      req.onsuccess = e => {
        let cursor = e.target.result;
        if (cursor) { res[cursor.key] = cursor.value; cursor.continue(); }
        else resolve(res);
      };
    });
  }
  async find (t, idx, val) {
    return this.task(t, 'readonly', (s, resolve) => {
      let rx = s.index(idx).getAll(val);
      rx.onsuccess = () => resolve(rx.result);
    });
  }
}
export default BunkerDB;

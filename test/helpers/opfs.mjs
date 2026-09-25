// minimal in-memory origin private file system.
// node has File and Blob but no opfs, and the point of the opfs suite is our
// logic against that surface, not the browser's implementation of it.

const notFound = (name) => Object.assign(new Error(`${name} not found`), { name: 'NotFoundError' });

class FakeFileHandle {
  kind = 'file';
  #bytes = new Uint8Array;
  #modified = Date.now();

  constructor (name) { this.name = name; }

  async getFile () { return new File([this.#bytes], this.name, { lastModified: this.#modified }); }

  // writes land in a swap buffer and only replace the file on close, like the real one
  async createWritable () {
    const chunks = [];
    return {
      write : async (data) => { chunks.push(data); },
      close : async () => {
        this.#bytes    = new Uint8Array(await new Blob(chunks).arrayBuffer());
        this.#modified = Date.now();
      },
    };
  }
}

class FakeDirectoryHandle {
  kind = 'directory';
  #children = new Map;

  constructor (name = '') { this.name = name; }

  async getDirectoryHandle (name, { create = false } = {}) { return this.#child(name, create, FakeDirectoryHandle); }
  async getFileHandle      (name, { create = false } = {}) { return this.#child(name, create, FakeFileHandle); }

  #child (name, create, Kind) {
    const found = this.#children.get(name);
    if (found) {
      if (!(found instanceof Kind)) throw Object.assign(new Error(`${name} is of another kind`), { name: 'TypeMismatchError' });
      return found;
    }
    if (!create) throw notFound(name);
    const made = new Kind(name);
    this.#children.set(name, made);
    return made;
  }

  async removeEntry (name) {
    if (!this.#children.delete(name)) throw notFound(name);
  }

  async * entries () { yield * [...this.#children]; }
  async * keys    () { yield * [...this.#children.keys()]; }
}

export function installOpfs () {
  const root = new FakeDirectoryHandle;
  Object.defineProperty(globalThis.navigator, 'storage', {
    configurable : true,
    value        : { getDirectory: async () => root },
  });
  return root;
}

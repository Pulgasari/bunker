// @bunker/utils/lru.js

// a bounded map whose iteration order is use order: reading a key moves it to the
// end, so the first key is always the one to drop next.
export const lru = (max = 100) => {
  const store = new Map;

  return {
    get size () { return store.size; },
    clear  : ()  => store.clear  (),
    delete : key => store.delete (key),
    has    : key => store.has    (key),
    keys   : ()  => store.keys   (),

    get (key) {
      if (!store.has(key)) return undefined;
      const value = store.get(key);
      store.delete(key);
      store.set(key, value);
      return value;
    },

    set (key, value) {
      if (store.has(key)) store.delete(key);
      else if (store.size >= max) store.delete(store.keys().next().value);
      store.set(key, value);
      return value;
    }
  };
};

export default lru;

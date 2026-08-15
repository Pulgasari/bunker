// @bunker/utils/memoize.js

import { lru } from './lru.js';

/*
  caches by a key derived from the arguments, the first one by default.

  a rejected promise is dropped again, so a failed call is retried rather than
  remembered forever. a resolved one stays, which is what makes this usable as a
  once-per-session loader.
*/
export const memoize = (callback, { key = (...args) => args[0], max = 0 } = {}) => {
  const store = max > 0 ? lru(max) : new Map;

  const memoized = (...args) => {
    const cacheKey = key(...args);
    if (store.has(cacheKey)) return store.get(cacheKey);

    const value = callback(...args);
    store.set(cacheKey, value);
    if (value instanceof Promise) value.catch(() => store.delete(cacheKey));
    return value;
  };

  memoized.cache = store;
  memoized.clear = () => store.clear();
  return memoized;
};

export default memoize;

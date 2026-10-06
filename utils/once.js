// @bunker/utils/once.js

// the first result of an async factory, shared by every caller: a cache opened
// once, a directory created once. a rejection is not kept, the next call tries
// again. reset() forgets a result too, e.g. after the cache was deleted.
export const once = (factory) => {
  let pending = null;

  const run = () => pending ??= Promise.resolve().then(factory).catch(error => { pending = null; throw error; });

  run.reset = () => { pending = null; };
  return run;
};

export default once;

// @bunker/utils/singleFlight.js

// one pending promise per key. two concurrent misses must not both hit the network,
// which is exactly what the old AufbauCache did.
export function createSingleFlight () {
  const inflight = new Map;

  const run = (key, factory) => {
    const pending = inflight.get(key);
    if (pending) return pending;

    const promise = Promise.resolve().then(factory).finally(() => inflight.delete(key));
    inflight.set(key, promise);
    return promise;
  };

  run.has    = (key) => inflight.has(key);
  run.size   = ()    => inflight.size;
  run.abort  = (key) => inflight.delete(key);
  run.clear  = ()    => inflight.clear();

  return run;
}

export default createSingleFlight;

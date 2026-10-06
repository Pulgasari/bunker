// @bunker/core/report.js

/*
  how every store tells about its operations. onError gets { operation, key, error },
  onSuccess { operation, key, detail }. a store never throws at its caller, it
  reports and hands back a fallback: a failed write is false, a failed read null.

    const { attempt, over } = createReport({ onError, onSuccess });

    attempt('get', key, null, () => read(key));                     // sync or async
    attempt('get', key, null, () => read(key), { detail: hit });     // onSuccess gets hit(result)
    attempt('delete', key, false, () => drop(key), { quiet: isNotFound });

  `over(open)` binds the same to a resource that opens lazily, a cache or a
  directory: no resource is the fallback without a report, open() reported it.

    const op     = over(open);
    const remove = op('delete', false, { quiet: isNotFound })((dir, key) => dir.removeEntry(name(key)));
*/

export function createReport ({ onError = null, onSuccess = null } = {}) {
  const fail = (operation, key, error)         => { onError?.({ error, key, operation }); };
  const done = (operation, key, detail = null) => { onSuccess?.({ detail, key, operation }); };

  function attempt (operation, key, fallback, run, { detail = null, quiet = null } = {}) {
    const success = result => { done(operation, key, detail?.(result) ?? null); return result; };
    const failure = error  => { if (!quiet?.(error)) fail(operation, key, error); return fallback; };

    try {
      const result = run();
      return typeof result?.then === 'function' ? result.then(success, failure) : success(result);
    }
    catch (error) { return failure(error); }
  }

  // `key` names what is reported when the first argument is not the key (clear, keys)
  const over = open => (operation, fallback, options = {}) => run => async (...args) => {
    const resource = await open();
    if (!resource) return fallback;
    const key = options.key ? options.key(...args) : args[0];
    return attempt(operation, key ?? null, fallback, () => run(resource, ...args), options);
  };

  return { attempt, done, fail, over };
}

export default createReport;

// @bunker/utils/emitter.js

// listeners and the one way to reach them. subscribe() returns the unsubscribe
export const createEmitter = () => {
  const listeners = new Set;

  return {
    get size () { return listeners.size; },
    clear     : ()         => listeners.clear(),
    emit      : (...args)  => { for (const listener of listeners) listener(...args); },
    subscribe : (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
  };
};

export default createEmitter;

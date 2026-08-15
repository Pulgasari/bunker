// @bunker/utils
// @ts-self-types="./index.d.ts"

/*
  small in-process helpers, one file per thing, each importable on its own:

    import { lru } from '@bunker/utils/lru.js';

  the bar for living here: no i/o, and no value that survives a reload. anything
  that persists is a driver and belongs in a backend package.
*/

export { createChannel }   from './channel.js';
export { contentHash }     from './hash.js';
export { lazy }            from './lazy.js';
export { lru }             from './lru.js';
export { memoize }         from './memoize.js';
export { createSingleFlight } from './singleFlight.js';

export * as quota from './quota.js';

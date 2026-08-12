// @bunker/kit
// @ts-self-types="./index.d.ts"

/*
  the one place in this repo that wires the packages together. everything else
  depends on @bunker/core and nothing more, which is what keeps cache free of any
  knowledge about indexeddb, localStorage or the cache api.
*/

/*
import * as core          from '@bunker/core';
import { createCache }    from '@bunker/cache';
import { createDb }       from '@bunker/db';
import { createFiles }    from '@bunker/files';
import { createStorage }  from '@bunker/storage';
*/

import * as core          from './../core/index.js';
import { createCache }    from './../cache/index.js';
import { createDb }       from './../db/index.js';
import { createFiles }    from './../files/index.js';
import { createStorage }  from './../storage/index.js';

export function createBunker (options = {}) {
  const {
    max        = 0,
    maxEntries = 0,
    namespace  = 'bunker',
    onError    = null,
    staleTtl   = 0,
    table      = 'kv',
    ttl        = null,
    version    = 1,
  } = options;

  const db    = createDb(namespace);
  const files = createFiles({ name: namespace, onError });

  const shared = { namespace, onError, version };

  return {
    core, db, files,

    // ttl and eviction over an indexeddb l2
    cache : createCache({ ...shared, driver: db.driver(table), max, maxEntries, staleTtl, ttl }),

    // synchronous, and the only layer readable before the first paint
    local   : createStorage({ ...shared, area: 'local'   }),
    session : createStorage({ ...shared, area: 'session' }),
  };
}

export { createCache, createDb, createFiles, createStorage, core };

export const bunker = createBunker();
export default bunker;

// @bunker/core
// @ts-self-types="./index.d.ts"

export {
  DRIVER_METHODS,
  DRIVER_METHODS_SYNC,
  assertDriver,
  asyncDriver,
  createMemoryDriver,
  isDriver,
  isSyncDriver,
  withKeyspace,
} from './driver.js';

export { NO_KEYSPACE, SEPARATOR, codecs, createKeyspace } from './keys.js';
export { proxyOf }                                        from './proxy.js';
export { createReport }                                   from './report.js';

// @bunker/core/quota.js

// indexeddb and the cache api share one origin quota, and under disk pressure the
// browser evicts whole origins by least-recent-use. persist() opts out of that.
// localStorage is not covered by any of this.

const manager = () => globalThis.navigator?.storage ?? null;

export const isSupported = () => Boolean(manager()?.estimate);

export async function estimate () {
  const storage = manager();
  if (!storage?.estimate) return { quota: 0, ratio: 0, supported: false, usage: 0 };

  try {
    const { quota = 0, usage = 0 } = await storage.estimate();
    return { quota, ratio: quota ? usage / quota : 0, supported: true, usage };
  } catch {
    return { quota: 0, ratio: 0, supported: false, usage: 0 };
  }
}

// asks the browser to exempt this origin from eviction. safari and firefox may
// prompt or decide by engagement heuristics, so a false is normal, not an error.
export async function persist () {
  const storage = manager();
  if (!storage?.persist) return false;
  try   { return await storage.persist(); }
  catch { return false; }
}

export async function isPersisted () {
  const storage = manager();
  if (!storage?.persisted) return false;
  try   { return await storage.persisted(); }
  catch { return false; }
}

// true when the origin is close enough to its quota that writes are at risk.
export async function isUnderPressure (threshold = 0.9) {
  const { ratio, supported } = await estimate();
  return supported && ratio >= threshold;
}

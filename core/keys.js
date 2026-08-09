// @bunker/core/keys.js

export const SEPARATOR = ':';

// a keyspace turns a bare key into a namespaced, versioned one:
//   createKeyspace({ namespace: 'aufbau', version: 2 }).encode('css/app.ass')
//   -> 'aufbau:v2:css/app.ass'
// bumping the version orphans every old entry at once, which is what a deploy needs.
export function createKeyspace ({ namespace = 'bunker', version = 1 } = {}) {
  const root   = namespace + SEPARATOR;
  const prefix = `${root}v${version}${SEPARATOR}`;

  return {
    namespace, version, prefix,

    encode : (key)  => prefix + key,
    decode : (full) => full.startsWith(prefix) ? full.slice(prefix.length) : null,
    owns   : (full) => full.startsWith(prefix),
    // same namespace, older version. the sweep target after a version bump.
    stale  : (full) => full.startsWith(root) && !full.startsWith(prefix),
  };
}

// identity keyspace. withKeyspace() short-circuits on it, so an unnamespaced
// driver carries no wrapper overhead at all.
export const NO_KEYSPACE = {
  namespace : '',
  version   : 0,
  prefix    : '',

  encode : (key)  => key,
  decode : (full) => full,
  owns   : ()     => true,
  stale  : ()     => false,
};

// :::::: CODECS ::::::::::::::::::::::::::::::::::::::::::::::::

// drivers differ in what they can hold: localStorage takes strings only,
// indexeddb takes anything structured-cloneable. the codec bridges that gap.
export const codecs = {

  // default. survives everything a string store can hold.
  json: {
    encode : (value) => JSON.stringify(value),
    decode : (text)  => {
      if (typeof text !== 'string') return null;
      try   { return JSON.parse(text); }
      catch { return null; } // a hand-edited or truncated entry must read as a miss, not throw
    },
  },

  // for values that are already strings. skips the quoting and escaping json adds,
  // which matters for the boot path: that reads a whole stylesheet synchronously.
  text: {
    encode : (value) => typeof value === 'string' ? value : String(value),
    decode : (text)  => typeof text === 'string' ? text : null,
  },

  // for drivers with native structured clone. nothing to do.
  none: {
    encode : (value) => value,
    decode : (value) => value ?? null,
  },
};

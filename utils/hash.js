// @bunker/utils/hash.js

/*
  a short, stable fingerprint of a string body.

  not a checksum and not collision proof — it exists so a cache can tell "the source
  changed" from "the source is the same" where the server offers no validator at all:
  file://, a Pages host without ETag, a generated response. Where an ETag or
  Last-Modified is available, a conditional request beats this, because it costs no
  body at all.
*/
export const contentHash = (text) =>
  [...text].reduce((sum, char) => Math.imul(31, sum) + char.charCodeAt(0) | 0, 0).toString(36);

export default contentHash;

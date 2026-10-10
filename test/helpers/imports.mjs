// resolves @bunker/* to the local sources, through the "imports" of the root
// deno.json, the one map deno check / lint use too. node has no importmap, so
// the suites load this first: node --import ./test/helpers/imports.mjs …
// exact keys win, then the longest prefix key (ending in /).

import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

const root    = new URL('../../', import.meta.url);
const imports = JSON.parse(readFileSync(new URL('deno.json', root), 'utf8')).imports ?? {};
const keys    = Object.keys(imports).sort((a, b) => b.length - a.length);

const mapped = specifier => {
  if (imports[specifier]) return imports[specifier];
  const key = keys.find(key => key.endsWith('/') && specifier.startsWith(key));
  return key ? imports[key] + specifier.slice(key.length) : null;
};

registerHooks({
  resolve (specifier, context, next) {
    const target = mapped(specifier);
    return next(target ? new URL(target, root).href : specifier, context);
  },
});

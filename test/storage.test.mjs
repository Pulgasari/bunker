import assert from 'node:assert/strict';
import { codecs } from '@bunker/core';
import { createStorage } from '@bunker/storage';

const expectPersistent = process.env.EXPECT_PERSISTENT === '1';

const store = createStorage({ namespace: 'aufbau', version: 2 });
assert.equal(store.persistent, expectPersistent, `persistent should be ${expectPersistent}`);
assert.equal(store.sync, true);

// :::::: sync core
assert.equal(store.getSync('missing'), null);
assert.equal(store.getSync('missing', 'fallback'), 'fallback');
assert.equal(store.setSync('theme', 'oled'), true);
assert.equal(store.getSync('theme'), 'oled');
assert.equal(store.hasSync('theme'), true);
assert.equal(store.getSync('theme', 'fallback'), 'oled');

store.setSync('config', { nested: { list: [1, 2] } });
assert.deepEqual(store.getSync('config').nested.list, [1, 2]);

// a stored null reads as absent; hasSync tells them apart
store.setSync('nulled', null);
assert.equal(store.getSync('nulled', 'fallback'), 'fallback');
assert.equal(store.hasSync('nulled'), true);

// :::::: namespacing + isolation
const other = createStorage({ namespace: 'docs', version: 1 });
other.setSync('theme', 'classic');
assert.equal(store.getSync('theme'), 'oled', 'namespaces must not collide');
assert.deepEqual(store.keysSync().sort(), ['config', 'nulled', 'theme']);

// :::::: clear stays inside the keyspace
store.clearSync();
assert.deepEqual(store.keysSync(), []);
assert.equal(other.getSync('theme'), 'classic', 'clear must not touch a foreign namespace');

// :::::: sweep drops older versions of the same namespace only
const v1 = createStorage({ namespace: 'aufbau', version: 1 });
v1.setSync('legacy', 'old');
v1.setSync('legacy2', 'old');
const v2 = createStorage({ namespace: 'aufbau', version: 2 });
v2.setSync('fresh', 'new');

assert.equal(v2.sweepSync(), 2, 'both v1 entries should be swept');
assert.equal(v2.getSync('fresh'), 'new', 'current version must survive its own sweep');
assert.equal(v1.getSync('legacy'), null);
assert.equal(other.getSync('theme'), 'classic', 'sweep must not touch a foreign namespace');

// :::::: codec: text skips json escaping
const css = createStorage({ codec: codecs.text, namespace: 'css' });
const sheet = 'body { content: "a\\"b"; }';
css.setSync('app.ass', sheet);
assert.equal(css.getSync('app.ass'), sheet, 'text codec must round-trip verbatim');

// :::::: subscribe sees local writes
const seen = [];
const off  = store.subscribe(change => seen.push(change));
store.setSync('theme', 'zombie');
store.deleteSync('theme');
off();
store.setSync('theme', 'ignored');

assert.deepEqual(seen, [
  { key: 'theme', source: 'local', value: 'zombie' },
  { key: 'theme', source: 'local', value: null },
], 'subscribe must report local writes and stop after unsubscribe');

// :::::: proxy sugar
const proxy = store.proxy;
proxy.skin = 'monochrome';
assert.equal(store.getSync('skin'), 'monochrome');
assert.equal(proxy.skin, 'monochrome');
assert.equal('skin' in proxy, true);
assert.equal('nope' in proxy, false);
assert.ok(Object.keys(proxy).includes('skin'));
delete proxy.skin;
assert.equal(store.getSync('skin'), null);
assert.equal(store.proxy, proxy, 'proxy must be memoised');

// :::::: onError receives failures instead of throwing
const errors = [];
const guarded = createStorage({ namespace: 'guard', onError: e => errors.push(e.operation) });
const circular = {}; circular.self = circular;
assert.equal(guarded.setSync('bad', circular), false, 'a failed write returns false');
assert.deepEqual(errors, ['set']);

// :::::: session area is a separate store
const tab = createStorage({ area: 'session', namespace: 'aufbau' });
tab.setSync('theme', 'session-only');
assert.equal(tab.getSync('theme'), 'session-only');

store.clearSync(); other.clearSync(); v2.clearSync(); css.clearSync(); tab.clearSync();
store.dispose(); other.dispose(); v1.dispose(); v2.dispose(); css.dispose(); tab.dispose();

console.log(`storage: all assertions passed (persistent: ${store.persistent})`);

import assert from 'node:assert/strict';
import { installOpfs } from './helpers/opfs.mjs';
import { isDriver } from '@bunker/core';

const { createOpfs } = await import('@bunker/opfs');
const { createPolicy } = await import('@bunker/policy');

// :::::: without opfs every call is a quiet miss
{
  const store = createOpfs({ directory: 'none' });
  assert.equal(store.isSupported(), false);
  assert.equal(await store.get('k'), null);
  assert.equal(await store.set('k', 1), false);
  assert.deepEqual(await store.keys(), []);
}

const root = installOpfs();

// :::::: bytes are stored as they are and come back as a File
{
  const store = createOpfs({ directory: 'app/thumbs' });
  const image = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/webp' });

  assert.equal(await store.set('a1b2@250.webp', image), true);
  const file = await store.get('a1b2@250.webp');
  assert.ok(file instanceof File);
  assert.deepEqual([...new Uint8Array(await file.arrayBuffer())], [1, 2, 3, 4]);

  // a real file in a real nested directory, readable by anything else
  const dir = await (await root.getDirectoryHandle('app')).getDirectoryHandle('thumbs');
  const raw = await (await dir.getFileHandle('a1b2@250.webp')).getFile();
  assert.equal(raw.size, 4, 'no container around plain bytes');

  await store.set('buffer', new Uint8Array([9, 8]).buffer);
  assert.deepEqual([...new Uint8Array(await (await store.get('buffer')).arrayBuffer())], [9, 8]);
}

// :::::: everything else round trips, binary parts included
{
  const store = createOpfs({ directory: 'values' });

  for (const value of [42, 'text', true, null, [1, 'two'], { nested: { deep: [1, { x: 'y' }] } }]) {
    await store.set('v', value);
    assert.deepEqual(await store.get('v'), value);
  }

  const blob = new Blob(['hello'], { type: 'text/plain' });
  await store.set('entry', { at: 1, list: [new Uint8Array([7]), blob], value: blob });
  const entry = await store.get('entry');

  assert.equal(entry.at, 1);
  assert.equal(await entry.value.text(), 'hello');
  assert.equal(entry.value.type, 'text/plain', 'a part keeps its type');
  assert.deepEqual([...new Uint8Array(await entry.list[0].arrayBuffer())], [7]);
  assert.equal(await entry.list[1].text(), 'hello');
}

// :::::: keys, entries, size, delete, clear
{
  const store = createOpfs({ directory: 'listing' });
  await store.set('img:1', new Blob(['aa']));
  await store.set('img:2', new Blob(['bbb']));
  await store.set('meta', { n: 1 });
  await store.set('.', 'dot');

  assert.deepEqual((await store.keys()).sort(), ['.', 'img:1', 'img:2', 'meta']);
  assert.deepEqual((await store.keys('img:')).sort(), ['img:1', 'img:2']);
  assert.equal(await store.get('.'), 'dot', 'a key that is not a valid file name still works');

  await store.set('a/b%c', 1);
  assert.equal(await store.get('a/b%c'), 1);
  assert.ok((await store.keys()).includes('a/b%c'), 'escaped names decode back to their key');
  await store.delete('a/b%c');
  assert.equal(await store.size('img:'), 5);
  assert.deepEqual((await store.entries('img:')).map(entry => entry.size).sort(), [2, 3]);

  assert.equal(await store.has('meta'), true);
  assert.equal(await store.delete('meta'), true);
  assert.equal(await store.delete('meta'), false, 'deleting a missing key is not an error');
  assert.equal(await store.has('meta'), false);

  assert.equal(await store.clear(), true);
  assert.deepEqual(await store.keys(), []);
  await store.set('after', 1);
  assert.equal(await store.get('after'), 1, 'the directory survives clear()');
}

// :::::: errors reach onError, a miss does not
{
  const errors = [];
  const store  = createOpfs({ directory: 'errors', onError: (report) => errors.push(report.operation) });
  assert.equal(await store.get('missing'), null);
  assert.deepEqual(errors, []);
}

// :::::: as the l2 of a policy, blobs and all
{
  const store  = createOpfs({ directory: 'policy' });
  const driver = store.driver();
  assert.ok(isDriver(driver));
  assert.equal(driver.name, 'opfs:policy');

  const cache = createPolicy({ driver, ttl: 60_000 });
  await cache.set('thumb', new Blob(['pixels'], { type: 'image/webp' }));

  const fresh = createPolicy({ driver, ttl: 60_000 });   // empty l1, reads through to the opfs
  const value = await fresh.get('thumb');
  assert.equal(await value.text(), 'pixels');
  assert.equal(value.type, 'image/webp');
  assert.deepEqual(await fresh.keys(), ['thumb']);
}

console.log('opfs: ok');

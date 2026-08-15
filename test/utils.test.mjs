import assert from 'node:assert/strict';
import { contentHash, createChannel, createSingleFlight, lazy, lru, memoize, quota } from '@bunker/utils';

// :::::: single flight
const once = createSingleFlight();
let calls  = 0;
const slow = () => new Promise(resolve => setTimeout(() => { calls++; resolve('v'); }, 10));
const [a, b] = await Promise.all([once('k', slow), once('k', slow)]);
assert.equal(calls, 1, 'concurrent misses must collapse');
assert.equal(a, b);
assert.equal(once.size(), 0, 'entry must be released after settle');
await once('k', slow);
assert.equal(calls, 2, 'a later call must run again');

let failed = 0;
await once('bad', () => { throw new Error('boom'); }).catch(() => failed++);
assert.equal(failed, 1, 'a sync throw must reject, not escape');
assert.equal(once.size(), 0, 'a rejection must not poison the slot');

// :::::: lazy
let built = 0;
const once5 = lazy(() => { built++; return undefined; });
assert.equal(once5(), undefined);
assert.equal(once5(), undefined);
assert.equal(built, 1, 'the factory runs once even when it returns undefined');
once5.clear();
assert.equal(once5(), undefined);
assert.equal(built, 2, 'clear() lets it run again');

// :::::: lru
const cache = lru(2);
cache.set('a', 1);
cache.set('b', 2);
cache.get('a');                 // touching 'a' makes 'b' the oldest
cache.set('c', 3);
assert.equal(cache.has('b'), false, 'the least recently used entry is dropped');
assert.deepEqual([...cache.keys()], ['a', 'c']);
assert.equal(cache.size, 2);

// :::::: memoize
let ran = 0;
const double = memoize((n) => { ran++; return n * 2; });
assert.equal(double(21), 42);
assert.equal(double(21), 42);
assert.equal(ran, 1, 'a hit must not call through');
double.clear();
assert.equal(double(21), 42);
assert.equal(ran, 2);

const keyed = memoize((a, b) => a + b, { key: (a, b) => `${a}:${b}` });
assert.equal(keyed(1, 2), 3);
assert.equal(keyed(2, 1), 3);
assert.equal(keyed.cache.size, 2, 'the key function decides identity');

let attempts = 0;
const flaky = memoize(async () => { attempts++; throw new Error('nope'); });
await flaky('k').catch(() => {});
await flaky('k').catch(() => {});
assert.equal(attempts, 2, 'a rejected promise must not stay cached');

// :::::: content hash
assert.equal(contentHash('a{}'), contentHash('a{}'), 'same input, same fingerprint');
assert.notEqual(contentHash('a{}'), contentHash('a{ }'));
assert.match(contentHash('a{}'), /^-?[0-9a-z]+$/, 'base36');

// :::::: quota + channel degrade instead of throwing
assert.equal(typeof (await quota.estimate()).supported, 'boolean');
assert.equal(await quota.persist(), false);
const channel = createChannel('smoke');
channel.post({ hello: 1 });
channel.close();

console.log('utils: all assertions passed');

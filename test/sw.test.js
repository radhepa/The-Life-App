'use strict';
// Exercises sw.js against a mocked Cache API and network.  Run: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const BASE = 'https://user.github.io/Focus/';
const SRC = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');

function resp(body, { ok = true, type = 'basic' } = {}) {
  return { body, ok, type, clone() { return resp(body, { ok, type }); } };
}

// Builds a fresh worker with fake caches/fetch; returns handles to poke at it.
function boot({ fetchImpl } = {}) {
  const handlers = {};
  const stores = new Map();                       // cache name -> Map(url -> response)
  const abs = u => new URL(typeof u === 'string' ? u : u.url, BASE).href;
  const noSearch = u => abs(u).split('?')[0];
  const cacheApi = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const m = stores.get(name);
      return {
        async add(u) {
          const r = await sandbox.fetch(abs(u));
          if (!r.ok) throw new Error('bad status');
          m.set(abs(u), r);
        },
        async put(req, r) { m.set(abs(req), r); },
        async keys() { return [...m.keys()].map(url => ({ url })); },
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(n) { return stores.delete(n); },
    async match(req, opts = {}) {
      for (const m of stores.values()) {
        for (const [k, v] of m) {
          if ((opts.ignoreSearch ? k.split('?')[0] === noSearch(req) : k === abs(req))) return v;
        }
      }
      return undefined;
    },
  };
  const sandbox = {
    self: {
      location: { origin: new URL(BASE).origin },
      addEventListener: (t, fn) => { handlers[t] = fn; },
      skipWaiting: async () => {},
      clients: { claim: async () => {} },
    },
    caches: cacheApi,
    fetch: fetchImpl || (async () => resp('net')),
    Response: { error: () => resp('error', { ok: false, type: 'error' }) },
    URL, Promise, setTimeout, clearTimeout,
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  const fire = (type, req) => {
    let waited = Promise.resolve(), responded;
    handlers[type]({
      request: req,
      waitUntil: p => { waited = p; },
      respondWith: p => { responded = Promise.resolve(p); },
    });
    return { waited, responded };
  };
  return { fire, stores, sandbox, cacheApi };
}

const get = url => ({ method: 'GET', url: new URL(url, BASE).href });

test('install caches the shell and survives a missing file', async () => {
  const { fire, stores } = boot({
    fetchImpl: async u => (u.includes('sync.js') ? resp('', { ok: false }) : resp('ok:' + u)),
  });
  await fire('install').waited;
  const cached = [...stores.get('focus-v1').keys()];
  assert.ok(cached.some(u => u.endsWith('radhe-labs-focus.html')));
  assert.ok(cached.some(u => u.endsWith('manifest.webmanifest')));
  assert.ok(!cached.some(u => u.endsWith('sync.js')), 'failed file is skipped, not fatal');
});

test('activate removes old cache versions', async () => {
  const { fire, stores, cacheApi } = boot();
  await cacheApi.open('focus-v0'); await cacheApi.open('focus-v1');
  await fire('activate').waited;
  assert.deepEqual([...stores.keys()], ['focus-v1']);
});

test('online: serves the network copy and refreshes the cache', async () => {
  const { fire, cacheApi } = boot({ fetchImpl: async () => resp('fresh') });
  const r = await fire('fetch', get('radhe-labs-focus.html')).responded;
  assert.equal(r.body, 'fresh');
  await new Promise(res => setImmediate(res));
  assert.equal((await cacheApi.match(get('radhe-labs-focus.html'))).body, 'fresh');
});

test('offline: falls back to the cached copy', async () => {
  let online = true;
  const { fire } = boot({ fetchImpl: async () => { if (!online) throw new TypeError('offline'); return resp('v1'); } });
  await fire('fetch', get('radhe-labs-focus.html')).responded;    // primes the cache
  await new Promise(res => setImmediate(res));
  online = false;
  const r = await fire('fetch', get('radhe-labs-focus.html?x=1')).responded;   // query string ignored
  assert.equal(r.body, 'v1');
});

test('offline navigation to an unknown URL falls back to the app page', async () => {
  let online = true;
  const { fire } = boot({ fetchImpl: async u => { if (!online) throw new TypeError('offline'); return resp('app:' + (u.url || u)); } });
  await fire('fetch', get('radhe-labs-focus.html')).responded;
  await new Promise(res => setImmediate(res));
  online = false;
  const r = await fire('fetch', get('somewhere-else')).responded;
  assert.match(r.body, /radhe-labs-focus\.html/);
});

test('slow network: serves the cache instead of waiting', async () => {
  let slow = false;
  const { fire } = boot({
    fetchImpl: async () => (slow ? new Promise(res => setTimeout(() => res(resp('late')), 6000)) : resp('cached-copy')),
  });
  await fire('fetch', get('radhe-labs-focus.html')).responded;
  await new Promise(res => setImmediate(res));
  slow = true;
  const t0 = Date.now();
  const r = await fire('fetch', get('radhe-labs-focus.html')).responded;
  assert.equal(r.body, 'cached-copy');
  assert.ok(Date.now() - t0 < 5000, 'returned at the timeout, not when the network finally answered');
});

test('ignores non-GET requests and other origins (sync API stays untouched)', () => {
  const { fire } = boot();
  assert.equal(fire('fetch', { method: 'PUT', url: BASE + 'x' }).responded, undefined);
  assert.equal(fire('fetch', { method: 'GET', url: 'https://api.github.com/repos/a/b/contents/c' }).responded, undefined);
});

test('fonts are cached on first use and then served from cache', async () => {
  let calls = 0;
  const { fire } = boot({ fetchImpl: async () => { calls++; return resp('font', { type: 'opaque', ok: false }); } });
  const req = { method: 'GET', url: 'https://fonts.gstatic.com/s/lora.woff2' };
  await fire('fetch', req).responded;
  await new Promise(res => setImmediate(res));
  const again = await fire('fetch', req).responded;
  assert.equal(again.body, 'font');
  assert.equal(calls, 1, 'second request came from the cache');
});

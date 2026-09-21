'use strict';
// Two simulated devices syncing through a mock of the GitHub contents API.
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../sync-core.js');

/* ── mock GitHub ─────────────────────────────────────────────────────────── */
function mockGitHub(opts = {}) {
  const gh = { file: null, commits: [], puts: 0, gets: 0, conditionalGets: 0, online: true, tokenValid: true,
    isPrivate: opts.isPrivate !== false, bigOver: opts.bigOver || Infinity, beforePut: null, seq: 0 };
  const res = (status, body, headers = {}) => {
    const h = {}; Object.keys(headers).forEach(k => { h[k.toLowerCase()] = headers[k]; });
    return { status, ok: status >= 200 && status < 300, headers: { get: k => (h[k.toLowerCase()] === undefined ? null : h[k.toLowerCase()]) },
      json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
  };
  gh.fetch = async (url, o = {}) => {
    if (!gh.online) throw new TypeError('Failed to fetch');
    const u = new URL(url), method = o.method || 'GET', h = o.headers || {};
    if (!gh.tokenValid) return res(401, { message: 'Bad credentials' });
    if (u.pathname === '/repos/me/data' && method === 'GET') return res(200, { private: gh.isPrivate, permissions: { push: true } });
    if (u.pathname === '/repos/nobody/none') return res(404, { message: 'Not Found' });
    if (u.pathname === '/repos/me/data/contents/focus-data.json') {
      if (method === 'GET') {
        gh.gets++;
        if (!gh.file) return res(404, { message: 'Not Found' });
        if (h['If-None-Match']) { gh.conditionalGets++; if (h['If-None-Match'] === gh.file.etag) return res(304, null); }
        if ((h.Accept || '').includes('raw')) return res(200, gh.file.text);
        const big = gh.file.text.length > gh.bigOver;
        return res(200, { sha: gh.file.sha, size: gh.file.text.length, encoding: big ? 'none' : 'base64',
          content: big ? '' : Buffer.from(gh.file.text).toString('base64') }, { ETag: gh.file.etag });
      }
      if (method === 'PUT') {
        gh.puts++;
        const body = JSON.parse(o.body);
        if (gh.beforePut) { const f = gh.beforePut; gh.beforePut = null; f(); }
        if (gh.file && body.sha !== gh.file.sha) return res(body.sha ? 409 : 422, { message: 'conflict' });
        gh.seq++;
        gh.file = { sha: 'sha' + gh.seq, etag: '"etag' + gh.seq + '"', text: Buffer.from(body.content, 'base64').toString('utf8') };
        gh.commits.push(body.message);
        return res(gh.seq === 1 ? 201 : 200, { content: { sha: gh.file.sha } });
      }
    }
    return res(404, { message: 'Not Found' });
  };
  gh.remoteData = () => (gh.file ? core.parseEnvelope(gh.file.text).data : null);
  return gh;
}

/* ── simulated device ────────────────────────────────────────────────────── */
let clock = 1000;
function device(gh, name, initial = {}) {
  const store = new Map();
  const dev = { name, store, states: [], applied: 0,
    db: Object.assign({ classes: [], assignments: [], sessions: [], diary: [], stickies: [], journeys: [], exams: [],
      settings: { goal: 120 }, loads: 1, savedAt: 0 }, initial) };
  dev.engine = core.createEngine({
    fetch: gh.fetch, now: () => ++clock, deviceName: name,
    storage: { get: k => (store.has(k) ? store.get(k) : null), set: (k, v) => store.set(k, v), del: k => store.delete(k) },
    getLocal: () => ({ content: core.contentOf(dev.db), savedAt: dev.db.savedAt || 0 }),
    applyContent: (c, t) => {
      dev.applied++;
      const keep = {}; core.DEVICE_KEYS.forEach(k => { if (k in dev.db) keep[k] = dev.db[k]; });
      dev.db = Object.assign({}, c, keep); dev.db.savedAt = t;
    },
    onState: s => dev.states.push(s.status),
  });
  dev.edit = fn => { fn(dev.db); dev.db.savedAt = ++clock; dev.engine.markPending(); };
  dev.titles = () => dev.db.assignments.map(a => a.title).sort();
  return dev;
}
const task = (id, title, extra) => Object.assign({ id, title, done: false }, extra);
const CONNECT = ['me/data', 'tok'];

test('connect refuses a public repo, a missing repo and a bad token', async () => {
  const gh = mockGitHub({ isPrivate: false });
  const d = device(gh, 'Laptop');
  await assert.rejects(d.engine.connect(...CONNECT), /public/);
  await assert.rejects(d.engine.connect('nobody/none', 't'), /not found|no access/);
  await assert.rejects(d.engine.connect('not a repo', 't'), /owner\/name/);
  gh.isPrivate = true; gh.tokenValid = false;
  await assert.rejects(d.engine.connect(...CONNECT), /rejected/);
  assert.equal(d.engine.getState().connected, false, 'a failed connect leaves nothing configured');
});

test('first device publishes its data; a fresh second device adopts it wholesale', async () => {
  const gh = mockGitHub();
  const laptop = device(gh, 'Laptop', { assignments: [task('a', 'Lab report'), task('b', 'Essay')], classes: [{ id: 'c1', name: 'Chem' }] });
  await laptop.engine.connect(...CONNECT);
  assert.equal(laptop.engine.getState().status, 'ok');
  assert.equal(gh.remoteData().assignments.length, 2);
  assert.ok(gh.commits[0].startsWith('sync from Laptop'));

  const phone = device(gh, 'iPhone');
  await phone.engine.connect(...CONNECT);
  assert.deepEqual(phone.titles(), ['Essay', 'Lab report']);
  assert.equal(phone.db.classes[0].name, 'Chem');
  assert.equal(gh.puts, 1, 'adopting the cloud copy pushes nothing');
});

test('device-only state never reaches the cloud', async () => {
  const gh = mockGitHub();
  const laptop = device(gh, 'Laptop', { assignments: [task('a', 'x')], active: { id: 'running-timer' }, loads: 42 });
  await laptop.engine.connect(...CONNECT);
  const remote = gh.remoteData();
  assert.equal('active' in remote, false); assert.equal('loads' in remote, false); assert.equal('savedAt' in remote, false);
  const phone = device(gh, 'iPhone', { loads: 3 });
  await phone.engine.connect(...CONNECT);
  assert.equal(phone.db.loads, 3, 'device keys survive an apply');
  assert.equal(phone.db.active, undefined);
});

test('changes made on both devices between syncs both survive', async () => {
  const gh = mockGitHub();
  const laptop = device(gh, 'Laptop', { assignments: [task('a', 'Shared')] });
  await laptop.engine.connect(...CONNECT);
  const phone = device(gh, 'iPhone'); await phone.engine.connect(...CONNECT);

  laptop.edit(db => db.assignments.push(task('l1', 'Added on laptop')));
  phone.edit(db => db.assignments.push(task('p1', 'Added on phone')));
  phone.edit(db => { db.assignments.find(a => a.id === 'a').done = true; });

  await laptop.engine.syncNow('change');     // pushes laptop's change
  await phone.engine.syncNow('change');      // must merge, not overwrite
  await laptop.engine.syncNow('poll');       // laptop picks up the phone's work

  for (const d of [laptop, phone]) {
    assert.deepEqual(d.titles(), ['Added on laptop', 'Added on phone', 'Shared']);
    assert.equal(d.db.assignments.find(a => a.id === 'a').done, true);
  }
  assert.deepEqual(gh.remoteData().assignments.map(a => a.id).sort(), ['a', 'l1', 'p1']);
});

test('a deletion on one device reaches the other', async () => {
  const gh = mockGitHub();
  const laptop = device(gh, 'Laptop', { assignments: [task('a', 'Keep'), task('b', 'Delete me')] });
  await laptop.engine.connect(...CONNECT);
  const phone = device(gh, 'iPhone'); await phone.engine.connect(...CONNECT);
  laptop.edit(db => { db.assignments = db.assignments.filter(a => a.id !== 'b'); });
  await laptop.engine.syncNow('change');
  await phone.engine.syncNow('poll');
  assert.deepEqual(phone.titles(), ['Keep']);
});

test('an unchanged sync uses a conditional request and pushes nothing', async () => {
  const gh = mockGitHub();
  const laptop = device(gh, 'Laptop', { assignments: [task('a', 'x')] });
  await laptop.engine.connect(...CONNECT);
  await laptop.engine.syncNow('poll');       // first poll learns the etag
  const puts = gh.puts, before = gh.conditionalGets;
  await laptop.engine.syncNow('poll');
  await laptop.engine.syncNow('poll');
  assert.equal(gh.puts, puts, 'no writes when nothing changed');
  assert.equal(gh.conditionalGets - before, 2, 'polls are cheap conditional requests');
  assert.equal(laptop.engine.getState().status, 'ok');
});

test('a conflict during the push is retried and both sides still merge', async () => {
  const gh = mockGitHub();
  const laptop = device(gh, 'Laptop', { assignments: [task('a', 'Shared')] });
  await laptop.engine.connect(...CONNECT);
  const phone = device(gh, 'iPhone'); await phone.engine.connect(...CONNECT);

  laptop.edit(db => db.assignments.push(task('l1', 'Laptop task')));
  phone.edit(db => db.assignments.push(task('p1', 'Phone task')));
  // the phone pushes in the middle of the laptop's sync, so the laptop's PUT hits a stale hash
  gh.beforePut = () => {
    const env = core.parseEnvelope(gh.file.text);
    env.data.assignments.push(task('p1', 'Phone task'));
    gh.seq++; gh.file = { sha: 'sha' + gh.seq, etag: '"e' + gh.seq + '"', text: core.makeEnvelope(env.data, { savedAt: ++clock, device: 'iPhone' }) };
  };
  await laptop.engine.syncNow('change');
  assert.equal(laptop.engine.getState().status, 'ok');
  assert.deepEqual(gh.remoteData().assignments.map(a => a.id).sort(), ['a', 'l1', 'p1']);
  assert.deepEqual(laptop.titles(), ['Laptop task', 'Phone task', 'Shared']);
});

test('offline: local data is untouched and the next sync catches up', async () => {
  const gh = mockGitHub();
  const laptop = device(gh, 'Laptop', { assignments: [task('a', 'x')] });
  await laptop.engine.connect(...CONNECT);
  gh.online = false;
  laptop.edit(db => db.assignments.push(task('b', 'made offline')));
  await laptop.engine.syncNow('change');
  assert.equal(laptop.engine.getState().status, 'offline');
  assert.equal(laptop.engine.getState().pending, true);
  assert.equal(laptop.titles().includes('made offline'), true);
  gh.online = true;
  await laptop.engine.syncNow('online');
  assert.equal(laptop.engine.getState().status, 'ok');
  assert.equal(gh.remoteData().assignments.length, 2);
});

test('an expired token is reported, not treated as an empty cloud', async () => {
  const gh = mockGitHub();
  const laptop = device(gh, 'Laptop', { assignments: [task('a', 'x')] });
  await laptop.engine.connect(...CONNECT);
  gh.tokenValid = false;
  await laptop.engine.syncNow('poll');
  const s = laptop.engine.getState();
  assert.equal(s.status, 'auth'); assert.match(s.message, /token/i);
  assert.equal(laptop.titles().length, 1, 'data is untouched');
});

test('if the cloud file disappears, the device republishes rather than deleting its data', async () => {
  const gh = mockGitHub();
  const laptop = device(gh, 'Laptop', { assignments: [task('a', 'x'), task('b', 'y')] });
  await laptop.engine.connect(...CONNECT);
  gh.file = null;
  await laptop.engine.syncNow('poll');
  assert.equal(laptop.db.assignments.length, 2);
  assert.equal(gh.remoteData().assignments.length, 2);
});

test('a large cloud file (over the 1 MB inline limit) is fetched raw', async () => {
  const gh = mockGitHub({ bigOver: 50 });
  const laptop = device(gh, 'Laptop', { assignments: Array.from({ length: 40 }, (_, i) => task('t' + i, 'Task number ' + i)) });
  await laptop.engine.connect(...CONNECT);
  const phone = device(gh, 'iPhone'); await phone.engine.connect(...CONNECT);
  assert.equal(phone.db.assignments.length, 40);
});

test('mass-delete guard pauses the sync and lets you choose', async () => {
  const gh = mockGitHub();
  const many = Array.from({ length: 20 }, (_, i) => task('t' + i, 'Task ' + i));
  const laptop = device(gh, 'Laptop', { assignments: many });
  await laptop.engine.connect(...CONNECT);
  const phone = device(gh, 'iPhone'); await phone.engine.connect(...CONNECT);

  // the cloud copy gets wiped down to two tasks (e.g. someone restored an old file)
  const env = core.parseEnvelope(gh.file.text); env.data.assignments = env.data.assignments.slice(0, 2);
  gh.seq++; gh.file = { sha: 'sha' + gh.seq, etag: '"e' + gh.seq + '"', text: core.makeEnvelope(env.data, { savedAt: ++clock + 10, device: 'x' }) };

  await phone.engine.syncNow('poll');
  let s = phone.engine.getState();
  assert.equal(s.status, 'review'); assert.deepEqual(s.review, { before: 20, after: 2 });
  assert.equal(phone.db.assignments.length, 20, 'nothing was removed while paused');

  await phone.engine.resolveReview('device');               // keep this device, overwrite the cloud
  assert.equal(phone.engine.getState().status, 'ok');
  assert.equal(phone.db.assignments.length, 20);
  assert.equal(gh.remoteData().assignments.length, 20);
});

test('choosing the cloud copy in the guard applies it', async () => {
  const gh = mockGitHub();
  const many = Array.from({ length: 20 }, (_, i) => task('t' + i, 'Task ' + i));
  const laptop = device(gh, 'Laptop', { assignments: many });
  await laptop.engine.connect(...CONNECT);
  const phone = device(gh, 'iPhone'); await phone.engine.connect(...CONNECT);
  const env = core.parseEnvelope(gh.file.text); env.data.assignments = env.data.assignments.slice(0, 2);
  gh.seq++; gh.file = { sha: 'sha' + gh.seq, etag: '"e' + gh.seq + '"', text: core.makeEnvelope(env.data, { savedAt: ++clock + 10, device: 'x' }) };
  await phone.engine.syncNow('poll');
  await phone.engine.resolveReview('cloud');
  assert.equal(phone.db.assignments.length, 2);
});

test('simultaneous sync requests run one after another, never overlapping', async () => {
  const gh = mockGitHub();
  const laptop = device(gh, 'Laptop', { assignments: [task('a', 'x')] });
  await laptop.engine.connect(...CONNECT);
  let inFlight = 0, maxInFlight = 0;
  const realFetch = gh.fetch;
  gh.fetch = async (...a) => { inFlight++; maxInFlight = Math.max(maxInFlight, inFlight); await new Promise(r => setImmediate(r)); try { return await realFetch(...a); } finally { inFlight--; } };
  // (the engine was built with the original fetch; rebuild it around the wrapped one)
  const d2 = device(gh, 'Laptop2', { assignments: [task('a', 'x')] });
  await d2.engine.connect(...CONNECT);
  maxInFlight = 0;
  await Promise.all([d2.engine.syncNow('a'), d2.engine.syncNow('b'), d2.engine.syncNow('c')]);
  assert.equal(maxInFlight, 1);
});

test('disconnect forgets the token and stops syncing', async () => {
  const gh = mockGitHub();
  const laptop = device(gh, 'Laptop', { assignments: [task('a', 'x')] });
  await laptop.engine.connect(...CONNECT);
  laptop.engine.disconnect();
  assert.equal(laptop.engine.getState().connected, false);
  assert.equal(laptop.store.has('radhelabs.sync.cfg'), false);
  const gets = gh.gets;
  await laptop.engine.syncNow('poll');
  assert.equal(gh.gets, gets, 'no requests once disconnected');
});

test('a device that reconnects later merges with what it already has', async () => {
  const gh = mockGitHub();
  const laptop = device(gh, 'Laptop', { assignments: [task('a', 'From laptop')] });
  await laptop.engine.connect(...CONNECT);
  // the phone was used on its own before being connected
  const phone = device(gh, 'iPhone', { assignments: [task('p', 'Phone-only task')] });
  await phone.engine.connect(...CONNECT);
  assert.deepEqual(phone.titles(), ['From laptop', 'Phone-only task']);
  await laptop.engine.syncNow('poll');
  assert.deepEqual(laptop.titles(), ['From laptop', 'Phone-only task']);
});

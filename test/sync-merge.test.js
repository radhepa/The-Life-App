'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../sync-core.js');
const { merge3, deepEqual } = core;

const t = (id, extra) => Object.assign({ id, title: 'Task ' + id, done: false, due: '' }, extra);
const ids = arr => arr.map(x => x.id);

test('no changes anywhere returns the same data', () => {
  const b = { assignments: [t('a')] };
  assert.deepEqual(merge3(b, b, b, 'local'), b);
});

test('a change on one side only is kept', () => {
  const b = { assignments: [t('a')], settings: { goal: 120 } };
  const l = { assignments: [t('a', { done: true })], settings: { goal: 120 } };
  assert.deepEqual(merge3(b, l, b, 'local'), l);
  assert.deepEqual(merge3(b, b, l, 'remote'), l);
});

test('tasks added on both devices are both kept', () => {
  const b = { assignments: [t('a')] };
  const l = { assignments: [t('a'), t('phone1')] };
  const r = { assignments: [t('a'), t('laptop1')] };
  const m = merge3(b, l, r, 'local');
  assert.deepEqual(ids(m.assignments).sort(), ['a', 'laptop1', 'phone1']);
});

test('edits to different fields of the same task combine', () => {
  const b = { assignments: [t('a')] };
  const l = { assignments: [t('a', { title: 'Renamed on laptop' })] };
  const r = { assignments: [t('a', { done: true })] };
  const [m] = merge3(b, l, r, 'remote').assignments;
  assert.equal(m.title, 'Renamed on laptop');
  assert.equal(m.done, true);
});

test('the same field edited on both sides takes the newer save', () => {
  const b = { assignments: [t('a', { title: 'old' })] };
  const l = { assignments: [t('a', { title: 'from laptop' })] };
  const r = { assignments: [t('a', { title: 'from phone' })] };
  assert.equal(merge3(b, l, r, 'remote').assignments[0].title, 'from phone');
  assert.equal(merge3(b, l, r, 'local').assignments[0].title, 'from laptop');
});

test('a deletion on the other side propagates when this side left the task alone', () => {
  const b = { assignments: [t('a'), t('b')] };
  const l = { assignments: [t('a'), t('b')] };
  const r = { assignments: [t('a')] };
  assert.deepEqual(ids(merge3(b, l, r, 'remote').assignments), ['a']);
  assert.deepEqual(ids(merge3(b, r, l, 'local').assignments), ['a']);
});

test('an edit beats a deletion, so nothing is lost', () => {
  const b = { assignments: [t('a'), t('b')] };
  const l = { assignments: [t('a'), t('b', { title: 'edited' })] };
  const r = { assignments: [t('a')] };
  const m = merge3(b, l, r, 'remote').assignments;
  assert.deepEqual(ids(m), ['a', 'b']);
  assert.equal(m[1].title, 'edited');
});

test('the same task deleted on both sides stays deleted', () => {
  const b = { assignments: [t('a'), t('b')] };
  const both = { assignments: [t('a')] };
  assert.deepEqual(ids(merge3(b, both, both, 'local').assignments), ['a']);
});

test('without a base (first sync) records from both sides are unioned', () => {
  const l = { assignments: [t('a')] };
  const r = { assignments: [t('b')] };
  assert.deepEqual(ids(merge3(undefined, l, r, 'local').assignments).sort(), ['a', 'b']);
});

test('newest-first lists keep new items in front (sessions are unshifted)', () => {
  const s = id => ({ id, name: id });
  const b = { sessions: [s('s2'), s('s1')] };
  const l = { sessions: [s('s2'), s('s1')] };
  const r = { sessions: [s('s3'), s('s2'), s('s1')] };
  assert.deepEqual(ids(merge3(b, l, r, 'remote').sessions), ['s3', 's2', 's1']);
  const both = merge3(b, { sessions: [s('p1'), s('s2'), s('s1')] }, r, 'remote').sessions;
  assert.deepEqual(new Set(ids(both)), new Set(['p1', 's3', 's2', 's1']));
  assert.ok(ids(both).indexOf('s3') < ids(both).indexOf('s2'), 's3 stays ahead of s2');
});

test('nested settings merge key by key', () => {
  const b = { settings: { focus: 25, brk: 5, urgency: { wDue: 40 } } };
  const l = { settings: { focus: 30, brk: 5, urgency: { wDue: 40 } } };
  const r = { settings: { focus: 25, brk: 10, urgency: { wDue: 50 } } };
  assert.deepEqual(merge3(b, l, r, 'remote').settings, { focus: 30, brk: 10, urgency: { wDue: 50 } });
});

test('plain arrays (day plans) fall back to the newer side', () => {
  const b = { dailyPicks: { '2026-09-21': ['a'] } };
  const l = { dailyPicks: { '2026-09-21': ['a', 'b'] } };
  const r = { dailyPicks: { '2026-09-21': ['a', 'c'] } };
  assert.deepEqual(merge3(b, l, r, 'remote').dailyPicks['2026-09-21'], ['a', 'c']);
});

test('subtasks with ids merge; one phone tick and one laptop tick both survive', () => {
  const sub = (id, done) => ({ id, text: id, done });
  const b = { assignments: [t('a', { subs: [sub('x', false), sub('y', false)] })] };
  const l = { assignments: [t('a', { subs: [sub('x', true), sub('y', false)] })] };
  const r = { assignments: [t('a', { subs: [sub('x', false), sub('y', true)] })] };
  const subs = merge3(b, l, r, 'remote').assignments[0].subs;
  assert.deepEqual(subs.map(s => s.done), [true, true]);
});

test('merging is stable: merging the result again changes nothing', () => {
  const b = { assignments: [t('a')] };
  const l = { assignments: [t('a', { done: true }), t('p')] };
  const r = { assignments: [t('a', { title: 'x' }), t('q')] };
  const m = merge3(b, l, r, 'remote');
  assert.ok(deepEqual(merge3(m, m, m, 'local'), m));
  assert.ok(deepEqual(merge3(b, m, r, 'local').assignments.map(x => x.id).sort(), ['a', 'p', 'q']));
});

test('device-only keys are stripped from the synced content', () => {
  const db = { assignments: [t('a')], active: { id: 'running' }, loads: 9, savedAt: 5, lastSync: 3, settings: { goal: 1 } };
  const c = core.contentOf(db);
  assert.deepEqual(Object.keys(c).sort(), ['assignments', 'settings']);
  c.assignments[0].title = 'changed';
  assert.equal(db.assignments[0].title, 'Task a', 'contentOf returns a copy');
});

test('envelope round-trips and rejects foreign files', () => {
  const text = core.makeEnvelope({ assignments: [t('é✓')] }, { savedAt: 7, device: 'iPhone' });
  const e = core.parseEnvelope(text);
  assert.equal(e.savedAt, 7); assert.equal(e.device, 'iPhone'); assert.equal(e.data.assignments[0].id, 'é✓');
  assert.throws(() => core.parseEnvelope('{"hello":1}'));
  assert.throws(() => core.parseEnvelope('not json'));
});

test('base64 handles unicode and large text', () => {
  const s = 'naïve ✓ 日本語 🙂 '.repeat(20000);
  assert.equal(core.b64decode(core.b64encode(s)), s);
});

test('setup code round-trips and rejects junk', () => {
  const code = core.encodeSetup({ repo: 'me/focus-data', token: 'github_pat_ab+/=cd' });
  assert.match(code, /^RLS1\.[A-Za-z0-9_-]+$/);
  assert.deepEqual(core.decodeSetup('  ' + code + '\n'), { repo: 'me/focus-data', token: 'github_pat_ab+/=cd' });
  assert.equal(core.decodeSetup('hello'), null);
  assert.equal(core.decodeSetup('RLS1.!!!'), null);
});

test('mass-delete guard trips only on a large drop', () => {
  const many = n => ({ assignments: Array.from({ length: n }, (_, i) => t('t' + i)) });
  assert.equal(core.massDeleteGuard(many(20), many(19)), null);
  assert.deepEqual(core.massDeleteGuard(many(20), many(3)), { before: 20, after: 3 });
  assert.equal(core.massDeleteGuard(many(5), many(0)), null, 'small data sets are not guarded');
});

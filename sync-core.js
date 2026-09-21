/* Sync core: merge logic and the sync engine, with no DOM and no direct network
   or storage access (both are injected), so it runs identically in the browser
   and under `node --test`.

   How it works
   ------------
   The whole database is stored as one JSON file in a private GitHub repo. Each
   device remembers the last version of that file it merged with (the "base").
   A sync is a three-way merge of base, this device's data and the cloud copy,
   done record-by-record (by `id`) and field-by-field, so changes made on two
   devices combine instead of one overwriting the other:

     · changed on one side only      → that change is kept
     · changed on both sides         → different fields combine; the same field
                                       takes the value from the newer save
     · added on either side          → kept
     · deleted on one side           → deleted, unless the other side edited it
                                       (an edit beats a delete, so nothing is lost)

   Device-only keys (a running timer, load counters…) never leave the device. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RLSyncCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var FORMAT = 1;
  var APP_ID = 'radhe-labs-focus';
  /* state that belongs to one device and must not be synced */
  var DEVICE_KEYS = ['active', 'loads', 'firstRun', 'lastSync', 'lastBackup', 'lastExport', 'lastImport', 'savedAt'];
  var RECORD_LISTS = ['classes', 'assignments', 'sessions', 'diary', 'stickies', 'journeys', 'exams'];

  /* ── helpers ─────────────────────────────────────────────────────────── */
  function isPlain(o) { return o !== null && typeof o === 'object' && !Array.isArray(o); }

  function deepEqual(a, b) {
    if (a === b) return true;
    if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) {
      if (a.length !== b.length) return false;
      for (var i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
      return true;
    }
    var ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (var j = 0; j < ka.length; j++) {
      var k = ka[j];
      if (!Object.prototype.hasOwnProperty.call(b, k) || !deepEqual(a[k], b[k])) return false;
    }
    return true;
  }

  function isIdObj(x) { return isPlain(x) && typeof x.id === 'string'; }
  /* an array of records that each carry a string id (an empty array qualifies) */
  function idLike(a) { return Array.isArray(a) && a.every(isIdObj); }

  /* ── three-way merge ─────────────────────────────────────────────────── */
  function merge3(base, local, remote, newer) {
    if (deepEqual(local, remote)) return local;
    if (base !== undefined) {
      if (deepEqual(local, base)) return remote;
      if (deepEqual(remote, base)) return local;
    }
    if (isPlain(local) && isPlain(remote)) return mergeObjects(base, local, remote, newer);
    if (idLike(local) && idLike(remote)) return mergeRecords(base, local, remote, newer);
    return newer === 'remote' ? remote : local;
  }

  function mergeObjects(base, l, r, newer) {
    var b = isPlain(base) ? base : undefined;
    var out = {};
    var keys = Object.keys(l);
    Object.keys(r).forEach(function (k) { if (!(k in l)) keys.push(k); });
    keys.forEach(function (k) {
      var inL = k in l, inR = k in r, inB = !!b && k in b;
      if (inL && inR) { out[k] = merge3(inB ? b[k] : undefined, l[k], r[k], newer); return; }
      var v = inL ? l[k] : r[k];
      if (inB && deepEqual(v, b[k])) return;      // the other side deleted it and this side left it alone
      out[k] = v;                                  // added here, or edited here while the other side deleted it
    });
    return out;
  }

  function mergeRecords(base, l, r, newer) {
    var b = idLike(base) ? base : [];
    var map = function (arr) { var m = new Map(); arr.forEach(function (x) { m.set(x.id, x); }); return m; };
    var bm = map(b), lm = map(l), rm = map(r);
    var backbone = newer === 'remote' ? r : l, other = newer === 'remote' ? l : r;

    // order: the newer side's order, with the other side's extra records slotted in after their predecessor
    var order = [], seen = new Set();
    backbone.forEach(function (x) { if (!seen.has(x.id)) { order.push(x.id); seen.add(x.id); } });
    var prev = null;
    other.forEach(function (x) {
      if (seen.has(x.id)) { prev = x.id; return; }
      order.splice(prev === null ? 0 : order.indexOf(prev) + 1, 0, x.id);
      seen.add(x.id); prev = x.id;
    });

    var out = [];
    order.forEach(function (id) {
      var inB = bm.has(id), inL = lm.has(id), inR = rm.has(id);
      if (inL && inR) { out.push(merge3(inB ? bm.get(id) : undefined, lm.get(id), rm.get(id), newer)); return; }
      var v = inL ? lm.get(id) : rm.get(id);
      if (inB && deepEqual(v, bm.get(id))) return;  // deleted on the other side, untouched here
      out.push(v);
    });
    return out;
  }

  /* ── data shape ──────────────────────────────────────────────────────── */
  function contentOf(db) {
    var c = {};
    Object.keys(db).forEach(function (k) { if (DEVICE_KEYS.indexOf(k) < 0) c[k] = db[k]; });
    return JSON.parse(JSON.stringify(c));
  }

  function countRecords(content) {
    var n = 0;
    RECORD_LISTS.forEach(function (k) { if (Array.isArray(content[k])) n += content[k].length; });
    if (content.bio && Array.isArray(content.bio.entries)) n += content.bio.entries.length;
    return n;
  }

  /* refuse a merge that would silently wipe most of what this device has */
  function massDeleteGuard(localContent, mergedContent) {
    var a = countRecords(localContent), b = countRecords(mergedContent);
    return a >= 10 && b < a * 0.6 ? { before: a, after: b } : null;
  }

  function makeEnvelope(content, meta) {
    return JSON.stringify({ app: APP_ID, format: FORMAT, savedAt: meta.savedAt, device: meta.device || '', data: content }, null, 1);
  }
  function parseEnvelope(text) {
    var o = JSON.parse(text);
    if (!o || o.app !== APP_ID || !isPlain(o.data)) throw new Error('That file is not a Focus data file');
    return { savedAt: o.savedAt || 0, device: o.device || '', data: o.data };
  }

  /* ── base64 (UTF-8 safe, chunked so large files don't overflow the stack) ── */
  function b64encode(str) {
    var bytes = new TextEncoder().encode(str), bin = '';
    for (var i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function b64decode(b64) {
    var bin = atob(String(b64).replace(/\s/g, '')), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  /* one string that carries repo + token, so a phone needs a single paste */
  function encodeSetup(o) {
    return 'RLS1.' + b64encode(JSON.stringify({ r: o.repo, t: o.token })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function decodeSetup(str) {
    var m = /^\s*RLS1\.([A-Za-z0-9_-]+)\s*$/.exec(String(str || ''));
    if (!m) return null;
    try {
      var b = m[1].replace(/-/g, '+').replace(/_/g, '/');
      while (b.length % 4) b += '=';
      var o = JSON.parse(b64decode(b));
      return o && typeof o.r === 'string' && typeof o.t === 'string' ? { repo: o.r, token: o.t } : null;
    } catch (e) { return null; }
  }

  var REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

  /* ── engine ──────────────────────────────────────────────────────────── */
  /* env: {
       fetch, storage:{get,set,del}, now(), deviceName, apiBase (optional, e.g. GitHub Enterprise),
       getLocal()        -> {content, savedAt}      snapshot without device keys
       applyContent(c,t) -> void                    replace synced data, keep device keys
       onState(state)    -> void
     } */
  function createEngine(env) {
    var K = { cfg: 'radhelabs.sync.cfg', base: 'radhelabs.sync.base' };
    var PATH = 'focus-data.json';
    var API = env.apiBase || 'https://api.github.com';
    var cfg = readJSON(K.cfg);
    var running = null, again = false, review = null;
    var state = { status: cfg ? 'idle' : 'off', message: '', lastSyncAt: (cfg && cfg.lastSyncAt) || 0, pending: false };

    function readJSON(k) { try { var v = env.storage.get(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
    function saveCfg() { try { env.storage.set(K.cfg, JSON.stringify(cfg)); } catch (e) {} }
    function getBase() { var b = readJSON(K.base); return b === null ? undefined : b; }
    function setBase(c) { try { if (c === undefined || c === null) env.storage.del(K.base); else env.storage.set(K.base, JSON.stringify(c)); } catch (e) { /* quota: fall back to base-less merges */ } }
    function setState(patch) { Object.assign(state, patch); if (env.onState) env.onState(getState()); }
    function getState() {
      return { status: state.status, message: state.message, lastSyncAt: state.lastSyncAt, pending: state.pending,
        connected: !!cfg, repo: cfg ? cfg.repo : '', review: review ? { before: review.info.before, after: review.info.after } : null };
    }

    function httpError(res, what) {
      var e = new Error(what + ' failed (' + res.status + ')');
      e.status = res.status;
      e.rateLimited = res.headers && res.headers.get && res.headers.get('x-ratelimit-remaining') === '0';
      return e;
    }
    function gh(path, opts) {
      opts = opts || {};
      var headers = Object.assign({ Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', Authorization: 'Bearer ' + cfg.token }, opts.headers || {});
      return env.fetch(API + path, Object.assign({}, opts, { headers: headers, cache: 'no-store' }));
    }
    var filePath = function () { return '/repos/' + cfg.repo + '/contents/' + encodeURIComponent(PATH); };

    async function fetchRemote() {
      var headers = {};
      if (cfg.etag && getBase() !== undefined) headers['If-None-Match'] = cfg.etag;
      var res = await gh(filePath(), { headers: headers });
      if (res.status === 304) return { unchanged: true };
      if (res.status === 404) return { missing: true };
      if (!res.ok) throw httpError(res, 'Reading the cloud copy');
      var j = await res.json(), text;
      if (j.encoding === 'base64' && typeof j.content === 'string' && j.content.length) text = b64decode(j.content);
      else {                                            // files over 1 MB come back without content
        var raw = await gh(filePath(), { headers: { Accept: 'application/vnd.github.raw+json' } });
        if (!raw.ok) throw httpError(raw, 'Reading the cloud copy');
        text = await raw.text();
      }
      return { sha: j.sha, etag: res.headers.get('ETag'), text: text };
    }

    async function putRemote(text, sha, message) {
      var body = { message: message, content: b64encode(text) };
      if (sha) body.sha = sha;
      var res = await gh(filePath(), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (res.status === 409 || res.status === 422) return { conflict: true };
      if (!res.ok) throw httpError(res, 'Saving to the cloud');
      var j = await res.json();
      return { sha: j.content && j.content.sha };
    }

    var stamp = function () { return env.now(); };
    var commitMsg = function (reason) { return 'sync from ' + (env.deviceName || 'device') + ' (' + reason + ')'; };

    /* one merge-and-push attempt; returns 'done' or 'retry' */
    async function attempt(reason, force) {
      var r = await fetchRemote();

      if (r.missing) {                                   // nothing in the cloud yet (or the file was removed): publish this device's data
        var l0 = env.getLocal();
        if (countRecords(l0.content) === 0) { cfg.sha = null; cfg.etag = null; setBase(null); return 'done'; }
        var put0 = await putRemote(makeEnvelope(l0.content, { savedAt: stamp(), device: env.deviceName }), null, commitMsg(reason));
        if (put0.conflict) return 'retry';
        cfg.sha = put0.sha; cfg.etag = null; cfg.remoteSavedAt = stamp(); setBase(l0.content);
        return 'done';
      }

      var remoteContent, remoteSha, remoteSavedAt;
      var haveBase = getBase() !== undefined;
      var newEtag = cfg.etag || null;     // only recorded once this cloud copy has actually been integrated
      if (r.unchanged || (haveBase && r.sha && r.sha === cfg.sha)) {
        remoteContent = getBase(); remoteSha = cfg.sha; remoteSavedAt = cfg.remoteSavedAt || 0;
        if (r.etag) newEtag = r.etag;
      } else {
        var envl = parseEnvelope(r.text);
        remoteContent = envl.data; remoteSha = r.sha; remoteSavedAt = envl.savedAt; newEtag = r.etag || null;
      }

      // read the local data only now, straight before merging, so the merge and the apply happen in one tick
      var local = env.getLocal();
      var merged;
      if (force === 'cloud') merged = remoteContent;
      else if (force === 'device') merged = local.content;
      else if (countRecords(local.content) === 0 && countRecords(remoteContent) > 0) merged = remoteContent;   // fresh device: take the cloud copy as is
      else {
        merged = merge3(getBase(), local.content, remoteContent, remoteSavedAt > local.savedAt ? 'remote' : 'local');
        var g = massDeleteGuard(local.content, merged);
        if (g) {
          review = { info: g, reason: reason };
          setState({ status: 'review', message: 'Sync paused: the cloud copy would remove ' + (g.before - g.after) + ' of your ' + g.before + ' items.' });
          return 'paused';
        }
      }
      review = null;

      if (!deepEqual(merged, local.content)) env.applyContent(JSON.parse(JSON.stringify(merged)), Math.max(local.savedAt, remoteSavedAt));
      cfg.sha = remoteSha; cfg.etag = newEtag; cfg.remoteSavedAt = remoteSavedAt; setBase(remoteContent);   // integrated the cloud copy; a failed push below is retried against this base
      saveCfg();

      if (!deepEqual(merged, remoteContent)) {
        var put = await putRemote(makeEnvelope(merged, { savedAt: stamp(), device: env.deviceName }), remoteSha, commitMsg(reason));
        if (put.conflict) return 'retry';
        cfg.sha = put.sha; cfg.etag = null; cfg.remoteSavedAt = stamp(); setBase(merged);
      }
      return 'done';
    }

    function describeError(e) {
      if (e && (e.status === 401)) return { status: 'auth', message: 'GitHub rejected the token. It may have expired — create a new one and reconnect.' };
      if (e && (e.status === 403 || e.status === 404)) {
        if (e.rateLimited) return { status: 'error', message: 'GitHub is rate-limiting requests. Sync will retry shortly.' };
        return { status: 'auth', message: 'The token cannot read and write this repo. It needs "Contents: Read and write" on it.' };
      }
      if (e && e.status) return { status: 'error', message: e.message };
      return { status: 'offline', message: 'Offline — changes are saved on this device and will sync when you are back online.' };
    }

    async function run(reason, force) {
      if (!cfg) return;
      setState({ status: 'syncing', message: '' });
      try {
        var result = 'retry';
        for (var i = 0; i < 4 && result === 'retry'; i++) result = await attempt(reason, force);
        if (result === 'paused') return;
        if (result === 'retry') { setState({ status: 'error', message: 'The cloud copy kept changing while syncing. Trying again shortly.' }); return; }
        cfg.lastSyncAt = stamp(); saveCfg();
        setState({ status: 'ok', message: '', lastSyncAt: cfg.lastSyncAt, pending: false });
      } catch (e) {
        var d = describeError(e);
        setState({ status: d.status, message: d.message });
      }
    }

    function syncNow(reason, force) {
      if (!cfg) return Promise.resolve();
      if (running) { again = true; return running; }
      running = (async function () {
        try {
          do { again = false; await run(reason || 'sync', force); force = undefined; } while (again);
        } finally { running = null; }
      })();
      return running;
    }

    async function connect(repo, token) {
      repo = String(repo || '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '');
      token = String(token || '').trim();
      if (!REPO_RE.test(repo)) throw new Error('Enter the repository as owner/name, e.g. yourname/focus-data.');
      if (!token) throw new Error('Paste the access token.');
      var prev = cfg;
      cfg = { repo: repo, token: token };
      var res;
      try { res = await gh('/repos/' + repo); }
      catch (e) { cfg = prev; throw new Error('Could not reach GitHub. Check your connection.'); }
      if (res.status === 401) { cfg = prev; throw new Error('GitHub rejected that token.'); }
      if (res.status === 404 || res.status === 403) { cfg = prev; throw new Error('That repository was not found, or the token has no access to it.'); }
      if (!res.ok) { cfg = prev; throw new Error('GitHub returned an error (' + res.status + ').'); }
      var info = await res.json();
      if (info.private === false) { cfg = prev; throw new Error('That repository is public — your data would be readable by anyone. Use a private repository.'); }
      if (info.permissions && info.permissions.push === false) { cfg = prev; throw new Error('The token can only read that repository. It needs "Contents: Read and write".'); }
      cfg = { repo: repo, token: token, sha: null, etag: null, lastSyncAt: 0 };
      setBase(null); review = null; saveCfg();
      setState({ status: 'idle', message: '', lastSyncAt: 0 });
      return syncNow('connect');
    }

    function disconnect() {
      cfg = null; review = null;
      try { env.storage.del(K.cfg); env.storage.del(K.base); } catch (e) {}
      setState({ status: 'off', message: '', lastSyncAt: 0, pending: false });
    }

    function markPending() { if (cfg && !state.pending) setState({ pending: true }); }
    function resolveReview(choice) { return syncNow('review', choice === 'cloud' ? 'cloud' : 'device'); }
    function getConfig() { return cfg ? { repo: cfg.repo, token: cfg.token } : null; }

    return { syncNow: syncNow, connect: connect, disconnect: disconnect, markPending: markPending,
      resolveReview: resolveReview, getState: getState, getConfig: getConfig };
  }

  return {
    FORMAT: FORMAT, DEVICE_KEYS: DEVICE_KEYS,
    deepEqual: deepEqual, merge3: merge3, contentOf: contentOf, countRecords: countRecords,
    massDeleteGuard: massDeleteGuard, makeEnvelope: makeEnvelope, parseEnvelope: parseEnvelope,
    b64encode: b64encode, b64decode: b64decode, encodeSetup: encodeSetup, decodeSetup: decodeSetup,
    createEngine: createEngine
  };
});

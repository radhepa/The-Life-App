/* Sync, browser side: wires sync-core.js into the app.
   - builds the "Cloud sync" card in Settings
   - decides when to sync (after edits, on open, on resume, when back online, and a light poll)
   - applies merged data into the running app
   Loaded after the main script, so it can use the app's globals (db, save, tab, …). */
(function () {
  'use strict';
  if (typeof RLSyncCore === 'undefined' || typeof db === 'undefined') return;
  var Core = RLSyncCore;

  var DEVICE = /iPhone|iPod/.test(navigator.userAgent) ? 'iPhone' : /iPad/.test(navigator.userAgent) ? 'iPad'
    : /Android/.test(navigator.userAgent) ? 'Android' : 'Laptop';
  var DISMISS_KEY = 'radhelabs.sync.bannerDismissed';
  var DOCS_URL = 'https://github.com/radhepa/The-Life-App/blob/main/docs/sync.md';

  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { localStorage.setItem(k, v); },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };

  var lastSyncedJSON = null, timer = null, lastRun = 0, busy = '', formError = '';

  /* ── applying merged data to the running app ─────────────────────────── */
  function applyToApp(content, savedAt) {
    var keep = {};
    Core.DEVICE_KEYS.forEach(function (k) { if (k in db) keep[k] = db[k]; });
    db = ensureSettings(Object.assign(clone(blank), content, keep));
    db.savedAt = savedAt;
    if (!db.onboarded && (db.classes.length || db.assignments.length || db.sessions.length)) db.onboarded = true;
    cacheSave();
    if (SERVER) syncOut();       // the local server copy stays in step too
    refreshViews();
  }

  function refreshViews() {
    try {
      if (db.onboarded && !$('v-onboard').classList.contains('hide')) { rehydrate(); return; }
      if ($('modals').innerHTML.trim()) return;      // never pull a form out from under someone mid-edit
      if (cur === 'set') tab('set'); else repaint();
    } catch (e) { /* a repaint problem must never break syncing */ }
  }

  /* ── engine ──────────────────────────────────────────────────────────── */
  var engine = Core.createEngine({
    fetch: function (u, o) { return window.fetch(u, o); },
    storage: store,
    now: function () { return Date.now(); },
    deviceName: DEVICE,
    apiBase: store.get('radhelabs.sync.api') || undefined,   // optional override (GitHub Enterprise, or a test server)
    getLocal: function () { return { content: Core.contentOf(db), savedAt: db.savedAt || 0 }; },
    applyContent: applyToApp,
    onState: function (s) {
      if (s.status === 'ok') lastSyncedJSON = JSON.stringify(Core.contentOf(db));
      renderCard();
      if (typeof paintWarn === 'function') paintWarn();
    }
  });

  function connected() { return engine.getState().connected; }

  function run(reason) {
    if (!connected()) return Promise.resolve();
    lastRun = Date.now();
    return engine.syncNow(reason);
  }

  /* called from save(): wait for a quiet moment, then sync if the synced data really changed */
  function dirty() {
    if (!connected()) return;
    clearTimeout(timer);
    timer = setTimeout(function () {
      var now = JSON.stringify(Core.contentOf(db));
      if (now === lastSyncedJSON && engine.getState().status === 'ok') return;   // e.g. only a running timer changed
      engine.markPending();
      run('change');
    }, 3000);
  }

  function resume(reason) {
    if (document.hidden || Date.now() - lastRun < 8000) return;
    run(reason);
  }

  /* ── helpers ─────────────────────────────────────────────────────────── */
  function ago(ms) {
    if (!ms) return 'never';
    var s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 10) return 'just now';
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    return new Date(ms).toLocaleDateString();
  }

  function statusLine(s) {
    var dot = function (c, t) { return '<span style="color:' + c + '">● ' + t + '</span>'; };
    if (s.status === 'syncing') return dot('var(--dim)', 'Syncing…');
    if (s.status === 'ok') return dot('var(--focus)', 'Up to date · synced ' + ago(s.lastSyncAt));
    if (s.status === 'offline') return dot('var(--over)', 'Offline') + '<br><span class="faint">' + esc(s.message) + '</span>';
    if (s.status === 'auth' || s.status === 'error') return dot('var(--bad)', 'Needs attention') + '<br><span class="faint">' + esc(s.message) + '</span>';
    if (s.status === 'review') return dot('var(--over)', 'Paused') ;
    if (s.pending) return dot('var(--dim)', 'Waiting to sync…');
    return dot('var(--dim)', 'Connected');
  }

  /* ── Settings card ───────────────────────────────────────────────────── */
  function ensureCard() {
    var c = document.getElementById('sync-card');
    if (c) return c;
    var health = document.getElementById('health');
    var anchor = health && health.closest('.card');
    if (!anchor) return null;
    c = document.createElement('div');
    c.id = 'sync-card'; c.className = 'card'; c.style.marginBottom = '16px';
    anchor.parentNode.insertBefore(c, anchor);
    return c;
  }

  function renderCard() {
    var c = ensureCard();
    if (!c) return;
    var focused = document.activeElement && c.contains(document.activeElement) && /INPUT|TEXTAREA/.test(document.activeElement.tagName);
    if (focused) return;                                   // don't wipe a field while it is being typed in
    var s = engine.getState();
    var head = '<h2 style="font-size:16px;margin-bottom:6px">Cloud sync</h2>';
    if (!s.connected) {
      c.innerHTML = head +
        '<p class="dim" style="font-size:13px;margin:0 0 13px">Keep your laptop and phone in step. Your data is stored as one file in a ' +
        '<b>private</b> GitHub repository that you own — it doesn\'t go anywhere else. ' +
        '<a href="' + DOCS_URL + '" target="_blank" rel="noopener">Setup steps</a></p>' +
        '<label class="lbl">Setup code</label>' +
        '<input id="sync-code" placeholder="Paste the code from your other device" autocomplete="off" autocapitalize="off" spellcheck="false">' +
        '<div class="row wrapf" style="gap:9px;margin-top:10px"><button class="sm primary" id="sync-go-code" onclick="RLSync.connectCode()">Connect</button></div>' +
        '<details style="margin-top:14px"><summary class="dim" style="font-size:13px;cursor:pointer">Set up by hand instead</summary>' +
        '<label class="lbl" style="margin-top:12px">Repository</label>' +
        '<input id="sync-repo" placeholder="yourname/focus-data" autocomplete="off" autocapitalize="off" spellcheck="false">' +
        '<label class="lbl" style="margin-top:12px">Access token</label>' +
        '<input id="sync-token" type="password" placeholder="github_pat_…" autocomplete="off" autocapitalize="off" spellcheck="false">' +
        '<div class="row wrapf" style="gap:9px;margin-top:10px"><button class="sm primary" id="sync-go-manual" onclick="RLSync.connectManual()">Connect</button></div></details>' +
        '<p id="sync-msg" class="faint" style="font-size:12.5px;margin:12px 0 0;color:var(--bad)">' + esc(formError) + '</p>' +
        (busy ? '<p class="faint" style="font-size:12.5px;margin:8px 0 0">' + esc(busy) + '</p>' : '');
      return;
    }
    c.innerHTML = head +
      '<p class="dim" style="font-size:13px;margin:0 0 12px">Edits on this device are merged with your other devices automatically.</p>' +
      '<p style="font-size:12.5px;margin:0 0 6px">' + statusLine(s) + '</p>' +
      '<p class="faint" style="font-size:12px;margin:0 0 14px">Repository <span class="mono">' + esc(s.repo) + '</span> · this device <span class="mono">' + esc(DEVICE) + '</span></p>' +
      (s.status === 'review'
        ? '<div class="banner"><b>' + esc(engine.getState().message) + '</b><br>Did you delete those on another device? If not, keep this device\'s data.' +
          '<div class="row wrapf" style="gap:9px;margin-top:10px"><button class="sm" onclick="RLSync.resolve(\'cloud\')">Use the cloud copy</button>' +
          '<button class="sm primary" onclick="RLSync.resolve(\'device\')">Keep this device\'s data</button></div></div>' : '') +
      '<div class="row wrapf" style="gap:9px">' +
      '<button class="sm primary" onclick="RLSync.syncButton(this)">Sync now</button>' +
      '<button class="sm" onclick="RLSync.copyCode()">Copy setup code</button>' +
      '<button class="sm danger" onclick="RLSync.disconnect()">Disconnect</button></div>';
  }

  /* ── actions used by the card ────────────────────────────────────────── */
  function connect(repo, token, buttonId) {
    formError = ''; busy = 'Connecting…';
    var b = document.getElementById(buttonId); if (b) b.disabled = true;
    var msg = document.getElementById('sync-msg'); if (msg) msg.textContent = '';
    return engine.connect(repo, token).then(function () {
      busy = ''; localStorage.setItem(DISMISS_KEY, '1'); renderCard(); toast('Sync connected');
    }).catch(function (e) {
      busy = ''; formError = (e && e.message) || 'Could not connect.';
      renderCard();
    });
  }
  function connectCode() {
    var v = (document.getElementById('sync-code') || {}).value;
    var o = Core.decodeSetup(v);
    if (!o) { formError = 'That does not look like a setup code. It starts with RLS1.'; renderCard(); return; }
    return connect(o.repo, o.token, 'sync-go-code');
  }
  function connectManual() {
    return connect((document.getElementById('sync-repo') || {}).value, (document.getElementById('sync-token') || {}).value, 'sync-go-manual');
  }
  function syncButton(btn) {
    if (btn) btn.disabled = true;
    run('manual').then(function () { if (btn) btn.disabled = false; renderCard(); });
  }
  function copyCode() {
    var cfg = engine.getConfig();
    if (!cfg) return;
    var code = Core.encodeSetup(cfg);
    var done = function () { toast('Copied. It contains your access token, so keep it private.'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code).then(done, function () { window.prompt('Copy this setup code:', code); });
    else window.prompt('Copy this setup code:', code);
  }
  function disconnect() {
    modal('<h2 style="font-size:17px">Disconnect sync?</h2>' +
      '<p class="dim" style="font-size:13px">This device keeps all its data, and the cloud copy stays where it is. This device just stops syncing and forgets the access token.</p>' +
      '<div class="row" style="gap:9px;margin-top:18px"><button class="primary" onclick="RLSync.confirmDisconnect()">Disconnect</button>' +
      '<button class="ghost" onclick="closeModal()">Cancel</button></div>');
  }
  function confirmDisconnect() { closeModal(); engine.disconnect(); lastSyncedJSON = null; formError = ''; renderCard(); if (typeof paintWarn === 'function') paintWarn(); }
  function resolve(choice) { engine.resolveReview(choice).then(renderCard); }

  /* ── "not syncing yet" banner (installed/hosted app only) ────────────── */
  function banner() {
    if (MODE !== 'hosted' || connected() || !db.onboarded) return '';
    if (store.get(DISMISS_KEY)) return '';
    return '<div class="banner">Your data is only on this device. <b>Cloud sync</b> keeps it in step with your other devices.' +
      '<div class="row wrapf" style="gap:8px;margin-top:9px"><button class="xs primary" onclick="tab(\'set\')">Set up sync</button>' +
      '<button class="xs ghost" onclick="RLSync.dismissBanner()">Not now</button></div></div>';
  }
  function dismissBanner() { try { localStorage.setItem(DISMISS_KEY, '1'); } catch (e) {} if (typeof paintWarn === 'function') paintWarn(); }

  /* ── start ───────────────────────────────────────────────────────────── */
  function start() {
    if (MODE === 'file') return;
    renderCard();
    if (connected()) run('open');
    setInterval(function () { if (!document.hidden) run('poll'); }, 60000);
    setInterval(function () { if (!document.hidden && cur === 'set' && connected() && !$('modals').innerHTML.trim()) renderCard(); }, 30000);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) resume('resume');
      else if (connected() && engine.getState().pending) run('hide');
    });
    window.addEventListener('focus', function () { resume('focus'); });
    window.addEventListener('online', function () { run('online'); });
  }

  window.RLSync = {
    dirty: dirty, start: start, paintCard: renderCard, banner: banner, dismissBanner: dismissBanner,
    connectCode: connectCode, connectManual: connectManual, syncButton: syncButton,
    copyCode: copyCode, disconnect: disconnect, confirmDisconnect: confirmDisconnect, resolve: resolve,
    state: function () { return engine.getState(); }, syncNow: function () { return run('manual'); }
  };

  Promise.resolve(window.appReady).then(start);
})();

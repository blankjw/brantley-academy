/* Dispatch Academy: UI */
(function () {
  'use strict';
  var E = window.Engine;
  var KEY = 'mathArena5.v1'; // kept from the math-only version so saved progress carries over
  var app = document.getElementById('app');

  // ---------- storage ----------
  function load() { try { return E.loadState(localStorage.getItem(KEY)); } catch (e) { return E.newState(); } }
  function saveLocal() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* storage blocked: keep going in memory */ } }
  function save() { saveLocal(); markDirty(); } // this device first, then the cloud a moment later
  function touchSettings() { state.settingsAt = new Date().toISOString(); }
  var state = load();

  // ---------- cloud sync (Supabase) ----------
  // No logins. Each family gets a Family Code like K7M9-P4X2. Progress is saved on this device first (works offline),
  // then copied to the cloud. Any phone or computer that opens the Family Link sees the same progress, live.
  var SUPA_URL = 'https://zrccpbvmpqordmywvjrx.supabase.co';
  var SUPA_KEY = 'sb_publishable_Dwkc2RhkRM6aYrqm27GxDw_Ht-dYS6y'; // public "publishable" key: it can only call the 4 arena_* functions
  var SYNC_KEY = 'mathArena5.sync';
  var cloud = { code: null, status: 'idle', live: false, lastSyncedAt: null, serverAt: null, dirty: false, busy: false, again: false, timer: null, ws: null, wsRef: 0, hb: null, poll: null, retry: 0, error: '' };
  (function () { try { var o = JSON.parse(localStorage.getItem(SYNC_KEY) || '{}') || {}; cloud.code = E.normalizeSyncCode(o.code); cloud.lastSyncedAt = o.lastSyncedAt || null; cloud.serverAt = o.serverAt || null; cloud.dirty = !!o.dirty; cloud.prevCode = o.prevCode || null; } catch (e) { /* ignore */ } })();
  function saveSyncInfo() { try { localStorage.setItem(SYNC_KEY, JSON.stringify({ code: cloud.code, lastSyncedAt: cloud.lastSyncedAt, serverAt: cloud.serverAt, dirty: cloud.dirty, prevCode: cloud.prevCode || null })); } catch (e) { /* ignore */ } }
  function familyLink(code) { return location.origin + location.pathname + '?code=' + encodeURIComponent(code || cloud.code || ''); }
  function rpc(name, args) {
    return fetch(SUPA_URL + '/rest/v1/rpc/' + name, { method: 'POST', headers: { apikey: SUPA_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(args), cache: 'no-store' })
      .then(function (res) { return res.json().catch(function () { return null; }).then(function (body) { if (!res.ok) { var err = new Error((body && body.message) || ('HTTP ' + res.status)); err.status = res.status; err.code = body && body.code; throw err; } return body; }); });
  }
  function newCode() { return E.makeSyncCode(function (n) { var b = new Uint8Array(n); window.crypto.getRandomValues(b); return b; }); }
  function setStatus(s, err) { cloud.status = s; cloud.error = err || ''; updateSyncIndicator(); }
  function syncText() {
    if (!cloud.code) return { cls: 'off', text: '☁️ Setting up cloud save...' };
    if (cloud.status === 'offline') return { cls: 'warn', text: '📴 Offline: saved on this device. It will sync when Wi-Fi is back.' };
    if (cloud.status === 'error') return { cls: 'warn', text: '⚠️ Could not reach the cloud. Saved on this device, will try again.' };
    if (cloud.status === 'syncing' && !cloud.lastSyncedAt) return { cls: 'off', text: '☁️ Syncing...' };
    var when = cloud.lastSyncedAt ? new Date(cloud.lastSyncedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
    return { cls: 'ok', text: '☁️ Cloud Synced' + (cloud.live ? ' · Live' : '') + (when ? ' · last synced ' + when : '') };
  }
  function updateSyncIndicator() {
    var t = syncText();
    document.querySelectorAll('[data-sync-status]').forEach(function (el) { el.textContent = t.text; el.className = 'sync-status ' + t.cls; });
    var chip = document.getElementById('syncChip');
    if (chip) { chip.textContent = t.cls === 'ok' ? '☁️✓' : t.cls === 'warn' ? '☁️!' : '☁️'; chip.title = t.text; chip.className = 'chip sync-chip ' + t.cls; }
  }
  function markDirty() {
    if (preview) return;
    cloud.dirty = true; saveSyncInfo();
    clearTimeout(cloud.timer); cloud.timer = setTimeout(function () { syncNow(); }, 1200);
  }
  function isTyping() { var a = document.activeElement; return !!(a && app.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)); }
  function refreshAfterRemote() {
    renderHud();
    if (isTyping() || !document.getElementById('modal').classList.contains('hidden')) return;
    if (route === 'home' || route === 'practice' || (route === 'parent' && !preview)) { var y = window.scrollY; render(); window.scrollTo(0, y); }
  }
  // Pull the cloud copy, merge it with this device, push back anything new. Never drops progress from either side.
  function syncNow() {
    if (!cloud.code) return Promise.resolve(false);
    if (cloud.busy) { cloud.again = true; return cloud.busyP; }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { setStatus('offline'); return Promise.resolve(false); }
    cloud.busy = true; cloud.again = false; if (cloud.status !== 'synced') setStatus('syncing');
    var code = cloud.code;
    cloud.busyP = rpc('arena_get', { p_sync_code: code }).then(function (r) {
      if (code !== cloud.code) return false;
      if (!r || !r.found) {
        return rpc('arena_create_or_load', { p_sync_code: code, p_initial_state: state }).then(function (c) { cloud.serverAt = c.updatedAt; return true; });
      }
      var merged = E.mergeStates(state, r.state), changedLocal = !E.sameProgress(merged, state), changedRemote = !E.sameProgress(merged, r.state);
      if (changedLocal) { state = merged; saveLocal(); refreshAfterRemote(); }
      if (!changedRemote) { cloud.serverAt = r.updatedAt; return true; }
      return rpc('arena_sync_state', { p_sync_code: code, p_state: merged }).then(function (w) { cloud.serverAt = w.updatedAt; broadcast(); return true; });
    }).then(function (ok) {
      cloud.busy = false; cloud.retry = 0;
      if (ok) { cloud.dirty = false; cloud.lastSyncedAt = new Date().toISOString(); saveSyncInfo(); setStatus('synced'); }
      if (cloud.again) return syncNow();
      return ok;
    }, function (err) {
      cloud.busy = false;
      setStatus(navigator.onLine === false ? 'offline' : 'error', String(err && err.message || err));
      cloud.retry = Math.min(cloud.retry + 1, 6);
      clearTimeout(cloud.timer); cloud.timer = setTimeout(function () { syncNow(); }, 2000 * Math.pow(2, cloud.retry));
      return false;
    });
    return cloud.busyP;
  }
  // first visit on this device: make a Family Code and copy any saved progress into the cloud
  function createProfile(tries) {
    tries = tries || 0;
    var code = newCode();
    return rpc('arena_create_or_load', { p_sync_code: code, p_initial_state: state }).then(function (r) {
      if (!r.created && tries < 4) return createProfile(tries + 1); // that code was taken (very rare): pick another
      cloud.code = code; cloud.serverAt = r.updatedAt; cloud.dirty = false; cloud.lastSyncedAt = new Date().toISOString(); saveSyncInfo();
      if (!r.created) { state = E.mergeStates(state, r.state); saveLocal(); }
      setStatus('synced'); connectLive(); refreshAfterRemote();
      return code;
    });
  }
  // open an existing Family Code on this device
  function linkCode(raw, opts) {
    opts = opts || {};
    var code = E.normalizeSyncCode(raw);
    if (!code) { toast('That code does not look right. It has 8 letters and numbers, like K7M9-P4X2.', 4000); return Promise.resolve(false); }
    if (code === cloud.code) { if (!opts.quiet) toast('This device already uses that Family Code.'); return syncNow(); }
    setStatus('syncing');
    var first = cloud.code && cloud.dirty ? syncNow().catch(function () { return false; }) : Promise.resolve(true);
    return first.then(function () { return rpc('arena_get', { p_sync_code: code }); }).then(function (r) {
      if (!r || !r.found) { setStatus(cloud.code ? 'synced' : 'error'); toast('We could not find that Family Code. Check the letters and try again.', 4500); return false; }
      // This device's own progress is already in the cloud under its old code, so it is safe to switch.
      // If this device never got a code (offline the whole time), fold its progress into the linked profile.
      var merge = !cloud.code && E.hasProgress(state);
      if (cloud.code) cloud.prevCode = cloud.code;
      cloud.code = code; cloud.serverAt = r.updatedAt;
      state = merge ? E.mergeStates(state, r.state) : E.loadState(r.state);
      saveLocal(); cloud.lastSyncedAt = new Date().toISOString(); cloud.dirty = merge; saveSyncInfo();
      parentUnlocked = false; preview = false; setStatus('synced'); connectLive();
      if (merge) syncNow();
      hideModal(); render(); window.scrollTo(0, 0);
      toast('Linked! This device now uses Family Code ' + code + '.', 3500);
      return true;
    }, function () { setStatus('error'); toast('Could not reach the cloud. Check the Wi-Fi and try again.', 4000); return false; });
  }
  // ----- live updates: Supabase Realtime broadcast over a plain WebSocket -----
  function wsSend(msg) { try { if (cloud.ws && cloud.ws.readyState === 1) { cloud.ws.send(JSON.stringify(msg)); return true; } } catch (e) { /* ignore */ } return false; }
  function topic() { return 'realtime:arena:' + cloud.code; }
  function connectLive() {
    if (!cloud.code || typeof WebSocket === 'undefined') return;
    if (cloud.ws) { try { cloud.ws.onclose = null; cloud.ws.close(); } catch (e) { /* ignore */ } }
    cloud.live = false; updateSyncIndicator();
    var code = cloud.code, ws;
    try { ws = new WebSocket(SUPA_URL.replace('https://', 'wss://') + '/realtime/v1/websocket?apikey=' + encodeURIComponent(SUPA_KEY) + '&vsn=1.0.0'); } catch (e) { return; }
    cloud.ws = ws;
    ws.onopen = function () {
      cloud.wsRef += 1;
      cloud.joinRef = String(cloud.wsRef);
      wsSend({ topic: topic(), event: 'phx_join', payload: { config: { broadcast: { self: false, ack: false }, presence: { key: '' }, private: false } }, ref: cloud.joinRef, join_ref: cloud.joinRef });
      clearInterval(cloud.hb); cloud.hb = setInterval(function () { cloud.wsRef += 1; wsSend({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(cloud.wsRef) }); }, 25000);
    };
    ws.onmessage = function (ev) {
      var m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.topic !== topic()) return;
      if (m.event === 'phx_reply' && m.ref === cloud.joinRef && m.payload && m.payload.status === 'ok') { cloud.live = true; updateSyncIndicator(); }
      if (m.event === 'broadcast' && m.payload && m.payload.event === 'updated') syncNow();
    };
    ws.onclose = function () {
      clearInterval(cloud.hb); cloud.live = false; updateSyncIndicator();
      if (code === cloud.code) setTimeout(function () { if (code === cloud.code && (!cloud.ws || cloud.ws.readyState > 1)) connectLive(); }, 5000);
    };
    ws.onerror = function () { /* onclose handles reconnects */ };
  }
  function broadcast() {
    cloud.wsRef += 1;
    var msg = { topic: topic(), event: 'broadcast', payload: { type: 'broadcast', event: 'updated', payload: { at: Date.now() } }, ref: String(cloud.wsRef), join_ref: cloud.joinRef };
    if (cloud.live && wsSend(msg)) return;
    // socket not ready: use the REST broadcast endpoint instead
    try { fetch(SUPA_URL + '/realtime/v1/api/broadcast', { method: 'POST', headers: { apikey: SUPA_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ topic: 'arena:' + cloud.code, event: 'updated', payload: { at: Date.now() } }] }) }).catch(function () {}); } catch (e) { /* ignore */ }
  }
  // While Parent View is open, also check every 10 seconds in case a live message was missed.
  function checkVersion() {
    if (!cloud.code || cloud.busy || document.hidden) return;
    rpc('arena_version', { p_sync_code: cloud.code }).then(function (v) {
      if (v && v.found && v.updatedAt !== cloud.serverAt) syncNow();
      else if (cloud.status !== 'synced') { cloud.lastSyncedAt = new Date().toISOString(); setStatus('synced'); }
      else { cloud.lastSyncedAt = new Date().toISOString(); saveSyncInfo(); updateSyncIndicator(); }
    }, function () { setStatus(navigator.onLine === false ? 'offline' : 'error'); });
  }
  function updatePolling() {
    var want = route === 'parent' && !!cloud.code;
    if (want && !cloud.poll) cloud.poll = setInterval(checkVersion, 10000);
    if (!want && cloud.poll) { clearInterval(cloud.poll); cloud.poll = null; }
  }
  function initCloud() {
    var params = null; try { params = new URLSearchParams(location.search); } catch (e) { params = null; }
    var fromUrl = params && params.get('code');
    if (fromUrl !== null && fromUrl !== undefined) {
      try { params.delete('code'); var qs = params.toString(); history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash); } catch (e) { /* ignore */ }
    }
    window.addEventListener('online', function () { if (cloud.code) syncNow(); else startCloudSetup(); });
    window.addEventListener('offline', function () { setStatus('offline'); });
    window.addEventListener('focus', function () { if (cloud.code) syncNow(); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden && cloud.code) syncNow(); });
    if (fromUrl && E.normalizeSyncCode(fromUrl) && E.normalizeSyncCode(fromUrl) !== cloud.code) {
      return linkCode(fromUrl, { quiet: true }).then(function (ok) { if (!ok) return cloud.code ? (connectLive(), syncNow()) : startCloudSetup(); return ok; });
    }
    if (fromUrl && !E.normalizeSyncCode(fromUrl)) toast('That Family Link looks incomplete. Ask for the link again.', 4000);
    if (cloud.code) { connectLive(); return syncNow(); }
    return startCloudSetup();
  }
  function startCloudSetup() {
    if (cloud.code || cloud.creating) return Promise.resolve(cloud.code);
    cloud.creating = true;
    return createProfile().then(function (c) { cloud.creating = false; return c; }, function () {
      cloud.creating = false; setStatus(navigator.onLine === false ? 'offline' : 'error');
      clearTimeout(cloud.timer); cloud.timer = setTimeout(startCloudSetup, 15000);
      return null;
    });
  }

  var route = 'home';
  var tab = 'all';        // practice subject tab
  var runner = null;      // practice / mission round
  var placement = null;   // placement run
  var lastPlacementResult = null;
  var lastRound = null;   // finished round summary
  var parentUnlocked = false;
  var preview = false;
  var lab = { d1: 4, s1: [], d2: 8, s2: [], common: false };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function playerName() { return state.studentName ? esc(state.studentName) : 'Champ'; }
  function subj(id) { return E.subjectById(id); }

  var toastTimer = null;
  function toast(msg, ms) {
    var t = document.getElementById('toast');
    t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.add('hidden'); }, ms || 2200);
  }

  var CHEERS = {
    fortnite: ['Victory Royale on that one!', 'Cranked 90s! Nice.', 'Headshot. Clean answer.'],
    roblox: ['Obby cleared!', 'Legendary pet unlocked!', 'Big Robux brain!'],
    karate: ['Hi-yah! Correct!', 'Clean strike!', 'Board broken!'],
    soccer: ['GOAL!', 'Top corner!', 'Hat trick energy!'],
    baseball: ['Home run!', 'Right down the middle!', 'That one is outta here!']
  };
  var TRY = ['Not quite, but you are close. Check the steps below.', 'Good try. Here is how it works:', 'No worries. Even pros miss shots. Here is the trick:'];
  function rand(a) { return a[Math.floor(Math.random() * a.length)]; }

  // ---------- read aloud (optional helper for a struggling reader) ----------
  var canSpeak = typeof window.speechSynthesis !== 'undefined' && typeof window.SpeechSynthesisUtterance !== 'undefined';
  function speak(text) {
    if (!canSpeak) return;
    try { window.speechSynthesis.cancel(); var u = new SpeechSynthesisUtterance(text); u.rate = 0.9; window.speechSynthesis.speak(u); } catch (e) { /* ignore */ }
  }

  // ---------- visuals ----------
  function barSVG(o) {
    var d = o.d, w = o.width || 560, h = o.height || 58, segW = w / d, fill = o.color || '#00d1ff';
    var shaded = o.shadedSet || null;
    var s = '<svg viewBox="0 0 ' + (w + 4) + ' ' + (h + 4) + '" width="' + (w + 4) + '" height="' + (h + 4) + '" role="img" aria-label="Fraction bar with ' + d + ' equal parts">';
    for (var i = 0; i < d; i++) {
      var on = shaded ? shaded.indexOf(i) >= 0 : (!o.hideShade && i < o.n);
      s += '<rect class="seg' + (o.interactive ? ' click' : '') + '" data-bar="' + (o.id || '') + '" data-seg="' + i + '" x="' + (2 + i * segW) + '" y="2" width="' + segW + '" height="' + h + '" rx="6" fill="' + (on ? fill : '#1b2350') + '" stroke="#e8ecff" stroke-width="2"></rect>';
    }
    s += '</svg>';
    return (o.label ? '<div class="bar-label">' + esc(o.label) + '</div>' : '') + s;
  }
  function numberLineSVG(n, d) {
    var w = 580, x0 = 30, x1 = 550, y = 50, s = '<svg viewBox="0 0 ' + w + ' 100" width="' + w + '" height="100" role="img" aria-label="Number line from 0 to 1 split into ' + d + ' equal jumps">';
    s += '<line x1="' + x0 + '" y1="' + y + '" x2="' + x1 + '" y2="' + y + '" stroke="#e8ecff" stroke-width="4"/>';
    for (var i = 0; i <= d; i++) { var x = x0 + (x1 - x0) * i / d; s += '<line x1="' + x + '" y1="' + (y - 14) + '" x2="' + x + '" y2="' + (y + 14) + '" stroke="#e8ecff" stroke-width="3"/>'; }
    s += '<text x="' + x0 + '" y="' + (y + 40) + '" fill="#e8ecff" font-size="22" text-anchor="middle" font-weight="700">0</text>';
    s += '<text x="' + x1 + '" y="' + (y + 40) + '" fill="#e8ecff" font-size="22" text-anchor="middle" font-weight="700">1</text>';
    var px = x0 + (x1 - x0) * n / d;
    s += '<circle cx="' + px + '" cy="' + y + '" r="12" fill="#f59e0b" stroke="#fff" stroke-width="3"/>';
    return s + '</svg>';
  }
  function rectSVG(v) {
    var maxW = 420, maxH = 200, sc = Math.min(maxW / v.L, maxH / v.W), w = Math.max(80, v.L * sc), h = Math.max(50, v.W * sc);
    var s = '<svg viewBox="0 0 ' + (w + 120) + ' ' + (h + 70) + '" width="' + (w + 120) + '" height="' + (h + 70) + '" role="img" aria-label="Rectangle ' + v.L + ' by ' + v.W + ' ' + esc(v.unit) + '">';
    s += '<rect x="60" y="20" width="' + w + '" height="' + h + '" fill="#123a2a" stroke="#5eead4" stroke-width="4" rx="4"/>';
    s += '<text x="' + (60 + w / 2) + '" y="' + (h + 55) + '" fill="#e8ecff" font-size="20" font-weight="800" text-anchor="middle">' + v.L + ' ' + esc(v.unit) + '</text>';
    s += '<text x="50" y="' + (20 + h / 2 + 7) + '" fill="#e8ecff" font-size="20" font-weight="800" text-anchor="end">' + v.W + '</text>';
    return s + '</svg>';
  }
  function boxSVG(v) {
    var s = '<svg viewBox="0 0 360 230" width="360" height="230" role="img" aria-label="Box ' + v.L + ' by ' + v.W + ' by ' + v.H + '">';
    s += '<polygon points="60,80 240,80 300,40 120,40" fill="#3b2a6b" stroke="#c4b5fd" stroke-width="3"/>';
    s += '<polygon points="240,80 300,40 300,160 240,200" fill="#2a1f52" stroke="#c4b5fd" stroke-width="3"/>';
    s += '<rect x="60" y="80" width="180" height="120" fill="#4c3a8a" stroke="#c4b5fd" stroke-width="3"/>';
    s += '<text x="150" y="224" fill="#e8ecff" font-size="18" font-weight="800" text-anchor="middle">length ' + v.L + '</text>';
    s += '<text x="40" y="146" fill="#e8ecff" font-size="18" font-weight="800" text-anchor="middle">h ' + v.H + '</text>';
    s += '<text x="300" y="30" fill="#e8ecff" font-size="18" font-weight="800" text-anchor="middle">width ' + v.W + '</text>';
    return s + '</svg>';
  }
  function renderVisual(q, r) {
    var v = q.visual; if (!v) return '';
    var out = '<div class="visual">';
    if (v.type === 'bar') out += barSVG({ n: v.n, d: v.d });
    else if (v.type === 'numberline') out += numberLineSVG(v.n, v.d);
    else if (v.type === 'rect') out += rectSVG(v);
    else if (v.type === 'box') out += boxSVG(v);
    else if (v.type === 'bars') v.bars.forEach(function (b, i) { out += barSVG({ n: b.n, d: b.d, label: b.label, hideShade: v.hideSecondShade && i === 1 && !(r && r.answered), color: i ? '#a78bfa' : '#00d1ff' }); });
    else if (v.type === 'shade') {
      var sh = (r && r.shaded) || [];
      out += barSVG({ d: v.d, interactive: !(r && r.answered), shadedSet: sh, id: 'q' });
      out += '<div class="muted" id="shadeReadout">You shaded <b>' + sh.length + '/' + v.d + '</b>. Click a part again to unshade it.</div>';
    } else if (v.type === 'addHelper') {
      var a = v.a, b = v.b;
      out += barSVG({ n: a.n, d: a.d, label: E.fstr(a) }) + '<div class="bar-label">' + (v.op === '+' ? 'plus' : 'minus') + '</div>' + barSVG({ n: b.n, d: b.d, label: E.fstr(b), color: '#a78bfa' });
      if (a.d === b.d) out += '<div class="muted">Same bottom numbers already. Just ' + (v.op === '+' ? 'add' : 'subtract') + ' the tops.</div>';
      else if (r && r.lcdShown) {
        var L = E.lcm(a.d, b.d), an = a.n * L / a.d, bn = b.n * L / b.d;
        out += '<div class="hintbox"><b>Matching denominator: ' + L + '</b><br>' + E.fstr(a) + ' = ' + an + '/' + L + ' and ' + E.fstr(b) + ' = ' + bn + '/' + L + '</div>';
        out += barSVG({ n: an, d: L, label: an + '/' + L }) + barSVG({ n: bn, d: L, label: bn + '/' + L, color: '#a78bfa' });
      } else if (r) out += '<button class="btn ghost small" data-action="lcd">🔧 Find a matching denominator</button>';
    }
    return out + '</div>';
  }
  function renderPassage(q) {
    if (!q.passage) return '';
    return '<div class="passage" id="passage"><div class="ptitle">📖 ' + esc(q.passage.title) + '</div><p>' + esc(q.passage.text) + '</p></div>';
  }
  function readAloudBtn() { return canSpeak ? '<button class="btn ghost small" data-action="speak" id="speakBtn">🔊 Read it to me</button>' : ''; }

  // ---------- HUD ----------
  function renderHud() {
    var b = E.beltForXp(state.xp);
    document.getElementById('hud').innerHTML =
      '<span class="chip belt-chip" style="background:' + b.color + ';color:' + b.text + '">🎖️ ' + b.name + ' Rank</span>' +
      '<span class="chip">⭐ ' + state.xp + ' XP</span>' +
      '<span class="chip" title="Correct answers in a row">🔥 ' + state.answerStreak + '</span>' +
      '<span class="chip" title="Days in a row">📅 ' + (state.dayStreak || 0) + ' day' + (state.dayStreak === 1 ? '' : 's') + '</span>' +
      '<span class="chip sync-chip" id="syncChip">☁️</span>';
    updateSyncIndicator();
    document.querySelectorAll('.nav button').forEach(function (btn) {
      var r = btn.getAttribute('data-nav');
      var active = r === route || (r === 'practice' && (route === 'round' || route === 'roundEnd')) || (r === 'placement' && (route === 'placementResults' || route === 'placementRun'));
      btn.classList.toggle('active', active);
    });
    document.body.classList.toggle('parent-mode', route === 'parent');
  }

  function recommendedModule() { var rec = E.recommendNext(state); return rec.module || null; }
  function statusBadge(st) { return '<span class="sbadge ' + st.key + '">' + esc(st.label) + '</span>'; }

  function moduleCard(m, recId) {
    var rec = m.id === recId, s = subj(m.subject);
    return '<div class="card module' + (rec ? ' recommended' : '') + '" data-action="start" data-module="' + m.id + '" role="button" tabindex="0" aria-label="Start ' + esc(m.title) + '">' +
      '<div class="row"><span class="icon">' + m.icon + '</span><span class="num">' + esc(s.label) + ' ' + m.num + '</span><span class="spacer"></span>' + (rec ? '<span class="badge">Start here</span>' : '') + '</div>' +
      '<h3>' + esc(m.title) + '</h3><p class="muted">' + esc(m.blurb) + '</p></div>';
  }
  function moduleGrid(subject, recId) {
    if (subject === 'all') {
      return E.SUBJECTS.map(function (s) {
        return '<h2 class="subject-head" id="head-' + s.id + '">' + s.icon + ' ' + esc(s.label) + '</h2><div class="grid cols-3">' + E.modulesFor(s.id).map(function (m) { return moduleCard(m, recId); }).join('') + '</div>';
      }).join('');
    }
    return '<div class="grid cols-3">' + E.modulesFor(subject).map(function (m) { return moduleCard(m, recId); }).join('') + '</div>';
  }
  function subjectTabs() {
    var tabs = [['all', '🗓️ All / Today\'s Mission']].concat(E.SUBJECTS.map(function (s) { return [s.id, s.icon + ' ' + s.label]; }));
    return '<div class="subject-tabs" role="tablist" aria-label="Subjects">' + tabs.map(function (t) {
      return '<button role="tab" aria-selected="' + (tab === t[0]) + '" data-action="tab" data-tab="' + t[0] + '" class="' + (tab === t[0] ? 'active' : '') + '">' + t[1] + '</button>';
    }).join('') + '<button data-nav="lab" class="lab-tab">🧪 Fraction Lab</button></div>';
  }
  function themeBar() {
    var opts = [['all', '🎮 All Themes']].concat(E.THEME_KEYS.map(function (k) { return [k, E.THEMES[k].emoji + ' ' + E.THEMES[k].label]; }));
    return '<div class="theme-bar" role="group" aria-label="Theme">' + opts.map(function (o) {
      return '<button data-action="theme" data-theme="' + o[0] + '" class="' + (state.theme === o[0] ? 'active' : '') + '">' + o[1] + '</button>';
    }).join('') + '</div>';
  }
  function beltProgress() {
    var b = E.beltForXp(state.xp), nb = E.nextRank(state.xp);
    if (!nb) return '<p>You reached <b>Black Rank</b>. Legend status.</p>';
    var pct = Math.round(100 * (state.xp - b.xp) / (nb.xp - b.xp));
    return '<p class="muted">' + (nb.xp - state.xp) + ' XP to <b>' + nb.name + ' Rank</b></p><div class="progress"><div style="width:' + pct + '%"></div></div>';
  }
  function missionCard(compact) {
    var done = state.missionDoneDate === E.todayKey(), due = E.dueSkills(state);
    return '<div class="card mission-card"' + (compact ? '' : ' style="margin-top:14px"') + '><div class="row"><div style="flex:1;min-width:220px"><h2>🗓️ Today\'s Daily Mission</h2><p class="muted">' +
      (done ? 'Mission done today. Nice work! You can run it again for extra XP.' : 'A quick mix of subjects, weakest ones first. Keep your day streak alive.') + '</p>' +
      (due.length ? '<p class="review-note" id="reviewNote">🔁 Includes skills due for review today: ' + esc(due.slice(0, 4).map(function (k) { return E.SKILLS[k].label; }).join(', ')) + (due.length > 4 ? ' and more' : '') + '</p>' : '') + '</div>' +
      '<button class="btn purple" data-action="mission" data-count="5" id="mission5">' + (done ? 'Run 5 again' : 'Quick 5 Questions') + '</button>' +
      '<button class="btn ghost" data-action="mission" data-count="7" id="mission7">Full 7 Questions</button></div></div>';
  }

  // ---------- screens ----------
  function renderHome() {
    var b = E.beltForXp(state.xp), st = E.allSubjectStatuses(state);
    var html = '<div class="card hero"><div class="belt-big" style="background:' + b.color + ';color:' + b.text + '"><span class="knot">🎖️</span>' + b.name + '</div>' +
      '<div style="flex:1;min-width:240px"><h1>What\'s up, ' + playerName() + '!</h1><p class="muted">Welcome to Dispatch Academy: math, reading, spelling, grammar, citizenship, science, and social studies.</p>' + beltProgress() + '</div></div>';
    if (!E.hasAnyCheck(state)) {
      html += '<div class="card start-card" style="margin-top:14px"><h2>🎯 Start here: Quick Placement Check</h2><p>16 questions across all 7 subjects, about 10 minutes. It finds your starting rank and what to work on first. No timer. If you do not know one, just hit <b>Not sure yet</b>. That is totally fine.</p>' +
        '<div class="row" style="margin-top:10px"><button class="btn" data-action="placement-start" data-kind="full">Start Full Placement Check</button><button class="btn ghost" data-nav="placement">Or do a shorter check</button></div></div>';
    }
    html += missionCard();
    html += '<h2 style="margin-top:22px">Pick a Subject</h2><div class="grid cols-4" id="subjectCards">' + E.SUBJECTS.map(function (s) {
      return '<div class="card subject-card" data-action="subject" data-subject="' + s.id + '" role="button" tabindex="0" aria-label="Open ' + esc(s.label) + '"><div class="sicon">' + s.icon + '</div><h3>' + esc(s.label) + '</h3>' + statusBadge(st[s.id]) + '<p class="muted small">' + E.modulesFor(s.id).length + ' modules</p></div>';
    }).join('') + '<div class="card subject-card" data-nav="lab" role="button" tabindex="0" aria-label="Open Fraction Lab"><div class="sicon">🧪</div><h3>Fraction Lab</h3><span class="sbadge none">Play tool</span><p class="muted small">Click bars to build fractions</p></div></div>';
    html += '<div class="family-row" id="familyRow"><span class="sync-status" data-sync-status></span><button class="linkbtn" data-action="link-open" id="haveCodeBtn">Already have a Family Code?</button></div>';
    app.innerHTML = html;
  }
  function renderPractice() {
    var rec = recommendedModule();
    var html = '<h1>Practice Arena</h1><p class="muted">Short rounds of 5 questions. Hints are always free to use and still earn XP.</p>' + subjectTabs() + themeBar();
    if (tab === 'all') html += missionCard(true) + '<div style="height:10px"></div>';
    else { var s = subj(tab); html += '<div class="card" style="margin-bottom:14px"><div class="row"><h2 style="margin:0">' + s.icon + ' ' + esc(s.label) + '</h2><span class="spacer"></span>' + statusBadge(E.subjectStatus(state, tab)) + '</div>' + (s.id !== 'math' ? '<p class="muted small" style="margin-top:6px">Theme filter shows matching questions first, then mixes in the others.</p>' : '') + '</div>'; }
    html += '<div id="moduleGrid">' + moduleGrid(tab, rec) + '</div>';
    app.innerHTML = html;
  }

  // ----- placement -----
  function startPlacement(kind) {
    kind = E.PLACEMENT_SETS[kind] ? kind : 'full';
    placement = { kind: kind, set: E.PLACEMENT_SETS[kind], idx: 0, results: [], draft: {}, selected: null, startedAt: Date.now() };
    route = 'placementRun'; render(); window.scrollTo(0, 0);
  }
  function renderPlacementRun() {
    var set = placement.set, q = set[placement.idx], n = set.length, info = E.PLACEMENT_INFO[placement.kind], s = subj(q.subject);
    var html = '<div class="card qcard"><div class="qmeta"><span>🎯 ' + esc(info.label) + ' &nbsp;·&nbsp; ' + s.icon + ' ' + esc(s.label) + '</span><span>Question ' + (placement.idx + 1) + ' of ' + n + '</span></div>' +
      '<div class="progress" style="margin-bottom:12px"><div style="width:' + Math.round(placement.idx * 100 / n) + '%"></div></div>' +
      renderPassage(q) + '<div class="qprompt" id="qprompt">' + esc(q.prompt) + '</div>' + renderVisual(q, null) +
      answerInputs(q, placement) +
      '<div class="row" style="margin-top:14px"><button class="btn" data-action="placement-answer">Lock it in</button><button class="btn ghost" data-action="placement-skip">🤔 Not sure yet</button>' + readAloudBtn() + '</div>' +
      '<p class="muted" style="margin-top:12px">No score shown until the end. Just do your best.</p></div>';
    app.innerHTML = html; focusFirstInput();
  }
  function placementSubmit(skip) {
    var q = placement.set[placement.idx], given = skip ? null : gatherInput(q, placement);
    if (!skip) {
      if (given === null || given === '' || given === undefined) { toast(q.answerType === 'choice' ? 'Pick an answer first, or hit Not sure yet.' : 'Type your answer first, or hit Not sure yet.'); return; }
      var chk = E.checkAnswer(q, given);
      if (chk.invalid) { toast(chk.message); return; }
      placement.results.push({ pid: q.pid, correct: chk.correct, skipped: false, given: String(given) });
    } else placement.results.push({ pid: q.pid, correct: false, skipped: true, given: null });
    placement.idx += 1; placement.draft = {}; placement.selected = null;
    if (placement.idx >= placement.set.length) return finishPlacement();
    toast(skip ? 'No problem. Moving on!' : 'Locked in!', 900);
    render();
  }
  function finishPlacement() {
    var kind = placement.kind, set = placement.set;
    var r = E.applyPlacement(state, placement.results, kind);
    var missed = placement.results.filter(function (x) { return !x.correct; }).map(function (x) {
      var q = set.filter(function (p) { return p.pid === x.pid; })[0];
      return { prompt: q.prompt, given: x.skipped ? 'not sure yet' : x.given, answer: E.answerText(q), note: q.note, subject: q.subject };
    });
    var subs = []; set.forEach(function (p) { if (subs.indexOf(p.subject) < 0) subs.push(p.subject); });
    E.recordSession(state, { mode: 'placement', kind: kind, module: 'placement', subjects: subs, theme: 'all', score: r.score, total: r.total, hints: 0, minutes: (Date.now() - placement.startedAt) / 60000, missed: missed });
    save(); lastPlacementResult = r; placement = null; route = 'placementResults'; render(); window.scrollTo(0, 0);
  }
  function renderPlacementResults() {
    var c = state.placement;
    if (!c) { route = 'home'; return render(); }
    var b = E.beltByName(c.belt), m = E.moduleById(c.startModule) || E.moduleById('warmup'), info = E.PLACEMENT_INFO[c.kind || 'full'];
    var pct = c.score / c.total;
    var msg = pct >= 0.85 ? 'You crushed it. Time to level up even more.' : pct >= 0.55 ? 'Solid start. A few skills to sharpen and you will be flying.' : pct >= 0.25 ? 'Good start. Now we know exactly what to train.' : 'Every chief started as a recruit. We will build it up step by step.';
    var st = E.allSubjectStatuses(state);
    var rows = E.SUBJECTS.map(function (s) {
      var ps = c.perSubject && c.perSubject[s.id];
      var stars = ps ? '⭐'.repeat(ps.correct) + '☆'.repeat(ps.total - ps.correct) : '';
      return '<div class="area-pill rc-row" data-subject="' + s.id + '"><b>' + s.icon + ' ' + esc(s.label) + '</b>' + (ps ? '<span class="stars">' + stars + '</span>' : '<span class="muted small">Not in this check</span>') + statusBadge(st[s.id]) + '</div>';
    }).join('');
    var others = E.PLACEMENT_KINDS.filter(function (k) { return k !== c.kind && !(state.checks && state.checks[k]); });
    app.innerHTML = '<div class="card qcard" id="placementResults"><div class="hero"><div class="belt-big" style="background:' + b.color + ';color:' + b.text + '"><span class="knot">🎖️</span>' + b.name + '</div><div><h1>Report Card: ' + b.name + ' Rank start!</h1><p>' + esc(info.label) + ': you got <b>' + c.score + ' out of ' + c.total + '</b>. ' + msg + '</p></div></div>' +
      '<h2 style="margin-top:14px">All-Subject Report Card</h2><p class="muted small"><b>Solid</b> = got it. <b>Working On It</b> = getting there. <b>Needs Focus First</b> = start here.</p>' +
      '<div class="result-areas" id="reportCard">' + rows + '</div>' +
      '<div class="card mission-card" style="margin:14px 0"><h2>🗓️ Today\'s Balanced Daily Mission is set</h2><p class="muted">It starts with your weakest subjects first.</p><div class="row"><button class="btn purple" data-action="mission" data-count="5" id="resultsMission5">Start Quick 5</button><button class="btn ghost" data-action="mission" data-count="7" id="resultsMission7">Start Full 7</button></div></div>' +
      '<div class="card module recommended" data-action="start" data-module="' + m.id + '" role="button"><span class="badge">Your starting module</span><h2 style="margin-top:8px">' + m.icon + ' ' + esc(subj(m.subject).label) + ': ' + esc(m.title) + '</h2><p class="muted">' + esc(m.blurb) + '</p></div>' +
      '<div class="row" style="margin-top:14px"><button class="btn" data-action="start" data-module="' + m.id + '" id="startRecommended">Start ' + esc(m.title) + '</button><button class="btn ghost" data-nav="home">Home</button></div>' +
      (others.length ? '<p class="muted" style="margin-top:14px">Want more detail? You can also take: ' + others.map(function (k) { return '<button class="btn ghost small" data-action="placement-start" data-kind="' + k + '">' + esc(E.PLACEMENT_INFO[k].label) + '</button>'; }).join(' ') + '</p>' : '') + '</div>';
  }
  function renderPlacementIntro() {
    var cards = E.PLACEMENT_KINDS.map(function (k) {
      var info = E.PLACEMENT_INFO[k], n = E.PLACEMENT_SETS[k].length, c = state.checks && state.checks[k];
      return '<div class="card check-card' + (k === 'full' ? ' recommended' : '') + '" id="check-' + k + '"><h3>' + (k === 'full' ? '⭐ ' : '') + esc(info.label) + '</h3><p class="muted">' + esc(info.short) + '. ' + n + ' questions, about ' + info.minutes + ' minutes.</p>' +
        (c ? '<p class="small">Last time: <b>' + c.score + ' of ' + c.total + '</b> on ' + E.fmtDate(c.date) + '</p>' : '') +
        '<button class="btn' + (k === 'full' ? '' : ' ghost') + '" data-action="placement-start" data-kind="' + k + '">' + (c ? 'Take it again' : 'Start') + '</button></div>';
    }).join('');
    app.innerHTML = '<div class="qcard"><h1>🎯 Placement Checks</h1><p>No timer and no pressure. If you do not know one, hit <b>Not sure yet</b>. Taking a check again will never lower your rank.</p>' +
      '<p class="muted">Dad tip: the Full Check covers all 7 subjects at once. To split it into shorter sittings, do the Math-Only Check one day and the Reading & Writing Check another day.</p>' +
      '<div class="grid cols-2" style="margin-top:12px">' + cards + '</div>' +
      (state.placement ? '<div class="row" style="margin-top:14px"><button class="btn ghost" data-action="placement-view">See my last Report Card</button></div>' : '') + '</div>';
  }

  // ----- rounds -----
  function startRound(moduleId, mode, count) {
    var qs = mode === 'mission' ? E.generateMission(state, state.theme, Math.random, count) : E.generateRound(moduleId, state.theme, Math.random, 5, state);
    runner = { mode: mode || 'practice', module: moduleId || 'mission', questions: qs, idx: 0, results: [], hintsShown: 0, answered: false, shaded: [], lcdShown: false, draft: {}, selected: null, xpGained: 0, hintsTotal: 0, startRank: E.beltIndexForXp(state.xp), almostUsed: false, missed: [], startedAt: Date.now() };
    route = 'round'; render(); window.scrollTo(0, 0);
  }
  function answerInputs(q, r) {
    var dis = r && r.answered ? ' disabled' : '';
    var d = (r && r.draft) || {};
    if (q.answerType === 'number') return '<div class="answer-area"><label for="ans" class="muted">Your answer:</label><input id="ans" class="num-input" inputmode="numeric" autocomplete="off" value="' + esc(d.ans || '') + '"' + dis + '></div>';
    if (q.answerType === 'decimal') return '<div class="answer-area"><label for="ans" class="muted">Your answer:</label>' + (q.money ? '<span class="money-sign">$</span>' : '') + '<input id="ans" class="num-input" inputmode="decimal" autocomplete="off" placeholder="0.00" value="' + esc(d.ans || '') + '"' + dis + '></div>';
    if (q.answerType === 'text') return '<div class="answer-area"><label for="ans" class="muted">Type the word:</label><input id="ans" class="text-input" type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" value="' + esc(d.ans || '') + '"' + dis + '></div>';
    if (q.answerType === 'fraction') return '<div class="answer-area"><span class="muted">Your answer:</span><span class="frac-input"><input id="num" aria-label="Top number (numerator)" inputmode="numeric" autocomplete="off" value="' + esc(d.num || '') + '"' + dis + '><span class="line"></span><input id="den" aria-label="Bottom number (denominator)" inputmode="numeric" autocomplete="off" value="' + esc(d.den || '') + '"' + dis + '></span><span class="muted" style="font-size:15px">top number<br>over<br>bottom number</span></div>';
    if (q.answerType === 'choice') {
      var long = q.choices.some(function (c) { return String(c).length > 16; });
      return '<div class="answer-area' + (long ? ' long-choices' : '') + '">' + q.choices.map(function (c, i) {
        var cls = 'choice' + (long ? ' long' : '');
        if (r && r.answered) { if (c === String(q.answer)) cls += ' correct'; else if (c === r.selected) cls += ' wrong'; }
        else if (r && r.selected === c) cls += ' selected';
        return '<button class="' + cls + '" data-action="choose" data-idx="' + i + '"' + dis + '>' + (long ? '<span class="letter">' + 'ABCD'[i] + '</span> ' : '') + esc(c) + '</button>';
      }).join('') + '</div>';
    }
    return ''; // shade uses the bar
  }
  function gatherInput(q, r) {
    if (q.answerType === 'number' || q.answerType === 'decimal' || q.answerType === 'text') { var el = document.getElementById('ans'); return el ? el.value : ''; }
    if (q.answerType === 'fraction') {
      var n = (document.getElementById('num') || {}).value || '', d = (document.getElementById('den') || {}).value || '';
      n = n.trim(); d = d.trim();
      if (!n) return '';
      return d ? n + '/' + d : n;
    }
    if (q.answerType === 'choice') return r.selected;
    if (q.answerType === 'shade') return r.shaded.length ? r.shaded.length : null;
    return '';
  }
  function focusFirstInput() { var el = app.querySelector('#ans, #num'); if (el && !el.disabled && window.innerWidth > 700) el.focus(); }

  function renderRound() {
    var r = runner, q = r.questions[r.idx], m = E.moduleById(q.module), s = subj(q.subject);
    var title = r.mode === 'mission' ? '🗓️ Daily Mission &nbsp;·&nbsp; ' + s.icon + ' ' + esc(s.label) : m.icon + ' ' + esc(m.title);
    var dots = r.questions.map(function (_, i) { var c = i < r.results.length ? (r.results[i] ? 'r' : 'w') : ''; if (i === r.idx) c += ' c'; return '<span class="' + c + '"></span>'; }).join('');
    var th = E.THEMES[q.theme];
    var html = '<div class="card qcard"><div class="qmeta"><span>' + title + ' &nbsp;·&nbsp; ' + th.emoji + ' ' + th.label + '</span><span class="dots" aria-label="Round progress">' + dots + '</span><span>Question ' + (r.idx + 1) + ' of ' + r.questions.length + '</span></div>' +
      '<div class="qbadges"><span class="lvl-badge l' + E.clampLevel(q.level) + '" id="levelBadge">' + esc(E.levelLabel(q.level)) + '</span>' + (q.review ? '<span class="review-badge">🔁 Review</span>' : '') + '</div>' +
      renderPassage(q) + '<div class="qprompt" id="qprompt">' + esc(q.prompt) + '</div>' + renderVisual(q, r) + answerInputs(q, r);
    if (r.hintsShown) html += '<div class="hintbox" id="hintbox"><b>💡 Hint' + (r.hintsShown > 1 ? 's' : '') + '</b><ol>' + q.hints.slice(0, r.hintsShown).map(function (h) { return '<li>' + esc(h) + '</li>'; }).join('') + '</ol><div class="muted" style="font-size:14px">Using hints is smart. You still earn XP.</div></div>';
    if (r.feedback) html += r.feedback;
    html += '<div class="row" style="margin-top:14px">';
    if (!r.answered) {
      html += '<button class="btn" data-action="check" id="checkBtn">Check Answer</button>';
      html += '<button class="btn ghost" data-action="hint" id="hintBtn"' + (r.hintsShown >= q.hints.length ? ' disabled' : '') + '>💡 ' + (r.hintsShown ? (r.hintsShown >= q.hints.length ? 'No more hints' : 'Another hint') : 'Need a Hint?') + '</button>';
      html += readAloudBtn();
    } else {
      html += '<button class="btn" data-action="next" id="nextBtn">' + (r.idx + 1 >= r.questions.length ? 'Finish Round 🏁' : 'Next Question ➜') + '</button>';
    }
    html += '<span class="spacer"></span><button class="btn ghost small" data-action="quit">Exit round</button></div></div>';
    app.innerHTML = html;
    if (!r.answered) focusFirstInput();
  }
  function checkRound() {
    var r = runner, q = r.questions[r.idx];
    var given = gatherInput(q, r);
    if (given === null || given === '' || given === undefined) { toast(q.answerType === 'shade' ? 'Click some parts of the bar first.' : q.answerType === 'choice' ? 'Pick an answer first.' : 'Type your answer first.'); return; }
    var chk = E.checkAnswer(q, given);
    if (chk.invalid) { toast(chk.message); return; }
    if (chk.almost && !r.almostUsed) {
      r.almostUsed = true;
      r.feedback = '<div class="feedback almost" id="feedback"><div class="title">So close!</div>' + esc(chk.message) + '</div>';
      return render();
    }
    var usedHint = r.hintsShown > 0;
    var res = E.recordAnswerDetailed(state, q, chk.correct, usedHint), gained = res.xp;
    r.xpGained += gained; r.hintsTotal += r.hintsShown; r.results.push(chk.correct); r.answered = true;
    if (q.answerType === 'choice') r.selected = String(given);
    if (q.answerType === 'number' || q.answerType === 'decimal' || q.answerType === 'text') r.draft.ans = String(given);
    if (!chk.correct) r.missed.push({ prompt: q.prompt, given: q.answerType === 'shade' ? given + ' parts shaded' : String(given), answer: E.answerText(q), note: q.note || '', subject: q.subject });
    if (!chk.correct && q.visual && q.visual.type === 'addHelper') r.lcdShown = true;
    save();
    r.feedback = chk.correct
      ? '<div class="feedback good" id="feedback"><div class="title">✅ ' + esc(rand(CHEERS[q.theme])) + ' +' + gained + ' XP</div>' + esc(q.explain) + '</div>'
      : '<div class="feedback bad" id="feedback"><div class="title">' + esc(rand(TRY)) + ' +' + gained + ' XP for trying</div>The answer is <b>' + esc(E.answerText(q)) + '</b>. ' + esc(q.explain) + '</div>' + walkCard(q, given);
    if (res.levelTo !== res.levelFrom) relevelRest(r, res.skill, res.levelTo);
    render();
    if (res.levelTo > res.levelFrom) toast('⬆️ Level up! ' + E.SKILLS[res.skill].label + ' is now ' + E.levelLabel(res.levelTo) + '.', 3200);
    else if (res.levelTo < res.levelFrom) toast('Switching ' + E.SKILLS[res.skill].label + ' to ' + E.levelLabel(res.levelTo) + ' to build it back up.', 3200);
  }
  // when a skill changes level mid-round, the rest of its questions switch to the new level right away
  function relevelRest(r, skill, level) {
    var prompts = r.questions.map(function (x) { return x.prompt; });
    for (var j = r.idx + 1; j < r.questions.length; j++) {
      var old = r.questions[j];
      if (old.skill !== skill || old.passage) continue;
      for (var t = 0; t < 8; t++) {
        var nq = E.generateQuestion(old.module, state.theme, Math.random, j, level);
        if (prompts.indexOf(nq.prompt) < 0 || t === 7) { nq.review = old.review; r.questions[j] = nq; prompts[j] = nq.prompt; break; }
      }
    }
  }
  // "How to solve it" card shown on a miss, before Next
  function walkCard(q, given) {
    var w = E.walkthrough(q, given);
    var html = '<div class="walk" id="walkthrough"><div class="walk-title">🧭 How to solve it</div><p class="walk-answer">Right answer: <b>' + esc(w.answer) + '</b></p>';
    if (w.steps.length) html += '<ol class="walk-steps">' + w.steps.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ol>';
    if (w.compare) {
      var g = w.compare.given, a = w.compare.answer, c = E.compareF(g, a);
      var verdict = c > 0 ? 'Your answer is a little too big.' : c < 0 ? 'Your answer is a little too small.' : 'Same amount, but write it in simplest form.';
      html += '<div class="walk-compare" id="walkCompare">' + barSVG({ n: g.n, d: g.d, label: 'Your answer: ' + E.fstr(g), color: '#f87171' }) + barSVG({ n: a.n, d: a.d, label: 'Right answer: ' + E.fstr(a), color: '#34d399' }) + '<div class="muted">' + verdict + '</div></div>';
    }
    if (w.rule) html += '<p class="walk-rule"><b>Remember:</b> ' + esc(w.rule) + '</p>';
    return html + '</div>';
  }
  function nextQuestion() {
    var r = runner;
    if (r.idx + 1 >= r.questions.length) return finishRound();
    r.idx += 1; r.answered = false; r.hintsShown = 0; r.shaded = []; r.lcdShown = false; r.draft = {}; r.selected = null; r.feedback = null; r.almostUsed = false;
    render();
  }
  function finishRound() {
    var r = runner, score = r.results.filter(Boolean).length;
    var bonus = score === r.questions.length ? 15 : 0;
    state.xp += bonus;
    var subs = []; r.questions.forEach(function (q) { if (subs.indexOf(q.subject) < 0) subs.push(q.subject); });
    E.recordSession(state, { mode: r.mode, module: r.module, subjects: subs, theme: state.theme, score: score, total: r.questions.length, hints: r.hintsTotal, minutes: (Date.now() - r.startedAt) / 60000, missed: r.missed });
    save();
    lastRound = { mode: r.mode, module: r.module, count: r.questions.length, score: score, total: r.questions.length, xp: r.xpGained + bonus, bonus: bonus, beltUp: E.beltIndexForXp(state.xp) > r.startRank };
    runner = null; route = 'roundEnd'; render(); window.scrollTo(0, 0);
  }
  function renderRoundEnd() {
    var L = lastRound; if (!L) { route = 'home'; return render(); }
    var b = E.beltForXp(state.xp), m = E.moduleById(L.module);
    var msg = L.score === L.total ? 'Perfect round! Flawless victory.' : L.score >= Math.ceil(L.total * 0.6) ? 'Strong round. Keep stacking wins.' : 'Every round makes you stronger. Try it again and watch the score climb.';
    app.innerHTML = '<div class="card qcard" id="roundEnd">' + (L.beltUp ? '<div class="feedback good"><div class="title">🎉 BELT UP! You are now a ' + b.name + ' Rank!</div></div>' : '') +
      '<h1>' + L.score + ' / ' + L.total + ' correct</h1><p>' + msg + '</p><p><b>+' + L.xp + ' XP</b> this round' + (L.bonus ? ' (includes a +15 perfect-round bonus)' : '') + '.</p>' + beltProgress() +
      '<div class="row" style="margin-top:16px">' + (L.mode === 'mission' ? '<button class="btn purple" data-action="mission" data-count="' + L.count + '">Run Mission Again</button>' : '<button class="btn" data-action="start" data-module="' + L.module + '">Play ' + esc(m ? m.title : '') + ' Again</button>') +
      '<button class="btn ghost" data-nav="practice">Pick Another Module</button><button class="btn ghost" data-nav="home">Home</button></div></div>';
  }

  // ----- lab -----
  function renderLab() {
    var f1 = E.frac(lab.s1.length, lab.d1), f2 = E.frac(lab.s2.length, lab.d2), c = E.compareF(f1, f2);
    function opts(sel) { var o = ''; for (var i = 1; i <= 12; i++) o += '<option value="' + i + '"' + (i === sel ? ' selected' : '') + '>' + i + '</option>'; return o; }
    var verdict = (lab.s1.length === 0 && lab.s2.length === 0) ? 'Click parts of the bars to shade them.' : c === 0 ? '🟰 They are EQUAL! ' + E.fstr(f1) + ' = ' + E.fstr(f2) : c > 0 ? '⬆️ Top bar is bigger: ' + E.fstr(f1) + ' > ' + E.fstr(f2) : '⬇️ Bottom bar is bigger: ' + E.fstr(f1) + ' < ' + E.fstr(f2);
    var html = '<h1>🧪 Fraction Lab</h1><p class="muted">Pick how many parts each bar has, then click to shade. Try to make two bars that are equal, like 1/2 and 4/8.</p><div class="card">' +
      '<div class="lab-row"><b>Top bar parts:</b><select id="labD1" data-action="labd" data-which="1">' + opts(lab.d1) + '</select><span class="bar-label" id="labF1">' + lab.s1.length + '/' + lab.d1 + '</span></div>' +
      barSVG({ d: lab.d1, interactive: true, shadedSet: lab.s1, id: 'lab1' }) +
      '<div class="lab-row" style="margin-top:14px"><b>Bottom bar parts:</b><select id="labD2" data-action="labd" data-which="2">' + opts(lab.d2) + '</select><span class="bar-label" id="labF2">' + lab.s2.length + '/' + lab.d2 + '</span></div>' +
      barSVG({ d: lab.d2, interactive: true, shadedSet: lab.s2, id: 'lab2', color: '#a78bfa' }) +
      '<div class="feedback almost" id="labVerdict" style="margin-top:14px"><div class="title">' + verdict + '</div></div>' +
      '<div class="row"><button class="btn ghost small" data-action="labcommon">' + (lab.common ? 'Hide' : 'Show') + ' matching denominator</button><button class="btn ghost small" data-action="labclear">Clear bars</button><button class="btn ghost small" data-nav="practice">Back to Practice</button></div>';
    if (lab.common && (lab.s1.length || lab.s2.length)) {
      var L = E.lcm(lab.d1, lab.d2), a = lab.s1.length * L / lab.d1, b = lab.s2.length * L / lab.d2;
      html += '<div class="hintbox">Both bars split into <b>' + L + '</b> parts: ' + E.fstr(f1) + ' = ' + a + '/' + L + ' and ' + E.fstr(f2) + ' = ' + b + '/' + L + '. Now just compare ' + a + ' and ' + b + '.</div>' + barSVG({ n: a, d: L }) + barSVG({ n: b, d: L, color: '#a78bfa' });
    }
    app.innerHTML = html + '</div>';
  }

  // ----- parent view -----
  function pvState() { return preview ? E.sampleState() : state; }
  function renderPin() {
    app.innerHTML = '<div class="pv"><h1>Dad / Parent View</h1><div class="pv-card"><p style="font-size:26px"><b>Enter the 4-digit PIN</b></p>' +
      '<input id="pinEntry" class="pin-input" type="password" inputmode="numeric" maxlength="4" autocomplete="off" aria-label="PIN">' +
      '<div><button class="pvbtn primary" data-action="pin-unlock">Open Parent View</button></div>' +
      '<p>If you never changed it, the PIN is <b>0000</b>.</p></div></div>';
    var el = document.getElementById('pinEntry'); if (el) el.focus();
  }
  function renderParent() {
    if (state.parent.pinEnabled && !parentUnlocked) return renderPin();
    var s = pvState(), st = E.allSubjectStatuses(s), sk = E.allStatuses(s), rec = E.recommendNext(s), b = E.beltForXp(s.xp), tot = E.practiceTotals(s);
    var who = s.studentName ? esc(s.studentName) : 'your son';
    var html = '<div class="pv" id="parentView">';
    if (preview) html += '<div class="preview-banner" id="previewBanner">PREVIEW MODE: this is SAMPLE data, not ' + who + '\'s real progress. <button class="pvbtn" data-action="preview-off">Exit Preview</button></div>';
    html += '<h1>Dad\'s Parent View</h1><p>Here is how ' + who + ' is doing in all 7 subjects, in plain English.</p>';
    if (!preview) html += familyCard();
    var last = s.sessions[0], checksTaken = E.PLACEMENT_KINDS.filter(function (k) { return s.checks && s.checks[k]; });
    html += '<div class="status-grid">' +
      '<div class="pv-card"><div>Rank level</div><div class="big-num">' + b.name + '</div></div>' +
      '<div class="pv-card"><div>Placement checks</div><div class="big-num">' + (checksTaken.length ? checksTaken.length + ' of 4' : 'None yet') + '</div>' + (s.checks && s.checks.full ? '<div>Full check: <b>' + s.checks.full.score + ' of ' + s.checks.full.total + '</b></div>' : '') + '</div>' +
      '<div class="pv-card"><div>Last practiced</div><div style="font-size:26px;font-weight:900">' + (last ? E.fmtDate(last.date) : 'Not yet') + '</div><div>Days in a row: <b>' + (s.dayStreak || 0) + '</b></div></div></div>';

    html += '<h2>Recommended Daily Plan &amp; Next Step</h2><div class="next" id="nextStep">👉 ' + esc(rec.text) + '</div>';
    if (!preview) {
      if (rec.placement) html += '<button class="pvbtn primary" data-action="placement-start" data-kind="full">Start the Full Placement Check for him</button><button class="pvbtn" data-action="placement-start" data-kind="math">Start the shorter Math-Only Check</button><button class="pvbtn" data-action="placement-start" data-kind="ela">Start the Reading &amp; Writing Check</button>';
      else html += '<button class="pvbtn primary" data-action="mission" data-count="5">Start Today\'s Daily Mission</button>' + (rec.module ? '<button class="pvbtn" data-action="start" data-module="' + rec.module + '">Start "' + esc(E.moduleById(rec.module).title) + '"</button>' : '');
    }

    html += reviewSection(s);
    html += '<h2>Where He Stands: All 7 Subjects</h2><p><b>Solid</b> = he has got it. <b>Working On It</b> = getting there. <b>Needs Focus First</b> = start here.</p><div class="status-grid" id="statusCards">' +
      E.SUBJECTS.map(function (sub) {
        var x = st[sub.id];
        var parts = E.skillsFor(sub.id).map(function (k) { var y = sk[k], rv = E.reviewInfo(s, k); return '<li><span class="mini ' + y.key + '">' + esc(y.label) + '</span> ' + esc(E.SKILLS[k].label) + '<br><span class="lvl-mini">' + esc(E.levelLabel(s.skill[k].level)) + '</span> <span class="rv-mini ' + rv.key + '">' + esc(rv.text) + '</span></li>'; }).join('');
        return '<div class="status ' + x.key + '" data-subject="' + sub.id + '"><span class="lbl">' + (x.key === 'solid' ? '✔ ' : x.key === 'focus' ? '! ' : '') + x.label + '</span><div class="what">' + sub.icon + ' ' + esc(sub.label) + '</div><div class="dadline">' + esc(sub.dad) + '</div><div>' + (x.total ? x.right + ' of his last ' + x.total + ' answers right' : 'No answers yet') + '</div>' +
          '<details class="parts"><summary>Show the ' + E.skillsFor(sub.id).length + ' skills</summary><ul>' + parts + '</ul></details></div>';
      }).join('') + '</div>';

    html += '<h2>Texas Homeschool Checklist</h2><div class="pv-card" id="texasChecklist"><p><b>Texas requires 5 subjects for homeschool:</b> Reading, Spelling, Grammar, Math, and Good Citizenship. This app covers all 5. <b>Science and Social Studies</b> are not required for Texas homeschool, but they round out full 5th grade (they are on the 5th grade STAAR and in public school).</p>' +
      '<table class="check-table"><thead><tr><th>Subject</th><th>Why</th><th>Days practiced</th><th>Sessions</th></tr></thead><tbody>' +
      E.SUBJECTS.map(function (sub) {
        var dd = tot.subjectDays[sub.id];
        return '<tr><td>' + (dd ? '✅ ' : '⬜ ') + esc(sub.label) + '</td><td>' + (sub.texas ? 'Texas required' : 'Full 5th grade') + '</td><td><b>' + dd + '</b></td><td>' + tot.subjectSessions[sub.id] + '</td></tr>';
      }).join('') + '</tbody></table>' +
      '<p style="margin-top:14px"><b>Practice log (for your records):</b></p><div class="status-grid" id="practiceTotals">' +
      '<div class="pv-card"><div>Days practiced</div><div class="big-num">' + tot.days + '</div></div>' +
      '<div class="pv-card"><div>Sessions</div><div class="big-num">' + tot.sessions + '</div></div>' +
      '<div class="pv-card"><div>Total minutes</div><div class="big-num">' + tot.minutes + '</div><div>Last 7 days: <b>' + tot.last7Minutes + '</b> minutes</div></div></div>' +
      (tot.dayList.length ? '<ul class="daylog" id="dayLog">' + tot.dayList.slice(-10).reverse().map(function (k) {
        var d = s.practiceLog[k], subs = Object.keys(d.subjects || {}).map(function (x) { return E.subjectById(x) ? E.subjectById(x).label : x; }).join(', ');
        return '<li><b>' + E.fmtDay(k) + ':</b> ' + d.sessions + ' session' + (d.sessions === 1 ? '' : 's') + ', ' + d.minutes + ' minutes' + (subs ? ' (' + esc(subs) + ')' : '') + '</li>';
      }).join('') + '</ul>' : '<p>No practice days logged yet.</p>') + '</div>';

    html += '<h2>Recent Sessions &amp; Missed Questions</h2>';
    if (!s.sessions.length) html += '<p>No sessions yet. Once he plays, each one shows up here.</p>';
    else html += '<table id="sessionsTable"><thead><tr><th>When</th><th>What he did</th><th>Score</th><th>Questions he missed</th></tr></thead><tbody>' +
      s.sessions.slice(0, 12).map(function (x) {
        var missed = (x.missed || []).length ? '<ul class="missed">' + x.missed.slice(0, 5).map(function (m) { return '<li>' + esc(m.prompt) + '<br><b>He said:</b> ' + esc(m.given || 'not sure yet') + ' &nbsp; <b>Answer:</b> ' + esc(m.answer) + (m.note ? '<br><i>Tip: ' + esc(m.note) + '</i>' : '') + '</li>'; }).join('') + '</ul>' : 'None. All right!';
        return '<tr><td>' + E.fmtDate(x.date) + (x.minutes ? '<br><span style="font-size:17px">' + x.minutes + ' min</span>' : '') + '</td><td>' + esc(E.sessionTitle(x)) + (x.hints ? '<br><span style="font-size:17px">Used ' + x.hints + ' hint' + (x.hints === 1 ? '' : 's') + '</span>' : '') + '</td><td><b>' + x.score + ' of ' + x.total + '</b></td><td>' + missed + '</td></tr>';
      }).join('') + '</tbody></table>';

    html += '<h2>Placement Checks</h2><div class="pv-card" id="checksCard">' + E.PLACEMENT_KINDS.map(function (k) {
      var c = s.checks && s.checks[k], info = E.PLACEMENT_INFO[k];
      return '<p><b>' + esc(info.label) + '</b> (' + esc(info.short) + ', about ' + info.minutes + ' minutes): ' + (c ? c.score + ' of ' + c.total + ' on ' + E.fmtDate(c.date) : 'not taken yet') + (preview ? '' : ' <button class="pvbtn" data-action="placement-start" data-kind="' + k + '">' + (c ? 'Retake' : 'Start') + '</button>') + '</p>';
    }).join('') + '</div>';

    html += '<h2>Print or Share</h2><button class="pvbtn primary" data-action="print">🖨️ Print Summary</button><button class="pvbtn" data-action="copy">📋 Copy Summary for John &amp; Family</button><button class="pvbtn" data-action="download">⬇️ Download Summary</button>' +
      '<details style="margin-top:10px"><summary style="cursor:pointer">Show the summary text</summary><textarea id="summaryText" readonly>' + esc(E.buildSummaryText(s)) + '</textarea></details>';
    html += '<h2>Preview Sample Data</h2><p>Want to see what this page looks like after a few days of practice? This does not touch his real progress.</p>' +
      (preview ? '<button class="pvbtn" data-action="preview-off">Exit Preview</button>' : '<button class="pvbtn" data-action="preview-on" id="previewBtn">👀 Preview Sample Data</button>');
    if (!preview) {
      html += '<h2>Settings</h2><div class="pv-card"><label for="nameInput"><b>His first name</b> (optional, shows on reports):</label><br><input type="text" id="nameInput" maxlength="20" value="' + esc(state.studentName) + '"> <button class="pvbtn" data-action="save-name">Save name</button></div>' +
        '<div class="pv-card" id="pinCard">' + (state.parent.pinEnabled
          ? '<p><b>PIN lock is ON.</b> The PIN is <b>' + (state.parent.pin === '0000' ? '0000' : 'the one you picked') + '</b>. This keeps him from resetting progress by accident.</p><label for="newPin">New 4-digit PIN:</label> <input type="tel" id="newPin" maxlength="4" inputmode="numeric"> <button class="pvbtn" data-action="pin-change">Save PIN</button><br><button class="pvbtn" data-action="pin-off">Turn PIN lock OFF</button>'
          : '<p><b>PIN lock is OFF.</b> Anyone can open this page. Turn it on so he cannot reset progress by accident. The starting PIN is <b>0000</b>.</p><button class="pvbtn" data-action="pin-on" id="pinOnBtn">Turn PIN lock ON</button>') + '</div>' +
        '<div class="pv-card"><p><b>Backup file</b> (extra safety copy; the Family Code already keeps progress in the cloud):</p><button class="pvbtn" data-action="backup" id="backupBtn">Download backup file</button><label class="pvbtn" style="display:inline-block" id="restoreLabel">Restore from backup<input type="file" id="restoreFile" accept="application/json,.json" style="display:none"></label></div>' +
        '<h2>Reset</h2><p>This erases all of his progress on every device that uses this Family Code. It cannot be undone.</p><button class="pvbtn danger" data-action="reset" id="resetBtn">Reset Progress</button>';
    }
    html += '<p style="margin-top:30px"><button class="pvbtn" data-nav="home">⬅ Back to the game</button></p></div>';
    app.innerHTML = html;
  }
  function familyCard() {
    var code = cloud.code;
    return '<h2>Family Code &amp; Cloud Sync</h2><div class="pv-card family-card" id="familyCard"><p class="sync-line"><span class="sync-status" data-sync-status></span></p>' +
      (code ? '<p>Your Family Code:</p><div class="family-code" id="familyCode">' + esc(code) + '</div>' +
        '<p>Open the Family Link on any phone, tablet, or computer to see the same progress. New answers show up here by themselves.</p>' +
        '<button class="pvbtn primary" data-action="copy-link" id="copyLinkBtn">🔗 Copy Family Link</button><button class="pvbtn" data-action="copy-code" id="copyCodeBtn">Copy Code</button>'
        : '<p>Setting up cloud save. If this takes a while, check the Wi-Fi. Progress is still saved on this device.</p>') +
      '<button class="pvbtn" data-action="link-open" id="useOtherCode">Use a different Family Code</button>' +
      '<p class="small-note">Keep the link in the family. Anyone who has it can see and add to his progress.</p></div>';
  }
  function reviewSection(s) {
    var due = E.dueSkills(s), rows = E.SKILL_ORDER.filter(function (k) { var x = s.skill[k]; return x.history.length || x.srNextDue || x.level !== 1; });
    var html = '<h2>Reviews &amp; Levels</h2><div class="pv-card" id="reviewCard">';
    html += due.length ? '<p class="due-line">🔁 <b>Due for review today:</b> ' + esc(due.map(function (k) { return E.SKILLS[k].label; }).join(', ')) + '. The Daily Mission mixes these in.</p>' : '<p>🔁 Nothing is due for review today.</p>';
    html += '<p>Each skill has a level: <b>Level 1: Starter</b>, <b>Level 2: 5th Grade</b>, or <b>Level 3: Challenge</b>. It moves up after 3 clean answers in a row and back down after 2 misses in a row.</p>';
    if (rows.length) html += '<table class="review-table" id="reviewTable"><thead><tr><th>Skill</th><th>Level</th><th>Review</th></tr></thead><tbody>' + rows.map(function (k) {
      var rv = E.reviewInfo(s, k);
      return '<tr data-skill="' + k + '"><td>' + esc(E.SKILLS[k].label) + '</td><td>' + esc(E.levelLabel(s.skill[k].level)) + '</td><td class="rv ' + rv.key + '">' + esc(rv.text) + '</td></tr>';
    }).join('') + '</tbody></table>';
    else html += '<p>Levels and review dates show up here after he answers a few questions.</p>';
    return html + '</div>';
  }
  function openLinkModal() {
    showModal('<h2>Already have a Family Code?</h2><p>Type the 8-letter code from the other device (it looks like K7M9-P4X2). This device will then show that progress.</p>' +
      '<input id="codeInput" class="code-input" type="text" maxlength="9" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX" aria-label="Family Code">' +
      (cloud.code ? '<p class="small-note">This device uses <b>' + esc(cloud.code) + '</b> right now. Its progress stays saved under that code.</p>' : '') +
      '<div class="row"><button class="primary" data-action="link-go" id="linkGo">Link this code</button><button data-action="modal-close">Cancel</button></div>');
    var el = document.getElementById('codeInput'); if (el) el.focus();
  }
  function showModal(html) { var m = document.getElementById('modal'); m.innerHTML = '<div class="box">' + html + '</div>'; m.classList.remove('hidden'); }
  function hideModal() { var m = document.getElementById('modal'); m.classList.add('hidden'); m.innerHTML = ''; }
  function summaryText() { return E.buildSummaryText(pvState()); }
  function copyText(text, okMsg) {
    okMsg = okMsg || 'Copied! Paste it into a text or email.';
    function fallback() {
      var ta = document.getElementById('summaryText'), tmp = null;
      if (ta && okMsg.indexOf('Copied! Paste') === 0) { ta.closest('details').open = true; ta.value = text; ta.select(); }
      else { tmp = document.createElement('textarea'); tmp.value = text; tmp.setAttribute('readonly', ''); tmp.style.position = 'fixed'; tmp.style.opacity = '0'; document.body.appendChild(tmp); tmp.select(); }
      var ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      if (tmp) tmp.remove();
      toast(ok ? okMsg : (tmp ? 'Copy this: ' + text : 'Select the text below and copy it.'), ok ? 3000 : 8000);
    }
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(function () { toast(okMsg, 3000); }, fallback);
    else fallback();
  }
  function download(name, text, type) {
    var blob = new Blob([text], { type: type || 'text/plain' }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  // ---------- router ----------
  function render() {
    if (route !== 'parent') { preview = false; parentUnlocked = false; }
    renderHud();
    if (route === 'home') renderHome();
    else if (route === 'practice') renderPractice();
    else if (route === 'placement') { if (placement) { route = 'placementRun'; renderHud(); renderPlacementRun(); } else renderPlacementIntro(); }
    else if (route === 'placementRun') { if (placement) renderPlacementRun(); else { route = 'placement'; render(); } }
    else if (route === 'placementResults') renderPlacementResults();
    else if (route === 'round') { if (runner) renderRound(); else { route = 'practice'; render(); } }
    else if (route === 'roundEnd') renderRoundEnd();
    else if (route === 'lab') renderLab();
    else if (route === 'parent') renderParent();
    else renderHome();
    updateSyncIndicator(); updatePolling();
  }

  // ---------- events ----------
  function currentChoices() {
    if (route === 'placementRun' && placement) return placement.set[placement.idx].choices;
    if (runner) return runner.questions[runner.idx].choices;
    return [];
  }
  document.addEventListener('click', function (e) {
    var nav = e.target.closest('[data-nav]');
    if (nav) {
      var to = nav.getAttribute('data-nav');
      if ((route === 'round' && runner && runner.results.length) || (route === 'placementRun' && placement && placement.results.length)) {
        if (to !== route && !confirmLeave()) return;
      }
      runner = null; placement = null; route = to; render(); window.scrollTo(0, 0); return;
    }
    var seg = e.target.closest('rect.seg.click');
    if (seg) {
      var bar = seg.getAttribute('data-bar'), i = +seg.getAttribute('data-seg');
      var arr = bar === 'q' ? runner.shaded : bar === 'lab1' ? lab.s1 : lab.s2;
      var at = arr.indexOf(i); if (at >= 0) arr.splice(at, 1); else arr.push(i);
      render(); return;
    }
    var el = e.target.closest('[data-action]'); if (!el) return;
    var act = el.getAttribute('data-action');
    switch (act) {
      case 'placement-start': startPlacement(el.getAttribute('data-kind') || 'full'); break;
      case 'placement-view': lastPlacementResult = null; route = 'placementResults'; render(); break;
      case 'placement-answer': placementSubmit(false); break;
      case 'placement-skip': placementSubmit(true); break;
      case 'theme': state.theme = el.getAttribute('data-theme'); touchSettings(); save(); render(); break;
      case 'copy-link': if (cloud.code) copyText(familyLink(), 'Family Link copied! Text it to anyone in the family.'); break;
      case 'copy-code': if (cloud.code) copyText(cloud.code, 'Family Code copied.'); break;
      case 'link-open': openLinkModal(); break;
      case 'link-go': linkCode((document.getElementById('codeInput') || {}).value || ''); break;
      case 'tab': tab = el.getAttribute('data-tab'); render(); break;
      case 'subject': tab = el.getAttribute('data-subject'); route = 'practice'; render(); window.scrollTo(0, 0); break;
      case 'start': if (el.getAttribute('data-module')) startRound(el.getAttribute('data-module'), 'practice'); break;
      case 'mission': startRound(null, 'mission', +(el.getAttribute('data-count') || 5)); break;
      case 'choose': {
        var ch = currentChoices()[+el.getAttribute('data-idx')];
        if (route === 'placementRun') { placement.selected = ch; app.querySelectorAll('.choice').forEach(function (b) { b.classList.toggle('selected', b === el); }); }
        else if (runner && !runner.answered) { runner.selected = ch; app.querySelectorAll('.choice').forEach(function (b) { b.classList.toggle('selected', b === el); }); }
        break;
      }
      case 'speak': {
        var q = route === 'placementRun' && placement ? placement.set[placement.idx] : runner && runner.questions[runner.idx];
        if (q) speak((q.passage ? q.passage.title + '. ' + q.passage.text + ' ' : '') + q.prompt + (q.choices ? ' Choices: ' + q.choices.join('. ') : ''));
        break;
      }
      case 'check': checkRound(); break;
      case 'hint': if (runner.hintsShown < runner.questions[runner.idx].hints.length) { runner.hintsShown += 1; render(); } break;
      case 'lcd': runner.lcdShown = true; render(); break;
      case 'next': nextQuestion(); window.scrollTo(0, 0); break;
      case 'quit': if (!runner.results.length || confirmLeave()) { runner = null; route = 'practice'; render(); } break;
      case 'labcommon': lab.common = !lab.common; render(); break;
      case 'labclear': lab.s1 = []; lab.s2 = []; render(); break;
      case 'preview-on': preview = true; renderParent(); window.scrollTo(0, 0); break;
      case 'preview-off': preview = false; renderParent(); break;
      case 'print': document.getElementById('printReport').textContent = summaryText(); window.print(); break;
      case 'copy': copyText(summaryText()); break;
      case 'download': download('5th-grade-arena-summary-' + E.todayKey() + '.txt', summaryText()); toast('Summary downloaded.'); break;
      case 'backup': download('5th-grade-arena-backup-' + E.todayKey() + '.json', JSON.stringify(state, null, 2), 'application/json'); toast('Backup downloaded.'); break;
      case 'save-name': state.studentName = (document.getElementById('nameInput').value || '').trim().slice(0, 20); touchSettings(); save(); toast('Name saved.'); render(); break;
      case 'pin-on': state.parent.pinEnabled = true; state.parent.pin = state.parent.pin || '0000'; parentUnlocked = true; touchSettings(); save(); toast('PIN lock is on. PIN: ' + state.parent.pin, 3000); renderParent(); break;
      case 'pin-off': state.parent.pinEnabled = false; touchSettings(); save(); toast('PIN lock is off.'); renderParent(); break;
      case 'pin-change': {
        var np = (document.getElementById('newPin').value || '').trim();
        if (!/^\d{4}$/.test(np)) { toast('Use exactly 4 numbers, like 1234.'); break; }
        state.parent.pin = np; touchSettings(); save(); toast('New PIN saved. Write it down: ' + np, 4000); renderParent(); break;
      }
      case 'pin-unlock': {
        var v = (document.getElementById('pinEntry').value || '').trim();
        if (v === String(state.parent.pin)) { parentUnlocked = true; renderParent(); }
        else { toast('That PIN did not match. Try again.'); document.getElementById('pinEntry').value = ''; }
        break;
      }
      case 'reset':
        showModal('<h2>Erase all progress?</h2><p>This clears his rank, XP, placement results, practice log, and session history on every device that uses this Family Code. It cannot be undone.</p><div class="row"><button class="danger" data-action="reset-yes" id="resetYes">Yes, erase everything</button><button class="primary" data-action="modal-close">No, keep it</button></div>');
        break;
      case 'reset-yes': {
        var keepParent = state.parent, keepName = state.studentName;
        state = E.newState(); state.parent = keepParent; state.studentName = keepName; state.resetAt = new Date().toISOString(); touchSettings(); save(); hideModal(); toast('Progress was reset.'); renderHud(); renderParent(); break;
      }
      case 'modal-close': hideModal(); break;
    }
  });
  function confirmLeave() {
    return window.confirm('Leave now? Answers you already got still count for XP, but this round or check will not be finished.');
  }
  document.addEventListener('input', function (e) {
    var t = e.target;
    if (runner && (t.id === 'ans' || t.id === 'num' || t.id === 'den')) runner.draft[t.id] = t.value;
    if (placement && (t.id === 'ans' || t.id === 'num' || t.id === 'den')) placement.draft[t.id] = t.value;
  });
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.matches && t.matches('select[data-action="labd"]')) {
      var w = t.getAttribute('data-which'), d = +t.value;
      if (w === '1') { lab.d1 = d; lab.s1 = []; } else { lab.d2 = d; lab.s2 = []; }
      render();
    }
    if (t.id === 'restoreFile' && t.files && t.files[0]) {
      var fr = new FileReader();
      fr.onload = function () {
        try { var parsed = JSON.parse(fr.result); if (!parsed || typeof parsed.xp !== 'number') throw new Error('bad'); state = E.loadState(parsed); state.resetAt = new Date().toISOString(); touchSettings(); save(); toast('Backup restored.'); renderHud(); renderParent(); }
        catch (err) { toast('That file did not look like a Dispatch Academy backup.'); }
      };
      fr.readAsText(t.files[0]);
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    var t = e.target;
    if (t.id === 'pinEntry') { e.preventDefault(); document.querySelector('[data-action="pin-unlock"]').click(); return; }
    if (t.id === 'codeInput') { e.preventDefault(); linkCode(t.value); return; }
    if (route === 'placementRun' && (t.id === 'ans' || t.id === 'num' || t.id === 'den')) { e.preventDefault(); if (t.id === 'num') { document.getElementById('den').focus(); return; } placementSubmit(false); return; }
    if (route === 'round' && runner) {
      if (t.id === 'num' && !runner.answered) { e.preventDefault(); document.getElementById('den').focus(); return; }
      if (t.id === 'ans' || t.id === 'den') { e.preventDefault(); if (!runner.answered) checkRound(); else nextQuestion(); return; }
    }
    if (t.classList && (t.classList.contains('module') || t.classList.contains('subject-card'))) { e.preventDefault(); t.click(); }
  });

  var api = { getState: function () { return state; }, route: function () { return route; }, runner: function () { return runner; }, placement: function () { return placement; }, tab: function () { return tab; },
    cloud: function () { return { code: cloud.code, status: cloud.status, live: cloud.live, lastSyncedAt: cloud.lastSyncedAt, dirty: cloud.dirty, busy: cloud.busy }; },
    syncNow: function () { return syncNow(); }, familyLink: function () { return familyLink(); } };
  window.__arena = api; window.__mathArena = api;
  render();
  /* cloud sync disabled: progress lives on this device; Family Code still works if ever entered */
})();

/* Dispatch Academy extras: incident-report writer, filed-work archive ("My File"),
   and one-tap email to Poppy & Dad. Floats on top of the arena app; does not touch its internals. */
(function () {
  'use strict';
  var E = window.Engine;
  var KEY = 'mathArena5.v1';
  var MEMO_KEY = 'ba.memos';
  var DRAFT_KEY = MEMO_KEY + '.draft';
  var DADS = ['gcraigblank@hotmail.com', 'johnblank@gmail.com'];

  var PROMPTS = [
    'Dispatch call at 14:00: a dog chased a mail truck down Bosque Street and would not move. Officer on scene. Write your incident report: what you saw, what you did, how it ended.',
    'Two cadets disagree about who gets first turn at the range. Captain asks YOU to write up what happened and the fair solution.',
    'You find a wallet on the bench at the Jasper ballfield. It has $40 and a library card inside. Write the report: what you do, and why.',
    'Late-night call: a store window is broken on Main Street but nothing is missing. Write your report on what you found and what you did.',
    'A fishing boat is stuck on a sandbar near town. You are the officer on the river patrol. Write the report: who was there, what you tried, how it ended.',
    'Your squad wins the karate tournament by ONE point. Write the after-action report: what went right and what to train next.'
  ];

  function memos() { try { return JSON.parse(localStorage.getItem(MEMO_KEY) || '[]'); } catch (e) { return []; } }
  function saveMemos(m) { try { localStorage.setItem(MEMO_KEY, JSON.stringify(m)); } catch (e) {} }
  // Draft is stored WITH its prompt so a reopened draft never shows under the wrong assignment.
  function getDraft() {
    try {
      var raw = localStorage.getItem(DRAFT_KEY); if (!raw) return null;
      var o = JSON.parse(raw);
      if (o && typeof o === 'object' && typeof o.text === 'string') return o;
      if (typeof o === 'string' && o) return { text: o, prompt: null }; // legacy plain-text draft
    } catch (e) {}
    return null;
  }
  function setDraft(d) { try { if (d) localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); else localStorage.removeItem(DRAFT_KEY); } catch (e) {} }
  function words(s) { return (s.trim().match(/\S+/g) || []).length; }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmtDate(iso) { try { return new Date(iso).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }); } catch (e) { return ''; } }

  // dock
  var dock = document.createElement('div');
  dock.id = 'ba-dock';
  dock.innerHTML = '<button id="ba-memo-btn">&#128221; Write a Report</button>' +
    '<button id="ba-file-btn">&#128455; My File</button>' +
    '<button id="ba-mail-btn">&#9993; Send Report to Craig</button>';
  document.body.appendChild(dock);

  // modal
  var modal = document.createElement('div');
  modal.id = 'ba-modal';
  modal.innerHTML = '<div class="sheet" role="document"><button class="close-x" id="ba-close" aria-label="Close">&times;</button><div id="ba-sheet-body"></div></div>';
  modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-label', 'Dispatch Academy extras');
  document.body.appendChild(modal);
  var lastFocus = null;
  function open(html, keepFocus) {
    if (!modal.classList.contains('open') && !keepFocus) lastFocus = document.activeElement;
    document.getElementById('ba-sheet-body').innerHTML = html;
    modal.classList.add('open');
  }
  function close() {
    modal.classList.remove('open');
    if (lastFocus && document.contains(lastFocus) && lastFocus.focus) lastFocus.focus();
    else { var b = document.getElementById('ba-memo-btn'); if (b) b.focus(); }
  }
  document.addEventListener('keydown', function (e) {
    if (!modal.classList.contains('open')) return;
    if (e.key === 'Escape') { close(); return; }
    if (e.key === 'Tab') { // simple focus trap: keep the loop inside the sheet
      var f = modal.querySelectorAll('button, textarea, [href], input, select, [tabindex]:not([tabindex="-1"])');
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  modal.addEventListener('click', function (e) { if (e.target === modal) close(); });

  // --- Write a Report ---
  document.getElementById('ba-memo-btn').addEventListener('click', function () {
    var d = getDraft();
    var p = (d && d.prompt) ? d.prompt : PROMPTS[Math.floor(Math.random() * PROMPTS.length)];
    open('<h2>&#128680; Incident Report</h2><p id="ba-memo-prompt">' + esc(p) +
      '</p><label for="ba-memo-text" style="display:block;margin:6px 0 2px">Your report</label><textarea id="ba-memo-text" placeholder="Type your report here..."></textarea>' +
      '<p id="ba-count" style="color:var(--muted)">0 words typed</p>' +
      '<button class="btn" id="ba-memo-save">File the Report</button>');
    var ta = document.getElementById('ba-memo-text');
    if (d) ta.value = d.text || '';
    ta.focus();
    function updCount() { var c = document.getElementById('ba-count'); if (c) c.textContent = words(ta.value) + ' words typed'; }
    updCount();
    ta.addEventListener('input', function () { updCount(); setDraft({ text: ta.value, prompt: p }); });
    document.getElementById('ba-memo-save').addEventListener('click', function () {
      var text = ta.value.trim();
      if (!text) { close(); return; }
      var m = memos();
      m.push({ date: new Date().toISOString(), prompt: p, text: text, words: words(text) });
      saveMemos(m);
      setDraft(null);
      open('<h2>&#9989; Report Filed</h2><p>Nice work, officer. <b>' + words(text) + ' words</b> on file, kept in <b>My File</b> for your records. ' +
        'Ask a grown-up to hit <b>Send Report to Craig</b> to send it along.</p><button class="btn" id="ba-done">Done</button>', true);
      var done = document.getElementById('ba-done'); if (done) { done.focus(); done.addEventListener('click', close); }
    });
  });

  // --- My File: everything he has written, kept ---
  document.getElementById('ba-file-btn').addEventListener('click', function () {
    var m = memos();
    var rows = m.length ? m.slice().reverse().map(function (r, i) {
      return '<div class="pv-card" style="margin:8px 0"><p style="margin:0 0 4px"><b>' + fmtDate(r.date) + '</b> &middot; ' + r.words + ' words</p>' +
        '<p class="muted small" style="margin:0 0 4px">Assignment: ' + esc(String(r.prompt || '').slice(0, 120)) + '...</p>' +
        '<p style="white-space:pre-wrap;margin:0">' + esc(r.text) + '</p></div>';
    }).join('') : '<p class="muted">Nothing filed yet. Hit "Write a Report" and your written work will be kept here.</p>';
    var d = getDraft();
    open('<h2>&#128455; My File</h2><p class="muted small">Every report you have filed, kept on this device. Parent View\'s Backup file now includes these.</p>' +
      (d && d.text.trim() ? '<p class="muted small">There is an unfinished draft waiting in "Write a Report".</p>' : '') + rows +
      '<button class="btn ghost" id="ba-file-close">Close</button>');
    var c = document.getElementById('ba-file-close'); if (c) { c.focus(); c.addEventListener('click', close); }
  });

  // --- Email ---
  document.getElementById('ba-mail-btn').addEventListener('click', function () {
    var state;
    try { state = E.loadState(localStorage.getItem(KEY)); } catch (e) { state = E.newState(); }
    var body = E.buildSummaryText(state);
    var m = memos();
    if (m.length) {
      var last = m[m.length - 1];
      body += '\n\n--- Incident Report on file (' + last.words + ' words) ---\n' + last.text;
      if (m.length > 1) body += '\n\n(' + (m.length - 1) + ' earlier report' + (m.length > 2 ? 's' : '') + ' kept in My File on the device.)';
    }
    var subject = encodeURIComponent('Dispatch Academy report');
    var href = 'mailto:' + DADS.join(',') + '?subject=' + subject + '&body=' + encodeURIComponent(body);
    var started = (state.xp || 0) > 0 || (state.checks && Object.keys(state.checks).length > 0) || m.length > 0;
    if (!started) {
      body = 'He has not started his first shift yet. Point him back at this site and have him take the Field Test when he is ready.\n\nNo progress logged yet as of ' + new Date().toLocaleDateString();
      href = 'mailto:' + DADS.join(',') + '?subject=' + subject + '&body=' + encodeURIComponent(body);
    }
    window.location.href = href;
  });

  var x = document.getElementById('ba-close');
  x && x.addEventListener('click', close);
})();

/* Dispatch Academy extras: incident-report writer + one-tap email to Craig.
   Floats on top of the arena app; does not touch its internals. */
(function () {
  'use strict';
  var E = window.Engine;
  var KEY = 'mathArena5.v1';
  var MEMO_KEY = '***';
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
  function words(s) { return (s.trim().match(/\S+/g) || []).length; }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  // dock
  var dock = document.createElement('div');
  dock.id = 'ba-dock';
  dock.innerHTML = '<button id="ba-memo-btn">&#128221; Write a Report</button><button id="ba-mail-btn">&#9993; Send Report to Craig</button>';
  document.body.appendChild(dock);

  // modal
  var modal = document.createElement('div');
  modal.id = 'ba-modal';
  modal.innerHTML = '<div class="sheet" role="document"><button class="close-x" id="ba-close" aria-label="Close">&times;</button><div id="ba-sheet-body"></div></div>';
  modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-label', 'Dispatch Academy extras');
  document.body.appendChild(modal);
  var lastFocus = null;
  function open(html) { lastFocus = document.activeElement; document.getElementById('ba-sheet-body').innerHTML = html; modal.classList.add('open'); }
  function close() { modal.classList.remove('open'); if (lastFocus && lastFocus.focus) lastFocus.focus(); }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && modal.classList.contains('open')) close(); });
  modal.addEventListener('click', function (e) { if (e.target === modal) close(); });

  document.getElementById('ba-memo-btn').addEventListener('click', function () {
    var p = PROMPTS[Math.floor(Math.random() * PROMPTS.length)];
    open('<h2>&#128680; Incident Report</h2><p>' + esc(p) +
      '</p><label for="ba-memo-text" style="display:block;margin:6px 0 2px">Your report</label><textarea id="ba-memo-text" placeholder="Type your report here..."></textarea>' +
      '<p id="ba-count" style="color:var(--muted)">0 words typed</p>' +
      '<button class="btn" id="ba-memo-save">File the Report</button>');
    var ta = document.getElementById('ba-memo-text');
    var draftKey = MEMO_KEY + '.draft';
    try { ta.value = localStorage.getItem(draftKey) || ''; } catch (e) {}
    ta.focus();
    function updCount() { document.getElementById('ba-count').textContent = words(ta.value) + ' words typed'; }
    updCount();
    ta.addEventListener('input', function () {
      updCount();
      try { localStorage.setItem(draftKey, ta.value); } catch (e) {}
    });
    document.getElementById('ba-memo-save').addEventListener('click', function () {
      var text = ta.value.trim();
      if (!text) { close(); return; }
      var m = memos();
      m.push({ date: new Date().toISOString(), prompt: p, text: text, words: words(text) });
      saveMemos(m);
      try { localStorage.removeItem(draftKey); } catch (e) {}
      open('<h2>&#9989; Report Filed</h2><p>Nice work, officer. <b>' + words(text) + ' words</b> on file. ' +
        'Ask a grown-up to hit <b>Send Report to Craig</b> to send it along.</p><button class="btn" id="ba-done">Done</button>');
      document.getElementById('ba-done').addEventListener('click', close);
    });
  });

  document.getElementById('ba-mail-btn').addEventListener('click', function () {
    var state;
    try { state = E.loadState(localStorage.getItem(KEY)); } catch (e) { state = E.newState(); }
    var body = E.buildSummaryText(state);
    var m = memos();
    if (m.length) {
      var last = m[m.length - 1];
      body += '\n\n--- Incident Report on file (' + last.words + ' words) ---\n' + last.text;
    }
    var subject = encodeURIComponent('Dispatch Academy report');
    var href = 'mailto:' + DADS.join(',') + '?subject=' + subject + '&body=' + encodeURIComponent(body);
    // if the kid has not started yet, point Craig at the login instead of an empty report
    var started = (state.xp || 0) > 0 || (state.checks && Object.keys(state.checks).length > 0) || m.length > 0;
    if (!started) {
      body = 'He has not started his first shift yet. Point him back at this site and have him take the Field Test when he is ready.\n\nNo progress logged yet as of ' + new Date().toLocaleDateString();
      href = 'mailto:' + DADS.join(',') + '?subject=' + subject + '&body=' + encodeURIComponent(body);
    }
    window.location.href = href;
  });

  document.getElementById('ba-close') && document.getElementById('ba-close').addEventListener('click', close);
})();

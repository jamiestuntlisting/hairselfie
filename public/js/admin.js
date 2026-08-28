/*
 * What is actually happening: what has been saved, by whom, and who has
 * turned up at all.
 *
 * Everything here is read from one endpoint that decides for itself
 * whether you are an admin — this page has no authority of its own, and
 * knowing its address gets you nothing.
 *
 * Two different questions get answered separately on purpose. Saved sheets
 * say who is making things. Days-seen says who arrived signed in and made
 * nothing, which is the half that tells you whether the tool is being
 * ignored rather than merely unused by the people you asked.
 */
(function () {
  'use strict';

  var GQL = window.StuntListingGQL;
  var statusEl = document.getElementById('admin-status');
  var figuresEl = document.getElementById('admin-figures');
  var peopleEl = document.getElementById('admin-people');
  var recentEl = document.getElementById('admin-recent');
  var chipEl = document.getElementById('session-chip');

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function day(iso) { return String(iso || '').slice(0, 10); }

  function when(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso || '');
    try {
      return d.toLocaleString(undefined, { day: 'numeric', month: 'short',
        hour: 'numeric', minute: '2-digit' });
    } catch (e) { return d.toISOString().slice(0, 16).replace('T', ' '); }
  }

  function ago(days) {
    var d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
  }

  function figure(number, label, note) {
    return '<div class="figure"><b>' + esc(number) + '</b><span>' + esc(label) + '</span>' +
      (note ? '<em>' + esc(note) + '</em>' : '') + '</div>';
  }

  function render(data) {
    var sheets = data.sheets || [];
    var seen = data.seen || [];
    var week = ago(7);
    var month = ago(30);

    var savers = {};
    sheets.forEach(function (s) { savers[s.userId] = true; });
    var seenRecently = {};
    seen.forEach(function (v) { if (v.date >= month) seenRecently[v.userId] = true; });
    var savedRecently = sheets.filter(function (s) { return day(s.createdAt) >= week; });

    /* the number worth the page: signed in, made nothing */
    var lookers = Object.keys(seenRecently).filter(function (id) { return !savers[id]; });

    var byKind = {};
    sheets.forEach(function (s) { byKind[s.kind || 'other'] = (byKind[s.kind || 'other'] || 0) + 1; });
    var kinds = Object.keys(byKind).sort(function (a, b) { return byKind[b] - byKind[a]; })
      .map(function (k) { return byKind[k] + ' ' + k; }).join(' · ');

    var bytes = sheets.reduce(function (n, s) { return n + (s.size || 0); }, 0);

    figuresEl.hidden = false;
    figuresEl.innerHTML =
      figure(sheets.length, 'sheets saved', kinds || '—') +
      figure(Object.keys(savers).length, 'people have saved one') +
      figure(Object.keys(seenRecently).length, 'signed in, last 30 days') +
      figure(lookers.length, 'signed in but saved nothing',
             lookers.length ? 'in the last 30 days' : '') +
      figure(savedRecently.length, 'sheets in the last 7 days') +
      figure(Math.round(bytes / 1024 / 1024 * 10) / 10 + ' MB', 'stored');

    /* ── people ── */
    var people = {};
    function person(id, name) {
      if (!people[id]) people[id] = { id: id, name: name || '', sheets: 0, last: '', seen: '' };
      if (name && !people[id].name) people[id].name = name;
      return people[id];
    }
    sheets.forEach(function (s) {
      var p = person(s.userId, s.name);
      p.sheets++;
      if (String(s.createdAt) > String(p.last)) p.last = s.createdAt;
    });
    seen.forEach(function (v) {
      var p = person(v.userId, v.name);
      if (v.date > p.seen) p.seen = v.date;
    });

    var rows = Object.keys(people).map(function (k) { return people[k]; })
      .sort(function (a, b) {
        return String(b.seen || day(b.last)).localeCompare(String(a.seen || day(a.last)));
      });

    document.getElementById('admin-people-panel').hidden = false;
    peopleEl.innerHTML =
      '<thead><tr><th>Who</th><th>Sheets</th><th>Last sheet</th><th>Last seen</th></tr></thead><tbody>' +
      rows.map(function (p) {
        return '<tr' + (p.sheets ? '' : ' class="is-quiet"') + '>' +
          '<td>' + esc(p.name || '—') + ' <span class="admin-id">#' + esc(p.id) + '</span></td>' +
          '<td>' + p.sheets + '</td>' +
          '<td>' + esc(p.last ? when(p.last) : '—') + '</td>' +
          '<td>' + esc(p.seen || '—') + '</td>' +
        '</tr>';
      }).join('') + '</tbody>';

    /* ── latest ── */
    document.getElementById('admin-recent-panel').hidden = false;
    recentEl.innerHTML =
      '<thead><tr><th>Who</th><th>Kind</th><th>When</th><th>Size</th></tr></thead><tbody>' +
      sheets.slice(0, 40).map(function (s) {
        return '<tr>' +
          '<td>' + esc(s.name || '—') + ' <span class="admin-id">#' + esc(s.userId) + '</span></td>' +
          '<td>' + esc(s.kind || '—') + '</td>' +
          '<td>' + esc(when(s.createdAt)) + '</td>' +
          '<td>' + (s.size ? Math.round(s.size / 1024) + ' KB' : '—') + '</td>' +
        '</tr>';
      }).join('') + '</tbody>';

    statusEl.className = 'hint';
    statusEl.textContent = data.complete
      ? ''
      : 'Showing the most recent records — there are more than this page reads.';
    if (!sheets.length && !seen.length) {
      statusEl.textContent = 'Nothing recorded yet.';
    }
  }

  function load() {
    var t = GQL.accessToken();
    if (!t) {
      statusEl.textContent = 'Sign in to see this.';
      return;
    }
    statusEl.textContent = 'Loading…';
    fetch('/api/admin', { headers: { Authorization: 'Bearer ' + t } })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) {
          if (!res.ok) throw new Error(body.error || ('Failed (' + res.status + ')'));
          return body;
        });
      })
      .then(render)
      .catch(function (err) {
        statusEl.className = 'hint is-warn';
        statusEl.textContent = err.message;
      });
  }

  function renderChip() {
    if (!GQL.accessToken()) {
      chipEl.innerHTML = '<button type="button" class="chip-link chip-link-lead" id="sign-in">Sign in</button>';
      chipEl.querySelector('#sign-in').addEventListener('click', function () {
        window.HairSelfieSignIn.open().then(function (r) { if (r) { renderChip(); load(); } });
      });
      return;
    }
    chipEl.innerHTML = 'Admin view <button type="button" class="chip-link" id="sign-out">Sign out</button>';
    chipEl.querySelector('#sign-out').addEventListener('click', function () {
      GQL.signOut();
      renderChip();
      figuresEl.hidden = true;
      document.getElementById('admin-people-panel').hidden = true;
      document.getElementById('admin-recent-panel').hidden = true;
      load();
    });
  }

  renderChip();
  load();
})();

/*
 * What is actually happening: what has been saved, by whom, who turns up
 * at all, and which of the three tools they use.
 *
 * Everything is read from one endpoint that decides for itself whether you
 * are an admin — this page has no authority of its own, and knowing its
 * address gets you nothing.
 *
 * Two questions are answered separately on purpose. Saved sheets say who
 * is making things. Loads say who opened the page and made nothing, and
 * who never signed in at all, which is the half that tells you whether the
 * tool is being ignored rather than merely unused by the people you asked.
 */
(function () {
  'use strict';

  var GQL = window.StuntListingGQL;
  var statusEl = document.getElementById('admin-status');
  var figuresEl = document.getElementById('admin-figures');
  var chartEl = document.getElementById('admin-chart');
  var rangeEl = document.getElementById('admin-range');
  var peopleEl = document.getElementById('admin-people');
  var recentEl = document.getElementById('admin-recent');
  var chipEl = document.getElementById('session-chip');

  var KINDS = [
    { key: 'hair', label: 'Hair', colour: '#ff5a36' },
    { key: 'wardrobe', label: 'Wardrobe', colour: '#5aa9ff' },
    { key: 'headshot', label: 'Headshot', colour: '#43d18f' },
    { key: 'saved', label: 'Saved', colour: '#a78bfa' },
    { key: 'other', label: 'Other', colour: '#6d7685' }
  ];

  var data = null;
  var days = 14;
  var urls = [];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function when(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso || '');
    try {
      return d.toLocaleString(undefined, { day: 'numeric', month: 'short',
        hour: 'numeric', minute: '2-digit' });
    } catch (e) { return d.toISOString().slice(0, 16).replace('T', ' '); }
  }

  function ago(n) {
    var d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
  }

  /* ── the numbers ─────────────────────────────────────────────── */

  function figure(number, label, note) {
    return '<div class="figure"><b>' + esc(number) + '</b><span>' + esc(label) + '</span>' +
      (note ? '<em>' + esc(note) + '</em>' : '') + '</div>';
  }

  function renderFigures() {
    var sheets = data.sheets || [];
    var usage = data.usage || [];
    var people = data.people || [];
    var month = ago(30);
    var week = ago(7);

    var recent = usage.filter(function (d) { return d.date >= month; });
    var loads = recent.reduce(function (n, d) { return n + d.loads; }, 0);
    var visitors = recent.reduce(function (n, d) { return n + d.visitors; }, 0);
    var guests = recent.reduce(function (n, d) { return n + d.guests; }, 0);
    var savers = people.filter(function (p) { return p.sheets > 0; }).length;
    var lookers = people.filter(function (p) { return !p.sheets && p.seen >= month; }).length;
    var thisWeek = sheets.filter(function (s) { return String(s.createdAt).slice(0, 10) >= week; });

    var byKind = {};
    sheets.forEach(function (s) { byKind[s.kind || 'other'] = (byKind[s.kind || 'other'] || 0) + 1; });
    var kinds = Object.keys(byKind).sort(function (a, b) { return byKind[b] - byKind[a]; })
      .map(function (k) { return byKind[k] + ' ' + k; }).join(' · ');

    figuresEl.hidden = false;
    figuresEl.innerHTML =
      figure(data.totalSheets || sheets.length, 'sheets saved', kinds || '—') +
      figure(savers, 'people have saved one') +
      figure(loads, 'page loads, last 30 days',
             visitors + (visitors === 1 ? ' visitor' : ' visitors')) +
      figure(guests, 'of those never signed in') +
      figure(lookers, 'signed in but saved nothing', lookers ? 'in the last 30 days' : '') +
      figure(thisWeek.length, 'sheets in the last 7 days') +
      figure(Math.round((data.storedBytes || 0) / 1024 / 1024 * 10) / 10 + ' MB', 'stored');
  }

  /* ── usage per day ───────────────────────────────────────────── */

  function renderChart() {
    var usage = data.usage || [];
    var byDate = {};
    usage.forEach(function (d) { byDate[d.date] = d; });

    /* every day in the window, including the quiet ones — a gap says
       something a missing column does not */
    var window_ = [];
    for (var i = days - 1; i >= 0; i--) {
      var date = ago(i);
      window_.push(byDate[date] || { date: date, loads: 0, visitors: 0, guests: 0,
                                     signedIn: 0, pages: {} });
    }

    var colW = days <= 14 ? 40 : (days <= 30 ? 24 : 12);
    var gap = days <= 30 ? 6 : 3;
    var H = 190;
    var pad = 26;
    var top = Math.max(1, Math.max.apply(null, window_.map(function (d) { return d.loads; })));
    var W = window_.length * (colW + gap) + gap;

    var bars = window_.map(function (d, i) {
      var x = gap + i * (colW + gap);
      var y = H - pad;
      var stack = KINDS.map(function (k) {
        var n = (d.pages && d.pages[k.key]) || 0;
        if (!n) return '';
        var h = Math.max(1, Math.round((n / top) * (H - pad - 12)));
        y -= h;
        return '<rect x="' + x + '" y="' + y + '" width="' + colW + '" height="' + h +
          '" fill="' + k.colour + '" rx="2"><title>' + esc(d.date) + ' · ' +
          n + ' ' + k.label + '</title></rect>';
      }).join('');

      /* days with loads but no page breakdown still have to show up */
      var counted = KINDS.reduce(function (n, k) { return n + ((d.pages && d.pages[k.key]) || 0); }, 0);
      if (!counted && d.loads) {
        var h2 = Math.max(1, Math.round((d.loads / top) * (H - pad - 12)));
        stack += '<rect x="' + x + '" y="' + (H - pad - h2) + '" width="' + colW +
          '" height="' + h2 + '" fill="#6d7685" rx="2"><title>' + esc(d.date) + ' · ' +
          d.loads + ' loads</title></rect>';
      }

      var label = days <= 14 ? d.date.slice(8) : (d.date.slice(8) === '01' ? d.date.slice(5) : '');
      return stack +
        '<text x="' + (x + colW / 2) + '" y="' + (H - 8) + '" text-anchor="middle" ' +
        'font-size="10" fill="#6d7685">' + esc(label) + '</text>';
    }).join('');

    chartEl.innerHTML =
      '<div class="chart-scroll"><svg width="' + W + '" height="' + H + '" role="img" ' +
      'aria-label="Page loads per day for the last ' + days + ' days">' +
      '<line x1="0" y1="' + (H - pad) + '" x2="' + W + '" y2="' + (H - pad) +
      '" stroke="#2b2f38"/>' + bars + '</svg></div>' +
      '<div class="chart-key">' + KINDS.map(function (k) {
        return '<span><i style="background:' + k.colour + '"></i>' + k.label + '</span>';
      }).join('') + '<span class="chart-top">busiest day: ' + top + ' loads</span></div>';
  }

  function renderRange() {
    rangeEl.innerHTML = [14, 30, 90].map(function (n) {
      return '<button type="button" class="btn btn-small' + (n === days ? ' btn-primary' : '') +
        '" data-days="' + n + '">' + n + ' days</button>';
    }).join('');
    rangeEl.onclick = function (e) {
      var btn = e.target.closest && e.target.closest('button[data-days]');
      if (!btn) return;
      days = +btn.dataset.days;
      renderRange();
      renderChart();
    };
  }

  /* ── people, and what they made ──────────────────────────────── */

  function renderPeople() {
    var rows = (data.people || []).slice().sort(function (a, b) {
      return String(b.seen || String(b.last).slice(0, 10))
        .localeCompare(String(a.seen || String(a.last).slice(0, 10)));
    });
    document.getElementById('admin-people-panel').hidden = false;
    peopleEl.innerHTML =
      '<thead><tr><th>Who</th><th>Sheets</th><th>Last sheet</th><th>Last seen</th></tr></thead><tbody>' +
      rows.map(function (p) {
        return '<tr' + (p.sheets ? '' : ' class="is-quiet"') + '>' +
          '<td>' + esc(p.name || '—') + ' <span class="admin-id">#' + esc(p.userId) + '</span></td>' +
          '<td>' + p.sheets + '</td>' +
          '<td>' + esc(p.last ? when(p.last) : '—') + '</td>' +
          '<td>' + esc(p.seen || '—') + '</td>' +
        '</tr>';
      }).join('') + '</tbody>';
  }

  function renderRecent() {
    var sheets = (data.sheets || []).slice(0, 60);
    document.getElementById('admin-recent-panel').hidden = false;
    recentEl.innerHTML =
      '<thead><tr><th></th><th>Who</th><th>Kind</th><th>When</th><th>Size</th></tr></thead><tbody>' +
      sheets.map(function (s) {
        return '<tr data-key="' + esc(s.key) + '">' +
          '<td class="shot-cell"><span class="shot"><img alt=""></span></td>' +
          '<td>' + esc(s.name || '—') + ' <span class="admin-id">#' + esc(s.userId) + '</span></td>' +
          '<td>' + esc(s.kind || '—') + '</td>' +
          '<td>' + esc(when(s.createdAt)) + '</td>' +
          '<td>' + (s.size ? Math.round(s.size / 1024) + ' KB' : '—') + '</td>' +
        '</tr>';
      }).join('') + '</tbody>';
    watchForView();
  }

  /* An admin may read any sheet, but the image still needs the token, so
     it cannot go straight into an <img src>. Fetched when it scrolls in. */
  function loadShot(row) {
    var img = row.querySelector('img');
    if (!img || img.src) return;
    fetch('/api/sheets?key=' + encodeURIComponent(row.dataset.key), {
      headers: { Authorization: 'Bearer ' + GQL.accessToken() }
    }).then(function (res) {
      if (!res.ok) throw new Error('no');
      return res.blob();
    }).then(function (blob) {
      var url = URL.createObjectURL(blob);
      urls.push(url);
      img.src = url;
      row.classList.add('is-loaded');
    }).catch(function () { row.classList.add('is-broken'); });
  }

  function watchForView() {
    var rows = recentEl.querySelectorAll('tr[data-key]');
    if (!window.IntersectionObserver) {
      Array.prototype.forEach.call(rows, loadShot);
      return;
    }
    var seen = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        loadShot(entry.target);
        seen.unobserve(entry.target);
      });
    }, { rootMargin: '250px' });
    Array.prototype.forEach.call(rows, function (r) { seen.observe(r); });
  }

  /* ── the page ────────────────────────────────────────────────── */

  function render(body) {
    data = body;
    if (!(data.sheets || []).length && !(data.usage || []).length) {
      statusEl.textContent = 'Nothing recorded yet.';
      return;
    }
    renderFigures();
    document.getElementById('admin-usage-panel').hidden = false;
    renderRange();
    renderChart();
    renderPeople();
    renderRecent();
    statusEl.className = 'hint';
    statusEl.textContent = data.complete
      ? ''
      : 'Showing the most recent records — there are more than this page reads.';
  }

  function hideAll() {
    figuresEl.hidden = true;
    ['admin-usage-panel', 'admin-people-panel', 'admin-recent-panel'].forEach(function (id) {
      document.getElementById(id).hidden = true;
    });
  }

  function load() {
    var t = GQL.accessToken();
    if (!t) {
      hideAll();
      statusEl.className = 'hint';
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
        hideAll();
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
      load();
    });
  }

  window.addEventListener('pagehide', function () {
    urls.forEach(function (u) { URL.revokeObjectURL(u); });
    urls = [];
  });

  if (window.HairSelfieSheets) HairSelfieSheets.recordUse('admin');
  renderChip();
  load();
})();

/*
 * Everything this account has made.
 *
 * The list comes from the Worker, which only ever returns sheets belonging
 * to the token that asked. The images need that token too, so they cannot
 * be dropped into an <img src> — each one is fetched and turned into an
 * object URL, and only when it comes into view. A page of full-size sheets
 * is several megabytes otherwise, on a phone, for pictures nobody scrolled
 * to yet.
 */
(function () {
  'use strict';

  var Sheets = window.HairSelfieSheets;
  var GQL = window.StuntListingGQL;
  var Api = window.HairSelfieApi;

  var listEl = document.getElementById('saved-list');
  var statusEl = document.getElementById('saved-status');
  var chipEl = document.getElementById('session-chip');
  var urls = [];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* "28 Aug 2026, 3:32 pm" where the browser allows it, ISO where it does not. */
  function when(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso || '';
    try {
      return d.toLocaleString(undefined, {
        day: 'numeric', month: 'short', year: 'numeric',
        hour: 'numeric', minute: '2-digit'
      });
    } catch (e) {
      return d.toISOString().slice(0, 16).replace('T', ' ');
    }
  }

  var KIND_LABEL = { hair: 'Hair selfie', wardrobe: 'Wardrobe', headshot: 'Headshot' };

  function kindOf(sheet) {
    return KIND_LABEL[sheet.kind] || (sheet.kind ? sheet.kind : 'Sheet');
  }

  function sizeOf(bytes) {
    if (!bytes) return '';
    return Math.max(1, Math.round(bytes / 1024)) + ' KB';
  }

  function status(text, kind) {
    statusEl.className = 'hint' + (kind ? ' ' + kind : '');
    statusEl.innerHTML = text;
  }

  /* ── the images ──────────────────────────────────────────────── */

  function loadImage(card) {
    var key = card.dataset.key;
    var img = card.querySelector('img');
    if (!img || img.src) return;
    fetch('/api/sheets?key=' + encodeURIComponent(key), {
      headers: { Authorization: 'Bearer ' + GQL.accessToken() }
    }).then(function (res) {
      if (!res.ok) throw new Error('could not load');
      return res.blob();
    }).then(function (blob) {
      var url = URL.createObjectURL(blob);
      urls.push(url);
      img.src = url;
      card.classList.add('is-loaded');
      var link = card.querySelector('a[download]');
      if (link) link.href = url;
    }).catch(function () {
      card.classList.add('is-broken');
      var note = card.querySelector('.saved-note');
      if (note) note.textContent = 'Could not load this one.';
    });
  }

  function watchForView() {
    var cards = listEl.querySelectorAll('.saved-card');
    if (!window.IntersectionObserver) {
      Array.prototype.forEach.call(cards, loadImage);
      return;
    }
    var seen = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        loadImage(entry.target);
        seen.unobserve(entry.target);
      });
    }, { rootMargin: '300px' });
    Array.prototype.forEach.call(cards, function (c) { seen.observe(c); });
  }

  /* ── the page ────────────────────────────────────────────────── */

  function render(sheets) {
    if (!sheets.length) {
      listEl.innerHTML = '';
      status('Nothing saved yet. Make a sheet and press create — it is kept here ' +
             'automatically while you are signed in.');
      return;
    }
    status(sheets.length + (sheets.length === 1 ? ' sheet' : ' sheets') + ', newest first.');
    listEl.innerHTML = sheets.map(function (s) {
      var name = s.key.split('/').pop();
      return '<div class="saved-card" data-key="' + esc(s.key) + '">' +
        '<div class="saved-thumb"><img alt="' + esc(kindOf(s)) + ' from ' + esc(when(s.createdAt)) + '"></div>' +
        '<div class="saved-meta">' +
          '<b>' + esc(kindOf(s)) + '</b>' +
          '<span class="saved-when">' + esc(when(s.createdAt)) + '</span>' +
          '<span class="saved-note">' + esc(sizeOf(s.size)) + '</span>' +
          '<span class="saved-actions">' +
            '<a class="btn btn-small" download="' + esc(name) + '" href="#">Save to phone</a>' +
            '<button type="button" class="btn btn-small btn-danger" data-act="delete">Delete</button>' +
          '</span>' +
        '</div>' +
      '</div>';
    }).join('');
    watchForView();
  }

  /*
   * Deleting one. It asks first, because there is no undo — the sheet is
   * gone from the account, though whatever was saved to the phone stays
   * on the phone, which is what the question says.
   */
  listEl.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('[data-act="delete"]');
    if (!btn) return;
    var card = btn.closest('.saved-card');
    var key = card && card.dataset.key;
    if (!key) return;
    if (!window.confirm('Delete this sheet from your account?\n\n' +
        'Any copy you already saved to your phone is not affected.')) return;

    btn.disabled = true;
    btn.textContent = 'Deleting…';
    Sheets.remove(key).then(function () {
      /* the object URL for this one lives on its own img, nowhere else */
      var img = card.querySelector('img');
      if (img && img.src.indexOf('blob:') === 0) {
        URL.revokeObjectURL(img.src);
        urls = urls.filter(function (u) { return u !== img.src; });
      }
      card.remove();
      var left = listEl.querySelectorAll('.saved-card').length;
      if (!left) {
        status('Nothing saved yet. Make a sheet and press create — it is kept here ' +
               'automatically while you are signed in.');
      } else {
        status(left + (left === 1 ? ' sheet' : ' sheets') + ', newest first.');
      }
    }).catch(function (err) {
      btn.disabled = false;
      btn.textContent = 'Delete';
      status('Could not delete that one — ' + esc(err.message), 'is-warn');
    });
  });

  function load() {
    if (!Sheets.canSave()) {
      listEl.innerHTML = '';
      status('Sign in to see the sheets you have made.');
      return;
    }
    status('Loading…');
    Sheets.list().then(render).catch(function (err) {
      listEl.innerHTML = '';
      status('Could not load your sheets — ' + esc(err.message), 'is-warn');
    });
  }

  function renderChip() {
    if (!Sheets.canSave()) {
      chipEl.innerHTML = '<button type="button" class="chip-link chip-link-lead" id="sign-in">Sign in</button>';
      chipEl.querySelector('#sign-in').addEventListener('click', function () {
        window.HairSelfieSignIn.open().then(function (result) {
          if (!result) return;
          renderChip();
          load();
        });
      });
      return;
    }
    Api.getSession().then(function (session) {
      var name = (session.user && session.user.name) || 'your account';
      chipEl.innerHTML = 'Signed in as <b>' + esc(name) + '</b> ' +
        '<button type="button" class="chip-link" id="sign-out">Sign out</button>';
      chipEl.querySelector('#sign-out').addEventListener('click', function () {
        GQL.signOut();
        renderChip();
        load();
      });
    }).catch(function () {
      chipEl.textContent = '';
    });
  }

  window.addEventListener('pagehide', function () {
    urls.forEach(function (u) { URL.revokeObjectURL(u); });
    urls = [];
  });

  if (Sheets.recordUse) Sheets.recordUse('saved');
  renderChip();
  load();
})();

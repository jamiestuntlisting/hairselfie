/*
 * The coordinator page.
 *
 * One job: find a performer and send them a link that opens straight into
 * taking their four photos. The search is the first thing on the page
 * because it is the whole task.
 */
(function () {
  'use strict';

  var Api = window.HairSelfieApi;
  var cfg = window.HAIRSELFIE_CONFIG || {};
  var REQ_PARAM = cfg.requestParam || 'p';

  var coordCfg = cfg.coordinator || {};
  var LS_ID = 'hairselfie.coord.id';
  var LS_NAME = 'hairselfie.coord.name';

  function $(sel) { return document.querySelector(sel); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function debounce(fn, ms) {
    var t;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }

  function firstName(p) { return String(p.name || '').split(' ')[0] || 'them'; }

  /* heights and weights read here as they do on the sheet */
  function fmtWeight(v) {
    var f = window.HairSelfieFormat;
    return f && f.weight ? f.weight(v) : (v || '');
  }

  function fmtHeight(v) {
    var f = window.HairSelfieFormat;
    return f && f.height ? f.height(v) : (v || '');
  }

  function store(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* private mode */ }
  }

  function read(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  /*
   * Who is sending. StuntListing will hand the real coordinator id to this
   * page as ?c=<id>; that wins and sticks. Otherwise it is whatever was set
   * here last, falling back to the configured default.
   */
  var me = (function () {
    var id = null;
    try {
      id = new URLSearchParams(window.location.search).get(coordCfg.idParam || 'c');
    } catch (e) { /* ignore */ }
    if (id) store(LS_ID, id);
    return {
      id: id || read(LS_ID) || coordCfg.defaultId || '33',
      /* only a cached label; the real name is looked up from the id */
      name: read(LS_NAME) || coordCfg.defaultName || 'Coordinator'
    };
  })();

  /*
   * The coordinator's name is not typed — it belongs to their user id, so it
   * is fetched from the user table. Demo mode has no user table, so the name
   * stays as the placeholder there.
   */
  function loadMyName() {
    var nameEl = $('#c-name');
    if (!me.id) return;
    if (Api.mode !== 'stuntlisting') {
      if (nameEl) nameEl.textContent = me.name + ' (demo)';
      return;
    }
    if (nameEl) nameEl.textContent = 'Looking up #' + me.id + '…';

    Api.getUserById(me.id).then(function (user) {
      me.name = user.name || me.name;
      store(LS_NAME, me.name);
      renderMe();
      if (!$('#send-box').hidden && lastPicked) renderSendBox(lastPicked);
    }).catch(function (err) {
      if (nameEl) nameEl.textContent = me.name;
      $('#who-status').textContent = 'Could not look up #' + me.id + ' — ' + err.message;
    });
  }

  function renderMe() {
    var chip = $('#session-chip');
    if (chip) {
      chip.innerHTML = 'Sending as <b>' + esc(me.name) + '</b> · #' + esc(me.id);
    }
    var nameEl = $('#c-name');
    var idEl = $('#c-id');
    if (nameEl) nameEl.textContent = me.name;
    if (idEl && idEl.value !== me.id) idEl.value = me.id;
  }

  function wireMe() {
    var idEl = $('#c-id');
    if (!idEl) return;

    /* Only the id is editable. Changing it re-reads the name from the user
       table, since the name belongs to the id. */
    var save = debounce(function () {
      var next = idEl.value.trim() || (coordCfg.defaultId || '33');
      if (next === me.id) return;
      me.id = next;
      store(LS_ID, me.id);
      $('#who-status').textContent = '';
      renderMe();
      loadMyName();
      if (!$('#send-box').hidden && lastPicked) renderSendBox(lastPicked);
    }, 500);

    idEl.addEventListener('input', save);
  }

  var lastPicked = null;

  /* Only an opaque token travels in the link — details are fetched — so no
     phone number or email ends up sitting in a text thread. */
  function requestLinkFor(performer) {
    var url = new URL('index.html', window.location.href);
    url.searchParams.set(REQ_PARAM, performer.id);
    /* who it came from — StuntListing will want this to attribute the request */
    if (me.id) url.searchParams.set('from', me.id);
    return url.toString();
  }

  function smsHref(performer, link) {
    var body = 'Hi ' + firstName(performer) + ' — ' + me.name + ' here. Please send four hair ' +
               'photos (front, both sides, back) for the shoot. Takes a minute on your ' +
               'phone: ' + link;
    var num = String(performer.phone || '').replace(/[^0-9+]/g, '');
    /* "?&body=" is the spelling that works on both iOS and Android */
    return 'sms:' + num + '?&body=' + encodeURIComponent(body);
  }

  function renderSendBox(p) {
    lastPicked = p;
    var box = $('#send-box');
    var link = requestLinkFor(p);
    var who = esc(firstName(p));
    var meta = [fmtHeight(p.height), fmtWeight(p.weight)].filter(Boolean).join(' · ');

    box.hidden = false;
    box.innerHTML =
      '<div class="send-head">' + esc(p.name) + '</div>' +
      (meta ? '<p class="hint hint-small">' + esc(meta) + '</p>' : '') +
      '<div class="send-link" id="send-link">' + esc(link) + '</div>' +
      '<div class="send-actions">' +
        (p.phone ? '<a class="btn btn-primary btn-small" id="send-sms" href="' +
                   esc(smsHref(p, link)) + '">Text ' + who + '</a>' : '') +
        '<button class="btn btn-small" id="send-copy" type="button">Copy link</button>' +
        '<button class="btn btn-small" id="send-share" type="button" hidden>Share</button>' +
        '<a class="btn btn-small" id="send-build" href="' + esc(link) + '">Build it myself</a>' +
      '</div>' +
      '<p class="send-status" id="send-status" aria-live="polite"></p>';

    $('#send-copy').addEventListener('click', function () {
      var status = $('#send-status');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(link).then(
          function () { status.textContent = 'Link copied.'; },
          function () { status.textContent = 'Copy failed — select the link above.'; }
        );
      } else {
        status.textContent = 'Select the link above to copy it.';
      }
    });

    if (navigator.share) {
      var shareBtn = $('#send-share');
      shareBtn.hidden = false;
      shareBtn.addEventListener('click', function () {
        navigator.share({
          title: 'Hair Selfie',
          text: 'Please send four hair photos',
          url: link
        }).catch(function () { /* dismissed */ });
      });
    }
  }

  /* ── autocomplete ─────────────────────────────────────── */

  function wireSearch() {
    var input = $('#perf-search');
    var list = $('#perf-listbox');
    var items = [];
    var results = [];
    var active = -1;
    var seq = 0;

    function close() {
      list.hidden = true;
      list.innerHTML = '';
      items = [];
      active = -1;
      input.setAttribute('aria-expanded', 'false');
    }

    function render(hits) {
      results = hits;
      if (!hits.length) {
        list.innerHTML = '<div class="ac-empty">No performers match “' +
          esc(input.value.trim()) + '”</div>';
        list.hidden = false;
        items = [];
        active = -1;
        return;
      }
      list.innerHTML = hits.map(function (p, i) {
        var meta = [fmtHeight(p.height), fmtWeight(p.weight)].filter(Boolean).join(' · ');
        return '<button type="button" class="ac-item" role="option" id="ac-opt-' + i + '">' +
          '<span>' + esc(p.name) + '</span>' +
          (meta ? '<span class="ac-meta">' + esc(meta) + '</span>' : '') +
          '</button>';
      }).join('');
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      items = Array.prototype.slice.call(list.querySelectorAll('.ac-item'));
      active = -1;
      items.forEach(function (el, i) {
        el.addEventListener('pointerdown', function (e) { e.preventDefault(); });
        el.addEventListener('click', function () {
          input.value = hits[i].name;
          close();
          renderSendBox(hits[i]);
        });
      });
    }

    function setActive(i) {
      if (!items.length) return;
      active = (i + items.length) % items.length;
      items.forEach(function (el, j) { el.classList.toggle('active', j === active); });
      input.setAttribute('aria-activedescendant', 'ac-opt-' + active);
      items[active].scrollIntoView({ block: 'nearest' });
    }

    var run = debounce(function () {
      var q = input.value.trim();
      var mine = ++seq;
      if (!q) { close(); return; }
      Api.searchPerformers(q).then(function (hits) {
        if (mine !== seq) return;
        render(hits);
      }).catch(function (err) {
        if (mine !== seq) return;
        /* show everything the server said, not just the first line — the
           useful part is often the second */
        var R = window.StuntListingResolve;
        var msgs = R && R.messagesIn ? R.messagesIn(err) : [err.message];
        list.innerHTML = '<div class="ac-empty">Search failed — ' +
          msgs.map(esc).join('<br>') +
          '<br><span class="ac-meta">Run <b>StuntListingResolve.report(\'searchUser\')</b> ' +
          'in the console for the full answer.</span></div>';
        list.hidden = false;
      });
    }, 170);

    input.addEventListener('input', run);
    input.addEventListener('keydown', function (e) {
      if (list.hidden) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
      else if (e.key === 'Enter' && active >= 0 && items[active]) { e.preventDefault(); items[active].click(); }
      else if (e.key === 'Escape') close();
    });
    input.addEventListener('blur', function () { setTimeout(close, 150); });
  }

  function init() {
    wireSearch();
    wireMe();
    renderMe();
    loadMyName();

    var input = $('#perf-search');
    $('#coord-badge').hidden = false;

    /* Say plainly where these names come from, right where they appear —
       these are invented until the app is pointed at the real directory. */
    if (Api.mode !== 'stuntlisting') {
      var note = document.createElement('p');
      note.className = 'sample-note';
      note.innerHTML = 'Showing <b>sample performers</b>, not StuntListing. ' +
        '<a href="?api=live">Connect to StuntListing</a>';
      input.closest('.panel').appendChild(note);
    }

    /* a search-first page should be ready to type on, but not hijack a
       phone keyboard the moment it opens */
    if (window.matchMedia &&
        window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
      input.focus();
    }
  }

  window.HairSelfieCoordinator = { requestLinkFor: requestLinkFor, smsHref: smsHref };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

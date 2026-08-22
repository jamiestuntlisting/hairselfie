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

  var isCoordinator = false;

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

  /* Only an opaque token travels in the link — details are fetched — so no
     phone number or email ends up sitting in a text thread. */
  function requestLinkFor(performer) {
    var url = new URL('index.html', window.location.href);
    url.searchParams.set(REQ_PARAM, performer.id);
    return url.toString();
  }

  function smsHref(performer, link) {
    var body = 'Hi ' + firstName(performer) + ' — please send four hair photos (front, both ' +
               'sides, back) for the shoot. Takes a minute on your phone: ' + link;
    var num = String(performer.phone || '').replace(/[^0-9+]/g, '');
    /* "?&body=" is the spelling that works on both iOS and Android */
    return 'sms:' + num + '?&body=' + encodeURIComponent(body);
  }

  function renderSendBox(p) {
    var box = $('#send-box');
    var link = requestLinkFor(p);
    var who = esc(firstName(p));
    var meta = [p.height, p.weight].filter(Boolean).join(' · ');

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

  /* ── autocomplete ────────────────────────────────────────────── */

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
        var meta = [p.height, p.weight].filter(Boolean).join(' · ');
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
      if (!isCoordinator) return;
      var q = input.value.trim();
      var mine = ++seq;
      if (!q) { close(); return; }
      Api.searchPerformers(q).then(function (hits) {
        if (mine !== seq) return;
        render(hits);
      }).catch(function (err) {
        if (mine !== seq) return;
        list.innerHTML = '<div class="ac-empty">Search failed — ' + esc(err.message) + '</div>';
        list.hidden = false;
      });
    }, 170);

    /* a locked box explains itself rather than silently doing nothing */
    function poke(e) {
      if (isCoordinator) return;
      if (e) e.preventDefault();
      $('#coord-note').hidden = false;
      input.blur();
    }
    input.addEventListener('pointerdown', poke);
    input.addEventListener('focus', function () { poke(null); });

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
    var input = $('#perf-search');

    Api.getSession().then(function (session) {
      var user = session.user || {};
      /* Demo mode has no real roles, so the coordinator page simply is the
         coordinator view; a live session decides for itself. */
      isCoordinator = Api.isDemo ? true : !!session.coordinator;

      $('#session-chip').innerHTML = user.name
        ? 'Signed in as <b>' + esc(user.name) + '</b>'
        : '';
      $('#coord-badge').hidden = !isCoordinator;
      input.readOnly = !isCoordinator;
      input.classList.toggle('is-locked', !isCoordinator);

      /* a search-first page should be ready to type on, but not hijack a
         phone keyboard the moment it opens */
      if (isCoordinator && window.matchMedia &&
          window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
        input.focus();
      }
    }).catch(function (err) {
      console.warn('session unavailable:', err.message);
      isCoordinator = false;
      input.readOnly = true;
      $('#session-chip').textContent = 'Not signed in';
    });
  }

  window.HairSelfieCoordinator = { requestLinkFor: requestLinkFor, smsHref: smsHref };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

/*
 * Sign-in, for when the app is pointed at the real StuntListing API.
 *
 * The mobile app keeps its token in SecureStore; a web page has no such
 * thing, so it either gets handed a token (?token=… or a postMessage from a
 * WebView host, both handled in graphql.js) or signs in here with the same
 * login mutation the app uses.
 *
 * Does nothing at all in demo mode.
 */
(function () {
  'use strict';

  var Api = window.HairSelfieApi;
  var cfg = window.HAIRSELFIE_CONFIG || {};

  function $(sel) { return document.querySelector(sel); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function panel() {
    var el = document.createElement('section');
    el.className = 'panel signin-panel';
    el.id = 'signin-panel';
    var main = document.querySelector('main');
    main.insertBefore(el, main.firstChild);
    return el;
  }

  function renderSignIn() {
    var el = $('#signin-panel') || panel();
    el.innerHTML =
      '<div class="panel-head panel-head-plain"><h2>Sign in to StuntListing</h2></div>' +
      '<p class="hint">Connected to <b>' + esc(cfg.graphqlUrl || 'the API') + '</b>. ' +
        'Sign in to load your profile and search performers.</p>' +
      '<form id="signin-form" class="signin-form">' +
        '<input type="email" id="si-email" placeholder="Email" autocomplete="username" required>' +
        '<input type="password" id="si-pass" placeholder="Password" autocomplete="current-password" required>' +
        '<button type="submit" class="btn btn-primary" id="si-go">Sign in</button>' +
      '</form>' +
      '<p class="send-status" id="si-status" aria-live="polite"></p>' +
      '<p class="hint hint-small">Or go back to <a href="?api=demo">sample data</a>.</p>';

    $('#signin-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var status = $('#si-status');
      var btn = $('#si-go');
      btn.disabled = true;
      status.classList.remove('is-error');
      status.textContent = 'Signing in…';

      Api.login($('#si-email').value.trim(), $('#si-pass').value)
        .then(function () { window.location.reload(); })
        .catch(function (err) {
          btn.disabled = false;
          status.classList.add('is-error');
          /* a network-level failure here is usually CORS, which looks
             identical to "offline" from inside the browser */
          status.textContent = /failed to fetch|networkerror|load failed/i.test(err.message)
            ? 'Could not reach the API. If it is up, this origin may not be allowed by its CORS policy.'
            : err.message;
        });
    });
  }

  function renderSignedIn(name) {
    var el = $('#signin-panel');
    if (el) el.remove();
    var chip = $('#session-chip');
    if (chip && name) {
      chip.innerHTML = 'Signed in as <b>' + esc(name) + '</b> ' +
        '<button class="btn btn-small" id="si-out" type="button">Sign out</button>';
      $('#si-out').addEventListener('click', function () {
        Api.signOut();
        window.location.reload();
      });
    }
  }

  function init() {
    if (Api.mode !== 'stuntlisting') return;     // demo mode: nothing to do
    Api.getSession().then(function (session) {
      if (session.signedOut) renderSignIn();
      else renderSignedIn((session.user || {}).name);
    }).catch(function () {
      renderSignIn();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

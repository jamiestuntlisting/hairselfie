/*
 * Signing in with a StuntListing account.
 *
 * The mutation is the one the rate calculator uses in production, which is
 * how it is known to be right rather than guessed:
 *
 *   mutation Login($email: String!, $password: String!) {
 *     login(email: $email, password: $password) { access_token refresh_token }
 *   }
 *
 * Two differences from that app, both worth knowing.
 *
 * It authenticates server-side, so the password never leaves its own
 * origin; here the request goes through the Worker's /api/graphql proxy
 * instead, because a browser cannot call api.stuntlisting.com directly.
 * The proxy holds no credentials and logs nothing, but it does relay the
 * password, and that is a hop the rate calculator does not have.
 *
 * It also keeps its session in an httpOnly cookie. This app has no server
 * to keep one, so the access token lives in localStorage, where any script
 * on the page could read it. That is the usual trade for a static app;
 * worth revisiting if this is ever served from a StuntListing origin.
 *
 * Nothing here gates on membership. The rate calculator turns away
 * anything below Plus — a hair selfie is not that kind of tool.
 */
window.HairSelfieSignIn = (function () {
  'use strict';

  var ui = null;

  function build() {
    if (ui) return ui;
    var root = document.createElement('div');
    root.className = 'modal signin';
    root.id = 'signin';
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'signin-title');
    root.innerHTML =
      '<div class="modal-card">' +
        '<h3 id="signin-title">Sign in to StuntListing</h3>' +
        '<form id="signin-form" autocomplete="on">' +
          '<div class="field field-wide">' +
            '<label for="si-email">Email</label>' +
            '<input id="si-email" type="email" name="email" autocomplete="username" ' +
              'inputmode="email" autocapitalize="none" required>' +
          '</div>' +
          '<div class="field field-wide">' +
            '<label for="si-password">Password</label>' +
            '<input id="si-password" type="password" name="password" ' +
              'autocomplete="current-password" required>' +
          '</div>' +
          '<p class="signin-error" id="si-error" aria-live="polite" hidden></p>' +
          '<div class="modal-actions">' +
            '<button type="button" class="btn btn-small" data-act="cancel">Cancel</button>' +
            '<span class="spacer"></span>' +
            '<button type="submit" class="btn btn-primary btn-small" data-act="go">Sign in</button>' +
          '</div>' +
        '</form>' +
      '</div>';
    document.body.appendChild(root);
    ui = {
      root: root,
      form: root.querySelector('#signin-form'),
      email: root.querySelector('#si-email'),
      password: root.querySelector('#si-password'),
      error: root.querySelector('#si-error'),
      go: root.querySelector('[data-act="go"]'),
      cancel: root.querySelector('[data-act="cancel"]')
    };
    return ui;
  }

  function fail(message) {
    ui.error.textContent = message;
    ui.error.hidden = false;
  }

  /*
   * Resolves to the signed-in session, or null if it was closed. Rejects
   * for nothing — a wrong password is shown in the dialog, where it can be
   * corrected, rather than thrown at the page behind it.
   */
  function open(opts) {
    opts = opts || {};
    var u = build();
    u.error.hidden = true;
    u.password.value = '';
    u.root.hidden = false;
    document.body.classList.add('modal-open');
    setTimeout(function () { u.email.focus(); }, 30);

    return new Promise(function (resolve) {
      function close(result) {
        u.root.hidden = true;
        document.body.classList.remove('modal-open');
        u.form.onsubmit = null;
        u.cancel.onclick = null;
        u.password.value = '';
        resolve(result);
      }

      u.cancel.onclick = function () { close(null); };

      u.form.onsubmit = function (e) {
        e.preventDefault();
        var email = u.email.value.trim();
        var password = u.password.value;
        if (!email || !password) { fail('Email and password, please.'); return; }

        u.error.hidden = true;
        u.go.disabled = true;
        u.go.textContent = 'Signing in…';

        window.StuntListingGQL.login(email, password)
          .then(function () {
            /* Signing in means you want the real thing, so the app switches
               off the sample data at the same time. */
            var switched = false;
            try {
              if (localStorage.getItem('hairselfie.mode') !== 'stuntlisting') {
                localStorage.setItem('hairselfie.mode', 'stuntlisting');
                switched = true;
              }
            } catch (e) { /* private mode: it stays on whatever it was */ }
            close({ switched: switched });
          })
          .catch(function (err) {
            u.go.disabled = false;
            u.go.textContent = 'Sign in';
            fail(explain(err));
          });
      };
    });
  }

  /* The API's own message is usually the useful one; the rest are not. */
  function explain(err) {
    var msg = (err && err.message) || '';
    if (/failed to fetch|networkerror|load failed/i.test(msg)) {
      return 'Could not reach StuntListing. Check your connection and try again.';
    }
    if (/unauthor|invalid|credential|password|not found/i.test(msg)) {
      return msg;
    }
    return msg || 'Sign in failed.';
  }

  return { open: open };
})();

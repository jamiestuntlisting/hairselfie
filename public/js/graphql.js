/*
 * StuntListing GraphQL transport.
 *
 * Everything the app sends to StuntListing is in this file, and every GraphQL
 * document is in the QUERIES block below — one place to correct them against
 * the real schema.
 *
 * What is known from the mobile app's auth provider:
 *   - endpoint          https://api.stuntlisting.com/graphql
 *   - login mutation    returns { access_token, refresh_token } under `login`
 *   - profile query     `getMyProfile`
 *   - token storage     STL_token / STL_refresh
 *
 * What is NOT confirmed and is marked TODO below: the field names on the
 * profile, whether a coordinator flag exists, and whether a performer search
 * query exists at all. Those are guesses shaped to look like the two
 * documents we have seen; check them before trusting them.
 */
window.StuntListingGQL = (function () {
  'use strict';

  var cfg = window.HAIRSELFIE_CONFIG || {};
  var auth = cfg.auth || {};
  var URL_ENDPOINT = cfg.graphqlUrl || 'https://api.stuntlisting.com/graphql';

  var TOKEN_KEY = auth.tokenKey || 'STL_token';
  var REFRESH_KEY = auth.refreshKey || 'STL_refresh';

  var QUERIES = {
    /* Confirmed shape: the mobile app reads response.data.data.login and
       pulls access_token / refresh_token off it. */
    login: [
      'mutation Login($email: String!, $password: String!) {',
      '  login(email: $email, password: $password) {',
      '    access_token',
      '    refresh_token',
      '  }',
      '}'
    ].join('\n'),

    /* TODO confirm the selection set. The mobile app calls getMyProfile but
       we have not seen which fields it asks for — height/weight/phone are the
       ones this app needs, and they may be named differently or live on a
       nested profile object. */
    me: [
      'query GetMyProfile {',
      '  getMyProfile {',
      '    id',
      '    name',
      '    height',
      '    weight',
      '    phone',
      '    email',
      '    isCoordinator',
      '  }',
      '}'
    ].join('\n'),

    /* TODO this query is a guess — we have no evidence of a performer search
       in the schema yet. Coordinator search stays disabled until it resolves. */
    searchPerformers: [
      'query SearchPerformers($q: String!) {',
      '  searchPerformers(query: $q, limit: 8) {',
      '    id',
      '    name',
      '    height',
      '    weight',
      '    phone',
      '    email',
      '  }',
      '}'
    ].join('\n'),

    /* TODO likewise a guess: resolving a request token back to one performer. */
    performer: [
      'query Performer($token: String!) {',
      '  hairSelfieRequest(token: $token) {',
      '    performer {',
      '      id',
      '      name',
      '      height',
      '      weight',
      '      phone',
      '      email',
      '    }',
      '  }',
      '}'
    ].join('\n')
  };

  /* ── token handling ──────────────────────────────────────────── */

  function store(key, value) {
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch (e) { /* private mode — the token just won't persist */ }
  }

  function read(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  /*
   * A token can arrive three ways, in order of precedence:
   *   1. ?token=… in the URL — StuntListing (or a WebView host) handing over
   *      a session. It is stored and then stripped from the address bar so it
   *      does not sit in history or get copy-pasted around.
   *   2. a postMessage from a WebView host, for the same reason.
   *   3. whatever was stored last time.
   */
  function adoptTokenFromUrl() {
    var url;
    try { url = new URL(window.location.href); } catch (e) { return; }
    var t = url.searchParams.get(auth.tokenParam || 'token');
    if (!t) return;
    store(TOKEN_KEY, t);
    url.searchParams.delete(auth.tokenParam || 'token');
    try {
      window.history.replaceState({}, '', url.toString());
    } catch (e) { /* non-fatal */ }
  }

  function listenForHostToken() {
    window.addEventListener('message', function (e) {
      var d = e.data;
      if (!d || typeof d !== 'object') return;
      if (d.type !== 'stuntlisting:token' || !d.token) return;
      /* Only trust a host we were told to trust. */
      var allowed = auth.tokenOrigins || [];
      if (allowed.length && allowed.indexOf(e.origin) === -1) return;
      store(TOKEN_KEY, d.token);
      if (d.refreshToken) store(REFRESH_KEY, d.refreshToken);
    });
  }

  function accessToken() { return read(TOKEN_KEY); }
  function isSignedIn() { return !!accessToken(); }

  function signOut() {
    store(TOKEN_KEY, null);
    store(REFRESH_KEY, null);
  }

  /* ── requests ────────────────────────────────────────────────── */

  function request(query, variables, opts) {
    opts = opts || {};
    var headers = { 'Content-Type': 'application/json' };
    var t = accessToken();
    if (t && !opts.anonymous) headers.Authorization = 'Bearer ' + t;

    return fetch(URL_ENDPOINT, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ query: query, variables: variables || {} })
    }).then(function (res) {
      return res.json().catch(function () {
        throw new Error('StuntListing returned a non-JSON response (' + res.status + ')');
      }).then(function (body) {
        if (body.errors && body.errors.length) {
          var err = new Error(body.errors[0].message || 'GraphQL error');
          err.graphQLErrors = body.errors;
          err.status = res.status;
          throw err;
        }
        if (!res.ok) throw new Error('StuntListing request failed (' + res.status + ')');
        return body.data;
      });
    });
  }

  function login(email, password) {
    return request(QUERIES.login, { email: email, password: password }, { anonymous: true })
      .then(function (data) {
        var payload = data && data.login;
        if (!payload || !payload.access_token) throw new Error('No token in the login response');
        store(TOKEN_KEY, payload.access_token);
        if (payload.refresh_token) store(REFRESH_KEY, payload.refresh_token);
        return payload;
      });
  }

  adoptTokenFromUrl();
  listenForHostToken();

  return {
    QUERIES: QUERIES,
    endpoint: URL_ENDPOINT,
    request: request,
    login: login,
    signOut: signOut,
    accessToken: accessToken,
    isSignedIn: isSignedIn
  };
})();

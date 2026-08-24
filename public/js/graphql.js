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
 * The schema is snake_case, and requests carry an operationName alongside
 * the query — both follow the app's own GraphQL files.
 *
 * Still NOT confirmed: how to search the user table by name. That query is
 * marked TODO below and remains a guess. introspect() and js/schema-check.js
 * will identify it against a live API.
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

    /* Confirmed against the app's own getMyProfile query. That query asks for
       ~50 fields; this asks only for what a hair selfie sheet needs.
       Note there is no single `name` — it is first_name + last_name, with
       alias and nickname alongside — and the phone comes formatted as well
       as raw. */
    me: [
      'query getMyProfile {',
      '  getMyProfile {',
      '    id',
      '    first_name',
      '    last_name',
      '    alias',
      '    nickname',
      '    height',
      '    weight',
      '    phone_number',
      '    phone_number_formatted',
      '    email',
      '    hair_color',
      '    role',
      '    __typename',
      '  }',
      '}'
    ].join('\n'),

    /* TODO still a guess — the one document we have not seen. The user table
       has a fullTextSearch column, so search is implemented server-side and a
       resolver for it exists; only its name and argument should need
       correcting here. The field selection is the real user shape. */
    searchPerformers: [
      'query searchUsers($search: String!) {',
      '  searchUsers(search: $search) {',
      '    id',
      '    user_id',
      '    first_name',
      '    last_name',
      '    alias',
      '    nickname',
      '    phone_number',
      '    email',
      '    __typename',
      '  }',
      '}'
    ].join('\n'),

    /* Users as they appear inside a list (confirmed from listDetails). A list
       belongs to a userId, so these are the coordinator's own lists — picking
       from one may fit better than a global search. */
    listDetails: [
      'query listDetails($list_id: Int!) {',
      '  listDetails(list_id: $list_id) {',
      '    list_id',
      '    list_name',
      '    users {',
      '      id',
      '      user_id',
      '      first_name',
      '      last_name',
      '      alias',
      '      nickname',
      '      phone_number',
      '      email',
      '      __typename',
      '    }',
      '    __typename',
      '  }',
      '}'
    ].join('\n'),

    /* TODO a guess: resolving a request token back to one performer.
       The visibility flags come along because this record is used to build a
       sheet for somebody else — see toPersonRespectingPrivacy in api.js. */
    performer: [
      'query userDetails($user_id: Int!) {',
      '  userDetails(user_id: $user_id) {',
      '    id',
      '    first_name',
      '    last_name',
      '    alias',
      '    nickname',
      '    height',
      '    weight',
      '    phone_number',
      '    phone_number_formatted',
      '    email',
      '    email_visibility',
      '    phone_number_visibility',
      '    hair_color',
      '    __typename',
      '  }',
      '}'
    ].join('\n')
  };

  /* ── token handling ─────────────────────────────────────── */

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

  /* ── requests ───────────────────────────────────────────── */

  function request(query, variables, opts) {
    opts = opts || {};
    var headers = { 'Content-Type': 'application/json' };
    var t = accessToken();
    if (t && !opts.anonymous) headers.Authorization = 'Bearer ' + t;

    /* The app sends operationName with every request; mirror that so server
       logs and any per-operation handling line up. */
    var named = (query.match(/^\s*(?:query|mutation)\s+([A-Za-z_][A-Za-z0-9_]*)/) || [])[1];

    return fetch(URL_ENDPOINT, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        operationName: named || undefined,
        variables: variables || {},
        query: query
      })
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

  /*
   * Ask the API what it actually offers.
   *
   * The search query above is still a guess, because the schema has never
   * been seen from here. Run this in the browser console against the real
   * API and it answers the question directly:
   *
   *   await StuntListingGQL.introspect('search')
   *
   * With no filter it lists every query field. Returns [] and explains
   * itself if introspection is switched off in production, which is common;
   * js/schema-check.js then probes instead.
   */
  function introspect(filter) {
    var doc = [
      'query Introspect {',
      '  __schema {',
      '    queryType { fields { name args { name } } }',
      '  }',
      '}'
    ].join('\n');

    return request(doc).then(function (data) {
      var fields = (((data || {}).__schema || {}).queryType || {}).fields || [];
      var list = fields.map(function (f) {
        return f.name + '(' + (f.args || []).map(function (a) { return a.name; }).join(', ') + ')';
      });
      if (filter) {
        var needle = String(filter).toLowerCase();
        list = list.filter(function (n) { return n.toLowerCase().indexOf(needle) !== -1; });
      }
      list.sort();
      console.log(list.length + ' query field(s)' + (filter ? ' matching "' + filter + '"' : '') + ':');
      list.forEach(function (n) { console.log('  ' + n); });
      return list;
    }).catch(function (err) {
      console.warn('Introspection unavailable: ' + err.message +
        ' — it is often disabled in production. The schema will have to come from the code.');
      return [];
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
    isSignedIn: isSignedIn,
    introspect: introspect
  };
})();

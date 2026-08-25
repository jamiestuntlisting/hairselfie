/*
 * Work out a query's real signature from the server's own error messages.
 *
 * GraphQL servers are unusually helpful when you get a name wrong:
 *
 *   Cannot query field "searchUsers" on type "Query".
 *     Did you mean "searchUser", "adminSearchUsers", or "getAllUsers"?
 *   Unknown argument "search" on field "searchUser". Did you mean "query"?
 *   Field "searchUser" argument "keyword" of type "String!" is required.
 *
 * That is enough to find the right field and argument in a couple of
 * requests, without anybody having to read the API source. The answer is
 * cached, so it costs nothing after the first time.
 *
 * This exists because the schema is not published to this app. Once the
 * signatures are known for certain they can be written into js/graphql.js
 * and this can go.
 */
window.StuntListingResolve = (function () {
  'use strict';

  var LS_PREFIX = 'hairselfie.resolved.';
  var MAX_ATTEMPTS = 12;   // a safety net, not an expected cost

  function remember(key, value) {
    try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(value)); } catch (e) { /* ignore */ }
  }

  function recall(key) {
    try {
      var raw = localStorage.getItem(LS_PREFIX + key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function forget(key) {
    try { localStorage.removeItem(LS_PREFIX + key); } catch (e) { /* ignore */ }
  }

  /* Pull "searchUser", "adminSearchUsers", "getAllUsers" out of a
     "Did you mean …?" tail. */
  function suggestionsIn(message) {
    var tail = (String(message || '').match(/Did you mean ([^?]+)\?/i) || [])[1];
    if (!tail) return [];
    return tail.split(/,|\bor\b/)
      .map(function (s) { return s.replace(/["'`\s]/g, ''); })
      .filter(Boolean);
  }

  /* Put the server's suggestions at the front, whether or not they were
     already on the list — a suggestion is better information than our
     guesses, so it should be tried next rather than in its old position. */
  function promote(list, items) {
    var rest = list.filter(function (x) { return items.indexOf(x) === -1; });
    return items.concat(rest);
  }

  function classify(err) {
    var m = String((err && err.message) || '');
    return {
      message: m,
      unknownField: /cannot query field/i.test(m),
      unknownArg: /unknown argument/i.test(m),
      /* a complaint about a *missing* argument means the field itself is
         right, and usually names the argument it wants */
      missingArg: /argument .*(is required|of required type)/i.test(m),
      suggestions: suggestionsIn(m)
    };
  }

  /* The argument named in "Field X argument Y of type Z is required". */
  function requiredArgIn(message) {
    var m = String(message || '').match(/argument ["'`]?([A-Za-z_][A-Za-z0-9_]*)["'`]?\s+of/i);
    return m ? m[1] : null;
  }

  /*
   * spec: {
   *   cacheKey, fields[], args[], argType, sample, selection, opName, request
   * }
   * Resolves to { field, arg } — the signature that worked.
   */
  function resolve(spec) {
    var cached = recall(spec.cacheKey);
    if (cached && cached.field && cached.arg) return Promise.resolve(cached);

    var fields = spec.fields.slice();
    var args = spec.args.slice();
    var attempts = 0;
    var lastError = null;

    function attempt(field, arg) {
      attempts++;
      var doc = 'query ' + (spec.opName || 'Probe') + '($v: ' + spec.argType + ') { ' +
                field + '(' + arg + ': $v) { ' + spec.selection + ' } }';
      return spec.request(doc, { v: spec.sample }).then(function () {
        var found = { field: field, arg: arg };
        remember(spec.cacheKey, found);
        return found;
      });
    }

    function next() {
      if (!fields.length || attempts >= MAX_ATTEMPTS) {
        return Promise.reject(lastError ||
          new Error('Could not work out how to call this query'));
      }
      var field = fields[0];
      if (!args.length) { fields.shift(); args = spec.args.slice(); return next(); }
      var arg = args[0];

      return attempt(field, arg).catch(function (err) {
        lastError = err;
        var c = classify(err);

        if (c.unknownField) {
          /* wrong field — the server usually names the right one */
          fields = fields.filter(function (f) { return f !== field; });
          if (c.suggestions.length) fields = promote(fields, c.suggestions);
          args = spec.args.slice();
          return next();
        }

        if (c.missingArg) {
          /* right field, and it just told us what it wants */
          var wanted = requiredArgIn(c.message);
          if (wanted && wanted !== arg) {
            args = [wanted].concat(args.filter(function (a) { return a !== wanted; }));
            return next();
          }
        }

        if (c.unknownArg) {
          args = args.filter(function (a) { return a !== arg; });
          if (c.suggestions.length) args = promote(args, c.suggestions);
          return next();
        }

        /* Anything else — auth, rate limit, a genuine server error — is not
           a naming problem, so stop rather than hammer the API. */
        return Promise.reject(err);
      });
    }

    return next();
  }

  return {
    resolve: resolve,
    forget: forget,
    recall: recall,
    suggestionsIn: suggestionsIn,
    classify: classify,
    requiredArgIn: requiredArgIn
  };
})();

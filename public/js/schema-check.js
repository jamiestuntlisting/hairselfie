/*
 * Find out what the API actually calls things.
 *
 * Four of the documents in graphql.js are guesses. Introspection would
 * settle it, but production servers often switch it off — so this also
 * probes, which works either way.
 *
 * The trick: a GraphQL server's own error messages give the answer away.
 *   - "Cannot query field 'x' on type 'Query'"          → no such field
 *   - "... Did you mean 'searchUsers'?"                 → the real name
 *   - "Field 'users' argument 'search' ... is required" → it exists, and
 *                                                          that is its argument
 *   - "Field 'x' must not have a selection set"         → exists, scalar
 * So asking for something wrong is informative.
 */
window.SchemaCheck = (function () {
  'use strict';

  /* Names worth trying for "search the user table by name". */
  var SEARCH_CANDIDATES = [
    'searchPerformers', 'searchPerformer', 'performers', 'performerSearch',
    'searchUsers', 'searchUser', 'users', 'userSearch', 'findUsers',
    'getUsers', 'allUsers', 'searchProfiles', 'profiles', 'searchTalent',
    'talent', 'search'
  ];

  function GQL() { return window.StuntListingGQL; }

  /* Classify what the server says about one field name. */
  function classify(name, err) {
    if (!err) return { name: name, exists: true, note: 'exists, returns an object' };

    var msg = String(err.message || '');
    var hint = (msg.match(/Did you mean ([^?]+)\?/i) || [])[1];

    if (/must not have a selection set|cannot have a selection set/i.test(msg)) {
      return { name: name, exists: true, note: 'exists, returns a scalar' };
    }
    if (/argument .* is required|of required type/i.test(msg)) {
      return { name: name, exists: true, note: 'exists — ' + msg };
    }
    if (/cannot query field/i.test(msg)) {
      return { name: name, exists: false, note: hint ? 'no — did you mean ' + hint + '?' : 'no such field', hint: hint };
    }
    /* Anything else (auth, rate limit) means the field probably resolved. */
    return { name: name, exists: null, note: msg };
  }

  function probeOne(name) {
    var doc = 'query Probe { ' + name + ' { __typename } }';
    return GQL().request(doc)
      .then(function () { return classify(name, null); })
      .catch(function (err) { return classify(name, err); });
  }

  /* Try each candidate in turn. Returns everything, so a "no" with a
     suggestion is just as useful as a "yes". */
  function probe(names) {
    var list = names || SEARCH_CANDIDATES;
    return list.reduce(function (chain, name) {
      return chain.then(function (acc) {
        return probeOne(name).then(function (r) { return acc.concat([r]); });
      });
    }, Promise.resolve([]));
  }

  /*
   * Learn the type behind a query field, and its real field names, by
   * asking for a field that certainly does not exist.
   */
  function fieldsOf(queryField) {
    var doc = 'query Fields { ' + queryField + ' { zzzDefinitelyNotAField } }';
    return GQL().request(doc)
      .then(function () { return { type: null, note: 'no error — unexpected' }; })
      .catch(function (err) {
        var msg = String(err.message || '');
        var type = (msg.match(/on type ['"]?([A-Za-z_][A-Za-z0-9_]*)/) || [])[1];
        var hint = (msg.match(/Did you mean ([^?]+)\?/i) || [])[1];
        return { type: type || null, suggestions: hint || null, note: msg };
      });
  }

  return {
    SEARCH_CANDIDATES: SEARCH_CANDIDATES,
    probe: probe,
    probeOne: probeOne,
    fieldsOf: fieldsOf
  };
})();

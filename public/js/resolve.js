/*
 * Work out a query's real signature by asking the server, not by guessing.
 *
 * A GraphQL server will name the thing you got wrong if you give it the
 * chance. Send a field with no selection set and no arguments:
 *
 *   query { searchUser }
 *
 * and a spec-compliant server answers with every validation error at once:
 *
 *   Field "searchUser" of type "[User!]!" must have a selection set.
 *   Field "searchUser" argument "keyword" of type "String!" is required,
 *     but it was not provided.
 *
 * That is the return type and the argument — its name and its type — in a
 * single request, with nothing guessed. If the field itself is wrong the
 * answer is just as direct:
 *
 *   Cannot query field "searchUsers" on type "Query".
 *     Did you mean "searchUser", "adminSearchUsers", or "getAllUsers"?
 *
 * Guessing at argument names is kept only as a fallback for servers that
 * do not volunteer a required argument (because the argument is optional).
 * Whatever is learned is cached, so it costs nothing after the first time.
 *
 * This exists because the schema is not published to this app. Once the
 * signatures are known for certain they can be written into js/graphql.js
 * and this can go.
 */
window.StuntListingResolve = (function () {
  'use strict';

  var LS_PREFIX = 'hairselfie.resolved.';
  var MAX_ATTEMPTS = 12;   // a safety net, not an expected cost

  /* every probe this page has sent, for when something still will not work */
  var transcript = [];

  function note(entry) {
    transcript.push(entry);
    if (transcript.length > 60) transcript.shift();
  }

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

  /* Every message the server sent, not just the first — a single invalid
     query usually trips several validation rules, and the useful one is
     often not first in the list. */
  function messagesIn(err) {
    var list = (err && err.graphQLErrors) || [];
    var msgs = list.map(function (e) { return String(e && e.message || ''); }).filter(Boolean);
    if (!msgs.length && err && err.message) msgs = [String(err.message)];
    return msgs;
  }

  /* Pull "searchUser", "adminSearchUsers", "getAllUsers" out of a
     "Did you mean …?" tail. Only plain names survive: the selection-set
     error suggests things like `searchUser { ... }`, which is advice about
     syntax, not a field name. */
  function suggestionsIn(message) {
    var tail = (String(message || '').match(/Did you mean ([^?]+)\?/i) || [])[1];
    if (!tail) return [];
    return tail.split(/,|\bor\b/)
      .map(function (s) { return s.replace(/["'`\s]/g, ''); })
      .filter(function (s) { return /^[A-Za-z_][A-Za-z0-9_]*$/.test(s); });
  }

  function allSuggestions(messages) {
    var out = [];
    messages.forEach(function (m) {
      suggestionsIn(m).forEach(function (s) { if (out.indexOf(s) === -1) out.push(s); });
    });
    return out;
  }

  /* Put the server's suggestions at the front, whether or not they were
     already on the list — a suggestion is better information than our
     guesses, so it should be tried next rather than in its old position. */
  function promote(list, items) {
    var rest = list.filter(function (x) { return items.indexOf(x) === -1; });
    return items.concat(rest);
  }

  function classify(err) {
    var msgs = messagesIn(err);
    var m = msgs.join(' | ');
    return {
      message: msgs[0] || '',
      messages: msgs,
      unknownField: /cannot query field/i.test(m),
      unknownArg: /unknown argument/i.test(m),
      /* a complaint about a *missing* argument means the field itself is
         right, and usually names the argument it wants */
      missingArg: /argument .*(is required|of required type)/i.test(m),
      needsSelection: /must have a selection (?:set|of subfields)/i.test(m),
      suggestions: allSuggestions(msgs)
    };
  }

  /* The argument named in "Field X argument Y of type Z is required". */
  function requiredArgIn(message) {
    var m = String(message || '').match(/argument ["'`]?([A-Za-z_][A-Za-z0-9_]*)["'`]?\s+of/i);
    return m ? m[1] : null;
  }

  /* …and the type it wants, so the probe declares the right variable. */
  function requiredArgTypeIn(message) {
    var m = String(message || '').match(/argument ["'`]?[A-Za-z_][A-Za-z0-9_]*["'`]?\s+of (?:required )?type ["'`]?([^"'`\s]+)/i);
    return m ? m[1] : null;
  }

  /* The type in:
       Field "x" of type "[User!]!" must have a selection of subfields.
       Field "x" of type "[User!]!" must have a selection set.
     Servers word this differently; both mean the same thing, and both
     name the type. */
  function returnTypeIn(message) {
    var m = String(message || '')
      .match(/of type ["'`]([^"'`]+)["'`] must have a selection (?:set|of subfields)/i);
    return m ? m[1] : null;
  }

  function firstIn(messages, fn) {
    var found = null;
    messages.some(function (m) {
      var v = fn(m);
      if (v) { found = v; return true; }
      return false;
    });
    return found;
  }

  /*
   * Ask the server to describe one field. Resolves to
   *   { field, exists, type, arg, argType, takesNoArgs, suggestions, messages }
   * and never rejects for a naming problem — that is the answer, not a
   * failure.
   */
  function describe(field, request) {
    var doc = 'query Describe { ' + field + ' }';
    return request(doc).then(function (data) {
      /* it answered — a scalar field that needs no arguments */
      note({ probe: doc, result: 'ok' });
      return { field: field, exists: true, scalar: true, takesNoArgs: true, data: data };
    }, function (err) {
      var c = classify(err);
      note({ probe: doc, result: c.messages.join(' | ') });

      if (c.unknownField) {
        return { field: field, exists: false, suggestions: c.suggestions, messages: c.messages };
      }

      var info = {
        field: field,
        /* the only error that means "no such field" is that one; every
           other complaint is about how we called a field that exists */
        exists: !c.unknownField,
        type: firstIn(c.messages, returnTypeIn),
        arg: c.missingArg ? firstIn(c.messages, requiredArgIn) : null,
        argType: c.missingArg ? firstIn(c.messages, requiredArgTypeIn) : null,
        suggestions: c.suggestions,
        messages: c.messages
      };

      /* The field exists and named no required argument. Either it takes
         none, or they are all optional — confirm with a valid selection. */
      if (info.exists && !info.arg) {
        var doc2 = 'query Describe { ' + field + ' { __typename } }';
        return request(doc2).then(function () {
          note({ probe: doc2, result: 'ok' });
          info.takesNoArgs = true;
          return info;
        }, function (err2) {
          var c2 = classify(err2);
          note({ probe: doc2, result: c2.messages.join(' | ') });
          if (c2.missingArg) {
            info.arg = firstIn(c2.messages, requiredArgIn);
            info.argType = firstIn(c2.messages, requiredArgTypeIn);
          }
          info.messages = info.messages.concat(c2.messages);
          return info;
        });
      }

      return info;
    });
  }

  /* "Cannot query field "id" on type "SearchResponseType"." — the field we
     asked for, and the type that does not have it. */
  function unknownFieldsIn(messages) {
    var out = [];
    messages.forEach(function (m) {
      var x = String(m).match(
        /Cannot query field ["'`]([A-Za-z_][A-Za-z0-9_]*)["'`] on type ["'`]([^"'`]+)["'`]/i);
      if (x) out.push({ field: x[1], type: x[2] });
    });
    return out;
  }

  /* Where rows tend to live when a query wraps them. */
  var CONTAINERS = ['users', 'data', 'results', 'items', 'records', 'rows',
                    'nodes', 'list', 'hits', 'edges', 'user', 'performers', 'profiles'];

  function unwrap(t) {
    while (t && (t.kind === 'NON_NULL' || t.kind === 'LIST')) t = t.ofType;
    return t || {};
  }

  function isList(t) {
    while (t && t.kind === 'NON_NULL') t = t.ofType;
    return !!(t && t.kind === 'LIST');
  }

  /*
   * What object-ish fields does this type have? Introspection answers
   * outright; when it is switched off, fall back to the usual names.
   */
  function containersFor(typeName, request) {
    var doc = 'query TypeShape($n: String!) { __type(name: $n) { fields { name type { ' +
              'kind name ofType { kind name ofType { kind name ofType { kind name } } } } } } }';
    return request(doc, { n: typeName }).then(function (data) {
      var fields = (((data || {}).__type || {}).fields) || [];
      var objects = fields.filter(function (f) { return unwrap(f.type).kind === 'OBJECT'; });
      note({ probe: 'shape of ' + typeName, result: objects.map(function (f) { return f.name; }).join(', ') || '(none)' });
      if (!objects.length) return CONTAINERS.slice();
      /* a list of objects is far more likely to be the rows than a single
         nested object, so try those first */
      var lists = objects.filter(function (f) { return isList(f.type); })
        .map(function (f) { return f.name; });
      var rest = objects.map(function (f) { return f.name; });
      return promote(rest, lists);
    }, function (err) {
      note({ probe: 'shape of ' + typeName, result: messagesIn(err).join(' | ') });
      return CONTAINERS.slice();
    });
  }

  /*
   * Work out where the rows sit inside a response and which of the fields
   * we want actually exist on them.
   *
   * Two things go wrong here and the server names both: a field we asked
   * for that the type does not have (drop it and ask again), and *every*
   * field being wrong, which means we are a level too high — the rows are
   * inside something like SearchResponseType.users.
   *
   * spec: { cacheKey, field, arg, argType, sample, fields[], opName, request }
   * → { path: ['users'], fields: [...], data }
   */
  function resolveRows(spec) {
    var request = spec.request;
    var MAX_DEPTH = 2;
    var cached = recall(spec.cacheKey);

    function docFor(path, fields) {
      var inner = fields.join(' ');
      for (var i = path.length - 1; i >= 0; i--) inner = path[i] + ' { ' + inner + ' }';
      return spec.arg
        ? 'query ' + (spec.opName || 'Rows') + '($v: ' + (spec.argType || 'String!') + ') { ' +
          spec.field + '(' + spec.arg + ': $v) { ' + inner + ' } }'
        : 'query ' + (spec.opName || 'Rows') + ' { ' + spec.field + ' { ' + inner + ' } }';
    }

    function run(path, fields) {
      var doc = docFor(path, fields);
      return request(doc, spec.arg ? { v: spec.sample } : {}).then(function (data) {
        note({ probe: doc, result: 'ok' });
        return { path: path, fields: fields, data: data };
      });
    }

    function tryPath(path, fields, depth) {
      if (!fields.length) return Promise.reject(new Error('nothing left to ask for'));
      return run(path, fields).catch(function (err) {
        var msgs = messagesIn(err);
        note({ probe: docFor(path, fields), result: msgs.join(' | ') });
        var unknown = unknownFieldsIn(msgs);
        if (!unknown.length) throw err;

        var kept = fields.filter(function (f) {
          return !unknown.some(function (u) { return u.field === f; });
        });
        /* some of what we asked for exists — drop the rest and take it */
        if (kept.length) return tryPath(path, kept, depth);

        /* none of it does: the rows are one level further in */
        if (depth >= MAX_DEPTH) throw err;
        return containersFor(unknown[0].type, request).then(function (names) {
          return names.reduce(function (chain, name) {
            return chain.catch(function () {
              return tryPath(path.concat(name), spec.fields.slice(), depth + 1);
            });
          }, Promise.reject(err));
        });
      });
    }

    var start = cached && cached.fields && cached.fields.length
      ? run(cached.path || [], cached.fields).catch(function () {
          forget(spec.cacheKey);
          return tryPath([], spec.fields.slice(), 0);
        })
      : tryPath([], spec.fields.slice(), 0);

    return start.then(function (found) {
      remember(spec.cacheKey, { path: found.path, fields: found.fields });
      return found;
    });
  }

  /*
   * spec: {
   *   cacheKey, fields[], args[], argType, sample, selection, opName, request
   * }
   * Resolves to { field, arg, argType } — the signature that worked. `arg`
   * is null for a field that takes no argument.
   */
  function resolve(spec) {
    var cached = recall(spec.cacheKey);
    if (cached && cached.field) return Promise.resolve(cached);

    var selection = spec.selection || '__typename';

    /* Some suggestions are false friends: getMyProfile is a real field, but
       it answers "who am I", not "who is #33". */
    function avoided(name) {
      return (spec.avoid || []).some(function (bad) {
        return bad instanceof RegExp ? bad.test(name) : bad === name;
      });
    }
    var queue = spec.fields.slice();
    var tried = {};
    var attempts = 0;
    var lastError = null;

    function keep(found) {
      remember(spec.cacheKey, found);
      return found;
    }

    /* Run the real shape once to be sure, then remember it. */
    function attempt(field, arg, argType) {
      attempts++;
      var doc = arg
        ? 'query ' + (spec.opName || 'Probe') + '($v: ' + (argType || spec.argType) + ') { ' +
          field + '(' + arg + ': $v) { ' + selection + ' } }'
        : 'query ' + (spec.opName || 'Probe') + ' { ' + field + ' { ' + selection + ' } }';
      return spec.request(doc, arg ? { v: spec.sample } : {}).then(function () {
        note({ probe: doc, result: 'ok' });
        return keep({ field: field, arg: arg || null, argType: argType || spec.argType });
      }, function (err) {
        note({ probe: doc, result: classify(err).messages.join(' | ') });
        throw err;
      });
    }

    /* Fallback for a field whose arguments are all optional: the server
       will not name one, so the guess list is all we have. */
    function guessArgs(field, args) {
      if (!args.length || attempts >= MAX_ATTEMPTS) return Promise.reject(lastError);
      var arg = args[0];
      return attempt(field, arg, spec.argType).catch(function (err) {
        lastError = err;
        var c = classify(err);
        if (c.unknownArg || c.missingArg) {
          var rest = args.filter(function (a) { return a !== arg; });
          if (c.suggestions.length) rest = promote(rest, c.suggestions);
          return guessArgs(field, rest);
        }
        throw err;
      });
    }

    function step() {
      if (!queue.length || attempts >= MAX_ATTEMPTS) {
        return Promise.reject(lastError ||
          new Error('Could not work out how to call this query'));
      }
      var field = queue.shift();
      if (tried[field]) return step();
      tried[field] = true;

      return describe(field, spec.request).then(function (info) {
        if (!info.exists) {
          lastError = new Error(info.messages[0] || ('No field "' + field + '"'));
          var worth = (info.suggestions || []).filter(function (s) {
            return !tried[s] && !avoided(s);
          });
          queue = promote(queue, worth);
          return step();
        }

        /* the server named its argument — use it */
        if (info.arg) {
          return attempt(info.field, info.arg, info.argType).catch(function (err) {
            lastError = err;
            return guessArgs(field, spec.args.slice()).catch(function () { return step(); });
          });
        }

        /* no required argument: try the guesses, then with none at all */
        return guessArgs(field, spec.args.slice())
          .catch(function () { return attempt(field, null, null); })
          .catch(function (err) { lastError = err; return step(); });
      });
    }

    return step();
  }

  /*
   * Print what the server says about a field. Run this in the browser
   * console on the live page when a query still will not work:
   *
   *   StuntListingResolve.report('searchUser')
   */
  function report(field) {
    var GQL = window.StuntListingGQL;
    if (!GQL) return Promise.reject(new Error('StuntListingGQL is not loaded'));
    return describe(field, GQL.request).then(function (info) {
      console.log('field      ', info.field);
      console.log('exists     ', !!info.exists);
      console.log('returns    ', info.type || '(not stated)');
      console.log('argument   ', info.arg ? info.arg + ': ' + (info.argType || '?') :
                                 (info.takesNoArgs ? '(none required)' : '(not stated)'));
      if (info.suggestions && info.suggestions.length) {
        console.log('suggested  ', info.suggestions.join(', '));
      }
      (info.messages || []).forEach(function (m) { console.log('  · ' + m); });
      return info;
    });
  }

  return {
    resolve: resolve,
    resolveRows: resolveRows,
    describe: describe,
    report: report,
    forget: forget,
    recall: recall,
    transcript: function () { return transcript.slice(); },
    messagesIn: messagesIn,
    suggestionsIn: suggestionsIn,
    classify: classify,
    unknownFieldsIn: unknownFieldsIn,
    requiredArgIn: requiredArgIn,
    requiredArgTypeIn: requiredArgTypeIn,
    returnTypeIn: returnTypeIn
  };
})();

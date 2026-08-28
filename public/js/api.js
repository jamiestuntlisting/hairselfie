/*
 * Session + performer roster adapter.
 *
 * The rest of the app only ever calls:
 *   HairSelfieApi.getSession()          → Promise<{ user, coordinator, signedOut }>
 *   HairSelfieApi.searchPerformers(q)   → Promise<[{id,name,height,weight,phone,email}, …]>
 *   HairSelfieApi.getPerformer(token)   → Promise<{id,name,…}>
 *   HairSelfieApi.getUserById(id)       → Promise<{id,name,…}>
 *   HairSelfieApi.login(email, pass)    → Promise
 *
 * In 'demo' mode everything is local: the profile lives in localStorage and
 * the roster below stands in for the StuntListing performer directory.
 * In 'stuntlisting' mode the same calls go to StuntListing's GraphQL API
 * through js/graphql.js, authenticated with a Bearer token. Swapping modes
 * changes nothing else in the app.
 */
window.HairSelfieApi = (function () {
  'use strict';

  var cfg = window.HAIRSELFIE_CONFIG || { mode: 'demo', endpoints: {} };

  var LS_PROFILE = 'hairselfie.demo.profile';
  var LS_ROLE = 'hairselfie.demo.role';
  var LS_MODE = 'hairselfie.mode';

  /*
   * Which backend to talk to. config.js sets the default, but ?api=live and
   * ?api=demo override it and stick — so the deployed page can be pointed at
   * the real StuntListing API without a code change and a redeploy.
   */
  function resolveMode() {
    var mode = cfg.mode || 'demo';
    try {
      var q = new URLSearchParams(window.location.search).get('api');
      if (q === 'live' || q === 'stuntlisting') {
        localStorage.setItem(LS_MODE, 'stuntlisting');
        return 'stuntlisting';
      }
      if (q === 'demo') {
        localStorage.setItem(LS_MODE, 'demo');
        return 'demo';
      }
      var saved = localStorage.getItem(LS_MODE);
      if (saved) return saved;
    } catch (e) { /* no storage — fall back to the configured mode */ }
    return mode;
  }

  var MODE = resolveMode();

  /* Fictional roster for demo mode — replaced by the real StuntListing
     directory in 'stuntlisting' mode. */
  var DEMO_PERFORMERS = [
    ['Alexis Tran',      "5'4\"",  '121 lb', '(310) 555-0141'],
    ['Marcus Bell',      "6'1\"",  '205 lb', '(323) 555-0162'],
    ['Sofia Reyes',      "5'6\"",  '132 lb', '(818) 555-0117'],
    ['Dae-Ho Kim',       "5'10\"", '172 lb', '(310) 555-0183'],
    ['Priya Nair',       "5'3\"",  '114 lb', '(323) 555-0149'],
    ['Jordan Whitfield', "5'11\"", '188 lb', '(818) 555-0128'],
    ['Tommy O’Rourke', "5'8\"", '161 lb', '(310) 555-0195'],
    ['Nia Okafor',       "5'7\"",  '140 lb', '(323) 555-0106'],
    ['Caleb Stone',      "6'3\"",  '218 lb', '(818) 555-0174'],
    ['Marisol Vega',     "5'5\"",  '127 lb', '(310) 555-0132'],
    ['Ryo Tanaka',       "5'9\"",  '158 lb', '(323) 555-0187'],
    ['Harper Quinn',     "5'6\"",  '131 lb', '(818) 555-0153'],
    ['Dmitri Volkov',    "6'0\"",  '196 lb', '(310) 555-0168'],
    ['Leilani Kahale',   "5'4\"",  '122 lb', '(323) 555-0121'],
    ['Andre Baptiste',   "5'11\"", '183 lb', '(818) 555-0146'],
    ['Scarlett Moss',    "5'8\"",  '143 lb', '(310) 555-0157'],
    ['Mateo Alvarez',    "5'7\"",  '152 lb', '(323) 555-0139'],
    ['Ingrid Sorensen',  "5'9\"",  '149 lb', '(818) 555-0192'],
    ['Jax Turner',       "6'2\"",  '209 lb', '(310) 555-0113'],
    ['Amara Diallo',     "5'10\"", '150 lb', '(323) 555-0178'],
    ['Finn Gallagher',   "5'9\"",  '167 lb', '(818) 555-0135'],
    ['Yuki Mori',        "5'2\"",  '106 lb', '(310) 555-0124'],
    ['Cole Redcloud',    "6'0\"",  '190 lb', '(323) 555-0158'],
    ['Bianca Ferraro',   "5'5\"",  '125 lb', '(818) 555-0181']
  ].map(function (row, i) {
    var slug = row[0].toLowerCase()
      .replace(/[’']/g, '')
      .replace(/[^a-z]+/g, '.')
      .replace(/^\.|\.$/g, '');
    return {
      id: 'demo-' + (i + 1),
      name: row[0],
      height: row[1],
      weight: row[2],
      phone: row[3],
      email: slug + '@example.com'
    };
  });

  /*
   * Stands in for the signed-in StuntListing profile. In 'stuntlisting' mode
   * these values come from getMyProfile, which is what makes the details
   * form fill itself in.
   */
  function defaultProfile() {
    return {
      id: 'demo-me',
      name: 'Jamie Northrup',
      height: "6'0\"",
      weight: '185 lb',
      phone: '(310) 555-0100',
      email: 'jamie@example.com'
    };
  }

  function loadProfile() {
    try {
      var raw = localStorage.getItem(LS_PROFILE);
      if (raw) {
        var p = JSON.parse(raw);
        if (p && typeof p === 'object') return Object.assign(defaultProfile(), p);
      }
    } catch (e) { /* ignore, fall through to default */ }
    return defaultProfile();
  }

  function delay(ms, value) {
    return new Promise(function (resolve) {
      setTimeout(function () { resolve(value); }, ms);
    });
  }

  /* ── demo implementation ───────────────────────────────────── */

  var demo = {
    isDemo: true,

    getSession: function () {
      var role = 'performer';
      try { role = localStorage.getItem(LS_ROLE) || 'performer'; } catch (e) { /* ignore */ }
      return delay(60, {
        user: loadProfile(),
        coordinator: role === 'coordinator'
      });
    },

    searchPerformers: function (q) {
      q = (q || '').trim().toLowerCase();
      var hits = !q ? [] : DEMO_PERFORMERS.filter(function (p) {
        return p.name.toLowerCase().indexOf(q) !== -1;
      }).slice(0, 8);
      return delay(120, hits);
    },

    /* resolve a request link (?p=<id>) back to a performer */
    getPerformer: function (id) {
      var me = loadProfile();
      if (id === me.id) return delay(60, me);
      var hit = DEMO_PERFORMERS.filter(function (p) { return p.id === id; })[0];
      return hit ? delay(90, hit) : Promise.reject(new Error('performer not found'));
    },

    /* Demo mode has no user table, so a coordinator id resolves to nothing
       rather than to an invented person. */
    getUserById: function () {
      return Promise.reject(new Error('no user table in demo mode'));
    },

    login: function () {
      return Promise.reject(new Error('Sign-in is only available once connected to StuntListing'));
    },

    signOut: function () { /* nothing to sign out of in demo mode */ },

    /* demo-only helpers used by the UI */
    saveLocalProfile: function (profile) {
      try {
        localStorage.setItem(LS_PROFILE, JSON.stringify(profile));
      } catch (e) { /* storage full/blocked — non-fatal */ }
    },

    getDemoRole: function () {
      try { return localStorage.getItem(LS_ROLE) || 'performer'; } catch (e) { return 'performer'; }
    },

    setDemoRole: function (role) {
      try { localStorage.setItem(LS_ROLE, role); } catch (e) { /* ignore */ }
    }
  };

  /*
   * StuntListing's user shape → the { id, name, height, weight, phone, email }
   * the UI works in. Confirmed against the app's own getMyProfile and
   * listDetails queries, and the user table:
   *   - there is no single `name`; it is first_name + last_name, with alias
   *     and nickname alongside as fallbacks
   *   - phone comes both raw and formatted — the formatted one is for people
   *   - inside a list a user carries both `id` (the membership row) and
   *     `user_id` (the actual user), so user_id wins where present
   *
   * The user table also carries email_visibility / phone_number_visibility.
   * They are deliberately ignored: a hair selfie sheet is a production
   * document and is meant to carry the performer's contact details, so those
   * flags do not apply here. Same for isAdminApproved. Decided, not
   * overlooked — don't reinstate without asking.
   */
  /*
   * Pull the rows out of whatever shape the server answered with: a bare
   * list, a Relay-style edges/node wrapper, a paginated object around one,
   * or — since the field is named `searchUser`, singular — a single user.
   */
  function rowsUnder(node) {
    if (!node) return [];
    if (Array.isArray(node)) {
      return node.filter(function (r) { return r && typeof r === 'object'; });
    }
    if (typeof node !== 'object') return [];

    if (Array.isArray(node.edges)) {
      return node.edges.map(function (e) { return e && e.node ? e.node : e; })
        .filter(function (r) { return r && typeof r === 'object'; });
    }

    var nested = null;
    Object.keys(node).some(function (k) {
      if (Array.isArray(node[k])) { nested = node[k]; return true; }
      return false;
    });
    if (nested) return nested.filter(function (r) { return r && typeof r === 'object'; });

    /* a lone user is still a result */
    return (node.id != null || node.user_id != null || node.first_name) ? [node] : [];
  }

  /* Walk to wherever resolveRows found the rows. A step through a list
     applies to each of its entries — that is what edges → node is. */
  function rowsAt(data, field, path) {
    var node = (data || {})[field];
    (path || []).forEach(function (k) {
      if (Array.isArray(node)) {
        node = node.map(function (el) { return el ? el[k] : el; });
      } else {
        node = node ? node[k] : node;
      }
    });
    return rowsUnder(node);
  }

  /* Only needed when the server has no search argument and hands back
     everyone — then the matching is ours to do. */
  function matches(p, q) {
    var needle = String(q || '').trim().toLowerCase();
    if (!needle) return true;
    return [p.name, p.alias, p.email, p.phone].some(function (v) {
      return String(v || '').toLowerCase().indexOf(needle) !== -1;
    });
  }

  /*
   * Everything a sheet can use, plus the gender fields, which are a guess —
   * that part of the schema has never been read from here. Unknown ones are
   * dropped on the first call rather than breaking the query.
   */
  var PROFILE_FIELDS = ['id', 'user_id', 'first_name', 'last_name', 'alias', 'nickname',
                        'height', 'weight', 'phone_number', 'phone_number_formatted',
                        'email', 'hair_color', 'role',
                        'gender', 'sex', 'gender_identity', 'pronouns'];

  /*
   * Whether to offer "able to shave". Only a clear yes hides it: an unknown
   * or unrecognised value leaves the question there, because wrongly
   * dropping it is the worse failure of the two.
   */
  function identifiesAsWoman(person) {
    var said = [person && person.gender, person && person.pronouns]
      .filter(Boolean).join(' ').toLowerCase();
    if (!said) return false;
    if (/\b(non[- ]?binary|nb|genderqueer|they|them)\b/.test(said)) return false;
    return /\b(f|female|woman|women|she|her|hers|fem)\b/.test(said);
  }

  function toPerson(u) {
    if (!u) return {};
    var full = [u.first_name, u.last_name].filter(Boolean).join(' ').trim();
    var id = u.user_id != null ? u.user_id : u.id;
    return {
      id: id == null ? '' : String(id),
      name: full || u.nickname || u.alias || '',
      alias: u.alias || u.nickname || '',
      height: u.height || '',
      weight: u.weight || '',
      phone: u.phone_number_formatted || u.phone_number || '',
      email: u.email || '',
      hairColor: u.hair_color || '',
      gender: u.gender || u.sex || u.gender_identity || '',
      pronouns: u.pronouns || ''
    };
  }

  /*
   * TODO confirm what `role` actually contains. The profile has a role field
   * rather than the boolean this app first assumed, but its values have not
   * been seen — so match loosely and keep the list configurable rather than
   * guess at one exact string.
   */
  var COORDINATOR_ROLES = (cfg.coordinator && cfg.coordinator.roles) ||
    ['coordinator', 'admin'];

  function roleIsCoordinator(role) {
    var r = String(role || '').toLowerCase();
    return COORDINATOR_ROLES.some(function (candidate) {
      return r.indexOf(String(candidate).toLowerCase()) !== -1;
    });
  }

  /* ── real StuntListing implementation ─────────────────────── */

  var live = {
    isDemo: false,

    getSession: function () {
      var GQL = window.StuntListingGQL;
      var R = window.StuntListingResolve;
      if (!GQL.isSignedIn()) {
        return Promise.resolve({ user: {}, coordinator: false, signedOut: true });
      }

      function shape(me) {
        return {
          user: toPerson(me),
          coordinator: roleIsCoordinator(me.role),
          role: me.role || ''
        };
      }

      /*
       * Asks for more than the confirmed fields — the gender ones have
       * never been seen in this schema — and lets resolveRows drop
       * whichever do not exist. The survivors are remembered, so this costs
       * one extra round trip once and nothing after that.
       *
       * If any of it goes wrong the plain confirmed query still runs:
       * signing in must not depend on a field nobody has verified.
       */
      return R.resolveRows({
        cacheKey: 'myProfileFields',
        field: 'getMyProfile',
        arg: null,
        fields: PROFILE_FIELDS,
        opName: 'getMyProfile',
        request: GQL.request
      }).then(function (found) {
        return shape(rowsAt(found.data, 'getMyProfile', found.path)[0] || {});
      }).catch(function () {
        return GQL.request(GQL.QUERIES.me).then(function (data) {
          return shape((data && data.getMyProfile) || {});
        });
      });
    },

    /*
     * The API told us the field is `searchUser` (its error suggested it over
     * our `searchUsers`), but not what the argument is called. Rather than
     * guess again, the signature is resolved from the server's own messages
     * once and then cached — see js/resolve.js.
     */
    searchPerformers: function (q) {
      var GQL = window.StuntListingGQL;
      var R = window.StuntListingResolve;
      /* Asked for individually rather than as one string: the server names
         any field its type does not have, and resolveRows drops those and
         asks again — so wanting too much costs nothing. */
      var USER_FIELDS = ['id', 'user_id', 'first_name', 'last_name', 'alias',
                         'nickname', 'height', 'weight', 'phone_number',
                         'phone_number_formatted', 'email', 'hair_color'];

      return R.resolve({
        cacheKey: 'searchUser',
        fields: ['searchUser', 'adminSearchUsers', 'getAllUsers', 'searchUsers'],
        args: ['search', 'query', 'keyword', 'term', 'text', 'name'],
        /* getMyProfile is a real field the server may suggest, but it
           answers "who am I", not "who matches this text" */
        avoid: [/my ?profile/i, /^me$/i],
        argType: 'String!',
        sample: q || 'a',
        selection: '__typename',
        opName: 'searchUser',
        request: GQL.request
      }).then(function (sig) {
        return R.resolveRows({
          cacheKey: 'searchUserRows',
          field: sig.field,
          arg: sig.arg,
          argType: sig.argType,
          sample: q,
          fields: USER_FIELDS,
          opName: 'searchUser',
          request: GQL.request
        }).then(function (found) {
          var people = rowsAt(found.data, sig.field, found.path).map(toPerson);
          /* a field that takes no search argument returns everyone, so the
             matching has to happen here */
          return sig.arg ? people : people.filter(function (p) { return matches(p, q); });
        });
      });
    },

    /*
     * One user by their id — used for the coordinator's own name, which is
     * set by their user id rather than typed. Same resolution trick.
     */
    getUserById: function (id) {
      var GQL = window.StuntListingGQL;
      var R = window.StuntListingResolve;
      var USER_FIELDS = ['id', 'user_id', 'first_name', 'last_name', 'alias',
                         'nickname', 'height', 'weight', 'phone_number',
                         'phone_number_formatted', 'email', 'hair_color'];

      return R.resolve({
        cacheKey: 'userById',
        fields: ['userDetails', 'getUser', 'user', 'getUserById', 'userProfile'],
        args: ['user_id', 'id', 'userId'],
        avoid: [/my ?profile/i, /^me$/i],
        argType: 'Int!',
        sample: parseInt(id, 10),
        selection: '__typename',
        opName: 'userById',
        request: GQL.request
      }).then(function (sig) {
        return R.resolveRows({
          cacheKey: 'userByIdRows',
          field: sig.field,
          arg: sig.arg,
          argType: sig.argType || 'Int!',
          sample: parseInt(id, 10),
          fields: USER_FIELDS,
          opName: 'userById',
          request: GQL.request
        }).then(function (found) {
          return rowsAt(found.data, sig.field, found.path)[0];
        });
      }).then(function (u) {
        if (!u) throw new Error('user not found');
        /* Make sure we were answered about the person we asked about: a
           resolved-by-guesswork query could easily be "the signed-in user"
           instead, and showing the wrong name would look like it worked. */
        var got = u.user_id != null ? u.user_id : u.id;
        if (got != null && String(got) !== String(id)) {
          R.forget('userById');
          R.forget('userByIdRows');
          throw new Error('that query returned #' + got + ', not #' + id);
        }
        return toPerson(u);
      });
    },

    /* Members of one of the coordinator's lists, as an alternative to a
       global search. */
    listPerformers: function (listId) {
      var GQL = window.StuntListingGQL;
      return GQL.request(GQL.QUERIES.listDetails, { list_id: parseInt(listId, 10) })
        .then(function (data) {
          var details = (data && data.listDetails) || {};
          return (details.users || []).map(toPerson);
        });
    },

    getPerformer: function (id) {
      var GQL = window.StuntListingGQL;
      return GQL.request(GQL.QUERIES.performer, { user_id: parseInt(id, 10) })
        .then(function (data) {
          var u = data && (data.userDetails || data.getUser || data.user);
          if (!u) throw new Error('performer not found');
          return toPerson(u);
        });
    },

    login: function (email, password) {
      return window.StuntListingGQL.login(email, password);
    },

    signOut: function () { window.StuntListingGQL.signOut(); },

    saveLocalProfile: function () { /* server owns the profile in live mode */ },
    getDemoRole: function () { return null; },
    setDemoRole: function () { /* not applicable */ }
  };

  var impl = MODE === 'stuntlisting' ? live : demo;
  impl.mode = MODE;
  /* pure helpers, exposed for tests */
  impl.toPerson = toPerson;
  impl.roleIsCoordinator = roleIsCoordinator;
  impl.identifiesAsWoman = identifiesAsWoman;
  return impl;
})();

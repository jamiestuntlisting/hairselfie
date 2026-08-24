/*
 * Session + performer roster adapter.
 *
 * The rest of the app only ever calls:
 *   HairSelfieApi.getSession()          → Promise<{ user, coordinator, signedOut }>
 *   HairSelfieApi.searchPerformers(q)   → Promise<[{id,name,height,weight,phone,email}, …]>
 *   HairSelfieApi.getPerformer(token)   → Promise<{id,name,…}>
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
   * these values come from the session endpoint, which is what makes the
   * details form fill itself in.
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

  /* ── demo implementation ─────────────────────────────────────── */

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

  /* ── real StuntListing implementation ────────────────────────── */

  /*
   * Talks to StuntListing's GraphQL API via js/graphql.js. The documents
   * themselves live there; this layer only reshapes results into the
   * { id, name, height, weight, phone, email } shape the UI works in.
   */
  var live = {
    isDemo: false,

    getSession: function () {
      var GQL = window.StuntListingGQL;
      if (!GQL.isSignedIn()) {
        return Promise.resolve({ user: {}, coordinator: false, signedOut: true });
      }
      return GQL.request(GQL.QUERIES.me).then(function (data) {
        var me = (data && data.getMyProfile) || {};
        return {
          user: {
            id: me.id,
            name: me.name || '',
            height: me.height || '',
            weight: me.weight || '',
            phone: me.phone || '',
            email: me.email || ''
          },
          /* TODO confirm how the schema marks a coordinator. */
          coordinator: !!(me.isCoordinator || me.is_coordinator)
        };
      });
    },

    searchPerformers: function (q) {
      var GQL = window.StuntListingGQL;
      return GQL.request(GQL.QUERIES.searchPerformers, { q: q })
        .then(function (data) {
          return (data && data.searchPerformers) || [];
        });
    },

    getPerformer: function (token) {
      var GQL = window.StuntListingGQL;
      return GQL.request(GQL.QUERIES.performer, { token: token })
        .then(function (data) {
          var p = data && data.hairSelfieRequest && data.hairSelfieRequest.performer;
          if (!p) throw new Error('request link not recognised');
          return p;
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
  return impl;
})();

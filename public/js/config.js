/*
 * Hair Selfie configuration.
 *
 * mode: 'demo'         — runs standalone with a local profile and a sample
 *                        performer roster. Good for trying the app before
 *                        it is wired into StuntListing.
 * mode: 'stuntlisting' — talks to the real StuntListing backend using the
 *                        endpoints below. The page must be served from (or
 *                        proxied through) a StuntListing origin so the
 *                        session cookie is sent along. See README.md for
 *                        the exact request/response contracts.
 */
window.HAIRSELFIE_CONFIG = {
  mode: 'demo',

  /* StuntListing's GraphQL API. Every document sent to it lives in
     js/graphql.js — correct them there against the real schema. */
  graphqlUrl: 'https://api.stuntlisting.com/graphql',

  auth: {
    /* Where the access token is kept in the browser. The mobile app uses
       these same names in SecureStore. */
    tokenKey: 'STL_token',
    refreshKey: 'STL_refresh',

    /* A token can be handed to this page as ?token=… (stripped from the URL
       immediately) or by postMessage from a WebView host. List the origins
       allowed to post one; an empty list accepts any, which is only safe if
       the page is never embedded by anyone else. */
    tokenParam: 'token',
    tokenOrigins: ['https://stuntlisting.com', 'https://www.stuntlisting.com'],

    /* Show an email/password sign-in when there is no token yet. Turn this
       off if the page is only ever opened with a token handed in. */
    allowPasswordLogin: true
  },

  /*
   * Request links. A coordinator sends a performer a link like
   *   https://…/?p=<performerId>
   * and the app opens straight into "take your four photos", with that
   * performer's details already filled in. Only the id travels in the URL —
   * the details are fetched, so no contact info ends up in a text message.
   */
  requestParam: 'p',

  output: {
    cellWidth: 1000,      // px per photo cell in the final sheet
    cellHeight: 1250,     // 4:5 portrait, passport-ish framing
    format: 'image/jpeg', // 'image/jpeg' (recommended for phones) or 'image/png'
    quality: 0.92         // JPEG quality (ignored for PNG)
  }
};

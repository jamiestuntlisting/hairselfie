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

  endpoints: {
    // GET → { user: {id,name,height,weight,phone,email}, coordinator: true|false }
    session: '/api/hair-selfie/session',
    // GET ?q=<query> → [ {id,name,height,weight,phone,email}, ... ]  (coordinator only)
    performerSearch: '/api/hair-selfie/performers'
  },

  output: {
    cellWidth: 1000,      // px per photo cell in the final sheet
    cellHeight: 1250,     // 4:5 portrait, passport-ish framing
    format: 'image/jpeg', // 'image/jpeg' (recommended for phones) or 'image/png'
    quality: 0.92         // JPEG quality (ignored for PNG)
  }
};

/*
 * Static assets, plus a small same-origin proxy for StuntListing's API.
 *
 * The API has never served a browser before — the StuntListing app is
 * native — so it sends no Access-Control-Allow-Origin header and every
 * request from this page dies at the preflight. Rather than wait on a
 * backend change, requests go through this Worker: server-to-server calls
 * are not subject to CORS.
 *
 * This proxy grants no authority of its own. It holds no credentials and
 * adds none; it only relays the caller's own Authorization header, so it
 * cannot reach anything the caller could not already reach with a token.
 * It is still a relay, so it is kept narrow: one fixed upstream, POST only,
 * and only from this site's own origin.
 *
 * None of this is needed once the app is served from a StuntListing origin
 * — then it is same-origin and the proxy can go.
 */

const UPSTREAM = 'https://api.stuntlisting.com/graphql';
const PROXY_PATH = '/api/graphql';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname !== PROXY_PATH) {
      /* Anything that is not the proxy is a static file. Assets are normally
         served before this runs; this covers the rest. */
      return env.ASSETS.fetch(request);
    }

    /* Same-origin only: a browser always sends Origin on a cross-origin
       POST, so this turns away other websites. It does not stop a direct
       client such as curl, which is why the no-credentials point above
       matters more than this check does. */
    const origin = request.headers.get('Origin');
    if (origin && origin !== url.origin) {
      return json({ errors: [{ message: 'This proxy only serves its own origin.' }] }, 403);
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(url.origin) });
    }

    if (request.method !== 'POST') {
      return json({ errors: [{ message: 'GraphQL requests must be POST.' }] }, 405);
    }

    const headers = new Headers({ 'Content-Type': 'application/json' });
    const auth = request.headers.get('Authorization');
    if (auth) headers.set('Authorization', auth);

    let upstream;
    try {
      upstream = await fetch(UPSTREAM, {
        method: 'POST',
        headers,
        body: await request.text()
      });
    } catch (err) {
      return json({ errors: [{ message: 'Could not reach StuntListing: ' + err.message }] }, 502);
    }

    /* Pass the upstream answer straight through, status and all, so a
       schema error still reads as a schema error rather than a proxy one. */
    const out = new Headers(corsHeaders(url.origin));
    out.set('Content-Type', upstream.headers.get('Content-Type') || 'application/json');
    return new Response(upstream.body, { status: upstream.status, headers: out });
  }
};

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400'
  };
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

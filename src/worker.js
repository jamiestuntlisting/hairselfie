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
const SHEETS_PATH = '/api/sheets';
const SEEN_PATH = '/api/seen';
const ADMIN_PATH = '/api/admin';
const SEEN_PREFIX = '_seen/';
const MAX_SHEET = 12 * 1024 * 1024;   // a sheet is under 1 MB; this is a ceiling, not a target

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === SHEETS_PATH) {
      return sheets(request, env, url);
    }
    if (url.pathname === SEEN_PATH) {
      return seen(request, env, url);
    }
    if (url.pathname === ADMIN_PATH) {
      return admin(request, env, url);
    }

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
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400'
  };
}

function json(body, status, origin) {
  const headers = origin
    ? new Headers(corsHeaders(origin))
    : new Headers();
  headers.set('Content-Type', 'application/json');
  return new Response(JSON.stringify(body), { status, headers });
}


/* ── saving finished sheets ─────────────────────────────────────────
 *
 * A sheet belongs to whoever made it, so the only question worth getting
 * right is whose it is — and that answer never comes from the browser. The
 * caller sends the access token they signed in with; this asks StuntListing
 * who that token belongs to and files the sheet under the id it gets back.
 * A client that says "save this as user 33" is ignored, because it is never
 * asked.
 *
 * The key is the whole record:
 *
 *   33/warren-hull_hair_2026-08-28T15-24-31.jpg
 *
 * — whose, whose name, which kind, and when. It is read back through
 * ?key=, not as a path segment, because it contains a slash. Listing a
 * prefix answers
 * "every sheet Warren has made" without anything else needing to exist.
 * That is why there is no database here. One would start to earn its place
 * the moment somebody wants to search across performers, or to attach a
 * sheet to a job, or to hold anything that is not itself a picture.
 */

async function sheets(request, env, url) {
  if (!env.SHEETS) {
    return json({ error: 'Saving is not configured on this deployment.' }, 501);
  }

  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) {
    return json({ error: 'This endpoint only serves its own origin.' }, 403);
  }
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(url.origin) });
  }

  const auth = request.headers.get('Authorization');
  if (!auth) {
    return json({ error: 'Sign in to save a sheet.' }, 401);
  }

  let who;
  try {
    who = await whoIs(auth);
  } catch (err) {
    return json({ error: 'Could not check who you are: ' + err.message }, 502);
  }
  if (!who) {
    return json({ error: 'That session is not valid any more. Sign in again.' }, 401);
  }

  if (request.method === 'POST') {
    return save(request, env, url, who);
  }
  if (request.method === 'GET') {
    /* The key carries a slash, so it travels as a query parameter rather
       than a path segment: %2F inside a path is handled differently by
       everything it passes through, and there is no reason to find out. */
    const key = url.searchParams.get('key');
    return key ? one(env, url, who, key) : listMine(env, url, who);
  }
  return json({ error: 'Not something this endpoint does.' }, 405);
}

/* The token's owner, straight from StuntListing. */
async function whoIs(auth) {
  const res = await fetch(UPSTREAM, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: auth },
    body: JSON.stringify({
      operationName: 'getMyProfile',
      variables: {},
      query: 'query getMyProfile { getMyProfile { id first_name last_name email } }'
    })
  });
  const body = await res.json();
  const me = body && body.data && body.data.getMyProfile;
  if (!me || me.id == null) return null;
  return {
    id: String(me.id),
    name: [me.first_name, me.last_name].filter(Boolean).join(' ').trim(),
    email: String(me.email || '').toLowerCase().trim()
  };
}

function slug(s) {
  return String(s || '').toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'performer';
}

async function save(request, env, url, who) {
  const kind = (request.headers.get('X-Sheet-Kind') || 'hair').replace(/[^a-z]/gi, '') || 'hair';
  const type = request.headers.get('Content-Type') || 'image/jpeg';
  if (!/^image\/(jpeg|png)$/.test(type)) {
    return json({ error: 'A sheet is a JPEG or a PNG.' }, 415);
  }

  const body = await request.arrayBuffer();
  if (!body.byteLength) return json({ error: 'That sheet was empty.' }, 400);
  if (body.byteLength > MAX_SHEET) return json({ error: 'That sheet is too large.' }, 413);

  const now = new Date();
  const stamp = now.toISOString().replace(/:/g, '-').replace(/\.\d+Z$/, '');
  const ext = type === 'image/png' ? 'png' : 'jpg';
  const key = `${who.id}/${slug(who.name)}_${kind}_${stamp}.${ext}`;

  await env.SHEETS.put(key, body, {
    httpMetadata: { contentType: type },
    customMetadata: {
      userId: who.id,
      name: who.name,
      kind,
      createdAt: now.toISOString()
    }
  });

  return json({ key, size: body.byteLength, savedAt: now.toISOString() }, 201, url.origin);
}

async function listMine(env, url, who) {
  const listed = await env.SHEETS.list({ prefix: who.id + '/', limit: 100 });
  const sheetsOut = listed.objects.map((o) => ({
    key: o.key,
    size: o.size,
    kind: (o.customMetadata && o.customMetadata.kind) || '',
    createdAt: (o.customMetadata && o.customMetadata.createdAt) || o.uploaded
  })).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return json({ sheets: sheetsOut }, 200, url.origin);
}

async function one(env, url, who, key) {
  /* Your own prefix or nothing: the key is guessable, so it is checked
     rather than trusted. */
  if (!key || key.indexOf(who.id + '/') !== 0) {
    return json({ error: 'Not yours.' }, 403);
  }
  const object = await env.SHEETS.get(key);
  if (!object) return json({ error: 'No such sheet.' }, 404);

  const headers = new Headers(corsHeaders(url.origin));
  headers.set('Content-Type',
    (object.httpMetadata && object.httpMetadata.contentType) || 'image/jpeg');
  headers.set('Cache-Control', 'private, max-age=60');
  return new Response(object.body, { status: 200, headers });
}


/* ── who is using it ────────────────────────────────────────────────
 *
 * Saved sheets say who is making things. They say nothing about who signed
 * in and made nothing, which is the more interesting half of "is anyone
 * using this". So the app marks a day when somebody arrives signed in.
 *
 * One object per person per day, overwritten:
 *
 *   _seen/2026-08-28/33.json
 *
 * That bounds the writes to one a day each however often somebody opens
 * the page, and a listing of the prefix is the day's active people. Day
 * granularity is all "are people logging in" needs, and the alternative —
 * a row per visit — is a database, which nothing here yet justifies.
 */

async function seen(request, env, url) {
  if (!env.SHEETS) return json({ error: 'Not configured.' }, 501);
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) return json({ error: 'Wrong origin.' }, 403);
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(url.origin) });
  }
  if (request.method !== 'POST') return json({ error: 'POST only.' }, 405);

  const auth = request.headers.get('Authorization');
  if (!auth) return json({ error: 'Not signed in.' }, 401);

  let who;
  try { who = await whoIs(auth); } catch (err) { return json({ error: err.message }, 502); }
  if (!who) return json({ error: 'Not a valid session.' }, 401);

  const day = new Date().toISOString().slice(0, 10);
  await env.SHEETS.put(`${SEEN_PREFIX}${day}/${who.id}.json`,
    JSON.stringify({ id: who.id, name: who.name, email: who.email, at: new Date().toISOString() }),
    { httpMetadata: { contentType: 'application/json' },
      customMetadata: { userId: who.id, name: who.name } });

  return json({ ok: true }, 200, url.origin);
}

/* ── the admin view ─────────────────────────────────────────────────
 *
 * Everything saved and everyone seen, for the handful of people who run
 * StuntListing. Being an admin is decided here from the email on the
 * token's profile, never from anything the browser says.
 */

function adminEmails(env) {
  const raw = (env && env.ADMIN_EMAILS) || '';
  return String(raw).split(',').map((e) => e.toLowerCase().trim()).filter(Boolean);
}

async function everything(bucket, prefix) {
  const out = [];
  let cursor;
  /* bounded rather than unbounded: five pages is more history than this
     page can usefully show, and an admin view should not be able to spend
     the whole request budget */
  for (let page = 0; page < 5; page++) {
    const chunk = await bucket.list({ prefix, limit: 1000, cursor });
    out.push(...chunk.objects);
    if (!chunk.truncated) return { objects: out, complete: true };
    cursor = chunk.cursor;
  }
  return { objects: out, complete: false };
}

async function admin(request, env, url) {
  if (!env.SHEETS) return json({ error: 'Not configured.' }, 501);
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) return json({ error: 'Wrong origin.' }, 403);
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(url.origin) });
  }

  const auth = request.headers.get('Authorization');
  if (!auth) return json({ error: 'Sign in to see this.' }, 401);

  let who;
  try { who = await whoIs(auth); } catch (err) { return json({ error: err.message }, 502); }
  if (!who) return json({ error: 'That session is not valid any more.' }, 401);

  const allowed = adminEmails(env);
  if (!who.email || allowed.indexOf(who.email) === -1) {
    return json({ error: 'This page is for StuntListing admins.' }, 403);
  }

  const [saved, visits] = await Promise.all([
    everything(env.SHEETS, ''),
    everything(env.SHEETS, SEEN_PREFIX)
  ]);

  const sheetsOut = saved.objects
    .filter((o) => o.key.indexOf(SEEN_PREFIX) !== 0)
    .map((o) => {
      const meta = o.customMetadata || {};
      return {
        key: o.key,
        userId: meta.userId || o.key.split('/')[0],
        name: meta.name || '',
        kind: meta.kind || '',
        size: o.size,
        createdAt: meta.createdAt || o.uploaded
      };
    })
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

  const seenOut = visits.objects.map((o) => {
    const meta = o.customMetadata || {};
    const parts = o.key.slice(SEEN_PREFIX.length).split('/');
    return {
      date: parts[0],
      userId: meta.userId || (parts[1] || '').replace(/\.json$/, ''),
      name: meta.name || ''
    };
  }).sort((a, b) => String(b.date).localeCompare(String(a.date)));

  return json({
    sheets: sheetsOut,
    seen: seenOut,
    complete: saved.complete && visits.complete,
    you: who.name
  }, 200, url.origin);
}

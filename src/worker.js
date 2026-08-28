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
const SEEN_PREFIX = '_seen/';        // the earlier signed-in-only marks
const USE_PREFIX = '_use/';
const USE_PATH = '/api/use';
const MAX_SHEET = 12 * 1024 * 1024;   // a sheet is under 1 MB; this is a ceiling, not a target

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === SHEETS_PATH) {
      return sheets(request, env, url);
    }
    if (url.pathname === SEEN_PATH || url.pathname === USE_PATH) {
      return used(request, env, url);
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

/*
 * The key was built to be readable on its own —
 *   33/warren-hull_hair_2026-08-28T15-32-25.jpg
 * — so it is a fallback for anything the metadata does not carry.
 */
function readKey(key) {
  const [userId, file] = String(key).split('/');
  const m = String(file || '').match(/^(.*)_([a-z]+)_(\d{4}-\d{2}-\d{2}T[\d-]+)\./);
  if (!m) return { userId: userId || '', name: '', kind: '' };
  return {
    userId: userId || '',
    name: m[1].split('-').map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(' '),
    kind: m[2]
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
  /* Your own prefix, or anything at all if you run the place. The key is
     guessable, so this is checked rather than trusted. */
  if (!key || (key.indexOf(who.id + '/') !== 0 && !isAdmin(env, who))) {
    return json({ error: 'Not yours.' }, 403);
  }
  if (key.indexOf(USE_PREFIX) === 0 || key.indexOf(SEEN_PREFIX) === 0) {
    return json({ error: 'Not a sheet.' }, 403);
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
 * Saved sheets say who is making things. They say nothing about everyone
 * who opened the page and made nothing, which is the more interesting half
 * of "is anyone using this" — and nothing at all about people who never
 * signed in.
 *
 * So every page load is counted, signed in or not, as one object per
 * visitor per day:
 *
 *   _use/2026-08-28/9f3c1a7e.json
 *   { visitor, userId, name, loads: 6, pages: { hair: 4, wardrobe: 2 } }
 *
 * A row per visit would be neater to query and would also be a database.
 * This keeps the writes to one object a day per person however often they
 * open it, while still counting every load inside it — and the visitor id
 * is a random string from their own browser, not anything about them.
 */

async function used(request, env, url) {
  if (!env.SHEETS) return json({ error: 'Not configured.' }, 501);
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) return json({ error: 'Wrong origin.' }, 403);
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(url.origin) });
  }
  if (request.method !== 'POST') return json({ error: 'POST only.' }, 405);

  let body = {};
  try { body = await request.json(); } catch (e) { /* a bare POST still counts */ }

  const visitor = String(body.visitor || '').replace(/[^a-z0-9-]/gi, '').slice(0, 40)
                  || 'anon-' + Math.random().toString(36).slice(2, 10);
  const page = String(body.page || 'other').replace(/[^a-z]/gi, '').slice(0, 20) || 'other';
  const day = new Date().toISOString().slice(0, 10);
  const key = `${USE_PREFIX}${day}/${visitor}.json`;

  /* what today already says about this visitor */
  let record = { visitor, userId: '', name: '', loads: 0, pages: {}, first: '', last: '' };
  try {
    const existing = await env.SHEETS.get(key);
    if (existing) record = Object.assign(record, await existing.json());
  } catch (e) { /* a corrupt record is replaced rather than mourned */ }
  if (!record.pages) record.pages = {};

  /*
   * Resolving who somebody is costs a call to StuntListing, so it happens
   * once a day per visitor rather than on every load: after the first one
   * the name is already on the record.
   */
  const auth = request.headers.get('Authorization');
  if (auth && !record.userId) {
    try {
      const who = await whoIs(auth);
      if (who) { record.userId = who.id; record.name = who.name; }
    } catch (e) { /* counted as a guest rather than not counted at all */ }
  }

  const now = new Date().toISOString();
  record.loads = (record.loads || 0) + 1;
  record.pages[page] = (record.pages[page] || 0) + 1;
  record.first = record.first || now;
  record.last = now;

  await env.SHEETS.put(key, JSON.stringify(record), {
    httpMetadata: { contentType: 'application/json' },
    customMetadata: { userId: record.userId || '', name: record.name || '', day }
  });

  return json({ ok: true }, 200, url.origin);
}

/* ── the admin view ─────────────────────────────────────────────────
 *
 * Everything saved and everyone seen, for the handful of people who run
 * StuntListing. Being an admin is decided here from the email on the
 * token's profile, never from anything the browser says.
 */

/*
 * Who runs this. An id rather than an email: it is the same id the sheets
 * are filed under, it cannot be changed by changing an email address, and
 * it is what the app already knows about a person.
 */
function adminIds(env) {
  const raw = (env && env.ADMIN_IDS) || '';
  return String(raw).split(',').map((e) => e.trim()).filter(Boolean);
}

function isAdmin(env, who) {
  return !!who && adminIds(env).indexOf(String(who.id)) !== -1;
}

async function everything(bucket, prefix) {
  const out = [];
  let cursor;
  /* bounded rather than unbounded: five pages is more history than this
     page can usefully show, and an admin view should not be able to spend
     the whole request budget */
  for (let page = 0; page < 5; page++) {
    /* include: custom metadata is left out of a listing unless asked for,
       which is why the admin page first showed every sheet as "— —" */
    const chunk = await bucket.list({ prefix, limit: 1000, cursor, include: ['customMetadata'] });
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

  if (!isAdmin(env, who)) {
    return json({ error: 'This page is for StuntListing admins.' }, 403);
  }

  const [saved, visits, marks] = await Promise.all([
    everything(env.SHEETS, ''),
    everything(env.SHEETS, USE_PREFIX),
    everything(env.SHEETS, SEEN_PREFIX)
  ]);

  const sheetsOut = saved.objects
    .filter((o) => o.key.indexOf(SEEN_PREFIX) !== 0 && o.key.indexOf(USE_PREFIX) !== 0)
    .map((o) => {
      const meta = o.customMetadata || {};
      const fromKey = readKey(o.key);
      return {
        key: o.key,
        userId: meta.userId || fromKey.userId,
        name: meta.name || fromKey.name,
        kind: meta.kind || fromKey.kind,
        size: o.size,
        createdAt: meta.createdAt || o.uploaded
      };
    })
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

  /*
   * Usage is rolled up here rather than sent raw: a day of visitors is a
   * handful of numbers, and the page has no use for the individual
   * records. Reading the bodies costs one get each, so it is capped.
   */
  const READ_CAP = 400;
  const recent = visits.objects
    .sort((a, b) => String(b.key).localeCompare(String(a.key)))
    .slice(0, READ_CAP);

  const days = {};
  function dayRow(date) {
    if (!days[date]) {
      days[date] = { date, visitors: 0, loads: 0, signedIn: 0, guests: 0, pages: {} };
    }
    return days[date];
  }

  const people = {};
  function person(id, name) {
    if (!people[id]) people[id] = { userId: id, name: name || '', sheets: 0, last: '', seen: '' };
    if (name && !people[id].name) people[id].name = name;
    return people[id];
  }

  await Promise.all(recent.map(async (o) => {
    const date = o.key.slice(USE_PREFIX.length).split('/')[0];
    const row = dayRow(date);
    let rec = {};
    try {
      const got = await env.SHEETS.get(o.key);
      rec = got ? await got.json() : {};
    } catch (e) { rec = {}; }
    row.visitors += 1;
    row.loads += rec.loads || 1;
    if (rec.userId) {
      row.signedIn += 1;
      const p = person(String(rec.userId), rec.name);
      if (date > p.seen) p.seen = date;
    } else {
      row.guests += 1;
    }
    Object.keys(rec.pages || {}).forEach((k) => {
      row.pages[k] = (row.pages[k] || 0) + rec.pages[k];
    });
  }));

  /* the earlier signed-in-only marks, so that history is not lost */
  marks.objects.forEach((o) => {
    const meta = o.customMetadata || {};
    const parts = o.key.slice(SEEN_PREFIX.length).split('/');
    const date = parts[0];
    const id = meta.userId || (parts[1] || '').replace(/\.json$/, '');
    if (!days[date]) {
      const row = dayRow(date);
      row.visitors += 1;
      row.loads += 1;
      row.signedIn += 1;
    }
    if (id) {
      const p = person(id, meta.name);
      if (date > p.seen) p.seen = date;
    }
  });

  sheetsOut.forEach((sheet) => {
    const p = person(String(sheet.userId), sheet.name);
    p.sheets += 1;
    if (String(sheet.createdAt) > String(p.last)) p.last = sheet.createdAt;
  });

  return json({
    sheets: sheetsOut.slice(0, 200),
    totalSheets: sheetsOut.length,
    storedBytes: sheetsOut.reduce((n, x) => n + (x.size || 0), 0),
    usage: Object.keys(days).map((d) => days[d]).sort((a, b) => a.date.localeCompare(b.date)),
    people: Object.keys(people).map((k) => people[k]),
    complete: saved.complete && visits.complete && recent.length === visits.objects.length,
    you: who.name
  }, 200, url.origin);
}

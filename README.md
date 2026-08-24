# Hair Selfie · a StuntListing add-on

Build a four-angle **hair reference sheet** — front, left side, right side, back — right from a
phone or computer, with the performer's details printed underneath, and download it as a single
JPEG.

**Live:** https://hairselfie.jamie-181.workers.dev

![The Hair Selfie editor](docs/screenshot-editor.png)

## What it does

- **Four photo positions** (Front · Left side · Right side · Back) in a 2×2 grid.
  **Take photos** walks you through the four angles one shot at a time using the camera;
  **Add photos** picks from the library (all four at once, in order).
- **Drag to rearrange** — press and hold a photo on a phone, or just drag with a mouse, and
  drop it on another position to swap. Tapping one photo then another swaps them too.
- **Works out which photo is which** — add four at once and it sorts them into front, sides and
  back for you, then says so and offers Undo. See below.
- **Passport-style head guides** — a large dashed head-and-shoulders outline in every position.
  Side shots say which way to face in plain terms: a *left side* view means your **left ear is
  toward the camera**, so the nose points to the left of frame. A faint guide stays over placed
  photos and can be switched off.
- **Adjust framing** — per-photo zoom, drag-to-reposition and 90° rotation, with the guide
  overlaid. What you see in the editor is exactly what gets exported.
- **Details bar** — name, height, weight, phone and email printed as white text on the black
  band *below* the photos, sized to run the full width of the sheet. Empty fields are left out.
  Details fill themselves in from the signed-in StuntListing profile.
- **Optional note** — a short line (up to 140 characters) under the details.
- **Able to cut hair / Able to shave** — tick either and it prints as a pill on the sheet.
- **Two pages** — `index.html` is the performer view and the default; `coordinator.html` is the
  coordinator view, which opens on a performer search and does one job: send someone a request.
- **Save image** — one button. On a phone the share sheet offers *Save Image*, which puts the
  sheet in the camera roll rather than Files; on desktop it downloads.
- **Request links** — a coordinator finds a performer and gets a link to text them. Opening it
  names the performer, fills in their details and goes straight to the camera.
- **Private by design** — photos are composed entirely in the browser with canvas.
  Nothing is uploaded.

## Sorting the photos automatically

Add several photos at once and the app tries to put them in the right positions.

Three cues do the work: **no face at all** means the back of the head; a face with the **nose
centred** is the front; a face with the **nose pushed to one side** is that side's profile. Left
versus right is the hard one and the one people get wrong — a *left* side view shows the left
ear, so the nose sits on the left of frame. That needs real landmarks, so the app measures where
the nose tip falls between the two edges of the jaw.

Rather than judging each photo alone, it scores every photo against every position and picks the
best whole arrangement (each position gets exactly one photo). That constraint rescues cases
where a single guess is shaky.

It **arranges but never asserts**: it only moves things when reasonably confident, tells you it
did, and one tap puts it back. No detector is reliable on a head that is half hair, so a wrong
guess should cost a tap rather than a re-upload.

Detection runs on [face-api.js](https://github.com/vladmandic/face-api) (MIT), vendored under
`public/vendor/face-api` — no CDN, so it works under a strict CSP and keeps photos on the device.
It is **loaded only when you add photos in bulk** (about 1.6 MB, cached afterwards), so the
camera flow and request links never wait for it.

## Not built yet

The client side is complete, including request links. What still needs StuntListing: the real
GraphQL queries (only two of the four are confirmed — see below), CORS for a browser origin,
signing the request tokens, and sending the text from StuntListing rather than the coordinator's
own SMS app.

![Example of a finished sheet](docs/screenshot-result.jpg)

## Running it

It's a static page — no build step. The site lives in `public/`.

```bash
# with Cloudflare's dev server (same behavior as production):
npx wrangler dev

# …or any static server:
python3 -m http.server 8000 -d public
```

Opening `public/index.html` straight from disk works too.

Out of the box it runs in **demo mode**: your profile is kept in this browser's localStorage and
the performer search uses a built-in fictional roster.

- `/index.html` — the performer view (the default page)
- `/coordinator.html` — the coordinator view

There is no sign-in, so both pages open straight up. `?api=live` points the app at the real
StuntListing API and sticks; `?api=demo` goes back to the sample roster.

## Deploying to Cloudflare

The repo is set up as a Cloudflare **Workers static-assets** project (`wrangler.jsonc` points at
`public/`, no server code). Two ways to ship it:

**From a terminal** (one-off):

```bash
npx wrangler deploy        # prompts a browser login the first time
```

That publishes to `https://hairselfie.<your-subdomain>.workers.dev`.

**Automatically on every push** — the included GitHub Action
(`.github/workflows/deploy.yml`) deploys whenever the main development branch is pushed.
It needs two repository secrets (GitHub → Settings → Secrets and variables → Actions):

- `CLOUDFLARE_API_TOKEN` — create at dash.cloudflare.com → My Profile → API Tokens with the
  **Edit Cloudflare Workers** template
- `CLOUDFLARE_ACCOUNT_ID` — shown on the Workers overview page of the dashboard

(Alternatively, skip both and connect the repo in the Cloudflare dashboard: Workers & Pages →
Create → import the GitHub repository — Cloudflare then builds and deploys on push by itself.)

## Wiring it into StuntListing

StuntListing's API is **GraphQL**, at `https://api.stuntlisting.com/graphql`, authenticated with
a Bearer token, on a different origin to this app. Every document sent to it lives in one
`QUERIES` block in `public/js/graphql.js` — that is the only file to edit.

Switch backends with `?api=live` (sticks) or by setting `mode: 'stuntlisting'` in
`public/js/config.js`.

### What is known, and what is guessed

From the mobile app's auth provider, two documents are confirmed:

- the `login` mutation, returning `access_token` / `refresh_token`
- the `getMyProfile` query

Everything else in `QUERIES` is **marked TODO and is a guess** shaped like those two. Check each
against the real schema before trusting it:

- the profile's selection set — `height`, `weight`, `phone` may be named differently or nested
- how a coordinator is flagged — `isCoordinator` is invented
- `searchPerformers` — there is no evidence such a query exists at all
- resolving a request token back to a performer

Two things will bite on the first live attempt:

1. **CORS.** The API has never served a browser origin — the mobile app is native. It must allow
   whichever origin this app is served from, or every request fails with what looks like an
   offline error.
2. **Contact details.** Whatever answers the performer lookup hands out phone and email, so it
   needs authorization and rate limiting.

### Both entry points

Two pages, so StuntListing can link each from the right place in its own menu.

- **Performer tool** → `/index.html`. Their own details prefilled and four photo slots. No
  coordinator UI at all.
- **Coordinator tool** → `/coordinator.html`. Opens on the performer search. Picking someone
  produces the request link plus Text / Copy / Share, and a **Build it myself** link that opens
  the performer page prefilled for them.

### Who is sending

**There is no sign-in.** Who sends a request is just an id: `?c=<id>`, which StuntListing passes
when it links to the coordinator page. It sticks in the browser once set, defaults to `33`, and
the name beside it is set on the page. That id rides along on every request link as `&from=<id>`,
and the prefilled text names the sender, so whatever picks the request up knows who asked.

A token can still be handed over — `?token=…`, stripped from the URL immediately, or a
`postMessage` from an allow-listed WebView host — and `StuntListingGQL.login()` still exists if a
real sign-in is ever wanted. Nothing in the UI asks for one.

### Request links (the textable one)

A coordinator picks a performer and gets a link:

```
https://…/hair-selfie/index.html?p=<token>&from=<coordinatorId>
```

Opened on a phone, that link names the performer, fills in their details and drops them straight
on **Take photos**.

The app treats `p` as **opaque** — it passes the value straight to the lookup and never parses
it. That matters, because:

> **Mint `p` as a signed, expiring token, not a raw performer id.** A raw id is guessable, and
> the lookup returns phone and email — anyone could walk the range and scrape the roster. Sign it
> (performer id + expiry), reject anything unsigned or stale, and rate-limit it. The demo uses
> bare ids like `demo-4` only because it has no server to sign with; nothing in the client needs
> to change when you switch to real tokens.

Only the token travels in the link, so no phone number or email ends up sitting in a text
message thread.

To have StuntListing send the text itself rather than opening the coordinator's SMS app, build
the same URL server-side and put it in your outbound message; the client's **Text** button is
just a `sms:` link for sending by hand.

## Customizing

Everything below lives in `public/js/config.js` / CSS variables:

- **Output size** — `output.cellWidth` / `output.cellHeight` (default 1000×1250 per photo,
  4:5 portrait).
- **JPEG vs PNG** — `output.format: 'image/png'` switches the export and the downloaded file
  extension; JPEG is the default because files are ~5× smaller and phones handle them everywhere.
- **Look & feel** — colors are CSS variables at the top of `public/css/styles.css`.

## Files

| File | What it is |
| --- | --- |
| `public/index.html` | Performer page: photo grid, details, create, adjust dialog |
| `public/coordinator.html` | Coordinator page: performer search and request links |
| `public/css/styles.css` | Shared styling (dark theme) |
| `public/css/coordinator.css` | Styles used only by the coordinator page |
| `public/js/config.js` | Mode, API URL, coordinator id, output size/format |
| `public/js/graphql.js` | StuntListing transport: every GraphQL document lives here |
| `public/js/api.js` | Session + performer adapter (demo and live implementations) |
| `public/js/outlines.js` | The dashed passport-style head guides (front + profile SVG paths) |
| `public/js/composer.js` | Canvas rendering: shared photo-framing math and final-sheet composition |
| `public/js/app.js` | Performer page wiring: uploads, drag/swap, adjust, create/save |
| `public/js/coordinator.js` | Coordinator page wiring: search, request links, SMS/copy/share |
| `public/js/detect.js` | Works out which photo is front / side / back |
| `public/vendor/face-api/` | Vendored face detector and weights (MIT) |
| `wrangler.jsonc` | Cloudflare Workers static-assets config |
| `.github/workflows/deploy.yml` | Auto-deploy to Cloudflare on push |

## Browser support

Modern evergreen browsers, iOS Safari 14+ and Android Chrome. HEIC photos are supported wherever
the browser can decode them (iPhones hand the picker's photos over as JPEG by default); if a
browser can't read a file, the app says so instead of failing silently.

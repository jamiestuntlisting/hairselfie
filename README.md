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
- **Coordinator tools** — always visible, above the performer details. Coordinators get an
  autocomplete performer search that swaps that performer's details into the sheet; everyone
  else sees the box explain that it's coordinators only when they touch it.
- **Save image** — one button. On a phone the share sheet offers *Save Image*, which puts the
  sheet in the camera roll rather than Files; on desktop it downloads.
- **Request links** — a coordinator finds a performer and gets a link to text them. Opening it
  names the performer, fills in their details and goes straight to the camera.
- **Private by design** — photos are composed entirely in the browser with canvas.
  Nothing is uploaded.

## Not built yet

The client side is complete, including request links. What still needs the StuntListing backend:
the three endpoints below, signing the request tokens, and sending the text from StuntListing
rather than the coordinator's own SMS app.

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
the performer search uses a built-in fictional roster. The banner at the top lets you flip
between *Performer* and *Coordinator* views to try both experiences.

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

Everything the app needs from the server goes through three calls in
`public/js/api.js`; the rest is UI. To connect the real site:

1. In `public/js/config.js` set `mode: 'stuntlisting'`.
2. Serve the app from a StuntListing origin (e.g. `stuntlisting.com/hair-selfie/`) so the
   session cookie rides along.
3. Implement three endpoints:

**`GET /api/hair-selfie/session`** — who is signed in, and are they a coordinator?

```json
{
  "user": { "id": "123", "name": "Jamie Northrup", "height": "6'0\"",
            "weight": "185 lb", "phone": "(555) 555-0100", "email": "jamie@example.com" },
  "coordinator": false
}
```

**`GET /api/hair-selfie/performers?q=al`** — autocomplete for coordinators. Returns an array of
the same person shape. **Must return `403` unless the caller really is a coordinator** — the UI
only makes the box inert, which is cosmetic, and this endpoint hands out contact details.

**`GET /api/hair-selfie/performers/{token}`** — resolves a request link back to one performer,
same person shape.

### Both entry points

The same page serves both tools; what a person sees follows from `session`.

- **Performer tool** — link to it plainly. They get their own details prefilled and four photo
  slots.
- **Coordinator tool** — the same link. Because `coordinator` comes back `true`, the search box
  unlocks and the send-a-request panel appears.

### Request links (the textable one)

A coordinator picks a performer and gets a link:

```
https://…/hair-selfie/?p=<token>
```

Opened on a phone, that link names the performer, fills in their details and drops them straight
on **Take photos**. The coordinator panel is hidden.

The app treats `p` as **opaque** — it passes the value to the endpoint above and never parses it.
That matters, because:

> **Mint `p` as a signed, expiring token, not a raw performer id.** A raw id is guessable, and
> `/performers/{id}` returns phone and email — anyone could walk the range and scrape the roster.
> Sign it (performer id + expiry), reject anything unsigned or stale, and rate-limit the
> endpoint. The demo uses bare ids like `demo-4` only because it has no server to sign with;
> nothing in the client needs to change when you switch to real tokens.

Only the token travels in the link, so no phone number or email ends up sitting in a text
message thread.

To have StuntListing send the text itself rather than opening the coordinator's SMS app, build
the same URL server-side and put it in your outbound message; the client's **Text** button is
just a `sms:` link for when you want to send it by hand.

Endpoint paths are configurable in `public/js/config.js` if you'd rather mount them elsewhere.

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
| `public/index.html` | The page: photo grid, details form, coordinator box, adjust dialog |
| `public/css/styles.css` | All styling (dark theme) |
| `public/js/config.js` | Mode, endpoint paths, output size/format |
| `public/js/api.js` | Session + performer search adapter (demo and live implementations) |
| `public/js/outlines.js` | The dashed passport-style head guides (front + profile SVG paths) |
| `public/js/composer.js` | Canvas rendering: shared photo-framing math and final-sheet composition |
| `public/js/app.js` | UI wiring: uploads, drag/swap, adjust dialog, autocomplete, create/download |
| `wrangler.jsonc` | Cloudflare Workers static-assets config |
| `.github/workflows/deploy.yml` | Auto-deploy to Cloudflare on push |

## Browser support

Modern evergreen browsers, iOS Safari 14+ and Android Chrome. HEIC photos are supported wherever
the browser can decode them (iPhones hand the picker's photos over as JPEG by default); if a
browser can't read a file, the app says so instead of failing silently.

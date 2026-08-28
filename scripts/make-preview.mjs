/*
 * Draws public/preview.png — the card that shows up when a link to this
 * app is texted or posted. Run it after changing the name or the tabs:
 *
 *   node scripts/make-preview.mjs
 *
 * It draws the real head guides from js/outlines.js rather than a picture
 * of them, so the card cannot drift away from what the app looks like.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const outlines = fs.readFileSync('/home/user/hairselfie/public/js/outlines.js', 'utf8');

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  body { margin:0; width:1200px; height:630px; background:#0d0e11;
         font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
         color:#f2f4f8; display:flex; align-items:center; gap:64px; padding:0 72px; }
  .grid { display:grid; grid-template-columns:1fr 1fr; gap:14px; width:430px; flex:0 0 430px; }
  .cell { aspect-ratio:4/5; background:#0a0b0e; border:2px dashed #3a3f4b; border-radius:16px;
          display:grid; place-items:center; overflow:hidden; }
  .cell svg { width:86%; height:auto; color:#5b6474; }
  h1 { margin:0; font-size:78px; line-height:1.02; letter-spacing:-1px; }
  .sub { margin:22px 0 0; font-size:30px; color:#9aa2af; }
  .kinds { margin:40px 0 0; display:flex; gap:12px; }
  .kind { padding:12px 22px; border:2px solid #2b2f38; border-radius:999px;
          font-size:25px; font-weight:700; color:#cdd4df; }
  .kind.on { border-color:#ff5a36; background:#1d1408; color:#fff; }
  .by { margin:44px 0 0; font-size:24px; color:#6d7685; }
  .by b { color:#ff5a36; }
</style></head><body>
  <div class="grid">
    <div class="cell" data-o="front"></div><div class="cell" data-o="profile"></div>
    <div class="cell" data-o="profile-m"></div><div class="cell" data-o="front"></div>
  </div>
  <div>
    <h1>The Selfie&nbsp;Tool</h1>
    <p class="sub">Reference sheets for hair, wardrobe<br>and headshots — made on your phone.</p>
    <div class="kinds"><span class="kind on">Hair</span><span class="kind">Wardrobe</span><span class="kind">Headshot</span></div>
    <p class="by">a <b>StuntListing</b> add-on</p>
  </div>
<script>${outlines}</script>
<script>
  document.querySelectorAll('.cell').forEach((c) => {
    const o = c.dataset.o;
    c.innerHTML = window.Outlines.svgMarkup(o === 'front' ? 'front' : 'profile', o === 'profile-m');
  });
</script></body></html>`;

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await b.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: 'load' });
await page.waitForTimeout(200);
await page.screenshot({ path: '/home/user/hairselfie/public/preview.png' });
await b.close();
console.log('preview.png:', Math.round(fs.statSync('/home/user/hairselfie/public/preview.png').size / 1024), 'KB');

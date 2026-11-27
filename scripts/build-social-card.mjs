// Compose the 1200×630 link-preview image from existing brand assets.
// Run: node scripts/build-social-card.mjs (needs Playwright with Chromium; see PUPTIME_PLAYWRIGHT_MODULE).
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PUPTIME_PLAYWRIGHT_MODULE ?? 'playwright');
const dataUrl = (path, type) => `data:${type};base64,${readFileSync(path).toString('base64')}`;
// Mirror websiteTheme in src/web/brand.ts and the tokens in src/web/website.css.
const deep = '#173B30', paper = '#F8F3E8', lime = '#D7EC98';
const mascot = await sharp('assets/mascots/scruffy-terrier.png').resize(1040, 1040).png().toBuffer();

const html = `<!doctype html><html><head><style>
@font-face{font-family:'Red Hat Display';src:url('${dataUrl('public/fonts/RedHatDisplay-Latin.woff2', 'font/woff2')}') format('woff2');font-weight:900}
@font-face{font-family:'Red Hat Text';src:url('${dataUrl('public/fonts/RedHatText-Latin.woff2', 'font/woff2')}') format('woff2');font-weight:400 700}
html,body{margin:0}
.card{width:1200px;height:630px;box-sizing:border-box;background:${deep};color:${paper};position:relative;overflow:hidden;padding:64px 72px;display:flex;flex-direction:column;justify-content:space-between}
.brand{display:flex;align-items:center;gap:16px;font:700 34px 'Red Hat Text',sans-serif}
.brand img{width:56px;height:56px;border-radius:13px}
h1{margin:0;max-width:620px;font:900 84px/.98 'Red Hat Display',sans-serif;letter-spacing:-.03em}
.url{font:700 34px 'Red Hat Text',sans-serif;color:${lime}}
.puppy{position:absolute;right:-24px;bottom:-56px;width:600px;height:600px}
</style></head><body><div class="card">
<div class="brand"><img src="${dataUrl('public/brand-icon.png', 'image/png')}" alt="">Puptime</div>
<h1>A little help with potty training.</h1>
<div class="url">puptime.org</div>
<img class="puppy" src="data:image/png;base64,${mascot.toString('base64')}" alt="">
</div></body></html>`;

const browser = await chromium.launch(process.env.PUPTIME_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PUPTIME_CHROMIUM_EXECUTABLE } : {});
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const png = await page.locator('.card').screenshot({ type: 'png' });
  await sharp(png).png({ palette: true, quality: 90, effort: 10 }).toFile('public/social-card.png');
} finally {
  await browser.close();
}

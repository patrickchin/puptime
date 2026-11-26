// Exercise real wheel and keyboard scrolling, which element clicks and full-page captures can miss.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PUPTIME_PLAYWRIGHT_MODULE ?? 'playwright');
const root = resolve('dist-web'), output = resolve('output/playwright/web-marketing');
assert.ok(existsSync(root + '/index.html'), 'Run npm run build:web first.');
mkdirSync(output, { recursive: true });
const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  let file = resolve(root, '.' + pathname);
  if (file !== root && !file.startsWith(root + '/')) { response.writeHead(404).end(); return; }
  if (pathname.endsWith('/')) file += '/index.html';
  else if (!extname(file)) file += '.html';
  if (!existsSync(file)) { response.writeHead(404).end(); return; }
  const type = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2' }[extname(file)];
  response.writeHead(200, { 'Content-Type': type ?? 'application/octet-stream' }).end(readFileSync(file));
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
// Resized web copies keep the source proportions and cover the rendered size at up to 2x.
const sharpCapture = async (image, ratio) => {
  // srcset reports naturalWidth in CSS pixels, so measure the chosen file itself.
  const file = new Image();
  file.src = image.currentSrc;
  await file.decode();
  return Math.abs(file.naturalWidth / file.naturalHeight - ratio) < 0.005 && file.naturalWidth >= image.clientWidth * Math.min(devicePixelRatio, 2);
};
let browser, page;
const passed = [];
writeFileSync(`${output}/verification.json`, JSON.stringify({ status: 'running' }));
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PUPTIME_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PUPTIME_CHROMIUM_EXECUTABLE } : {}) });
  const context = await browser.newContext({ deviceScaleFactor: 2 });
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const width of [1440, 768, 631, 390, 320]) {
    const height = width < 600 ? 844 : 900;
    await page.setViewportSize({ width, height });
    await page.goto(origin);
    await page.evaluate(() => document.fonts.ready);
    assert.match(await page.locator('h1').innerText(), /A little help with\s+potty training\./);
    const lines = await page.locator('h1').evaluate(element => element.clientHeight / parseFloat(getComputedStyle(element).lineHeight));
    assert.ok(lines < 2.1, `Hero title wraps beyond two lines at ${width}px.`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Horizontal overflow at ${width}px.`);
    await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished)));
    await page.screenshot({ path: `${output}/${width}-hero.png` });
    assert.equal(await page.locator('.site-brand img').getAttribute('src'), '/brand-icon.png');
    const heroBackground = await page.locator('.hero').evaluate(element => getComputedStyle(element).backgroundColor);
    assert.equal(heroBackground, 'rgb(23, 59, 48)', 'Keep the mascot forest green behind the hero.');
    assert.equal(await page.locator('.app-chapter').evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(248, 243, 232)', 'Use warm cream to separate the app preview from the green hero.');
    assert.equal(await page.locator('.rhythm-chapter').evaluate(element => getComputedStyle(element).backgroundColor), heroBackground, 'Return to forest green after the cream app preview.');

    await page.mouse.move(width / 2, height / 2);
    await page.mouse.wheel(0, height);
    await page.waitForFunction(() => scrollY > innerHeight / 3, null, { timeout: 5000 });
    await page.screenshot({ path: `${output}/${width}-after-wheel.png` });
    await page.keyboard.press('End');
    await page.waitForFunction(() => document.querySelector('.site-footer').getBoundingClientRect().bottom <= innerHeight + 2, null, { timeout: 5000 });
    await page.screenshot({ path: `${output}/${width}-footer.png` });
    assert.ok(await page.locator('.footer-wordmark').evaluate(element => parseFloat(getComputedStyle(element).fontSize) <= 40), 'The footer wordmark should be modest.');
    await page.getByRole('link', { name: 'Back to top', exact: true }).click();
    await page.waitForFunction(() => scrollY < 2, null, { timeout: 5000 });
    await page.keyboard.press('PageDown');
    await page.waitForFunction(() => scrollY > innerHeight / 3, null, { timeout: 5000 });

    await page.keyboard.press('Home');
    await page.waitForFunction(() => scrollY < 2, null, { timeout: 5000 });
    await page.getByRole('link', { name: 'See the app', exact: true }).click();
    assert.ok(await page.locator('#app').evaluate(element => Math.abs(element.getBoundingClientRect().top) < 60), 'The hero action should reach the product section.');
    for (const name of ['Today', 'History', 'Insights', 'Routine']) {
      const button = page.getByRole('button', { name, exact: true });
      await button.click();
      assert.equal(await button.getAttribute('aria-pressed'), 'true');
      await page.getByRole('img', { name: `Puptime ${name} screen`, exact: true }).evaluate(image => image.decode());
      assert.ok(await page.getByRole('img', { name: `Puptime ${name} screen`, exact: true }).evaluate(sharpCapture, 1206 / 2622), 'Use sharp, uncropped native iPhone captures.');
      assert.ok(await page.locator('.app-preview .phone-frame').evaluate(element => {
        const radius = getComputedStyle(element).borderTopLeftRadius;
        return (radius.endsWith('%') ? parseFloat(radius) * element.clientWidth / 100 : parseFloat(radius)) >= 28;
      }), 'Keep rounded phone frames around the captures.');
    }
    await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished)));
    await page.screenshot({ path: `${output}/${width}-app-preview.png` });
    const concept = page.getByRole('img', { name: 'Illustrative Poop & Eat timeline concept with routine windows', exact: true });
    await concept.scrollIntoViewIfNeeded();
    await concept.evaluate(image => image.decode());
    assert.ok(await concept.evaluate(sharpCapture, 851 / 1848), 'Keep the illustrative story image sharp and uncropped.');
    assert.ok(await concept.evaluate(image => Math.abs(image.clientWidth / image.clientHeight - 851 / 1848) < 0.01), 'Preserve the concept image proportions.');
    await page.getByText('Illustrative timeline concept with routine windows.', { exact: true }).waitFor();
    await page.locator('.rhythm-story').first().screenshot({ path: `${output}/${width}-timeline-concept.png` });
    passed.push(`${width}px: wheel, PageDown, footer, back to top, app anchor, all four native previews, and illustrative timeline story.`);
    console.log('PASS', passed.at(-1));
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin + '/puppy-care/');
  await page.mouse.move(195, 500);
  await page.mouse.wheel(0, 844);
  await page.waitForFunction(() => scrollY > 300, null, { timeout: 5000 });
  await page.screenshot({ path: `${output}/care-after-wheel.png` });
  passed.push('Care library also supports ordinary document scrolling.');
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
    await page.goto(origin + '/puppy-care/');
    await page.evaluate(() => document.fonts.ready);
    const background = await page.locator('[data-testid="screen.learn"]').evaluate(element => getComputedStyle(element).backgroundColor);
    assert.equal(await page.locator('.site-header').evaluate(element => getComputedStyle(element).backgroundColor), background, 'Header and guide background should match.');
    await page.screenshot({ path: `${output}/${width}-care-library.png` });
    await page.getByTestId('learn.search').fill('zzzz-no-matching-guide');
    await page.getByRole('heading', { name: 'No matching guides', exact: true }).waitFor();
    assert.equal(await page.locator('[aria-live="polite"]').innerText(), 'No matching guides', 'Search should announce when nothing matches.');
    await page.getByTestId('learn.search').fill('toilet');
    assert.match(await page.locator('[aria-live="polite"]').innerText(), /^\d+ guides? match/, 'Search should announce the result count.');
    if (width < 700) assert.ok((await page.getByTestId('learn.article.toilet-training').boundingBox()).height < 160, 'Narrow guide cards should be compact rows.');
    await page.getByTestId('learn.article.toilet-training').click();
    await page.waitForURL('**/puppy-care/toilet-training');
    await page.getByTestId('learn.image.toilet-training').waitFor();
    await page.evaluate(() => document.fonts.ready);
    const illustration = await page.getByTestId('learn.image.toilet-training').boundingBox();
    assert.ok(illustration.height >= 100 && illustration.height <= 240, 'Article illustrations should stay visible without filling the first screen.');
    assert.equal(await page.locator('h1').count(), 1, 'Guides should have one page heading.');
    assert.equal(await page.locator('h1').innerText(), 'How often does a puppy need to go out?', 'Guide heading should answer the page title.');
    assert.equal(await page.getByTestId('learn.glance').locator('[role="listitem"]').count(), 3, 'Guides should show every at-a-glance item.');
    await page.getByTestId('learn.reviewed').waitFor();
    const firstSection = await page.getByRole('heading', { level: 2, name: 'Start with frequent opportunities' }).boundingBox();
    if (width >= 390) assert.ok(firstSection.y + firstSection.height <= (width < 600 ? 844 : 900), `First guide section should start above the fold at ${width}px.`);
    assert.ok(await page.getByTestId('learn.sources').isVisible(), 'Guide sources should be visible without a toggle.');
    assert.equal(await page.getByTestId('learn.appCard').getAttribute('href'), '/#app', 'Guides should link to the app once.');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Guide overflow at ${width}px.`);
    await page.screenshot({ path: `${output}/${width}-care-article.png` });
    passed.push(`${width}px: guide search announcements, compact narrow cards, matching backgrounds, answer-first heading, glance, sources, and app link.`);
    console.log('PASS', passed.at(-1));
  }
  assert.deepEqual(errors, [], 'No browser errors.');
  writeFileSync(`${output}/verification.json`, JSON.stringify({ status: 'passed', passed }, null, 2));
} catch (error) {
  await page?.screenshot({path: `${output}/failure.png`});
  writeFileSync(`${output}/verification.json`, JSON.stringify({ status: 'failed', passed, error: String(error) }, null, 2));
  throw error;
} finally {
  await browser?.close();
  await new Promise(done => server.close(done));
}

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
  const type = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' }[extname(file)];
  response.writeHead(200, { 'Content-Type': type ?? 'application/octet-stream' }).end(readFileSync(file));
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser, page;
const passed = [];
writeFileSync(`${output}/verification.json`, JSON.stringify({ status: 'running' }));
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PUPTIME_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PUPTIME_CHROMIUM_EXECUTABLE } : {}) });
  const context = await browser.newContext();
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const width of [1440, 768, 631, 390, 320]) {
    const height = width < 600 ? 844 : 900;
    await page.setViewportSize({ width, height });
    await page.goto(origin);
    await page.evaluate(() => document.fonts.ready);
    assert.match(await page.locator('h1').innerText(), /Potty training,\s+day by day\./);
    const lines = await page.locator('h1').evaluate(element => element.clientHeight / parseFloat(getComputedStyle(element).lineHeight));
    assert.ok(lines < 2.1, `Hero title wraps beyond two lines at ${width}px.`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Horizontal overflow at ${width}px.`);
    await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished)));
    await page.screenshot({ path: `${output}/${width}-hero.png` });

    await page.mouse.move(width / 2, height / 2);
    await page.mouse.wheel(0, height);
    await page.waitForFunction(() => scrollY > innerHeight / 3, null, { timeout: 5000 });
    await page.screenshot({ path: `${output}/${width}-after-wheel.png` });
    await page.keyboard.press('End');
    await page.waitForFunction(() => document.querySelector('.site-footer').getBoundingClientRect().bottom <= innerHeight + 2, null, { timeout: 5000 });
    await page.screenshot({ path: `${output}/${width}-footer.png` });
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
    }
    passed.push(`${width}px: wheel, PageDown, footer, back to top, app anchor, and all four previews.`);
    console.log('PASS', passed.at(-1));
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin + '/puppy-care/');
  await page.mouse.move(195, 500);
  await page.mouse.wheel(0, 844);
  await page.waitForFunction(() => scrollY > 300, null, { timeout: 5000 });
  await page.screenshot({ path: `${output}/care-after-wheel.png` });
  passed.push('Care library also supports ordinary document scrolling.');
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

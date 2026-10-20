// Installed SDK acceptance against a local collector only; never hosted ingestion.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { gunzipSync } from 'node:zlib';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PUPTIME_PLAYWRIGHT_MODULE ?? 'playwright');
const origin = 'http://127.0.0.1:8897', root = resolve('dist-web');
const output = resolve('output/playwright/web-telemetry');
mkdirSync(output, { recursive: true });
writeFileSync(output + '/verification.json', JSON.stringify({ status: 'running', scope: 'Local collector only.' }));
const bundle = readdirSync(root + '/_expo/static/js/web').filter(name => name.startsWith('index-') && name.endsWith('.js')).map(name => readFileSync(root + '/_expo/static/js/web/' + name, 'utf8')).join('');
assert.ok(bundle.includes('phc_synthetic_web_review') && bundle.includes(origin + '/telemetry'), 'Build with the documented synthetic token and localhost collector first.');
const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, origin).pathname);
  let file = resolve(root, '.' + pathname);
  if (file !== root && !file.startsWith(root + '/')) { response.writeHead(404).end(); return; }
  if (pathname.endsWith('/')) file += '/index.html';
  else if (!extname(file)) file += '.html';
  if (!existsSync(file)) { response.writeHead(404).end(); return; }
  const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' }[extname(file)];
  response.writeHead(200, { 'Content-Type': type ?? 'application/octet-stream' }).end(readFileSync(file));
});
await new Promise(done => server.listen(8897, '127.0.0.1', done));
const events = [], requests = [], passed = [];
const browser = await chromium.launch({ headless: true, ...(process.env.PUPTIME_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PUPTIME_CHROMIUM_EXECUTABLE } : {}) });
const pass = message => { passed.push(message); console.log('PASS', message); };
const pause = () => new Promise(done => setTimeout(done, 3500));
async function until(check) {
  for (let i = 0; i < 100 && !check(); i++) await new Promise(done => setTimeout(done, 100));
  assert.ok(check(), `Expected local SDK event was not received; requests=${JSON.stringify(requests)}, events=${JSON.stringify(events.map(event => event.event))}. Build with the documented synthetic configuration.`);
}
async function context({ signal, blockedStorage = false, failCollector = false } = {}) {
  const context = await browser.newContext({ userAgent: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${browser.version()} Safari/537.36` });
  // SDK bot filtering stays enabled in production. Only this isolated test emulates a nonautomated browser.
  await context.addInitScript(({ signal, blockedStorage }) => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'userAgentData', { get: () => ({ brands: [{ brand: 'Chromium', version: '153' }], mobile: false, platform: 'macOS' }) });
    if (signal) localStorage.setItem('puptime.website.analytics', 'yes');
    if (signal === 'dnt') Object.defineProperty(navigator, 'doNotTrack', { get: () => '1' });
    if (signal === 'gpc') Object.defineProperty(navigator, 'globalPrivacyControl', { get: () => true });
    if (blockedStorage) for (const method of ['getItem', 'setItem']) Storage.prototype[method] = () => { throw new DOMException('Blocked', 'SecurityError'); };
  }, { signal, blockedStorage });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) { requests.push('unexpected-external'); await route.abort(); return; }
    if (url.pathname.startsWith('/telemetry/')) {
      assert.equal(route.request().headers().cookie, undefined, 'Analytics fetch must omit cookies.');
      assert.equal(route.request().headers().referer, undefined, 'Analytics fetch must omit referrers.');
      requests.push(url.pathname);
      if (failCollector) { await route.abort(); return; }
      let body = route.request().postDataBuffer();
      if (body?.length) {
        if (body[0] === 31 && body[1] === 139) body = gunzipSync(body);
        let raw = body.toString();
        if (raw.startsWith('data=')) raw = Buffer.from(new URLSearchParams(raw).get('data'), 'base64').toString();
        const data = JSON.parse(raw); events.push(...(Array.isArray(data) ? data : data.batch ?? [data]));
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":1}' }); return;
    }
    // No backend, authentication, provider navigation or account mutation in this test.
    if (url.pathname.startsWith('/api/')) { await route.fulfill({ status: 503, body: '{}' }); return; }
    await route.continue();
  });
  return context;
}
try {
  const session = await context(), page = await session.newPage();
  await session.addCookies([{ name: 'synthetic-private-cookie', value: 'never-telemetry', url: origin }]);
  await page.goto(origin + '/?email=private-query#private-fragment');
  await page.getByRole('button', { name: 'Decline analytics', exact: true }).click();
  await pause(); assert.equal(requests.length, 0);
  await page.reload(); await pause(); assert.equal(requests.length, 0);
  pass('Fresh visitor, decline and declined reload make no analytics requests.');
  await page.getByRole('button', { name: 'Analytics settings', exact: true }).click();
  await page.getByRole('button', { name: 'Allow analytics', exact: true }).click();
  await until(() => events.some(event => event.event === 'website_page_view'));
  const originalId = events[0].properties.distinct_id;
  await page.goto(origin + '/puppy-care/toilet-training?email=private-query#private-fragment');
  await until(() => events.some(event => event.properties.page === '/puppy-care/toilet-training'));
  await page.goto(origin + '/account?code=private-query#private-fragment');
  await until(() => events.some(event => event.properties.page === '/account'));
  await page.evaluate(() => window.dispatchEvent(new ErrorEvent('error', { message: 'private raw error', error: new Error('private raw error') })));
  await until(() => events.some(event => event.event === 'website_error'));
  const keys = ['page', '$pathname', '$process_person_profile', '$geoip_disable', 'distinct_id', '$device_id', '$session_id', '$window_id', '$lib', '$lib_version', 'token', 'error_kind'];
  for (const event of events) {
    assert.ok(['website_page_view', 'website_error'].includes(event.event));
    assert.deepEqual(Object.keys(event.properties).filter(key => !keys.includes(key)), []);
    assert.equal(event.properties.$geoip_disable, true);
    assert.equal(event.properties.$process_person_profile, false);
    assert.doesNotMatch(JSON.stringify(event), /private-query|private-fragment|private raw error|https?:\/\//);
  }
  pass('Installed SDK sends only allowlisted anonymous page/error events, with no URLs or private strings.');
  await page.getByRole('button', { name: 'Analytics settings', exact: true }).click();
  await page.getByRole('button', { name: 'Decline analytics', exact: true }).click();
  const stopped = requests.length;
  const storage = await page.evaluate(() => Object.entries(localStorage));
  assert.ok(!storage.some(([key]) => /^ph_.*_posthog$/.test(key)), 'Withdrawal must remove SDK identity persistence.');
  await page.reload(); await pause(); assert.equal(requests.length, stopped);
  await page.getByRole('button', { name: 'Analytics settings', exact: true }).click();
  await page.getByRole('button', { name: 'Allow analytics', exact: true }).click();
  await until(() => events.at(-1).event === 'website_page_view' && events.at(-1).properties.distinct_id !== originalId);
  pass('Withdrawal clears identity, stops requests across reload, and reconsent uses a new anonymous ID.');
  await page.evaluate(() => window.dispatchEvent(new ErrorEvent('error', { message: 'private queued error' })));
  await page.getByRole('button', { name: 'Analytics settings', exact: true }).click();
  await page.getByRole('button', { name: 'Decline analytics', exact: true }).click();
  const afterWithdrawal = requests.length;
  await pause(); assert.equal(requests.length, afterWithdrawal, 'Withdrawal must also stop an event waiting in the SDK batch queue.');
  pass('Withdrawal stops queued delivery.');
  await session.close();
  for (const signal of ['dnt', 'gpc']) {
    const privacy = await context({ signal }), page = await privacy.newPage(), before = requests.length;
    await page.goto(origin); await page.getByRole('button', { name: 'Analytics settings', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Allow analytics', exact: true }).isDisabled(), true);
    await pause(); assert.equal(requests.length, before); await privacy.close();
    pass(`${signal.toUpperCase()} prevents analytics requests and disables consent.`);
  }
  for (const options of [{ blockedStorage: true }, { failCollector: true }]) {
    const isolated = await context(options), page = await isolated.newPage();
    const before = requests.length;
    await page.goto(origin); await page.getByRole('button', { name: 'Allow analytics', exact: true }).click();
    if (options.failCollector) {
      await until(() => requests.length > before);
      await page.getByRole('button', { name: 'Analytics settings', exact: true }).click();
      await page.getByRole('button', { name: 'Decline analytics', exact: true }).click();
      const stopped = requests.length;
      await new Promise(done => setTimeout(done, 14000));
      assert.equal(requests.length, stopped, 'Failed requests must not retry over the network after withdrawal.');
      pass('Withdrawal prevents failed-request retries over the network.');
    }
    await page.goto(origin + '/puppy-care/toilet-training');
    await page.getByRole('heading', { level: 1 }).waitFor(); await isolated.close();
    pass(options.blockedStorage ? 'Blocked storage does not break browsing.' : 'Collector failure does not break browsing.');
  }
  assert.ok(!requests.includes('unexpected-external'));
  assert.ok(requests.every(path => path.startsWith('/telemetry/e/')), 'Flags, replay and other SDK endpoints must stay unused.');
  writeFileSync(output + '/verification.json', JSON.stringify({ checkedAt: new Date().toISOString(), scope: 'Isolated local collector; no hosted ingestion claim.', passed, eventCount: events.length, endpoints: [...new Set(requests)] }, null, 2));
} finally {
  await browser.close(); await new Promise(done => server.close(done));
}

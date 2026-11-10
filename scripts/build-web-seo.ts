import { copyFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { publicPaths, siteUrl } from '../src/web/site.ts';
import { appUrl, isAppSurface } from '../src/web/origins.ts';

const output = isAppSurface ? 'dist-web-app' : 'dist-web';

writeFileSync(`${output}/sitemap.xml`, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${publicPaths.map((path) => `  <url><loc>${siteUrl}${path}</loc></url>`).join('\n')}\n</urlset>\n`);
writeFileSync(`${output}/robots.txt`, `User-agent: *\nAllow: /\nDisallow: /care\nSitemap: ${siteUrl}/sitemap.xml\n`);
// A top-level 404 disables Pages' SPA fallback for nonexistent guide URLs.
copyFileSync(`${output}/+not-found.html`, `${output}/404.html`);
for (const path of ['+not-found.html', '_sitemap.html', 'puppy-care/[id].html']) rmSync(`${output}/${path}`, { force: true });
// Cloudflare also protects preview deployments; keep that policy explicit in source.
writeFileSync(`${output}/_headers`, `/*\n  Referrer-Policy: strict-origin-when-cross-origin\n  X-Content-Type-Options: nosniff\nhttps://:preview.puptime.pages.dev/*\n  X-Robots-Tag: noindex\n/account\n  X-Robots-Tag: noindex, nofollow\n  Cache-Control: no-store\n/account.html\n  X-Robots-Tag: noindex, nofollow\n  Cache-Control: no-store\n`);
const accountHtml=readFileSync(`${output}/account.html`,'utf8');
writeFileSync(`${output}/_headers`,readFileSync(`${output}/_headers`,'utf8')+`/care\n  X-Robots-Tag: noindex, nofollow\n  Cache-Control: no-store\n  Referrer-Policy: no-referrer\n/care.html\n  X-Robots-Tag: noindex, nofollow\n  Cache-Control: no-store\n  Referrer-Policy: no-referrer\n`);
const careHtml=readFileSync(`${output}/care.html`,'utf8');
if(!careHtml.includes('noindex')||!careHtml.includes('Shared puppy care | Puptime')||publicPaths.includes('/care'))throw new Error('Care must be private and excluded from the sitemap.');
if(!accountHtml.includes('noindex')||!accountHtml.includes('Your account | Puptime')||publicPaths.includes('/account'))throw new Error('Account must be static, private and excluded from the sitemap.');
for (const path of isAppSurface ? [] : publicPaths) {
  const filename = path === '/' ? 'index' : path === '/puppy-care/' ? 'puppy-care/index' : path.slice(1);
  const html = readFileSync(`${output}/${filename}.html`, 'utf8');
  if (!html.includes('rel="canonical"') || !html.includes('<h1') || !html.includes('name="description"')) {
    throw new Error(`Missing rendered SEO content: ${path}`);
  }
}
if (!isAppSurface) console.log(`Verified static HTML and generated sitemap for ${publicPaths.length} public pages.`);

if (isAppSurface) {
 // The app host serves account and care screens, with no public care-library documents or sitemap.
 rmSync(`${output}/puppy-care`, { recursive: true, force: true });
 rmSync(`${output}/puppy-care.html`, { force: true });
 rmSync(`${output}/sitemap.xml`, { force: true });
 writeFileSync(`${output}/robots.txt`, 'User-agent: *\nDisallow: /\n');
 writeFileSync(`${output}/_headers`, readFileSync(`${output}/_headers`, 'utf8') + '/*\n  X-Robots-Tag: noindex, nofollow\n/\n  Cache-Control: no-store\n');
 if (!readFileSync(`${output}/index.html`, 'utf8').includes('Your account | Puptime')) throw new Error('The app homepage must open the account screen.');
 console.log('Built the private app surface in ' + output);
} else if (appUrl !== siteUrl) {
 // Preserve invitation fragments entirely in the browser; never send them to a redirect service.
 for (const path of ['/account', '/care']) {
  const target = appUrl + path;
  const redirect = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>Opening Puptime</title><script>location.replace(${JSON.stringify(target)}+location.search+location.hash)</script></head><body><a href="${target}">Continue to Puptime</a></body></html>`;
  writeFileSync(`${output}${path}.html`, redirect);
 }
 console.log('Public account and care links open ' + appUrl);
}

import { copyFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { publicPaths, siteUrl } from '../src/web/site.ts';

writeFileSync('dist-web/sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${publicPaths.map((path) => `  <url><loc>${siteUrl}${path}</loc></url>`).join('\n')}\n</urlset>\n`);
writeFileSync('dist-web/robots.txt', `User-agent: *\nAllow: /\nDisallow: /care\nSitemap: ${siteUrl}/sitemap.xml\n`);
// A top-level 404 disables Pages' SPA fallback for nonexistent guide URLs.
copyFileSync('dist-web/+not-found.html', 'dist-web/404.html');
for (const path of ['+not-found.html', '_sitemap.html', 'puppy-care/[id].html']) rmSync(`dist-web/${path}`, { force: true });
// Cloudflare also protects preview deployments; keep that policy explicit in source.
writeFileSync('dist-web/_headers', `/*\n  Referrer-Policy: strict-origin-when-cross-origin\n  X-Content-Type-Options: nosniff\nhttps://:preview.puptime.pages.dev/*\n  X-Robots-Tag: noindex\n/account\n  X-Robots-Tag: noindex, nofollow\n  Cache-Control: no-store\n/account.html\n  X-Robots-Tag: noindex, nofollow\n  Cache-Control: no-store\n`);
const accountHtml=readFileSync('dist-web/account.html','utf8');
writeFileSync('dist-web/_headers',readFileSync('dist-web/_headers','utf8')+`/care\n  X-Robots-Tag: noindex, nofollow\n  Cache-Control: no-store\n  Referrer-Policy: no-referrer\n/care.html\n  X-Robots-Tag: noindex, nofollow\n  Cache-Control: no-store\n  Referrer-Policy: no-referrer\n`);
const careHtml=readFileSync('dist-web/care.html','utf8');
if(!careHtml.includes('noindex')||!careHtml.includes('Shared puppy care | Puptime')||publicPaths.includes('/care'))throw new Error('Care must be private and excluded from the sitemap.');
if(!accountHtml.includes('noindex')||!accountHtml.includes('Your account | Puptime')||publicPaths.includes('/account'))throw new Error('Account must be static, private and excluded from the sitemap.');
for (const path of publicPaths) {
  const filename = path === '/' ? 'index' : path === '/puppy-care/' ? 'puppy-care/index' : path.slice(1);
  const html = readFileSync(`dist-web/${filename}.html`, 'utf8');
  if (!html.includes('rel="canonical"') || !html.includes('<h1') || !html.includes('name="description"')) {
    throw new Error(`Missing rendered SEO content: ${path}`);
  }
}
console.log(`Verified static HTML and generated sitemap for ${publicPaths.length} public pages.`);

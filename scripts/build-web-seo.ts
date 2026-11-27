import { copyFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { marked } from 'marked';
import { privacyPath, supportPath } from '../src/public-site.ts';
import { websiteIconLinks, websiteManifest, websiteThemeColor } from '../src/web/brand.ts';
import { publicPaths, siteUrl, socialImage } from '../src/web/site.ts';
import { siteFooterHtml, siteHeaderHtml } from '../src/web/site-chrome.ts';

const resources = [
  {
    path: privacyPath,
    title: 'Puptime Privacy Policy',
    description: 'How Puptime handles information in the app, optional cloud accounts, and on the website.',
    body: marked.parse(readFileSync('PRIVACY.md', 'utf8'), { async: false }),
  },
  {
    path: supportPath,
    title: 'Puptime Support',
    description: 'Get help with Puptime, read the privacy policy, or delete a cloud account.',
    body: `<h1>Puptime Support</h1>
<p>For app questions or bug reports, use <a href="https://github.com/patrickchin/puptime/issues">Puptime’s GitHub issue tracker</a>. Issues are public. Keep account details, activity logs, and other personal information out of your report.</p>
<h2>Privacy and accounts</h2>
<ul><li><a href="${privacyPath}">Read the privacy policy</a></li><li><a href="/delete-account">Delete your cloud account</a></li></ul>`,
  },
];

// Expo emits src/web/website.css as one hashed file; the static pages share it so every page uses one cached stylesheet.
const stylesheetLinks = (html: string) => [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(([, href]) => href);
const [stylesheetHref, ...extraStylesheets] = stylesheetLinks(readFileSync('dist-web/index.html', 'utf8'));
if (!stylesheetHref?.startsWith('/_expo/static/css/') || extraStylesheets.length) throw new Error('Expo pages must link exactly one website stylesheet.');
const iconHead = `<meta name="theme-color" content="${websiteThemeColor}">${websiteIconLinks.map(({ rel, href }) => `<link rel="${rel}" href="${href}">`).join('')}`;
writeFileSync('dist-web/site.webmanifest', `${JSON.stringify(websiteManifest, null, 2)}\n`);

for (const { path, title, description, body } of resources) {
  writeFileSync(`dist-web${path}.html`, `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title><meta name="description" content="${description}">
<link rel="canonical" href="${siteUrl}${path}"><link rel="icon" href="/favicon.ico">${iconHead}
<meta property="og:site_name" content="Puptime"><meta property="og:title" content="${title}"><meta property="og:description" content="${description}"><meta property="og:url" content="${siteUrl}${path}"><meta property="og:type" content="website">
<meta property="og:image" content="${socialImage.url}"><meta property="og:image:width" content="${socialImage.width}"><meta property="og:image:height" content="${socialImage.height}"><meta property="og:image:alt" content="${socialImage.alt}"><meta name="twitter:card" content="summary_large_image">
<link rel="stylesheet" href="${stylesheetHref}"></head><body class="static-page">
${siteHeaderHtml(path)}
<main>${body}</main>
${siteFooterHtml(path)}</body></html>`);
}

const indexedPaths = [...publicPaths, ...resources.map(({ path }) => path)];
writeFileSync('dist-web/sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${indexedPaths.map((path) => `  <url><loc>${siteUrl}${path}</loc></url>`).join('\n')}\n</urlset>\n`);
writeFileSync('dist-web/robots.txt', `User-agent: *\nAllow: /\nDisallow: /care\nSitemap: ${siteUrl}/sitemap.xml\n`);
// A top-level 404 disables Pages' SPA fallback for nonexistent guide URLs.
copyFileSync('dist-web/+not-found.html', 'dist-web/404.html');
for (const path of ['+not-found.html', '_sitemap.html', 'puppy-care/[id].html']) rmSync(`dist-web/${path}`, { force: true });
// Cloudflare also protects preview deployments; keep that policy explicit in source.
writeFileSync('dist-web/_headers', `/*\n  Referrer-Policy: strict-origin-when-cross-origin\n  X-Content-Type-Options: nosniff\nhttps://:preview.puptime.pages.dev/*\n  X-Robots-Tag: noindex\n/account\n  X-Robots-Tag: noindex, nofollow\n  Cache-Control: no-store\n/account.html\n  X-Robots-Tag: noindex, nofollow\n  Cache-Control: no-store\n`);
const accountHtml=readFileSync('dist-web/account.html','utf8');
writeFileSync('dist-web/_headers',readFileSync('dist-web/_headers','utf8')+`/delete-account\n  X-Robots-Tag: noindex, nofollow\n  Cache-Control: no-store\n  Referrer-Policy: no-referrer\n/delete-account.html\n  X-Robots-Tag: noindex, nofollow\n  Cache-Control: no-store\n  Referrer-Policy: no-referrer\n`);
const deletionHtml=readFileSync('dist-web/delete-account.html','utf8');
if(!deletionHtml.includes('Delete your Puptime account')||!deletionHtml.includes('noindex')||publicPaths.includes('/delete-account'))throw new Error('Deletion page must remain a direct, non-indexed account utility.');
writeFileSync('dist-web/_headers',readFileSync('dist-web/_headers','utf8')+`/care\n  X-Robots-Tag: noindex, nofollow\n  Cache-Control: no-store\n  Referrer-Policy: no-referrer\n/care.html\n  X-Robots-Tag: noindex, nofollow\n  Cache-Control: no-store\n  Referrer-Policy: no-referrer\n`);
const careHtml=readFileSync('dist-web/care.html','utf8');
if(!careHtml.includes('noindex')||!careHtml.includes('Shared puppy care | Puptime')||publicPaths.includes('/care'))throw new Error('Care handoff must be excluded from the sitemap.');
if(!accountHtml.includes('noindex')||!accountHtml.includes('Your account | Puptime')||publicPaths.includes('/account'))throw new Error('Account handoff must be excluded from the sitemap.');
for(const html of [accountHtml,careHtml])if(html.includes('<form')||html.includes('<input')||!html.includes('Open Puptime'))throw new Error('Legacy account and care routes must only hand off to the native app.');
for (const path of [...indexedPaths, '/account', '/care', '/delete-account', '/404']) {
  const filename = path === '/' ? 'index' : path === '/puppy-care/' ? 'puppy-care/index' : path.slice(1);
  const html = readFileSync(`dist-web/${filename}.html`, 'utf8');
  // A render-blocking link in <head> keeps the static HTML from flashing unstyled.
  if (stylesheetLinks(html).join() !== stylesheetHref || /<style>/.test(html) || html.indexOf(stylesheetHref) > html.indexOf('</head>')) throw new Error(`Page must use only the shared website stylesheet in <head>: ${path}`);
  if (!indexedPaths.includes(path)) continue;
  if (!html.includes(`href="${siteUrl}${path}"`) || !html.includes('rel="canonical"') || !html.includes('<h1') || !html.includes('name="description"') || !html.includes(`content="${socialImage.url}"`) || !html.includes('content="summary_large_image"')) {
    throw new Error(`Missing rendered SEO content: ${path}`);
  }
}
console.log(`Verified static HTML and generated sitemap for ${indexedPaths.length} public pages.`);

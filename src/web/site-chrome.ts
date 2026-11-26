import { privacyPath, supportPath } from '../public-site.ts';

// Shared by the React pages (SiteChrome.tsx) and the static privacy/support HTML (scripts/build-web-seo.ts).
export const sourceUrl = 'https://github.com/patrickchin/puptime';
export const androidDownloadPath = '/download/android.apk';
export const deleteAccountPath = '/delete-account';
export const siteTagline = 'Potty training and puppy routines, one log at a time.';

export type ChromeLink = { label: string; href: string; external?: boolean; event?: 'android_download' | 'source' };
export const headerLinks: ChromeLink[] = [{ label: 'The app', href: '/#app' }, { label: 'Puppy care', href: '/puppy-care/' }];
export const footerColumns: { title: string; links: ChromeLink[] }[] = [
  { title: 'Product', links: [...headerLinks, { label: 'Download Android APK', href: androidDownloadPath, event: 'android_download' }] },
  { title: 'Help', links: [{ label: 'Support', href: supportPath }, { label: 'Privacy', href: privacyPath }, { label: 'Delete cloud account', href: deleteAccountPath }] },
  { title: 'Source', links: [{ label: 'GitHub', href: sourceUrl, external: true, event: 'source' }] },
];

const carePath = (path: string) => path === '/puppy-care' || path.startsWith('/puppy-care/');
// Guide articles sit inside the Puppy care section, so its header link marks the location rather than the exact page.
export function headerCurrent(href: string, path: string): 'page' | 'true' | undefined {
  if (href === '/#app') return path === '/' ? 'page' : undefined;
  if (href === '/puppy-care/' && carePath(path)) return path === '/puppy-care' || path === '/puppy-care/' ? 'page' : 'true';
  return undefined;
}
export const footerCurrent = (href: string, path: string) => href === path || (href === '/puppy-care/' && path === '/puppy-care') ? 'page' as const : undefined;

const attribute = (name: string, value?: string) => value ? ` ${name}="${value}"` : '';
const linkHtml = ({ label, href, external }: ChromeLink, current?: string) => `<a href="${href}"${attribute('aria-current', current)}>${label}${external ? '&nbsp;<span aria-hidden="true">↗</span>' : ''}</a>`;

export function siteHeaderHtml(path: string) {
  return `<header class="site-header"><a class="site-brand" href="/" aria-label="Puptime home"><img src="/brand-icon.png" width="38" height="38" alt="">Puptime</a><nav aria-label="Website">${headerLinks.map((link) => linkHtml(link, headerCurrent(link.href, path))).join('')}</nav></header>`;
}

export function siteFooterHtml(path: string) {
  return `<footer class="site-footer"><div class="footer-brand"><p class="footer-wordmark" aria-hidden="true">Puptime</p><p class="footer-tagline">${siteTagline}</p></div><nav class="footer-columns" aria-label="Footer">${footerColumns.map(({ title, links }) => `<div><h2 class="footer-heading">${title}</h2><ul>${links.map((link) => `<li>${linkHtml(link, footerCurrent(link.href, path))}</li>`).join('')}</ul></div>`).join('')}</nav></footer>`;
}

// Self-contained so the chrome renders identically on React pages and on the static HTML pages.
export const siteChromeStyles = `
.site-header,.site-footer{--chrome-margin:max(24px,calc((100% - 1160px)/2));font-family:'Red Hat Text',sans-serif;font-size:clamp(17px,1.35vw,20px);line-height:1.5;color:var(--ink);box-sizing:border-box}
.site-header *,.site-footer *{box-sizing:border-box}
.site-header :where(a,button),.site-footer :where(a,button){color:inherit;text-decoration:none;touch-action:manipulation}
.site-header :where(a,button):focus-visible,.site-footer :where(a,button):focus-visible{outline:3px solid currentColor;outline-offset:6px}
.site-header{padding:24px var(--chrome-margin);display:flex;justify-content:space-between;align-items:center;gap:24px;background:var(--paper)}
.site-header.dark{background:var(--deep);color:var(--paper)}
.site-header .site-brand{display:flex;align-items:center;gap:10px;font-size:clamp(22px,2vw,28px);font-weight:900;letter-spacing:-.04em;white-space:nowrap}
.site-brand img{border-radius:10px}
.site-header nav{display:flex;align-items:center;gap:clamp(24px,3vw,48px)}
.site-header nav a{display:flex;align-items:center;min-height:44px;white-space:nowrap;text-underline-offset:8px}
.site-header nav a:hover{text-decoration:underline;text-decoration-thickness:1px}
.site-header nav a[aria-current]{text-decoration:underline;text-decoration-thickness:3px}
.site-footer{background:var(--paper);padding:48px var(--chrome-margin) 40px;border-top:1px solid var(--border);display:grid;grid-template-columns:minmax(0,1fr) auto;gap:40px 64px;align-items:start;overflow:clip}
.site-footer :where(p,h2,ul,li){margin:0;padding:0}
.site-footer .footer-wordmark{font-family:'Red Hat Display',sans-serif;font-size:32px;letter-spacing:-.065em;font-weight:900;line-height:.9;margin-left:-.04em}
.site-footer .footer-tagline{margin-top:20px;max-width:36ch;text-wrap:pretty}
.site-footer .footer-top{display:inline-flex;align-items:center;min-height:44px;margin-top:12px;font-size:14px;color:var(--muted)}
.site-footer .footer-top:hover{text-decoration:underline;text-underline-offset:4px}
.footer-columns{display:grid;grid-template-columns:repeat(3,auto);gap:24px 56px}
.site-footer h2.footer-heading{font-family:'Red Hat Display',sans-serif;font-weight:900;font-size:16px;letter-spacing:-.01em;line-height:1.2;margin-bottom:8px}
.footer-columns ul{list-style:none}
.footer-columns :where(a,button){display:flex;align-items:center;min-height:44px;white-space:nowrap}
.footer-columns button{border:0;background:none;padding:0;font:inherit;line-height:inherit;text-align:left;cursor:pointer}
.footer-columns :where(a,button):hover{text-decoration:underline;text-underline-offset:5px}
.footer-columns a[aria-current]{text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:5px}
@media(max-width:1000px){.site-header{padding-top:18px;padding-bottom:18px}}
@media(max-width:860px){.site-footer{grid-template-columns:1fr}}
@media(max-width:600px){
  .site-header,.site-footer{--chrome-margin:20px}
  .site-header{gap:12px;padding-top:16px;padding-bottom:16px}.site-header .site-brand{font-size:22px;gap:8px}.site-brand img{width:30px;height:30px;border-radius:8px}
  .site-header nav{gap:20px;font-size:16px}
  .site-footer{padding-top:40px;gap:32px}.footer-columns{grid-template-columns:1fr 1fr;gap:24px 20px}.footer-columns :where(a,button){white-space:normal}
}
@media(max-width:360px){.site-header{gap:8px}.site-header .site-brand{font-size:20px;gap:6px}.site-brand img{width:28px;height:28px}.site-header nav{gap:14px;font-size:15px}}
`;

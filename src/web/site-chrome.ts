import { privacyPath, supportPath } from '../public-site.ts';
import type { WebsiteDestination } from './telemetry-policy.ts';

// Shared by the React pages (SiteChrome.tsx) and the static privacy/support HTML (scripts/build-web-seo.ts).
export const sourceUrl = 'https://github.com/patrickchin/puptime';
export const downloadPath = '/download';
export const androidDownloadPath = '/download/android.apk';
export const androidReleasesUrl = 'https://github.com/patrickchin/puptime/releases/latest';
export const deleteAccountPath = '/delete-account';
export const siteTagline = 'Potty training and puppy routines, one log at a time.';

export type ChromeLink = { label: string; href: string; external?: boolean; event?: WebsiteDestination };
// Narrow phones show only the logo, so the header fits at 320px.
export const headerLinks: ChromeLink[] = [{ label: 'The app', href: '/#app' }, { label: 'Puppy care', href: '/puppy-care/' }];
export const footerColumns: { title: string; links: ChromeLink[] }[] = [
  { title: 'Product', links: [...headerLinks, { label: 'Download', href: downloadPath, event: 'get_puptime' }] },
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
const linkHtml = ({ label, href, external }: ChromeLink, current?: string, className?: string) => `<a${attribute('class', className)} href="${href}"${attribute('aria-current', current)}>${label}${external ? '&nbsp;<span aria-hidden="true">↗</span>' : ''}</a>`;

export function siteHeaderHtml(path: string) {
  return `<header class="site-header"><a class="site-brand" href="/" aria-label="Puptime home"><img src="/brand-icon.png" width="38" height="38" alt=""><span class="brand-name">Puptime</span></a><nav aria-label="Website">${headerLinks.map((link) => linkHtml(link, headerCurrent(link.href, path))).join('')}</nav></header>`;
}

export function siteFooterHtml(path: string) {
  return `<footer class="site-footer"><div class="footer-brand"><p class="footer-wordmark" aria-hidden="true">Puptime</p><p class="footer-tagline">${siteTagline}</p></div><nav class="footer-columns" aria-label="Footer">${footerColumns.map(({ title, links }) => `<div><h2 class="footer-heading">${title}</h2><ul>${links.map((link) => `<li>${linkHtml(link, footerCurrent(link.href, path))}</li>`).join('')}</ul></div>`).join('')}</nav></footer>`;
}

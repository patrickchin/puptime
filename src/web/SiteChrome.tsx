import { openAnalyticsSettings } from './WebsiteAnalytics';
import { captureWebsiteEvent } from './telemetry';
import { footerColumns, footerCurrent, headerAction, headerCurrent, headerLinks, siteTagline, type ChromeLink } from './site-chrome';

function ChromeLinkItem({ link, current, className }: { link: ChromeLink; current?: 'page' | 'true'; className?: string }) {
  const { label, href, external, event } = link;
  return <a className={className} href={href} aria-current={current} onClick={event ? () => captureWebsiteEvent('website_cta', { destination: event }) : undefined}>{label}{external && <>&nbsp;<span aria-hidden="true">↗</span></>}</a>;
}

export function SiteHeader({ path, dark = false }: { path: string; dark?: boolean }) {
  return <header className={`site-header${dark ? ' dark' : ''}`}>
    <a className="site-brand" href="/" aria-label="Puptime home"><img src="/brand-icon.png" width="38" height="38" alt="" /><span className="brand-name">Puptime</span></a>
    <nav aria-label="Website">{headerLinks.map((link) => <ChromeLinkItem key={link.href} link={link} current={headerCurrent(link.href, path)} className={link.wide ? 'wide-only' : undefined} />)}<ChromeLinkItem link={headerAction} className="header-cta" /></nav>
  </header>;
}

// Only offer analytics settings where WebsiteAnalytics is mounted to answer the button.
export function SiteFooter({ path, analytics = false, backToTop = false }: { path: string; analytics?: boolean; backToTop?: boolean }) {
  return <footer className="site-footer">
    <div className="footer-brand">
      <p className="footer-wordmark" aria-hidden="true">Puptime</p>
      <p className="footer-tagline">{siteTagline}</p>
      {backToTop && <a className="footer-top" href="#top">Back to top <span aria-hidden="true">↑</span></a>}
    </div>
    <nav className="footer-columns" aria-label="Footer">{footerColumns.map(({ title, links }) => <div key={title}>
      <h2 className="footer-heading">{title}</h2>
      <ul>
        {links.map((link) => <li key={link.href}><ChromeLinkItem link={link} current={footerCurrent(link.href, path)} /></li>)}
        {analytics && title === 'Help' && <li><button type="button" onClick={openAnalyticsSettings}>Analytics settings</button></li>}
      </ul>
    </div>)}</nav>
  </footer>;
}

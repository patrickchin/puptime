import Head from 'expo-router/head';
import { supportPath } from '../src/public-site';
import { marketingStyles } from '../src/web/marketing-styles';
import { SiteFooter, SiteHeader } from '../src/web/SiteChrome';

export default function NotFound() {
  return <div className="marketing-site care-page site-page not-found-page">
    <Head><title>Page not found | Puptime</title><meta name="robots" content="noindex" /></Head>
    <style>{marketingStyles + css}</style>
    <SiteHeader path="/404" />
    <main className="not-found-content">
      <h1>We couldn’t find that page.</h1>
      <p>The link may be old or mistyped. These are good places to pick up again:</p>
      <ul>
        <li><a className="text-action" href="/">Puptime home</a></li>
        <li><a className="text-action" href="/puppy-care/">Puppy care guides</a></li>
        <li><a className="text-action" href={supportPath}>Get help</a></li>
      </ul>
    </main>
    <SiteFooter path="/404" />
  </div>;
}
const css = `.not-found-content{max-width:680px;margin:72px auto;padding:0 24px 64px}.not-found-content h1{font-size:clamp(32px,5vw,48px);line-height:1.1;margin-bottom:24px}.not-found-content p{max-width:44ch}.not-found-content ul{list-style:none;margin:24px 0 0;padding:0;display:flex;flex-wrap:wrap;gap:4px 32px}@media(max-width:600px){.not-found-content{margin-top:48px}.not-found-content ul{flex-direction:column}}`;

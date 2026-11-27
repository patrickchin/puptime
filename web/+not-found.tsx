import Head from 'expo-router/head';
import { supportPath } from '../src/public-site';
import { SiteFooter, SiteHeader } from '../src/web/SiteChrome';

export default function NotFound() {
  return <div className="marketing-site care-page site-page not-found-page">
    <Head><title>Page not found | Puptime</title><meta name="robots" content="noindex" /></Head>
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

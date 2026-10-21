import Head from 'expo-router/head';
import { websiteStyles, websiteTheme } from '../src/web/brand';

export default function NotFound() {
  return <>
    <Head><title>Page not found | Puptime</title><meta name="robots" content="noindex" /><link rel="icon" href="/brand-icon.svg" type="image/svg+xml" /></Head>
    <style>{websiteStyles}</style>
    <main className="marketing-site" style={{ padding: 40, color: websiteTheme.text, background: websiteTheme.background, minHeight: '100vh' }}>
      <h1>Page not found</h1>
      <p><a href="/">Puptime home</a> · <a href="/puppy-care/">Puppy care guides</a></p>
    </main>
  </>;
}

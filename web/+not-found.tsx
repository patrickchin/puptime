import Head from 'expo-router/head';
import { marketingStyles } from '../src/web/marketing-styles';

export default function NotFound() {
  return <>
    <Head><title>Page not found | Puptime</title><meta name="robots" content="noindex" /><link rel="icon" href="/brand-icon.svg" type="image/svg+xml" /></Head>
    <style>{marketingStyles}</style>
    <main className="marketing-site" style={{ padding: 40, minHeight: '100vh' }}>
      <h1>Page not found</h1>
      <p><a className="text-action" href="/">Puptime home</a> · <a className="text-action" href="/puppy-care/">Puppy care guides</a></p>
    </main>
  </>;
}

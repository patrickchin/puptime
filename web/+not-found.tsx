import Head from 'expo-router/head';

export default function NotFound() {
  return <>
    <Head><title>Page not found | Puptime</title><meta name="robots" content="noindex" /></Head>
    <main style={{ padding: 40, fontFamily: 'system-ui', color: '#17231E', background: '#F6F4ED', minHeight: '100vh' }}>
      <h1>Page not found</h1>
      <p><a href="/">Puptime home</a> · <a href="/puppy-care/">Puppy care guides</a></p>
    </main>
  </>;
}

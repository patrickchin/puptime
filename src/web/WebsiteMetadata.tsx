import Head from 'expo-router/head';
import { pageMetadata, siteUrl } from './site';

export function WebsiteMetadata({ path }: { path: string }) {
  const { title, description, url, article } = pageMetadata(path);
  const structuredData = article ? {
    '@context': 'https://schema.org', '@type': 'Article', headline: article.title,
    description, url, mainEntityOfPage: url, inLanguage: 'en',
    author: { '@type': 'Person', name: 'Patrick Chin' },
    publisher: { '@type': 'Organization', name: 'Puptime', url: siteUrl },
  } : {
    '@context': 'https://schema.org', '@type': 'WebSite', name: 'Puptime', url: siteUrl,
    description, inLanguage: 'en',
  };
  return <Head>
    <title>{title}</title>
    <meta name="description" content={description} />
    <link rel="canonical" href={url} />
    <meta property="og:site_name" content="Puptime" />
    <meta property="og:title" content={title} />
    <meta property="og:description" content={description} />
    <meta property="og:url" content={url} />
    <meta property="og:type" content={article ? 'article' : 'website'} />
    <meta property="og:image" content={`${siteUrl}/social-preview.png`} />
    <meta property="og:image:alt" content="Puptime logo" />
    <meta name="twitter:card" content="summary" />
    <script type="application/ld+json">{JSON.stringify(structuredData).replace(/</g, '\\u003c')}</script>
  </Head>;
}

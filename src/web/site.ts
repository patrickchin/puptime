import { careArticles } from '../puppy-care.ts';

export const siteUrl = 'https://puptime.pages.dev';
export const publicPaths = ['/', '/puppy-care', ...careArticles.map(({ id }) => `/puppy-care/${id}`)];

export function pageMetadata(path: string) {
  const article = careArticles.find(({ id }) => path === `/puppy-care/${id}`);
  return {
    title: article ? `${article.title} | Puptime` : path === '/puppy-care' ? 'Puppy care guides: feeding, sleep & toilet training | Puptime' : 'Puptime — Puppy activity log & potty training tracker',
    description: article?.summary ?? (path === '/puppy-care'
      ? 'Practical puppy care guides on toilet training, feeding, sleep, socialisation, and daily routines, with sources from animal welfare and veterinary organisations.'
      : 'Track puppy potty breaks, meals, walks, and naps with Puptime. Build a daily routine, spot timing patterns, and log from your Home Screen. Free and open source.'),
    url: `${siteUrl}${path === '/' ? '/' : path}`,
    article,
  };
}

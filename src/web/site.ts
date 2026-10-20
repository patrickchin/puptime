import { careArticles } from '../puppy-care.ts';

export const siteUrl = 'https://puptime.pages.dev';
export const publicPaths = ['/', '/puppy-care/', ...careArticles.map(({ id }) => `/puppy-care/${id}`)];

export function pageMetadata(path: string) {
  const article = careArticles.find(({ id }) => path === `/puppy-care/${id}`);
  const library = path === '/puppy-care' || path === '/puppy-care/';
  return {
    title: article ? `${article.title} | Puptime` : library ? 'Puppy care guides: feeding, sleep & toilet training | Puptime' : 'Puptime — Puppy activity log & potty training tracker',
    description: article?.summary ?? (library
      ? 'Practical puppy care guides on toilet training, feeding, sleep, socialisation, and daily routines, with sources from animal welfare and veterinary organisations.'
      : 'Track puppy potty breaks, meals, and walks with Puptime. Local logging is free without an account, with optional cloud backup and device sync.'),
    url: `${siteUrl}${library ? '/puppy-care/' : path}`,
    article,
  };
}

import type { CareArticle } from './puppy-care.ts';

export function guideSourceText(article: CareArticle): string {
  return [
    article.title, article.summary,
    ...article.sections.flatMap((section) => [section.title, ...section.paragraphs]),
    'This is a Puptime puppy care summary. Ask your vet about health, diet, and vaccination decisions. Sources and further reading are available in the written guide.',
  ].join('\n\n');
}

export function audioTime(seconds: number): string {
  const value = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

export function audioSeek(current: number, delta: number, duration: number): number {
  return Math.max(0, Math.min(current + delta, Math.max(0, duration)));
}

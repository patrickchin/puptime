import { lazy, Suspense, type ComponentProps } from 'react';
import { guideRecordings } from '../guide-recordings';

// The website loads the audio player (expo-audio and icon fonts) only for guides that ship a recording.
const Player = lazy(() => import('./GuideListener.tsx').then((module) => ({ default: module.GuideListener })));

export function GuideListener(props: ComponentProps<typeof Player>) {
  if (!guideRecordings[props.article.id]) return null;
  return <Suspense fallback={null}><Player {...props} /></Suspense>;
}

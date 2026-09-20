import { createContext, useContext, useMemo, type ReactNode } from 'react';

import {
  localizedEventLabel,
  localizedEventPastLabel,
  localizedElapsedTime,
  localizedRelativeTime,
  themeVoiceCopy,
  translate,
  type AppLanguage,
  type MessageKey,
  type TranslationVariables,
} from './localization';
import type { PuppyEvent } from './domain';
import type { ThemeVoice } from './theme';

type Localization = {
  language: AppLanguage;
  locale: string;
  t: (key: MessageKey, variables?: TranslationVariables) => string;
  eventLabel: (type: PuppyEvent['type']) => string;
  eventPastLabel: (event: PuppyEvent) => string;
  elapsedTime: (value: number, now?: number) => string;
  relativeTime: (value: number, now?: number) => string;
  voiceCopy: (date: string) => ReturnType<typeof themeVoiceCopy>;
};

const fallback = createLocalization('en', 'gentle');
const LocalizationContext = createContext<Localization>(fallback);

function createLocalization(language: AppLanguage, voice: ThemeVoice): Localization {
  return {
    language,
    locale: language,
    t: (key, variables) => translate(language, key, variables),
    eventLabel: (type) => localizedEventLabel(language, type),
    eventPastLabel: (event) => localizedEventPastLabel(language, event),
    elapsedTime: (value, now) => localizedElapsedTime(language, value, now),
    relativeTime: (value, now) => localizedRelativeTime(language, value, now),
    voiceCopy: (date) => themeVoiceCopy(language, voice, date),
  };
}

export function LocalizationProvider({
  children,
  language,
  voice,
}: {
  children: ReactNode;
  language: AppLanguage;
  voice: ThemeVoice;
}) {
  const value = useMemo(() => createLocalization(language, voice), [language, voice]);
  return <LocalizationContext.Provider value={value}>{children}</LocalizationContext.Provider>;
}

export function useLocalization(): Localization {
  return useContext(LocalizationContext);
}

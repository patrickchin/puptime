import { createContext, useContext, useMemo, type ReactNode } from 'react';

import {
  localizedEventLabel,
  localizedEventPastLabel,
  localizedElapsedTime,
  localizedRelativeTime,
  translate,
  type AppLanguage,
  type MessageKey,
  type TranslationVariables,
} from './localization';
import type { PuppyEvent } from './domain';

type Localization = {
  language: AppLanguage;
  locale: string;
  t: (key: MessageKey, variables?: TranslationVariables) => string;
  eventLabel: (type: PuppyEvent['type']) => string;
  eventPastLabel: (event: PuppyEvent) => string;
  elapsedTime: (value: number, now?: number) => string;
  relativeTime: (value: number, now?: number) => string;
};

const fallback = createLocalization('en');
const LocalizationContext = createContext<Localization>(fallback);

function createLocalization(language: AppLanguage): Localization {
  return {
    language,
    locale: language,
    t: (key, variables) => translate(language, key, variables),
    eventLabel: (type) => localizedEventLabel(language, type),
    eventPastLabel: (event) => localizedEventPastLabel(language, event),
    elapsedTime: (value, now) => localizedElapsedTime(language, value, now),
    relativeTime: (value, now) => localizedRelativeTime(language, value, now),
  };
}

export function LocalizationProvider({
  children,
  language,
}: {
  children: ReactNode;
  language: AppLanguage;
}) {
  const value = useMemo(() => createLocalization(language), [language]);
  return <LocalizationContext.Provider value={value}>{children}</LocalizationContext.Provider>;
}

export function useLocalization(): Localization {
  return useContext(LocalizationContext);
}

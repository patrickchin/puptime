import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { customizedActivityColors, type ActivityCustomization, type ActivityCustomizations } from './activity-customization';
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
import { activityKey, type Activity, type PuppyEvent } from './domain';
import type { Theme } from './theme';

type Localization = {
  language: AppLanguage;
  locale: string;
  t: (key: MessageKey, variables?: TranslationVariables) => string;
  eventLabel: (type: PuppyEvent['type']) => string;
  eventPastLabel: (event: PuppyEvent) => string;
  activityLabel: (activity: Activity) => string;
  activityAppearance: (activity: Activity) => ActivityCustomization | undefined;
  activityColors: (theme: Theme, activity: Activity) => { color: string; softColor: string };
  elapsedTime: (value: number, now?: number) => string;
  relativeTime: (value: number, now?: number) => string;
};

const fallback = createLocalization('en');
const LocalizationContext = createContext<Localization>(fallback);

function createLocalization(language: AppLanguage, customizations: ActivityCustomizations = {}): Localization {
  const appearance = (activity: Activity) => customizations[activityKey(activity)];
  return {
    language,
    locale: language,
    t: (key, variables) => translate(language, key, variables),
    eventLabel: (type) => appearance({ type })?.name ?? localizedEventLabel(language, type),
    eventPastLabel: (event) => appearance(event)?.name ?? localizedEventPastLabel(language, event),
    activityLabel: (activity) => appearance(activity)?.name ?? (activity.type === 'custom' && activity.customLabel ? activity.customLabel : localizedEventLabel(language, activity.type)),
    activityAppearance: appearance,
    activityColors: (theme, activity) => customizedActivityColors(theme, customizations, activity),
    elapsedTime: (value, now) => localizedElapsedTime(language, value, now),
    relativeTime: (value, now) => localizedRelativeTime(language, value, now),
  };
}

export function LocalizationProvider({
  children,
  language,
  customizations = {},
}: {
  children: ReactNode;
  language: AppLanguage;
  customizations?: ActivityCustomizations;
}) {
  const value = useMemo(() => createLocalization(language, customizations), [language, customizations]);
  return <LocalizationContext.Provider value={value}>{children}</LocalizationContext.Provider>;
}

export function useLocalization(): Localization {
  return useContext(LocalizationContext);
}

import { EVENT_META, customActivityKey, isOpenNap, latestQuickEventTimes, type PuppyEvent } from '../domain';
import { resolveLanguage } from '../localization';
import { resolveTheme } from '../theme';
import {
  loadLanguagePreference,
  loadCustomActivities,
  loadNotificationPreferences,
  loadThemePreference,
  loadWidgetActions,
} from '../storage';
import PuptimeWidget, { type PuptimeWidgetProps } from './PuptimeWidget.ios';

export async function readPendingWidgetEvents(): Promise<PuppyEvent[]> {
  try {
    const timeline = await PuptimeWidget.getTimeline();
    const pending = timeline.flatMap((entry) => (entry.props as PuptimeWidgetProps).pending ?? []);
    return [...new Map(pending.map((event) => [event.id, {
      ...event,
      ...(event.type === 'nap' && event.endedAt === undefined ? { endedAt: null } : {}),
      source: 'widget' as const,
    }])).values()];
  } catch {
    return [];
  }
}

export async function updateHomeWidget(events: PuppyEvent[]): Promise<void> {
  const openNap = events.find(isOpenNap);
  const customActivities = await loadCustomActivities(events);
  const [actions, themePreference, notificationPreferences, languagePreference] = await Promise.all([
    loadWidgetActions(customActivities),
    loadThemePreference(),
    loadNotificationPreferences(),
    loadLanguagePreference(),
  ]);
  const lightTheme = resolveTheme(themePreference, 'light');
  const darkTheme = resolveTheme(themePreference, 'dark');
  const actionDetails = Object.fromEntries([...new Set([...actions, 'nap' as const])].map((type) => {
    const meta = EVENT_META[type.startsWith('custom:') ? 'custom' : type as keyof typeof EVENT_META];
    const label = type.startsWith('custom:')
      ? customActivities.find((value) => customActivityKey(value) === type) ?? type.slice(7)
      : meta.label;
    return [type, {
      label,
      lightColor: lightTheme.isDark ? meta.darkColor : meta.color,
      darkColor: darkTheme.isDark ? meta.darkColor : meta.color,
    }];
  }));
  await PuptimeWidget.updateSnapshot({
    pending: [],
    openNap: openNap ? { id: openNap.id, type: 'nap', at: openNap.at } : false,
    lastEventAt: latestQuickEventTimes(events),
    actions,
    actionDetails,
    appearance: {
      light: {
        background: lightTheme.background,
        surface: lightTheme.surface,
        controlRadius: lightTheme.presentation.controlRadius,
      },
      dark: {
        background: darkTheme.background,
        surface: darkTheme.surface,
        controlRadius: darkTheme.presentation.controlRadius,
      },
    },
    notificationConfirmations: notificationPreferences.widgetConfirmations,
    pottyAfterPeeMinutes: notificationPreferences.pottyAfterPee.enabled
      ? notificationPreferences.pottyAfterPee.delayMinutes
      : 0,
    pottyAfterMealMinutes: notificationPreferences.pottyAfterMeal.enabled
      ? notificationPreferences.pottyAfterMeal.delayMinutes
      : 0,
    language: resolveLanguage(languagePreference),
  });
}

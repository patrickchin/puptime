import { EVENT_META, type EventType } from './domain.ts';

type DisplayWeight = '400' | '700' | '800' | '900';

export type ThemeEventIcon = 'pee' | 'poop' | 'meal' | 'pottyTrip' | 'walk' | 'nap' | 'custom';
export type ThemeNavigationIcon = 'log' | 'timeline' | 'insights' | 'schedule' | 'learn';

export type Theme = typeof lightTheme;

export type ThemePreference = 'system' | 'light' | 'dark';

export const lightTheme = {
  isDark: false as boolean,
  background: '#F8F3E8',
  surface: '#FFFAF0',
  surfaceRaised: '#FFFAF0',
  text: '#173B30',
  textMuted: '#59675B',
  border: '#D8D4C3',
  primary: '#234B3B',
  onPrimary: '#FFFAF0',
  primaryPressed: '#173B30',
  primarySoft: '#EDE4D0',
  danger: '#B43A35',
  dangerSoft: '#FBE5E2',
  shadow: '#10251C',
  nav: '#F8F3E8',
  presentation: {
    headingFont: undefined as string | undefined,
    markIcon: 'paw' as string,
    cardRadius: 22,
    controlRadius: 16,
    iconRadius: 15,
    borderWidth: 1,
    cardPadding: 16,
    actionHeight: 112,
    gridGap: 8,
    titleSize: 29,
    titleLineHeight: 35,
    titleWeight: '800' as DisplayWeight,
    titleTracking: -0.5,
    eyebrowTracking: 1.6,
    navIndicatorWidth: 52,
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffsetY: 0,
    elevation: 0,
  },
};

export const darkTheme: Theme = {
  isDark: true,
  background: '#10251D',
  surface: '#173B30',
  surfaceRaised: '#234B3B',
  text: '#F8F3E8',
  textMuted: '#C7CDBB',
  border: '#486052',
  primary: '#D7EC98',
  onPrimary: '#173B30',
  primaryPressed: '#C4DB81',
  primarySoft: '#294B38',
  danger: '#FF9A94',
  dangerSoft: '#452926',
  shadow: '#000000',
  nav: '#10251D',
  presentation: {
    headingFont: undefined,
    markIcon: 'weather-night',
    cardRadius: 28,
    controlRadius: 24,
    iconRadius: 24,
    borderWidth: 0,
    cardPadding: 18,
    actionHeight: 120,
    gridGap: 10,
    titleSize: 28,
    titleLineHeight: 35,
    titleWeight: '700',
    titleTracking: -0.2,
    eyebrowTracking: 1.1,
    navIndicatorWidth: 58,
    shadowOpacity: 0.32,
    shadowRadius: 16,
    shadowOffsetY: 8,
    elevation: 5,
  },
};

export const themeChoices = ['system', 'light', 'dark'] as const;

const defaultIcons = {
  events: { pee: 'water-outline', poop: 'emoticon-poop-outline', meal: 'food-apple-outline', pottyTrip: 'door-open', walk: 'walk', nap: 'sleep', custom: 'tag-outline' },
  navigation: { log: 'home-variant-outline', timeline: 'timeline-clock-outline', insights: 'chart-line-variant', schedule: 'calendar-clock-outline', learn: 'book-open-page-variant-outline' },
};

const defaultDarkIcons = {
  events: { pee: 'cup-water', poop: 'emoticon-poop-outline', meal: 'bowl-mix-outline', pottyTrip: 'door-open', walk: 'foot-print', nap: 'weather-night', custom: 'bookmark-outline' },
  navigation: { log: 'moon-waning-crescent', timeline: 'timeline-clock-outline', insights: 'chart-areaspline', schedule: 'calendar-month-outline', learn: 'book-open-page-variant-outline' },
};

export function headingStyle(theme: Theme) {
  return { fontFamily: theme.presentation.headingFont, fontWeight: theme.presentation.titleWeight };
}

export function eventIcon(theme: Theme, type: ThemeEventIcon): string {
  return (theme.isDark ? defaultDarkIcons : defaultIcons).events[type];
}

export function eventColors(theme: Theme, type: EventType) {
  const meta = EVENT_META[type];
  return theme.isDark
    ? { color: meta.darkColor, softColor: meta.darkSoftColor }
    : { color: meta.color, softColor: meta.softColor };
}

export function navigationIcon(theme: Theme, tab: ThemeNavigationIcon): string {
  return (theme.isDark ? defaultDarkIcons : defaultIcons).navigation[tab];
}

export function surfaceTreatment(theme: Theme) {
  return {
    borderWidth: theme.presentation.borderWidth,
    borderRadius: theme.presentation.cardRadius,
    shadowColor: theme.shadow,
    shadowOpacity: theme.presentation.shadowOpacity,
    shadowRadius: theme.presentation.shadowRadius,
    shadowOffset: { width: 0, height: theme.presentation.shadowOffsetY },
    elevation: theme.presentation.elevation,
  };
}

export function isThemePreference(value: string | null): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

export function readThemePreference(value: string | null): ThemePreference {
  // These shipped cloud preferences use the current default appearance.
  if (value === null || value === 'puppy-journal' || value === 'soft-play' || value === 'day-trails') return 'system';
  if (!isThemePreference(value)) throw new Error('Saved theme preference is invalid.');
  return value;
}

export function resolveTheme(
  preference: ThemePreference,
  colorScheme: 'light' | 'dark' | 'unspecified' | null | undefined,
): Theme {
  return (preference === 'dark' || (preference === 'system' && colorScheme === 'dark'))
    ? darkTheme : lightTheme;
}

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;

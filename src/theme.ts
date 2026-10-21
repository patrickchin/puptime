import { EVENT_META, type EventType } from './domain.ts';

type DisplayWeight = '400' | '700' | '800' | '900';

export type ThemeEventIcon = 'pee' | 'poop' | 'meal' | 'pottyTrip' | 'walk' | 'nap' | 'custom';
export type ThemeNavigationIcon = 'log' | 'timeline' | 'insights' | 'schedule' | 'learn';

export type Theme = typeof lightTheme;

export type ThemePreference = 'system' | 'light' | 'dark';

export const lightTheme = {
  isDark: false as boolean,
  background: '#F5F3EC',
  surface: '#FFFEFA',
  surfaceRaised: '#FFFFFF',
  text: '#17231E',
  textMuted: '#56635D',
  border: '#DDE5DF',
  primary: '#176B52',
  onPrimary: '#FFFFFF',
  primaryPressed: '#10533F',
  primarySoft: '#DDEFE7',
  danger: '#B43A35',
  dangerSoft: '#FBE5E2',
  shadow: '#10251C',
  nav: '#FFFEFA',
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
  background: '#101713',
  surface: '#17211C',
  surfaceRaised: '#1D2923',
  text: '#F2F6F3',
  textMuted: '#B9C5BE',
  border: '#35443C',
  primary: '#73D3AD',
  onPrimary: '#0B2017',
  primaryPressed: '#55B992',
  primarySoft: '#253E33',
  danger: '#FF8A83',
  dangerSoft: '#452926',
  shadow: '#000000',
  nav: '#151E19',
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
  more: 'plus-circle-outline', routine: 'calendar-clock-outline',
};

const defaultDarkIcons = {
  events: { pee: 'cup-water', poop: 'emoticon-poop-outline', meal: 'bowl-mix-outline', pottyTrip: 'door-open', walk: 'foot-print', nap: 'weather-night', custom: 'bookmark-outline' },
  navigation: { log: 'moon-waning-crescent', timeline: 'timeline-clock-outline', insights: 'chart-areaspline', schedule: 'calendar-month-outline', learn: 'book-open-page-variant-outline' },
  more: 'plus-circle-multiple-outline', routine: 'calendar-month-outline',
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

export function supportingIcon(theme: Theme, icon: 'more' | 'routine'): string {
  return (theme.isDark ? defaultDarkIcons : defaultIcons)[icon];
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

export function resolveTheme(
  preference: ThemePreference,
  colorScheme: 'light' | 'dark' | 'unspecified' | null | undefined,
): Theme {
  return (preference === 'dark' || (preference === 'system' && colorScheme === 'dark'))
    ? darkTheme : lightTheme;
}

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;

import { EVENT_META, type EventType } from './domain.ts';

type DisplayWeight = '400' | '700' | '800' | '900';

export type ThemeIconProfile = 'default' | NamedThemePreference;
export type ThemeEventIcon = 'pee' | 'poop' | 'meal' | 'pottyTrip' | 'walk' | 'nap' | 'custom';
export type ThemeNavigationIcon = 'log' | 'timeline' | 'insights' | 'schedule' | 'learn';

export type Theme = typeof lightTheme;

export type ThemePreference = 'system' | 'puppy-journal' | 'soft-play' | 'day-trails';

export type NamedThemePreference = Exclude<ThemePreference, 'system'>;

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
    iconProfile: 'default' as ThemeIconProfile,
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
    iconProfile: 'default',
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

export const puppyJournalTheme: Theme = {
  ...lightTheme,
  background: '#FFFCF6', surface: '#FFFDF8', surfaceRaised: '#FFFFFF',
  text: '#30372F', textMuted: '#596354', border: '#E4E4D5',
  primary: '#365F9D', primaryPressed: '#274979', primarySoft: '#E4EDFA',
  nav: '#FFFCF6', shadow: '#777659',
  presentation: {
    ...lightTheme.presentation,
    iconProfile: 'puppy-journal', headingFont: 'Delius', markIcon: 'dog-side',
    cardRadius: 24, controlRadius: 18, iconRadius: 22,
    borderWidth: 0, cardPadding: 16, actionHeight: 146, gridGap: 10,
    titleSize: 32, titleLineHeight: 40, titleWeight: '400', titleTracking: -0.4,
    shadowOpacity: 0.05, shadowRadius: 5, shadowOffsetY: 2, elevation: 1,
  },
};

export const softPlayTheme: Theme = {
  ...lightTheme,
  background: '#F0F6FC', surface: '#F7FAFE', surfaceRaised: '#FFFFFF',
  text: '#25314D', textMuted: '#50617D', border: '#D5E2F2',
  primary: '#3155CF', primaryPressed: '#2341AB', primarySoft: '#E2EBFC',
  nav: '#FFFFFF', shadow: '#718DBA',
  presentation: {
    ...lightTheme.presentation,
    iconProfile: 'soft-play', headingFont: 'LilitaOne', markIcon: 'dog',
    cardRadius: 28, controlRadius: 24, iconRadius: 24,
    borderWidth: 1, cardPadding: 18, actionHeight: 154, gridGap: 12,
    titleSize: 34, titleLineHeight: 42, titleWeight: '400', titleTracking: 0,
    shadowOpacity: 0.14, shadowRadius: 2, shadowOffsetY: 4, elevation: 3,
    navIndicatorWidth: 56,
  },
};

export const dayTrailsTheme: Theme = {
  ...lightTheme,
  background: '#EDF7F5', surface: '#F6FCFA', surfaceRaised: '#FFFFFF',
  text: '#184B4B', textMuted: '#486B63', border: '#D5E8DE',
  primary: '#23625C', primaryPressed: '#174C47', primarySoft: '#DCEFE6',
  nav: '#F6FCFA', shadow: '#527A61',
  presentation: {
    ...lightTheme.presentation,
    iconProfile: 'day-trails', headingFont: 'Itim', markIcon: 'dog-side',
    cardRadius: 26, controlRadius: 22, iconRadius: 999,
    borderWidth: 0, cardPadding: 16, actionHeight: 142, gridGap: 10,
    titleSize: 34, titleLineHeight: 42, titleWeight: '400', titleTracking: -0.3,
    shadowOpacity: 0, shadowRadius: 0, shadowOffsetY: 0, elevation: 0,
  },
};

export const namedThemes: Record<NamedThemePreference, Theme> = {
  'puppy-journal': puppyJournalTheme,
  'soft-play': softPlayTheme,
  'day-trails': dayTrailsTheme,
};

export const themeChoices = ['system', 'puppy-journal', 'soft-play', 'day-trails'] as const;

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

const iconProfiles: Record<ThemeIconProfile, {
  events: Record<ThemeEventIcon, string>;
  navigation: Record<ThemeNavigationIcon, string>;
  more: string;
  routine: string;
}> = {
  default: defaultIcons,
  'puppy-journal': {
    ...defaultIcons,
    events: { ...defaultIcons.events, meal: 'bowl-mix-outline', nap: 'weather-night' },
    navigation: { ...defaultIcons.navigation, log: 'notebook-outline', timeline: 'timeline-text-outline' },
  },
  'soft-play': {
    ...defaultIcons,
    events: { ...defaultIcons.events, pee: 'water', poop: 'emoticon-poop', meal: 'bowl-mix', nap: 'moon-waning-crescent' },
    navigation: { log: 'home', timeline: 'clock', insights: 'chart-bar', schedule: 'calendar', learn: 'book-open-variant' },
  },
  'day-trails': {
    ...defaultIcons,
    events: { ...defaultIcons.events, meal: 'bowl-mix-outline', walk: 'map-marker-path', nap: 'moon-waning-crescent' },
    navigation: { ...defaultIcons.navigation, timeline: 'map-marker-path', insights: 'chart-bar' },
  },
};

export function headingStyle(theme: Theme) {
  return { fontFamily: theme.presentation.headingFont, fontWeight: theme.presentation.titleWeight };
}

export function eventIcon(theme: Theme, type: ThemeEventIcon): string {
  return (theme.isDark ? defaultDarkIcons : iconProfiles[theme.presentation.iconProfile]).events[type];
}

export function eventColors(theme: Theme, type: EventType) {
  const meta = EVENT_META[type];
  return theme.isDark
    ? { color: meta.darkColor, softColor: meta.darkSoftColor }
    : { color: meta.color, softColor: meta.softColor };
}

export function navigationIcon(theme: Theme, tab: ThemeNavigationIcon): string {
  return (theme.isDark ? defaultDarkIcons : iconProfiles[theme.presentation.iconProfile]).navigation[tab];
}

export function supportingIcon(theme: Theme, icon: 'more' | 'routine'): string {
  return (theme.isDark ? defaultDarkIcons : iconProfiles[theme.presentation.iconProfile])[icon];
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
  return value === 'system'
    || (value !== null && Object.prototype.hasOwnProperty.call(namedThemes, value));
}

export function resolveTheme(
  preference: ThemePreference,
  colorScheme: 'light' | 'dark' | 'unspecified' | null | undefined,
): Theme {
  if (preference === 'system') return colorScheme === 'dark' ? darkTheme : lightTheme;
  return namedThemes[preference];
}

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;

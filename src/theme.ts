type DisplayWeight = '700' | '800' | '900';

export type ThemeIconProfile = Exclude<ThemePreference, 'system'>;
export type ThemeEventIcon = 'pee' | 'poop' | 'meal' | 'pottyTrip' | 'walk' | 'nap' | 'custom';
export type ThemeNavigationIcon = 'log' | 'timeline' | 'insights' | 'schedule';

export type Theme = typeof lightTheme;

export type ThemePreference =
  | 'system'
  | 'meadow'
  | 'sunrise'
  | 'midnight'
  | 'paper'
  | 'bubblegum'
  | 'blueprint'
  | 'trail'
  | 'tide'
  | 'plum'
  | 'contrast';

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
    iconProfile: 'meadow' as ThemeIconProfile,
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
    iconProfile: 'midnight',
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

export const sunriseTheme: Theme = {
  isDark: false,
  background: '#FFF4EC',
  surface: '#FFF9F4',
  surfaceRaised: '#FFFFFF',
  text: '#2A1C17',
  textMuted: '#6B554C',
  border: '#E9D8CE',
  primary: '#99462E',
  onPrimary: '#FFFFFF',
  primaryPressed: '#7A3522',
  primarySoft: '#F6DED5',
  danger: '#B42318',
  dangerSoft: '#F9DEDC',
  shadow: '#3C1E14',
  nav: '#FFF9F4',
  presentation: {
    iconProfile: 'sunrise',
    markIcon: 'weather-sunset-up',
    cardRadius: 10,
    controlRadius: 8,
    iconRadius: 999,
    borderWidth: 1.5,
    cardPadding: 14,
    actionHeight: 104,
    gridGap: 6,
    titleSize: 31,
    titleLineHeight: 36,
    titleWeight: '900',
    titleTracking: -1,
    eyebrowTracking: 2,
    navIndicatorWidth: 36,
    shadowOpacity: 0.12,
    shadowRadius: 0,
    shadowOffsetY: 3,
    elevation: 2,
  },
};

export const paperTheme: Theme = {
  isDark: false,
  background: '#F2F0E8',
  surface: '#F8F7F1',
  surfaceRaised: '#FFFEF8',
  text: '#191918',
  textMuted: '#585650',
  border: '#282724',
  primary: '#24231F',
  onPrimary: '#FFFFFF',
  primaryPressed: '#000000',
  primarySoft: '#E2DED0',
  danger: '#9B2C2C',
  dangerSoft: '#F2D7D3',
  shadow: '#191918',
  nav: '#F8F7F1',
  presentation: {
    iconProfile: 'paper',
    markIcon: 'book-open-page-variant-outline',
    cardRadius: 2,
    controlRadius: 2,
    iconRadius: 2,
    borderWidth: 1,
    cardPadding: 16,
    actionHeight: 112,
    gridGap: 8,
    titleSize: 30,
    titleLineHeight: 36,
    titleWeight: '700',
    titleTracking: -0.8,
    eyebrowTracking: 2.3,
    navIndicatorWidth: 34,
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffsetY: 0,
    elevation: 0,
  },
};

export const bubblegumTheme: Theme = {
  isDark: false,
  background: '#FFF0F7',
  surface: '#FFF7FB',
  surfaceRaised: '#FFFFFF',
  text: '#321827',
  textMuted: '#6E4E60',
  border: '#EFC9DC',
  primary: '#B4236C',
  onPrimary: '#FFFFFF',
  primaryPressed: '#8E1853',
  primarySoft: '#F9D8E9',
  danger: '#A61B1B',
  dangerSoft: '#F8DCDD',
  shadow: '#7A174A',
  nav: '#FFF7FB',
  presentation: {
    iconProfile: 'bubblegum',
    markIcon: 'heart-outline',
    cardRadius: 30,
    controlRadius: 999,
    iconRadius: 999,
    borderWidth: 1,
    cardPadding: 18,
    actionHeight: 120,
    gridGap: 10,
    titleSize: 32,
    titleLineHeight: 37,
    titleWeight: '900',
    titleTracking: -1.1,
    eyebrowTracking: 1.2,
    navIndicatorWidth: 64,
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffsetY: 6,
    elevation: 3,
  },
};

export const blueprintTheme: Theme = {
  isDark: true,
  background: '#071B2B',
  surface: '#0C2A40',
  surfaceRaised: '#10354F',
  text: '#F0FAFF',
  textMuted: '#B4D2E3',
  border: '#2B647F',
  primary: '#4ED6FF',
  onPrimary: '#041923',
  primaryPressed: '#25B5E1',
  primarySoft: '#123F56',
  danger: '#FF8B8B',
  dangerSoft: '#4B252A',
  shadow: '#000000',
  nav: '#081F30',
  presentation: {
    iconProfile: 'blueprint',
    markIcon: 'vector-square',
    cardRadius: 4,
    controlRadius: 4,
    iconRadius: 4,
    borderWidth: 1.5,
    cardPadding: 12,
    actionHeight: 96,
    gridGap: 6,
    titleSize: 27,
    titleLineHeight: 33,
    titleWeight: '800',
    titleTracking: 0.2,
    eyebrowTracking: 2.4,
    navIndicatorWidth: 36,
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffsetY: 0,
    elevation: 0,
  },
};

export const trailTheme: Theme = {
  isDark: false,
  background: '#F3EBDD',
  surface: '#FAF4E8',
  surfaceRaised: '#FFF9EF',
  text: '#2B2418',
  textMuted: '#655B48',
  border: '#766A50',
  primary: '#6B4F1D',
  onPrimary: '#FFFFFF',
  primaryPressed: '#4F3B16',
  primarySoft: '#E9DFC5',
  danger: '#A13E2B',
  dangerSoft: '#F1D7CF',
  shadow: '#2B2418',
  nav: '#FAF4E8',
  presentation: {
    iconProfile: 'trail',
    markIcon: 'pine-tree',
    cardRadius: 8,
    controlRadius: 6,
    iconRadius: 8,
    borderWidth: 2,
    cardPadding: 14,
    actionHeight: 108,
    gridGap: 8,
    titleSize: 29,
    titleLineHeight: 35,
    titleWeight: '800',
    titleTracking: -0.3,
    eyebrowTracking: 1.8,
    navIndicatorWidth: 42,
    shadowOpacity: 0.16,
    shadowRadius: 0,
    shadowOffsetY: 4,
    elevation: 3,
  },
};

export const tideTheme: Theme = {
  isDark: false,
  background: '#EDF8F8',
  surface: '#F6FCFC',
  surfaceRaised: '#FFFFFF',
  text: '#123337',
  textMuted: '#4E686B',
  border: '#C6DFDF',
  primary: '#08747C',
  onPrimary: '#FFFFFF',
  primaryPressed: '#055A61',
  primarySoft: '#D5EFF0',
  danger: '#B03445',
  dangerSoft: '#F6DDE2',
  shadow: '#0C4A4F',
  nav: '#F6FCFC',
  presentation: {
    iconProfile: 'tide',
    markIcon: 'waves',
    cardRadius: 26,
    controlRadius: 999,
    iconRadius: 999,
    borderWidth: 1,
    cardPadding: 18,
    actionHeight: 116,
    gridGap: 10,
    titleSize: 28,
    titleLineHeight: 35,
    titleWeight: '700',
    titleTracking: -0.1,
    eyebrowTracking: 1,
    navIndicatorWidth: 60,
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffsetY: 7,
    elevation: 3,
  },
};

export const plumTheme: Theme = {
  isDark: false,
  background: '#F4EFF7',
  surface: '#FAF7FC',
  surfaceRaised: '#FFFFFF',
  text: '#2A1733',
  textMuted: '#685872',
  border: '#D7C8DE',
  primary: '#6E3482',
  onPrimary: '#FFFFFF',
  primaryPressed: '#542464',
  primarySoft: '#EADCF0',
  danger: '#A52A3A',
  dangerSoft: '#F4DDE2',
  shadow: '#2A1733',
  nav: '#FAF7FC',
  presentation: {
    iconProfile: 'plum',
    markIcon: 'flower-outline',
    cardRadius: 0,
    controlRadius: 999,
    iconRadius: 999,
    borderWidth: 1,
    cardPadding: 16,
    actionHeight: 110,
    gridGap: 8,
    titleSize: 33,
    titleLineHeight: 38,
    titleWeight: '900',
    titleTracking: -1.3,
    eyebrowTracking: 2.6,
    navIndicatorWidth: 56,
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffsetY: 0,
    elevation: 0,
  },
};

export const contrastTheme: Theme = {
  isDark: false,
  background: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceRaised: '#FFFFFF',
  text: '#000000',
  textMuted: '#2F2F2F',
  border: '#000000',
  primary: '#000000',
  onPrimary: '#FFFFFF',
  primaryPressed: '#333333',
  primarySoft: '#FFE949',
  danger: '#B00020',
  dangerSoft: '#FFDDE4',
  shadow: '#000000',
  nav: '#FFFFFF',
  presentation: {
    iconProfile: 'contrast',
    markIcon: 'contrast-circle',
    cardRadius: 0,
    controlRadius: 0,
    iconRadius: 0,
    borderWidth: 2.5,
    cardPadding: 14,
    actionHeight: 104,
    gridGap: 6,
    titleSize: 30,
    titleLineHeight: 35,
    titleWeight: '900',
    titleTracking: -1,
    eyebrowTracking: 2.4,
    navIndicatorWidth: 34,
    shadowOpacity: 0.28,
    shadowRadius: 0,
    shadowOffsetY: 4,
    elevation: 4,
  },
};

export const namedThemes: Record<NamedThemePreference, Theme> = {
  meadow: lightTheme,
  sunrise: sunriseTheme,
  midnight: darkTheme,
  paper: paperTheme,
  bubblegum: bubblegumTheme,
  blueprint: blueprintTheme,
  trail: trailTheme,
  tide: tideTheme,
  plum: plumTheme,
  contrast: contrastTheme,
};

const iconProfiles: Record<
  ThemeIconProfile,
  {
    events: Record<ThemeEventIcon, string>;
    navigation: Record<ThemeNavigationIcon, string>;
    more: string;
    routine: string;
  }
> = {
  meadow: {
    events: { pee: 'water-outline', poop: 'emoticon-poop-outline', meal: 'food-apple-outline', pottyTrip: 'door-open', walk: 'walk', nap: 'sleep', custom: 'tag-outline' },
    navigation: { log: 'home-variant-outline', timeline: 'timeline-clock-outline', insights: 'chart-line-variant', schedule: 'calendar-clock-outline' },
    more: 'plus-circle-outline',
    routine: 'calendar-clock-outline',
  },
  sunrise: {
    events: { pee: 'water', poop: 'emoticon-poop', meal: 'silverware-fork-knife', pottyTrip: 'door-open', walk: 'shoe-sneaker', nap: 'bed-clock', custom: 'tag' },
    navigation: { log: 'home-variant', timeline: 'timeline-clock', insights: 'chart-line', schedule: 'calendar-clock' },
    more: 'plus-circle',
    routine: 'calendar-clock',
  },
  midnight: {
    events: { pee: 'cup-water', poop: 'emoticon-poop-outline', meal: 'bowl-mix-outline', pottyTrip: 'door-open', walk: 'foot-print', nap: 'weather-night', custom: 'bookmark-outline' },
    navigation: { log: 'moon-waning-crescent', timeline: 'timeline-clock-outline', insights: 'chart-areaspline', schedule: 'calendar-month-outline' },
    more: 'plus-circle-multiple-outline',
    routine: 'calendar-month-outline',
  },
  paper: {
    events: { pee: 'water-opacity', poop: 'emoticon-poop', meal: 'silverware', pottyTrip: 'exit-run', walk: 'shoe-print', nap: 'bed-outline', custom: 'label-outline' },
    navigation: { log: 'notebook-outline', timeline: 'timeline-text-outline', insights: 'chart-box-outline', schedule: 'calendar-blank-outline' },
    more: 'note-plus-outline',
    routine: 'calendar-blank-outline',
  },
  bubblegum: {
    events: { pee: 'water-circle', poop: 'emoticon-poop', meal: 'cupcake', pottyTrip: 'door-open', walk: 'dog', nap: 'power-sleep', custom: 'sticker-emoji' },
    navigation: { log: 'home-heart', timeline: 'timeline-outline', insights: 'chart-bubble', schedule: 'calendar-heart' },
    more: 'shape-circle-plus',
    routine: 'calendar-heart',
  },
  blueprint: {
    events: { pee: 'water-sync', poop: 'emoticon-poop-outline', meal: 'food-outline', pottyTrip: 'door-sliding-open', walk: 'run-fast', nap: 'timer-sand', custom: 'vector-square' },
    navigation: { log: 'view-dashboard-outline', timeline: 'chart-timeline-variant-shimmer', insights: 'chart-line-variant', schedule: 'calendar-sync-outline' },
    more: 'plus-box-outline',
    routine: 'calendar-sync-outline',
  },
  trail: {
    events: { pee: 'cup-water', poop: 'emoticon-poop-outline', meal: 'food-apple', pottyTrip: 'door-open', walk: 'map-marker-path', nap: 'tent', custom: 'pine-tree' },
    navigation: { log: 'home-outline', timeline: 'timeline-clock-outline', insights: 'chart-line-variant', schedule: 'calendar-range-outline' },
    more: 'plus-box',
    routine: 'calendar-range-outline',
  },
  tide: {
    events: { pee: 'water-outline', poop: 'emoticon-poop-outline', meal: 'bowl-mix-outline', pottyTrip: 'door-open', walk: 'walk', nap: 'weather-night', custom: 'tag-heart-outline' },
    navigation: { log: 'home-variant-outline', timeline: 'timeline-clock-outline', insights: 'chart-bell-curve-cumulative', schedule: 'calendar-outline' },
    more: 'plus-circle-outline',
    routine: 'calendar-outline',
  },
  plum: {
    events: { pee: 'water-outline', poop: 'emoticon-poop-outline', meal: 'silverware-fork-knife', pottyTrip: 'door-open', walk: 'walk', nap: 'bed-outline', custom: 'bookmark-outline' },
    navigation: { log: 'newspaper-variant-outline', timeline: 'timeline-text-outline', insights: 'chart-box-outline', schedule: 'calendar-month-outline' },
    more: 'bookmark-plus-outline',
    routine: 'calendar-month-outline',
  },
  contrast: {
    events: { pee: 'water', poop: 'emoticon-poop', meal: 'food', pottyTrip: 'door-open', walk: 'walk', nap: 'sleep', custom: 'tag' },
    navigation: { log: 'home', timeline: 'timeline-clock', insights: 'chart-bar', schedule: 'calendar' },
    more: 'plus-box',
    routine: 'calendar',
  },
};

export function eventIcon(theme: Theme, type: ThemeEventIcon): string {
  return iconProfiles[theme.presentation.iconProfile].events[type];
}

export function navigationIcon(theme: Theme, tab: ThemeNavigationIcon): string {
  return iconProfiles[theme.presentation.iconProfile].navigation[tab];
}

export function supportingIcon(theme: Theme, icon: 'more' | 'routine'): string {
  return iconProfiles[theme.presentation.iconProfile][icon];
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

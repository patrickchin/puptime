export type Theme = typeof lightTheme;

export type ThemePreference = 'system' | 'meadow' | 'sunrise' | 'midnight';

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
};

export function isThemePreference(value: string | null): value is ThemePreference {
  return value === 'system' || value === 'meadow' || value === 'sunrise' || value === 'midnight';
}

export function resolveTheme(
  preference: ThemePreference,
  colorScheme: 'light' | 'dark' | 'unspecified' | null | undefined,
): Theme {
  if (preference === 'sunrise') return sunriseTheme;
  if (preference === 'midnight') return darkTheme;
  if (preference === 'system' && colorScheme === 'dark') return darkTheme;
  return lightTheme;
}

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;

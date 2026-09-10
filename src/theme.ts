export type Theme = typeof lightTheme;

export const lightTheme = {
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
  shadow: '#10251C',
  nav: '#FFFEFA',
};

export const darkTheme: Theme = {
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
  shadow: '#000000',
  nav: '#151E19',
};

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;

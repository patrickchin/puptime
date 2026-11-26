import { lightTheme, type Theme } from '../theme.ts';

// Website colors follow the terrier's forest-green fur, cream coat, and ochre ears.
export const websiteTheme: Theme = {
  ...lightTheme,
  background: '#F8F3E8',
  surface: '#FFFAF0',
  surfaceRaised: '#FFFAF0',
  text: '#173B30',
  textMuted: '#59675B',
  border: '#D8D4C3',
  primary: '#234B3B',
  primaryPressed: '#173B30',
  primarySoft: '#EDE4D0',
  nav: '#F8F3E8',
};

// The browser chrome matches the deep green site header.
export const websiteThemeColor = websiteTheme.primaryPressed;

export const websiteIconLinks = [
  { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
  { rel: 'manifest', href: '/site.webmanifest' },
];

export const websiteManifest = {
  name: 'Puptime', short_name: 'Puptime', start_url: '/', display: 'browser',
  theme_color: websiteThemeColor, background_color: websiteTheme.background,
  icons: [
    { src: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    { src: '/brand-icon.png', sizes: '256x256', type: 'image/png' },
  ],
};

export const websiteStyles = `
@font-face{font-family:'Red Hat Display';src:url('/fonts/RedHatDisplay-Latin.woff2') format('woff2');font-weight:900;font-style:normal;font-display:swap}
@font-face{font-family:'Red Hat Text';src:url('/fonts/RedHatText-Latin.woff2') format('woff2');font-weight:400 700;font-style:normal;font-display:swap}
.marketing-site{
  --paper:${websiteTheme.background};--white:${websiteTheme.surface};--ink:${websiteTheme.text};--muted:${websiteTheme.textMuted};--border:${websiteTheme.border};
  --green:${websiteTheme.primary};--deep:${websiteTheme.primaryPressed};--mint:${websiteTheme.primarySoft};--ochre:#EBAD43;--lime:#D7EC98;
  font-family:'Red Hat Text',sans-serif;
}
`;

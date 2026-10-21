import { lightTheme, type Theme } from '../theme';

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

export const websiteStyles = `
@font-face{font-family:'Red Hat Display';src:url('/fonts/RedHatDisplay-Latin.woff2') format('woff2');font-weight:900;font-style:normal;font-display:swap}
@font-face{font-family:'Red Hat Text';src:url('/fonts/RedHatText-Latin.woff2') format('woff2');font-weight:400 700;font-style:normal;font-display:swap}
.marketing-site,.account-page{
  --paper:${websiteTheme.background};--white:${websiteTheme.surface};--ink:${websiteTheme.text};--muted:${websiteTheme.textMuted};--border:${websiteTheme.border};
  --green:${websiteTheme.primary};--deep:${websiteTheme.primaryPressed};--mint:${websiteTheme.primarySoft};--ochre:#EBAD43;--lime:#D7EC98;
  font-family:'Red Hat Text',sans-serif;
}
`;

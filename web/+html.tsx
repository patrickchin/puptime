import type { PropsWithChildren } from 'react';
import { ScrollViewStyleReset } from 'expo-router/html';
import { websiteIconLinks, websiteThemeColor } from '../src/web/brand';

// Expo's default root document, plus the icons and theme color shared by every page.
export default function Root({ children }: PropsWithChildren) {
  return <html lang="en">
    <head>
      <meta charSet="utf-8" />
      <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
      <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
      <meta name="theme-color" content={websiteThemeColor} />
      {websiteIconLinks.map(({ rel, href }) => <link key={rel} rel={rel} href={href} />)}
      <ScrollViewStyleReset />
    </head>
    <body>{children}</body>
  </html>;
}

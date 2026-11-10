function origin(value: string) {
 const url = new URL(value);
 const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
 if (url.username || url.password || url.pathname !== '/' || url.search || url.hash || (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) throw new Error('Website URLs must be secure origins without paths.');
 return url;
}

export function webOrigins(site: string, app?: string) {
 const publicUrl = origin(site);
 const appUrl = app ? origin(app) : new URL(publicUrl);
 // Managed preview hosts and localhost need an explicitly deployed app origin.
 if (!app && !publicUrl.hostname.endsWith('.pages.dev') && !['localhost', '127.0.0.1', '[::1]'].includes(publicUrl.hostname)) appUrl.hostname = `app.${publicUrl.hostname.replace(/^www\./, '')}`;
 return { siteUrl: publicUrl.origin, appUrl: appUrl.origin };
}

export const { siteUrl, appUrl } = webOrigins(process.env.EXPO_PUBLIC_SITE_URL || 'https://puptime.pages.dev', process.env.EXPO_PUBLIC_APP_URL);
export const isAppSurface = process.env.EXPO_PUBLIC_WEB_SURFACE === 'app';
export const appHref = (path: '/account' | '/care') => appUrl === siteUrl ? path : appUrl + path;
export const publicSiteHref = (path = '/') => isAppSurface ? siteUrl + path : path;

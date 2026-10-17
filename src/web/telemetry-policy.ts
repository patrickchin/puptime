import { publicPaths, siteUrl } from './site.ts';

export const consentKey = 'puptime.website.analytics';
export type WebsiteEvent = 'website_page_view' | 'website_cta' | 'website_error';

// The final boundary also strips SDK-added URLs, referrers, text and campaign values.
export function sanitizeWebsiteEvent<T extends { event: string; properties: Record<string, unknown> }>(event: T): T | null {
  if (!['website_page_view', 'website_cta', 'website_error'].includes(event.event)) return null;
  const input = event.properties;
  const page = publicPaths.includes(String(input.page)) ? String(input.page) : '/404';
  const properties: Record<string, unknown> = { page, $current_url: `${siteUrl}${page}`, $pathname: page, $process_person_profile: false };
  for (const key of ['distinct_id', '$device_id', '$session_id', '$window_id', '$lib', '$lib_version', 'token']) {
    if (typeof input[key] === 'string') properties[key] = input[key];
  }
  if (['android_download', 'source'].includes(String(input.destination))) properties.destination = input.destination;
  if (['script', 'unhandled_rejection', 'render'].includes(String(input.error_kind))) properties.error_kind = input.error_kind;
  return { ...event, properties };
}

export function privacySignalActive(navigator: { doNotTrack?: string | null; globalPrivacyControl?: boolean }) {
  return navigator.doNotTrack === '1' || navigator.globalPrivacyControl === true;
}

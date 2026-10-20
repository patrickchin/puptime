import { publicPaths } from './site.ts';

export const consentKey = 'puptime.website.analytics';
export const telemetryPaths=[...publicPaths,'/account'];
export type WebsiteEvent = 'website_page_view' | 'website_cta' | 'website_error' | 'website_account';

// The final boundary also strips SDK-added URLs, referrers, text and campaign values.
export function sanitizeWebsiteEvent<T extends { event: string; properties: Record<string, unknown> }>(event: T): T | null {
  if (!['website_page_view', 'website_cta', 'website_error','website_account'].includes(event.event)) return null;
  const input = event.properties;
  const page = telemetryPaths.includes(String(input.page)) ? String(input.page) : '/404';
  const properties: Record<string, unknown> = { page, $pathname: page, $process_person_profile: false, $geoip_disable: true };
  for (const key of ['distinct_id', '$device_id', '$session_id', '$window_id', '$lib', '$lib_version', 'token']) {
    if (typeof input[key] === 'string') properties[key] = input[key];
  }
  if (['android_download', 'source'].includes(String(input.destination))) properties.destination = input.destination;
  if (['script', 'unhandled_rejection', 'render'].includes(String(input.error_kind))) properties.error_kind = input.error_kind;
  if(event.event==='website_account'){
    if(!['sign_in','request_code','sign_out','link_provider','export','delete'].includes(String(input.action))||!['started','success','error','cancelled'].includes(String(input.result)))return null;
    properties.action=input.action;properties.result=input.result;
  }
  return { ...event, properties };
}

export function privacySignalActive(navigator: { doNotTrack?: string | null; globalPrivacyControl?: boolean }) {
  return navigator.doNotTrack === '1' || navigator.globalPrivacyControl === true;
}

import type { PostHog } from 'posthog-js';
import { consentKey, privacySignalActive, sanitizeWebsiteEvent, telemetryPaths, type WebsiteEvent } from './telemetry-policy';

export const posthogConfigured = Boolean(process.env.EXPO_PUBLIC_POSTHOG_KEY);
let client: PostHog | undefined;
let allowed = false;
let generation = 0;
let page = '/';
let consentRequests: AbortController | undefined;

export function storedConsent() {
  try { return localStorage.getItem(consentKey); } catch { return null; }
}

export async function setAnalyticsEnabled(enabled: boolean, path: string) {
  const current = ++generation;
  allowed = enabled && !privacySignalActive(navigator);
  page = path === '/puppy-care' ? '/puppy-care/' : telemetryPaths.includes(path) ? path : '/404';
  if (!allowed) {
    consentRequests?.abort();
    consentRequests = undefined;
    // reset clears SDK consent; opt out last and replace the device ID too.
    client?.reset(true);
    client?.opt_out_capturing();
    return;
  }
  if (!posthogConfigured) return;
  try {
    const { default: posthog } = await import('posthog-js');
    if (current !== generation || !allowed) return;
    consentRequests ??= new AbortController();
    // Fetch options also apply to SDK retries. An old consent period keeps its
    // aborted signal even if the visitor later opts in again.
    const fetchOptions: RequestInit = { cache: 'no-store', signal: consentRequests.signal, credentials: 'omit', referrerPolicy: 'no-referrer' };
    if (!client) {
      client = posthog.init(process.env.EXPO_PUBLIC_POSTHOG_KEY!, {
        api_host: process.env.EXPO_PUBLIC_POSTHOG_HOST || 'https://eu.i.posthog.com',
        api_transport: 'fetch',
        fetch_options: fetchOptions,
        disable_beacon: true,
        request_batching: false,
        autocapture: false,
        capture_pageview: false,
        capture_pageleave: false,
        capture_exceptions: false,
        capture_performance: false,
        disable_session_recording: true,
        disable_surveys: true,
        disable_external_dependency_loading: true,
        advanced_disable_flags: true,
        advanced_disable_feature_flags: true,
        person_profiles: 'never',
        persistence: 'localStorage',
        opt_out_capturing_by_default: true,
        opt_out_persistence_by_default: true,
        save_referrer: false,
        save_campaign_params: false,
        respect_dnt: true,
        before_send: (event) => event ? sanitizeWebsiteEvent(event) : null,
      });
    }
    client?.set_config({ fetch_options: fetchOptions });
    client?.opt_in_capturing({ captureEventName: false });
    captureWebsiteEvent('website_page_view');
  } catch {
    // A blocked/unavailable analytics provider must never prevent browsing.
  }
}

export function captureWebsiteEvent(event: WebsiteEvent, properties: { destination?: 'android_download' | 'source'; error_kind?: 'script' | 'unhandled_rejection' | 'render';action?:'sign_in'|'request_code'|'sign_out'|'link_provider'|'export'|'delete';result?:'started'|'success'|'error'|'cancelled' } = {}) {
  if (allowed && !privacySignalActive(navigator)) client?.capture(event, { page, ...properties });
}

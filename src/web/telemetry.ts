import type { PostHog } from 'posthog-js';
import { consentKey, privacySignalActive, sanitizeWebsiteEvent, type WebsiteEvent } from './telemetry-policy';
import { publicPaths } from './site';

export const posthogConfigured = Boolean(process.env.EXPO_PUBLIC_POSTHOG_KEY);
let client: PostHog | undefined;
let allowed = false;
let generation = 0;
let page = '/';

export function storedConsent() {
  try { return localStorage.getItem(consentKey); } catch { return null; }
}

export async function setAnalyticsEnabled(enabled: boolean, path: string) {
  const current = ++generation;
  allowed = enabled && !privacySignalActive(navigator);
  page = path === '/puppy-care' ? '/puppy-care/' : publicPaths.includes(path) ? path : '/404';
  if (!allowed) {
    client?.opt_out_capturing();
    client?.reset();
    return;
  }
  if (!posthogConfigured) return;
  try {
    const { default: posthog } = await import('posthog-js');
    if (current !== generation || !allowed) return;
    if (!client) {
      client = posthog.init(process.env.EXPO_PUBLIC_POSTHOG_KEY!, {
        api_host: process.env.EXPO_PUBLIC_POSTHOG_HOST || 'https://eu.i.posthog.com',
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
        respect_dnt: true,
        before_send: (event) => event ? sanitizeWebsiteEvent(event) : null,
      });
    }
    client?.opt_in_capturing({ captureEventName: false });
    captureWebsiteEvent('website_page_view');
  } catch {
    // A blocked/unavailable analytics provider must never prevent browsing.
  }
}

export function captureWebsiteEvent(event: WebsiteEvent, properties: { destination?: 'android_download' | 'source'; error_kind?: 'script' | 'unhandled_rejection' | 'render' } = {}) {
  if (allowed && !privacySignalActive(navigator)) client?.capture(event, { page, ...properties });
}

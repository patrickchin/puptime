import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import type { CaptureEvent, PostHogFetchOptions, PostHogFetchResponse } from '@posthog/core';
import { entityId } from './entity-id';
import { createProductTelemetry, sanitizeProductEvent, type TelemetryScreen } from './product-telemetry';

const consentKey = 'puptime.app.analytics.v1';
export const appTelemetryConfigured = Boolean(process.env.EXPO_PUBLIC_APP_POSTHOG_KEY);
let client: import('posthog-react-native').PostHog | undefined;
let period: AbortController | undefined;
let generation = 0;
let initialization: Promise<boolean> | undefined;
let consentEnabled = false;

export const productTelemetry = createProductTelemetry((event, properties) => client?.capture(event, properties));

function scrub(event: CaptureEvent): CaptureEvent | null {
  const input = event.properties ?? {};
  const properties = sanitizeProductEvent(event.event, input);
  if (!properties) return null;
  for (const key of ['distinct_id', '$device_id', '$session_id', '$lib', '$lib_version', 'token']) {
    if (typeof input[key] === 'string') properties[key] = input[key];
  }
  return { event: event.event, uuid: event.uuid, timestamp: event.timestamp, properties: {
    ...properties, platform: Platform.OS, app_version: Application.nativeApplicationVersion ?? 'development',
    $process_person_profile: false, $geoip_disable: true,
  } };
}

async function start(id: string, revision: number) {
  if (!appTelemetryConfigured) return;
  try {
    const { PostHog } = await import('posthog-react-native');
    if (revision !== generation) return;
    const requests = new AbortController();
    const host = (process.env.EXPO_PUBLIC_APP_POSTHOG_HOST || 'https://eu.i.posthog.com').replace(/\/$/, '');
    // Use the official native SDK's transport hook to bind requests and retries
    // to this consent period. Remote config cannot turn on additional capture.
    class ConsentedPostHog extends PostHog {
      override async fetch(url: string, options: PostHogFetchOptions): Promise<PostHogFetchResponse> {
        if (requests.signal.aborted || revision !== generation) return { status: 200, text: async () => '{}', json: async () => ({}) };
        if (url.split('?')[0] !== `${host}/batch/`) return { status: 200, text: async () => '{}', json: async () => ({}) };
        const controller = new AbortController();
        const abort = () => controller.abort();
        requests.signal.addEventListener('abort', abort);
        options.signal?.addEventListener('abort', abort);
        if (options.signal?.aborted) controller.abort();
        try { return await fetch(url, { ...options, body: options.body as RequestInit['body'], signal: controller.signal, credentials: 'omit' }); }
        catch (error) {
          if (requests.signal.aborted) return { status: 200, text: async () => '{}', json: async () => ({}) };
          throw error;
        }
        finally { requests.signal.removeEventListener('abort', abort); options.signal?.removeEventListener('abort', abort); }
      }
    }
    period = requests;
    const next = new ConsentedPostHog(process.env.EXPO_PUBLIC_APP_POSTHOG_KEY!, {
      host, persistence: 'memory', bootstrap: { distinctId: id, isIdentifiedId: false },
      defaultOptIn: true, personProfiles: 'never', disableGeoip: true,
      captureAppLifecycleEvents: false, enableSessionReplay: false,
      capturePushNotificationSubscriptions: false, capturePushNotificationOpened: false,
      preloadFeatureFlags: false, disableRemoteFeatureFlags: true, disableSurveys: true,
      setDefaultPersonProperties: false, customAppProperties: {},
      errorTracking: { autocapture: false }, before_send: scrub,
      flushAt: 20, flushInterval: 15_000, maxQueueSize: 200, fetchRetryCount: 1,
    });
    await next.ready();
    if (revision !== generation) { requests.abort(); await next.optOut(); await next.shutdown(); return; }
    client = next;
    productTelemetry.setEnabled(true);
  } catch { /* Missing/blocked analytics must never prevent local use. */ }
}

function stop() {
  ++generation;
  productTelemetry.setEnabled(false);
  period?.abort(); period = undefined;
  const previous = client; client = undefined;
  if (previous) {
    previous.reset();
    void previous.optOut().then(() => previous.shutdown()).catch(() => {});
  }
}

export function initializeAppTelemetry(): Promise<boolean> {
  initialization ??= (async () => {
    const revision = generation;
    try {
      const saved = JSON.parse(await AsyncStorage.getItem(consentKey) ?? 'null');
      if (revision !== generation) return false;
      if (saved?.enabled === true && /^ano_[a-f0-9]{32}$/.test(saved.id)) {
        consentEnabled = true;
        await start(saved.id, revision); return true;
      }
    } catch { /* Missing or unreadable consent fails closed. */ }
    return false;
  })();
  return initialization.then(() => consentEnabled);
}

export async function setAppTelemetryEnabled(enabled: boolean) {
  // Stop synchronously, even if saving the user's withdrawal subsequently fails.
  stop();
  const revision = generation;
  const id = enabled ? entityId('ano') : undefined;
  await AsyncStorage.setItem(consentKey, JSON.stringify({ enabled, ...(id ? { id } : {}) }));
  consentEnabled = enabled;
  if (enabled && revision === generation) await start(id!, revision);
}

export async function flushAppTelemetry() { try { await client?.flush(); } catch { /* Best effort. */ } }
export function useTelemetryOverlay(screen: TelemetryScreen, visible: boolean) {
  useEffect(() => visible ? productTelemetry.overlay(screen) : undefined, [screen, visible]);
}
